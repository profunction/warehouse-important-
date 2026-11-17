-- 第二组：产品
CREATE TABLE category (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id uuid NOT NULL REFERENCES company(id),
  code text NOT NULL CHECK (code ~ '^[A-Z0-9_]{2,10}$'),
  name_zh text, name_ms text, name_en text,
  icon text NOT NULL DEFAULT 'tag',
  color text NOT NULL DEFAULT '#9E9E9E',
  parent_id uuid REFERENCES category(id),
  default_backroom_code text,
  default_shelf_life_days smallint,
  default_unit text NOT NULL DEFAULT 'PCS' CHECK (default_unit IN ('PCS','KG')),
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz, created_by uuid, updated_at timestamptz, updated_by uuid,
  UNIQUE (company_id, code),
  CHECK (coalesce(name_zh, name_ms, name_en) IS NOT NULL)
);
CREATE TRIGGER t_audit_cols BEFORE INSERT OR UPDATE ON category FOR EACH ROW EXECUTE FUNCTION trg_set_audit_cols();
CREATE OR REPLACE FUNCTION trg_category_depth() RETURNS trigger AS $$
BEGIN
  IF NEW.parent_id IS NOT NULL AND EXISTS (SELECT 1 FROM category WHERE id = NEW.parent_id AND parent_id IS NOT NULL) THEN
    RAISE EXCEPTION '类别最多两层 / Category depth max 2';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER t_depth BEFORE INSERT OR UPDATE ON category FOR EACH ROW EXECUTE FUNCTION trg_category_depth();

