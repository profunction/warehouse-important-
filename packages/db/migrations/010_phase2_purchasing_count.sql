-- 第二阶段：采购、收货、调拨、盘点、代理、单据编号。第四五六组表。
-- 单据编号：每公司每类一个序列（PO-2026-0001 / GRN / TR / CS / INV / SI / RCPT 按店+机）
CREATE TABLE doc_sequence (
  company_id uuid NOT NULL REFERENCES company(id),
  kind text NOT NULL,
  scope text NOT NULL DEFAULT '',
  last_no bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (company_id, kind, scope)
);
CREATE OR REPLACE FUNCTION next_doc_no(p_company uuid, p_kind text, p_prefix text, p_scope text DEFAULT '', p_width int DEFAULT 4) RETURNS text AS $$
DECLARE n bigint;
BEGIN
  INSERT INTO doc_sequence (company_id, kind, scope, last_no) VALUES (p_company, p_kind, p_scope, 1)
  ON CONFLICT (company_id, kind, scope) DO UPDATE SET last_no = doc_sequence.last_no + 1 RETURNING last_no INTO n;
  RETURN p_prefix || lpad(n::text, p_width, '0');
END $$ LANGUAGE plpgsql;

-- 放宽审批类型、工单类型、移动参照类型
ALTER TABLE approval_request DROP CONSTRAINT IF EXISTS approval_request_type_check;
ALTER TABLE approval_request ADD CONSTRAINT approval_request_type_check CHECK (type IN ('IMPORT','ORDER','COUNT_VARIANCE','RETURN','PO_PRICE_CHANGE','ADJUST','TRANSFER','PAYMENT','PRICE_CHANGE','PO','VOID_SALE','SUPPLIER_INVOICE','DISCOUNT'));
ALTER TABLE approval_request ADD COLUMN IF NOT EXISTS amount numeric(14,2);
ALTER TABLE approval_request ADD COLUMN IF NOT EXISTS site_id uuid;
ALTER TABLE approval_request ADD COLUMN IF NOT EXISTS telegram_message_id text;
ALTER TABLE ticket DROP CONSTRAINT IF EXISTS ticket_type_check;
ALTER TABLE ticket ADD CONSTRAINT ticket_type_check CHECK (type IN ('COUNT_VARIANCE','RECEIVE_VARIANCE','TRANSFER_VARIANCE','NEGATIVE_STOCK','CUSTOMER_HELP','BOT_UNANSWERED','DEVICE','UNKNOWN_BARCODE','OVERDUE_AR','OVERDUE_AP','SYNC_QUARANTINE','MANUAL','RECEIVE_DAMAGE','EINVOICE','PANDAL_UNKNOWN','AP_VARIANCE'));
ALTER TABLE movement DROP CONSTRAINT IF EXISTS movement_ref_type_check;
ALTER TABLE movement ADD CONSTRAINT movement_ref_type_check CHECK (ref_type IS NULL OR ref_type IN ('IMPORT','GRN','TRANSFER','SALE','RETURN','COUNT','ADJUST','MANUAL'));

-- ---------- 第四组：订货建议、采购单、收货 ----------
CREATE TABLE order_proposal (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id uuid NOT NULL REFERENCES company(id),
  site_id uuid REFERENCES site(id),
  proposal_date date NOT NULL DEFAULT current_date,
  status text NOT NULL DEFAULT 'PENDING_REVIEW' CHECK (status IN ('PENDING_REVIEW','PENDING_APPROVAL','APPROVED','REJECTED','RETURNED')),
  source text NOT NULL DEFAULT 'AUTO' CHECK (source IN ('AUTO','MANUAL')),
  reviewed_by uuid, approved_by uuid, approved_at timestamptz,
  approval_id uuid,
  telegram_message_id text,
  note text,
  created_at timestamptz, created_by uuid, updated_at timestamptz, updated_by uuid
);
CREATE INDEX order_proposal_company ON order_proposal (company_id, proposal_date DESC);
CREATE TRIGGER t_audit_cols BEFORE INSERT OR UPDATE ON order_proposal FOR EACH ROW EXECUTE FUNCTION trg_set_audit_cols();

