-- 第四阶段：店地图、机器人查询与对话、大屏。第十二组补全。
CREATE TABLE map_layout (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id uuid NOT NULL REFERENCES company(id),
  site_id uuid NOT NULL REFERENCES site(id),
  version int NOT NULL DEFAULT 1,
  width int NOT NULL DEFAULT 40, height int NOT NULL DEFAULT 30,   -- 格子数
  kiosk_x int NOT NULL DEFAULT 0, kiosk_y int NOT NULL DEFAULT 0,
  entrance_x int, entrance_y int,
  walkable_grid jsonb,                        -- 可选：行数组，1 可走 0 不可走；空则按元素自动算
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PUBLISHED')),
  published_at timestamptz,
  created_at timestamptz, created_by uuid, updated_at timestamptz, updated_by uuid
);
CREATE UNIQUE INDEX map_layout_site_version ON map_layout (site_id, version);
CREATE TRIGGER t_audit_cols BEFORE INSERT OR UPDATE ON map_layout FOR EACH ROW EXECUTE FUNCTION trg_set_audit_cols();

CREATE TABLE map_element (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id uuid NOT NULL,
  map_layout_id uuid NOT NULL REFERENCES map_layout(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('ZONE','RACK','AISLE','ENTRANCE','KIOSK','COUNTER','WALL','LABEL')),
  zone_id uuid REFERENCES zone(id),
  location_id uuid REFERENCES location(id),
  rack int,
  x int NOT NULL, y int NOT NULL, w int NOT NULL DEFAULT 1, h int NOT NULL DEFAULT 1,
  rotation int NOT NULL DEFAULT 0,
  label text,
  color text
);
CREATE INDEX map_element_layout ON map_element (map_layout_id);

-- 机器人固定查询清单（系统级，所有公司共用；LLM 只能选查询填参数）
CREATE TABLE bot_query (
  code text PRIMARY KEY,
  description_zh text NOT NULL, description_ms text, description_en text,
  required_permission text,
  params_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  examples jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true
);
INSERT INTO bot_query (code, description_zh, description_ms, description_en, required_permission, params_json, examples) VALUES
('STOCK_BY_BARCODE','这个条码在哪里还有多少','Kod bar ini ada di mana dan berapa','Where is this barcode and how many','stock.view','[{"name":"barcode_or_name","type":"string"}]','["可乐还有多少","9556001234567 在哪"]'),
('PRODUCT_LOCATION_SHOP','产品在哪个货架','Produk di rak mana','Which shelf is the product on',NULL,'[{"name":"product","type":"string"}]','["可乐放哪里","Milo kat mana"]'),
('ZONE_CONTENTS','某区有什么','Apa ada dalam zon','What is in a zone','stock.view','[{"name":"zone_code","type":"string"}]','["A 区有什么","S-01 有什么"]'),
('LOW_STOCK','今天什么要补','Apa perlu diisi hari ini','What needs refill today','order.view','[]','["今天要补什么","什么缺货"]'),
('EXPIRING','什么快到期','Apa hampir luput','What is expiring soon','stock.view','[{"name":"days","type":"int","default":7}]','["这周什么到期","快过期的"]'),
('TODAY_SALES','今天卖了多少','Jualan hari ini','Today sales','report.sales','[]','["今天卖了多少","今天销售"]'),
('PRODUCT_SALES_30D','一个月卖多少','Jualan sebulan','Product sales last 30 days','report.sales','[{"name":"product","type":"string"}]','["可乐一个月卖多少"]'),
('MY_TICKETS','我有什么工单','Tiket saya','My tickets',NULL,'[]','["我有什么工单","我的任务"]'),
('PENDING_APPROVALS','什么等我批','Apa menunggu kelulusan saya','What awaits my approval',NULL,'[]','["什么等我批","待审批"]'),
('PO_STATUS','货什么时候到','Bila barang sampai','PO status','po.view','[{"name":"supplier_or_product","type":"string"}]','["可乐的货什么时候到","PO 状态"]'),
('TRANSFER_STATUS','调拨到了没','Pindahan sampai belum','Transfer status','transfer.view','[]','["调拨到了没","调货"]'),
('PRODUCT_COST','成本多少','Kos berapa','Product cost','product.view_cost','[{"name":"product","type":"string"}]','["可乐成本多少"]'),
('DEVICE_STATUS','哪台掉线','Peranti mana luar talian','Device status','device.view','[]','["哪台掉线","设备状态"]'),
('HOW_TO','怎么做某个操作（查 SOP）','Cara buat','How to do something (SOP)',NULL,'[{"name":"question","type":"string"}]','["怎么收货","怎么盘点"]')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE bot_conversation (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id uuid NOT NULL REFERENCES company(id),
  user_id uuid NOT NULL,
  channel text NOT NULL DEFAULT 'APP' CHECK (channel IN ('APP','TELEGRAM')),
  question_text text NOT NULL,
  question_audio_url text,
  detected_language text,
  intent text,                                -- DATA | HOWTO | OTHER
  query_code text,
  params jsonb,
  answer_text text,
  answered boolean NOT NULL DEFAULT false,
  ticket_id uuid,
  knowledge_id uuid,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bot_conversation_company ON bot_conversation (company_id, answered, at DESC);

-- 大屏会话（叫员工的排队，离线后补）
ALTER TABLE knowledge_article ADD COLUMN IF NOT EXISTS keywords text;
ALTER TABLE knowledge_article ADD COLUMN IF NOT EXISTS hit_count int NOT NULL DEFAULT 0;

-- 促销（大屏待机轮播）
CREATE TABLE promotion (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id uuid NOT NULL REFERENCES company(id),
  site_id uuid REFERENCES site(id),
  product_id uuid REFERENCES product(id),
  title_zh text, title_ms text, title_en text,
  promo_price numeric(14,2),
  image_url text,
  starts_on date NOT NULL DEFAULT current_date, ends_on date,
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz, created_by uuid, updated_at timestamptz, updated_by uuid
);
CREATE TRIGGER t_audit_cols BEFORE INSERT OR UPDATE ON promotion FOR EACH ROW EXECUTE FUNCTION trg_set_audit_cols();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['map_layout','promotion'] LOOP
    EXECUTE format('CREATE TRIGGER t_audit AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION trg_audit_row()', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['map_layout','map_element','bot_conversation','promotion'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY rls_%I ON %I USING (company_id = app_company_id())', t, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO app_rw', t);
    EXECUTE format('GRANT ALL ON %I TO app_admin', t);
    EXECUTE format('GRANT SELECT ON %I TO app_ro', t);
  END LOOP;
END $$;
GRANT DELETE ON map_element, promotion TO app_rw;
GRANT SELECT ON bot_query TO app_rw, app_ro; GRANT ALL ON bot_query TO app_admin;
GRANT DELETE ON knowledge_article TO app_rw;