CREATE TABLE zone_category (
  zone_id uuid NOT NULL REFERENCES zone(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES category(id),
  PRIMARY KEY (zone_id, category_id)
);

CREATE TABLE tax_code (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id uuid NOT NULL REFERENCES company(id),
  code text NOT NULL,
  rate numeric(5,2) NOT NULL CHECK (rate BETWEEN 0 AND 100),
  myinvois_tax_type text NOT NULL DEFAULT '06',
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz, created_by uuid, updated_at timestamptz, updated_by uuid,
  UNIQUE (company_id, code)
);
CREATE UNIQUE INDEX tax_code_default ON tax_code (company_id) WHERE is_default;
CREATE TRIGGER t_audit_cols BEFORE INSERT OR UPDATE ON tax_code FOR EACH ROW EXECUTE FUNCTION trg_set_audit_cols();

CREATE TABLE supplier (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id uuid NOT NULL REFERENCES company(id),
  name text NOT NULL,
  tin text,
  email text CHECK (email IS NULL OR email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone text, whatsapp text,
  payment_terms_days smallint NOT NULL DEFAULT 30,
  lead_time_days smallint NOT NULL DEFAULT 3,
  min_order_amount numeric(14,2) NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz, created_by uuid, updated_at timestamptz, updated_by uuid
);
CREATE UNIQUE INDEX supplier_name_unique ON supplier (company_id, lower(name));
CREATE TRIGGER t_audit_cols BEFORE INSERT OR UPDATE ON supplier FOR EACH ROW EXECUTE FUNCTION trg_set_audit_cols();

CREATE TABLE product (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id uuid NOT NULL REFERENCES company(id),
  sku text NOT NULL,
  name_zh text CHECK (name_zh IS NULL OR length(name_zh) <= 60),
  name_ms text CHECK (name_ms IS NULL OR length(name_ms) <= 60),
  name_en text CHECK (name_en IS NULL OR length(name_en) <= 60),
  name_pinyin text,                 -- 服务器写入
  search_text text NOT NULL DEFAULT '',
  photo_url text,
  category_id uuid NOT NULL REFERENCES category(id),
  unit text NOT NULL CHECK (unit IN ('PCS','KG')),
  is_weighed boolean NOT NULL DEFAULT false,
  plu_code text CHECK (plu_code IS NULL OR plu_code ~ '^[0-9]{5}$'),
  cost_price numeric(14,2) NOT NULL CHECK (cost_price >= 0),
  sell_price numeric(14,2) NOT NULL CHECK (sell_price > 0),
  tax_code_id uuid NOT NULL REFERENCES tax_code(id),
  min_level numeric(14,3) NOT NULL CHECK (min_level >= 0),
  reorder_qty numeric(14,3) NOT NULL CHECK (reorder_qty > 0),
  reorder_days smallint NOT NULL DEFAULT 7,
  default_supplier_id uuid REFERENCES supplier(id),
  default_location_id uuid REFERENCES location(id),
  shelf_life_days smallint,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz, created_by uuid, updated_at timestamptz, updated_by uuid,
  UNIQUE (company_id, sku),
  CHECK (coalesce(name_zh, name_ms, name_en) IS NOT NULL),
  CHECK (unit <> 'KG' OR is_weighed),
  CHECK (NOT is_weighed OR plu_code IS NOT NULL)
);
CREATE UNIQUE INDEX product_plu_unique ON product (company_id, plu_code) WHERE plu_code IS NOT NULL;
CREATE INDEX product_category ON product (company_id, category_id);
CREATE INDEX product_search_trgm ON product USING gin (search_text gin_trgm_ops);
CREATE INDEX product_updated ON product (company_id, updated_at);
CREATE TRIGGER t_audit_cols BEFORE INSERT OR UPDATE ON product FOR EACH ROW EXECUTE FUNCTION trg_set_audit_cols();

CREATE TABLE barcode (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id uuid NOT NULL REFERENCES company(id),
  product_id uuid NOT NULL REFERENCES product(id),
  barcode text NOT NULL CHECK (barcode ~ '^[0-9]{8,14}$'),
  pack_qty numeric(14,3) NOT NULL CHECK (pack_qty > 0),
  barcode_type text NOT NULL CHECK (barcode_type IN ('UNIT','CASE','SCALE_PLU')),
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz, created_by uuid, updated_at timestamptz, updated_by uuid,
  UNIQUE (company_id, barcode),
  CHECK (barcode_type <> 'UNIT' OR pack_qty = 1)
);
CREATE UNIQUE INDEX barcode_primary_unique ON barcode (product_id) WHERE is_primary;
CREATE INDEX barcode_product ON barcode (product_id);
CREATE INDEX barcode_updated ON barcode (company_id, updated_at);
CREATE TRIGGER t_audit_cols BEFORE INSERT OR UPDATE ON barcode FOR EACH ROW EXECUTE FUNCTION trg_set_audit_cols();

-- search_text：三语 + 拼音 + 所有条码 + sku
CREATE OR REPLACE FUNCTION refresh_product_search(pid uuid) RETURNS void AS $$
  UPDATE product p SET search_text = lower(concat_ws(' ', p.sku, p.name_zh, p.name_ms, p.name_en, p.name_pinyin, p.plu_code,
      (SELECT string_agg(b.barcode, ' ') FROM barcode b WHERE b.product_id = p.id)))
  WHERE p.id = pid;
$$ LANGUAGE sql SECURITY DEFINER;
CREATE OR REPLACE FUNCTION trg_product_search() RETURNS trigger AS $$
BEGIN
  NEW.search_text := lower(concat_ws(' ', NEW.sku, NEW.name_zh, NEW.name_ms, NEW.name_en, NEW.name_pinyin, NEW.plu_code,
      (SELECT string_agg(b.barcode, ' ') FROM barcode b WHERE b.product_id = NEW.id)));
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER t_search BEFORE INSERT OR UPDATE OF sku, name_zh, name_ms, name_en, name_pinyin, plu_code ON product FOR EACH ROW EXECUTE FUNCTION trg_product_search();
CREATE OR REPLACE FUNCTION trg_barcode_search() RETURNS trigger AS $$
BEGIN
  PERFORM refresh_product_search(COALESCE(NEW.product_id, OLD.product_id));
  RETURN COALESCE(NEW, OLD);
END $$ LANGUAGE plpgsql;
CREATE TRIGGER t_search AFTER INSERT OR UPDATE OR DELETE ON barcode FOR EACH ROW EXECUTE FUNCTION trg_barcode_search();

CREATE TABLE price_history (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id uuid NOT NULL,
  product_id uuid NOT NULL REFERENCES product(id),
  cost_price numeric(14,2) NOT NULL,
  sell_price numeric(14,2) NOT NULL,
  effective_from timestamptz NOT NULL DEFAULT now(),
  changed_by uuid,
  source text NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL','IMPORT','APPROVAL'))
);
CREATE INDEX price_history_product ON price_history (product_id, effective_from DESC);
CREATE OR REPLACE FUNCTION trg_price_history() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.cost_price <> OLD.cost_price OR NEW.sell_price <> OLD.sell_price THEN
    INSERT INTO price_history (company_id, product_id, cost_price, sell_price, changed_by, source)
    VALUES (NEW.company_id, NEW.id, NEW.cost_price, NEW.sell_price, app_user_id(),
            COALESCE(NULLIF(current_setting('app.price_source', true), ''), 'MANUAL'));
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER;
CREATE TRIGGER t_price_history AFTER INSERT OR UPDATE OF cost_price, sell_price ON product FOR EACH ROW EXECUTE FUNCTION trg_price_history();

CREATE TABLE product_supplier (
  product_id uuid NOT NULL REFERENCES product(id),
  supplier_id uuid NOT NULL REFERENCES supplier(id),
  supplier_sku text,
  last_cost numeric(14,2),
  lead_time_days smallint,
  is_preferred boolean NOT NULL DEFAULT false,
  PRIMARY KEY (product_id, supplier_id)
);

CREATE TABLE product_site_setting (
  product_id uuid NOT NULL REFERENCES product(id),
  site_id uuid NOT NULL REFERENCES site(id),
  min_level numeric(14,3),
  reorder_qty numeric(14,3),
  shelf_min_level numeric(14,3),
  PRIMARY KEY (product_id, site_id)
);