CREATE TABLE order_proposal_line (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id uuid NOT NULL,
  proposal_id uuid NOT NULL REFERENCES order_proposal(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES product(id),
  supplier_id uuid REFERENCES supplier(id),
  current_qty numeric(14,3) NOT NULL DEFAULT 0,
  avg_daily_sales numeric(14,3) NOT NULL DEFAULT 0,
  suggested_qty numeric(14,3) NOT NULL DEFAULT 0,
  final_qty numeric(14,3) NOT NULL DEFAULT 0,
  unit_cost numeric(14,2) NOT NULL DEFAULT 0,
  is_removed boolean NOT NULL DEFAULT false,
  note text
);
CREATE INDEX order_proposal_line_p ON order_proposal_line (proposal_id);

CREATE TABLE purchase_order (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id uuid NOT NULL REFERENCES company(id),
  po_no text NOT NULL,
  supplier_id uuid NOT NULL REFERENCES supplier(id),
  deliver_to_site_id uuid REFERENCES site(id),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PENDING_APPROVAL','SENT','PARTIAL','RECEIVED','CLOSED','CANCELLED')),
  proposal_id uuid REFERENCES order_proposal(id),
  approval_id uuid,
  total_amount numeric(14,2) NOT NULL DEFAULT 0,
  expected_date date,
  sent_at timestamptz, sent_via text,
  pdf_url text, xlsx_url text,
  note text,
  created_at timestamptz, created_by uuid, updated_at timestamptz, updated_by uuid,
  UNIQUE (company_id, po_no)
);
CREATE INDEX purchase_order_status ON purchase_order (company_id, status, created_at DESC);
CREATE TRIGGER t_audit_cols BEFORE INSERT OR UPDATE ON purchase_order FOR EACH ROW EXECUTE FUNCTION trg_set_audit_cols();

CREATE TABLE purchase_order_line (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id uuid NOT NULL,
  po_id uuid NOT NULL REFERENCES purchase_order(id) ON DELETE CASCADE,
  line_no int NOT NULL DEFAULT 1,
  product_id uuid NOT NULL REFERENCES product(id),
  ordered_qty numeric(14,3) NOT NULL CHECK (ordered_qty > 0),
  unit_cost numeric(14,2) NOT NULL DEFAULT 0,
  received_qty numeric(14,3) NOT NULL DEFAULT 0,
  UNIQUE (po_id, product_id)
);

CREATE TABLE goods_receipt (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id uuid NOT NULL REFERENCES company(id),
  grn_no text NOT NULL,
  po_id uuid REFERENCES purchase_order(id),
  site_id uuid REFERENCES site(id),
  supplier_id uuid REFERENCES supplier(id),
  received_by uuid NOT NULL REFERENCES app_user(id),
  status text NOT NULL DEFAULT 'IN_PROGRESS' CHECK (status IN ('IN_PROGRESS','COMPLETED','CANCELLED')),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  short_count int NOT NULL DEFAULT 0, over_count int NOT NULL DEFAULT 0, damaged_count int NOT NULL DEFAULT 0,
  pdf_url text,
  created_at timestamptz, created_by uuid, updated_at timestamptz, updated_by uuid,
  UNIQUE (company_id, grn_no)
);
CREATE INDEX goods_receipt_po ON goods_receipt (company_id, po_id, status);
CREATE TRIGGER t_audit_cols BEFORE INSERT OR UPDATE ON goods_receipt FOR EACH ROW EXECUTE FUNCTION trg_set_audit_cols();

CREATE TABLE goods_receipt_line (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id uuid NOT NULL,
  grn_id uuid NOT NULL REFERENCES goods_receipt(id) ON DELETE CASCADE,
  po_line_id uuid REFERENCES purchase_order_line(id),
  product_id uuid NOT NULL REFERENCES product(id),
  expected_qty numeric(14,3) NOT NULL DEFAULT 0,
  received_qty numeric(14,3) NOT NULL DEFAULT 0,
  damaged_qty numeric(14,3) NOT NULL DEFAULT 0,
  expiry_date date,
  to_location_id uuid REFERENCES location(id),
  movement_id uuid,
  damage_movement_id uuid,
  photo_url text,
  client_id uuid UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX goods_receipt_line_grn ON goods_receipt_line (grn_id);

-- ---------- 第五组：调拨 ----------
CREATE TABLE transfer (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id uuid NOT NULL REFERENCES company(id),
  transfer_no text NOT NULL,
  from_site_id uuid NOT NULL REFERENCES site(id),
  to_site_id uuid NOT NULL REFERENCES site(id),
  status text NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED','APPROVED','PICKING','IN_TRANSIT','RECEIVED','CLOSED','REJECTED','CANCELLED')),
  requested_by uuid NOT NULL REFERENCES app_user(id),
  approved_by uuid, approved_at timestamptz,
  approval_id uuid,
  required_at timestamptz,
  dispatched_at timestamptz, dispatched_by uuid,
  received_at timestamptz, received_by uuid,
  note text,
  created_at timestamptz, created_by uuid, updated_at timestamptz, updated_by uuid,
  UNIQUE (company_id, transfer_no),
  CHECK (from_site_id <> to_site_id)
);
CREATE INDEX transfer_status ON transfer (company_id, status, created_at DESC);
CREATE TRIGGER t_audit_cols BEFORE INSERT OR UPDATE ON transfer FOR EACH ROW EXECUTE FUNCTION trg_set_audit_cols();

CREATE TABLE transfer_line (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id uuid NOT NULL,
  transfer_id uuid NOT NULL REFERENCES transfer(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES product(id),
  requested_qty numeric(14,3) NOT NULL DEFAULT 0,
  approved_qty numeric(14,3),
  picked_qty numeric(14,3) NOT NULL DEFAULT 0,
  received_qty numeric(14,3) NOT NULL DEFAULT 0,
  pick_location_id uuid REFERENCES location(id),
  out_movement_id uuid, in_movement_id uuid,
  UNIQUE (transfer_id, product_id)
);

-- ---------- 第六组：盘点 ----------
CREATE TABLE count_rule (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id uuid NOT NULL REFERENCES company(id),
  name text NOT NULL,
  condition jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {"category_code":"BEV"} | {"min_value":100} | {"negative_stock":true} | {"last_variance_days":3}
  frequency_days int NOT NULL DEFAULT 30,
  lines_per_day int NOT NULL DEFAULT 20,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz, created_by uuid, updated_at timestamptz, updated_by uuid
);
CREATE TRIGGER t_audit_cols BEFORE INSERT OR UPDATE ON count_rule FOR EACH ROW EXECUTE FUNCTION trg_set_audit_cols();

CREATE TABLE count_session (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id uuid NOT NULL REFERENCES company(id),
  session_no text NOT NULL,
  site_id uuid NOT NULL REFERENCES site(id),
  zone_id uuid REFERENCES zone(id),
  count_type text NOT NULL DEFAULT 'FULL' CHECK (count_type IN ('FULL','CYCLE','SPOT')),
  status text NOT NULL DEFAULT 'ASSIGNED' CHECK (status IN ('ASSIGNED','IN_PROGRESS','PENDING_APPROVAL','APPROVED','RECOUNT','CANCELLED')),
  assigned_to uuid REFERENCES app_user(id),
  scheduled_for date NOT NULL DEFAULT current_date,
  started_at timestamptz, submitted_at timestamptz,
  approved_by uuid, approved_at timestamptz,
  approval_id uuid,
  location_ids uuid[] NOT NULL DEFAULT '{}',   -- 按路线顺序
  variance_qty numeric(14,3) NOT NULL DEFAULT 0,
  variance_amount numeric(14,2) NOT NULL DEFAULT 0,
  rule_id uuid REFERENCES count_rule(id),
  note text,
  created_at timestamptz, created_by uuid, updated_at timestamptz, updated_by uuid,
  UNIQUE (company_id, session_no)
);
CREATE INDEX count_session_assignee ON count_session (company_id, assigned_to, status, scheduled_for);
CREATE TRIGGER t_audit_cols BEFORE INSERT OR UPDATE ON count_session FOR EACH ROW EXECUTE FUNCTION trg_set_audit_cols();

-- 快照：开始盘点时锁定系统数量（盘点员看不到）
CREATE TABLE count_snapshot (
  company_id uuid NOT NULL,
  session_id uuid NOT NULL REFERENCES count_session(id) ON DELETE CASCADE,
  product_id uuid NOT NULL,
  location_id uuid NOT NULL,
  system_qty numeric(14,3) NOT NULL,
  unit_cost numeric(14,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (session_id, product_id, location_id)
);

CREATE TABLE count_line (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id uuid NOT NULL,
  session_id uuid NOT NULL REFERENCES count_session(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES location(id),
  product_id uuid NOT NULL REFERENCES product(id),
  counted_qty numeric(14,3) NOT NULL DEFAULT 0,
  counted_by uuid NOT NULL,
  counted_at timestamptz NOT NULL DEFAULT now(),
  variance_qty numeric(14,3),
  variance_amount numeric(14,2),
  decision text CHECK (decision IS NULL OR decision IN ('ACCEPT','RECOUNT')),
  movement_id uuid,
  client_id uuid UNIQUE,
  UNIQUE (session_id, location_id, product_id)
);
CREATE INDEX count_line_session ON count_line (session_id, location_id);

-- 货位完成标记（含"货位是空的"）
CREATE TABLE count_location_done (
  company_id uuid NOT NULL,
  session_id uuid NOT NULL REFERENCES count_session(id) ON DELETE CASCADE,
  location_id uuid NOT NULL,
  is_empty boolean NOT NULL DEFAULT false,
  done_by uuid, done_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, location_id)
);

-- ---------- 代理（老板不在，指定一个人代批） ----------
CREATE TABLE delegation (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id uuid NOT NULL REFERENCES company(id),
  delegator_id uuid NOT NULL REFERENCES app_user(id),
  delegate_id uuid NOT NULL REFERENCES app_user(id),
  scope_types text[] NOT NULL DEFAULT '{}',   -- 审批类型清单，空 = 全部
  per_item_limit numeric(14,2),
  daily_limit numeric(14,2),
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz NOT NULL,
  is_standby boolean NOT NULL DEFAULT false,
  standby_after_hours int,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','EXPIRED','REVOKED')),
  revoked_at timestamptz,
  note text,
  created_at timestamptz, created_by uuid, updated_at timestamptz, updated_by uuid,
  CHECK (delegator_id <> delegate_id), CHECK (ends_at > starts_at)
);
CREATE INDEX delegation_active ON delegation (company_id, delegate_id, status, ends_at);
CREATE TRIGGER t_audit_cols BEFORE INSERT OR UPDATE ON delegation FOR EACH ROW EXECUTE FUNCTION trg_set_audit_cols();

-- ---------- 安全：审计、RLS、权限 ----------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['order_proposal','purchase_order','goods_receipt','transfer','count_session','count_rule','delegation'] LOOP
    EXECUTE format('CREATE TRIGGER t_audit AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION trg_audit_row()', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['doc_sequence','order_proposal','order_proposal_line','purchase_order','purchase_order_line','goods_receipt','goods_receipt_line','transfer','transfer_line','count_rule','count_session','count_snapshot','count_line','count_location_done','delegation'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY rls_%I ON %I USING (company_id = app_company_id())', t, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO app_rw', t);
    EXECUTE format('GRANT ALL ON %I TO app_admin', t);
    EXECUTE format('GRANT SELECT ON %I TO app_ro', t);
  END LOOP;
END $$;
GRANT DELETE ON order_proposal_line, purchase_order_line, transfer_line, count_line, count_location_done, goods_receipt_line TO app_rw;
-- 快照只能由盘点开始时写入，之后不改
REVOKE UPDATE, DELETE ON count_snapshot FROM app_rw;
