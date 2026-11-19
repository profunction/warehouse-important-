-- 第三阶段：客户、销售、付款、发票、钱箱、供应商发票、电子发票、月结、API 密钥。第七八九组表。
CREATE TABLE customer (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id uuid NOT NULL REFERENCES company(id),
  code text,
  name text NOT NULL,
  tin text, brn text, sst_no text,
  id_type text CHECK (id_type IS NULL OR id_type IN ('NRIC','BRN','PASSPORT','ARMY')), id_no text,
  email text, phone text, address jsonb,
  credit_terms_days int NOT NULL DEFAULT 30,
  credit_limit numeric(14,2) NOT NULL DEFAULT 0,
  balance numeric(14,2) NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz, created_by uuid, updated_at timestamptz, updated_by uuid
);
CREATE INDEX customer_company ON customer (company_id, is_active, name);
CREATE TRIGGER t_audit_cols BEFORE INSERT OR UPDATE ON customer FOR EACH ROW EXECUTE FUNCTION trg_set_audit_cols();

-- 钱箱班次：每机一个
CREATE TABLE cash_drawer_session (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id uuid NOT NULL REFERENCES company(id),
  site_id uuid NOT NULL REFERENCES site(id),
  device_id uuid REFERENCES device(id),
  terminal_code text NOT NULL,                 -- P1, P2 …
  cashier_id uuid NOT NULL REFERENCES app_user(id),
  opened_at timestamptz NOT NULL DEFAULT now(),
  opening_cash numeric(14,2) NOT NULL DEFAULT 0,
  closed_at timestamptz,
  expected_cash numeric(14,2), counted_cash numeric(14,2), variance numeric(14,2),
  sales_total numeric(14,2) NOT NULL DEFAULT 0, sales_count int NOT NULL DEFAULT 0,
  cash_total numeric(14,2) NOT NULL DEFAULT 0, card_total numeric(14,2) NOT NULL DEFAULT 0, ewallet_total numeric(14,2) NOT NULL DEFAULT 0, refund_total numeric(14,2) NOT NULL DEFAULT 0,
  z_report_url text,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
  created_at timestamptz, created_by uuid, updated_at timestamptz, updated_by uuid
);
CREATE INDEX drawer_open ON cash_drawer_session (company_id, site_id, terminal_code, status);
CREATE TRIGGER t_audit_cols BEFORE INSERT OR UPDATE ON cash_drawer_session FOR EACH ROW EXECUTE FUNCTION trg_set_audit_cols();

CREATE TABLE sale (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id uuid NOT NULL REFERENCES company(id),
  site_id uuid NOT NULL REFERENCES site(id),
  receipt_no text NOT NULL,                    -- KL01-P2-000123
  sale_type text NOT NULL DEFAULT 'RETAIL' CHECK (sale_type IN ('RETAIL','B2B','RETURN')),
  source text NOT NULL DEFAULT 'OWN_POS' CHECK (source IN ('OWN_POS','PANDAL','WEB')),
  external_ref text,
  customer_id uuid REFERENCES customer(id),
  cashier_id uuid REFERENCES app_user(id),
  device_id uuid, terminal_code text,
  drawer_session_id uuid REFERENCES cash_drawer_session(id),
  subtotal numeric(14,2) NOT NULL DEFAULT 0,
  discount_total numeric(14,2) NOT NULL DEFAULT 0,
  tax_amount numeric(14,2) NOT NULL DEFAULT 0,
  rounding numeric(14,2) NOT NULL DEFAULT 0,
  total numeric(14,2) NOT NULL DEFAULT 0,
  paid_total numeric(14,2) NOT NULL DEFAULT 0,
  change_amount numeric(14,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('HELD','COMPLETED','VOIDED','PENDING_RETURN')),
  hold_code text,
  sold_at timestamptz NOT NULL DEFAULT now(),
  einvoice_required boolean NOT NULL DEFAULT false,
  einvoice_buyer jsonb,
  original_sale_id uuid REFERENCES sale(id),
  approval_id uuid,
  void_reason text, voided_at timestamptz, voided_by uuid,
  client_id uuid,
  note text,
  created_at timestamptz, created_by uuid, updated_at timestamptz, updated_by uuid,
  UNIQUE (company_id, receipt_no)
);
CREATE UNIQUE INDEX sale_external_ref ON sale (company_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE UNIQUE INDEX sale_client_id ON sale (company_id, client_id) WHERE client_id IS NOT NULL;
CREATE INDEX sale_site_time ON sale (company_id, site_id, sold_at DESC);
CREATE INDEX sale_customer ON sale (company_id, customer_id) WHERE customer_id IS NOT NULL;
CREATE TRIGGER t_audit_cols BEFORE INSERT OR UPDATE ON sale FOR EACH ROW EXECUTE FUNCTION trg_set_audit_cols();

CREATE TABLE sale_line (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id uuid NOT NULL,
  sale_id uuid NOT NULL REFERENCES sale(id) ON DELETE CASCADE,
  line_no int NOT NULL DEFAULT 1,
  product_id uuid NOT NULL REFERENCES product(id),
  barcode_scanned text,
  qty numeric(14,3) NOT NULL CHECK (qty > 0),
  weight_kg numeric(10,3),
  unit_price numeric(14,2) NOT NULL,
  discount numeric(14,2) NOT NULL DEFAULT 0,
  discount_pct numeric(5,2) NOT NULL DEFAULT 0,
  tax_code_id uuid REFERENCES tax_code(id),
  tax_rate numeric(5,2) NOT NULL DEFAULT 0,
  tax_amount numeric(14,2) NOT NULL DEFAULT 0,
  line_total numeric(14,2) NOT NULL,
  unit_cost numeric(14,2) NOT NULL DEFAULT 0,
  from_location_id uuid REFERENCES location(id),
  movement_id uuid,
  approved_by uuid                               -- 折扣超限经理授权
);
CREATE INDEX sale_line_sale ON sale_line (sale_id);
CREATE INDEX sale_line_product ON sale_line (company_id, product_id);

CREATE TABLE invoice (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id uuid NOT NULL REFERENCES company(id),
  invoice_no text NOT NULL,
  customer_id uuid NOT NULL REFERENCES customer(id),
  sale_id uuid REFERENCES sale(id),
  issue_date date NOT NULL DEFAULT current_date,
  due_date date NOT NULL,
  subtotal numeric(14,2) NOT NULL DEFAULT 0, tax_amount numeric(14,2) NOT NULL DEFAULT 0, total numeric(14,2) NOT NULL,
  paid_amount numeric(14,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'UNPAID' CHECK (status IN ('UNPAID','PARTIAL','PAID','OVERDUE','CANCELLED')),
  einvoice_submission_id uuid,
  pdf_url text,
  note text,
  created_at timestamptz, created_by uuid, updated_at timestamptz, updated_by uuid,
  UNIQUE (company_id, invoice_no)
);
CREATE INDEX invoice_customer ON invoice (company_id, customer_id, status);
CREATE TRIGGER t_audit_cols BEFORE INSERT OR UPDATE ON invoice FOR EACH ROW EXECUTE FUNCTION trg_set_audit_cols();

CREATE TABLE payment (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id uuid NOT NULL REFERENCES company(id),
  sale_id uuid REFERENCES sale(id),
  invoice_id uuid REFERENCES invoice(id),
  customer_id uuid REFERENCES customer(id),
  method text NOT NULL CHECK (method IN ('CASH','CARD','EWALLET','BANK_TRANSFER','CREDIT','CHEQUE')),
  amount numeric(14,2) NOT NULL,
  tendered numeric(14,2),
  reference text,
  received_by uuid REFERENCES app_user(id),
  received_at timestamptz NOT NULL DEFAULT now(),
  drawer_session_id uuid REFERENCES cash_drawer_session(id),
  created_at timestamptz, created_by uuid, updated_at timestamptz, updated_by uuid
);
CREATE INDEX payment_sale ON payment (sale_id);
CREATE INDEX payment_invoice ON payment (invoice_id);
CREATE TRIGGER t_audit_cols BEFORE INSERT OR UPDATE ON payment FOR EACH ROW EXECUTE FUNCTION trg_set_audit_cols();

CREATE TABLE statement (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id uuid NOT NULL REFERENCES company(id),
  customer_id uuid NOT NULL REFERENCES customer(id),
  period_start date NOT NULL, period_end date NOT NULL,
  opening_balance numeric(14,2) NOT NULL DEFAULT 0, closing_balance numeric(14,2) NOT NULL DEFAULT 0,
  pdf_url text, sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id, period_start)
);

-- 第八组：供应商发票和付款
CREATE TABLE supplier_invoice (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id uuid NOT NULL REFERENCES company(id),
  supplier_id uuid NOT NULL REFERENCES supplier(id),
  po_id uuid REFERENCES purchase_order(id),
  invoice_no text NOT NULL,
  invoice_date date NOT NULL DEFAULT current_date,
  due_date date,
  amount numeric(14,2) NOT NULL,
  matched_amount numeric(14,2) NOT NULL DEFAULT 0,
  variance_amount numeric(14,2) NOT NULL DEFAULT 0,
  paid_amount numeric(14,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'PENDING_MATCH' CHECK (status IN ('PENDING_MATCH','VARIANCE','PAYABLE','PARTIAL','PAID','CANCELLED')),
  resolution text,
  photo_url text,
  myinvois_uuid text,
  approval_id uuid,
  note text,
  created_at timestamptz, created_by uuid, updated_at timestamptz, updated_by uuid,
  UNIQUE (company_id, supplier_id, invoice_no)
);
CREATE INDEX supplier_invoice_status ON supplier_invoice (company_id, status, due_date);
CREATE TRIGGER t_audit_cols BEFORE INSERT OR UPDATE ON supplier_invoice FOR EACH ROW EXECUTE FUNCTION trg_set_audit_cols();

CREATE TABLE supplier_invoice_line (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id uuid NOT NULL,
  supplier_invoice_id uuid NOT NULL REFERENCES supplier_invoice(id) ON DELETE CASCADE,
  po_line_id uuid REFERENCES purchase_order_line(id),
  product_id uuid REFERENCES product(id),
  invoiced_qty numeric(14,3) NOT NULL DEFAULT 0,
  invoiced_unit_cost numeric(14,2) NOT NULL DEFAULT 0,
  received_qty numeric(14,3) NOT NULL DEFAULT 0,
  po_unit_cost numeric(14,2) NOT NULL DEFAULT 0,
  variance_amount numeric(14,2) NOT NULL DEFAULT 0
);

CREATE TABLE supplier_payment (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id uuid NOT NULL REFERENCES company(id),
  supplier_invoice_id uuid NOT NULL REFERENCES supplier_invoice(id),
  amount numeric(14,2) NOT NULL,
  method text NOT NULL DEFAULT 'BANK_TRANSFER' CHECK (method IN ('CASH','BANK_TRANSFER','CHEQUE','CARD','EWALLET')),
  reference text,
  paid_by uuid REFERENCES app_user(id),
  paid_at timestamptz NOT NULL DEFAULT now(),
  approval_id uuid,
  created_at timestamptz, created_by uuid, updated_at timestamptz, updated_by uuid
);
CREATE TRIGGER t_audit_cols BEFORE INSERT OR UPDATE ON supplier_payment FOR EACH ROW EXECUTE FUNCTION trg_set_audit_cols();

-- 第九组：电子发票 MyInvois
CREATE TABLE einvoice_submission (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id uuid NOT NULL REFERENCES company(id),
  doc_type text NOT NULL CHECK (doc_type IN ('INVOICE','CREDIT_NOTE','CONSOLIDATED','SELF_BILLED','REFUND_NOTE')),
  ref_type text NOT NULL, ref_id uuid NOT NULL,
  env text NOT NULL DEFAULT 'SANDBOX' CHECK (env IN ('SANDBOX','PRODUCTION','STUB')),
  submission_uid text, document_uuid text, long_id text,
  status text NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','SUBMITTED','VALID','INVALID','CANCELLED','FAILED')),
  payload jsonb,
  response jsonb, error_json jsonb,
  retry_count int NOT NULL DEFAULT 0, next_retry_at timestamptz,
  validated_at timestamptz, cancelled_at timestamptz,
  qr_url text,
  created_at timestamptz, created_by uuid, updated_at timestamptz, updated_by uuid
);
CREATE INDEX einvoice_status ON einvoice_submission (company_id, status, next_retry_at);
CREATE INDEX einvoice_ref ON einvoice_submission (ref_type, ref_id);
CREATE TRIGGER t_audit_cols BEFORE INSERT OR UPDATE ON einvoice_submission FOR EACH ROW EXECUTE FUNCTION trg_set_audit_cols();

CREATE TABLE consolidated_invoice_period (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id uuid NOT NULL REFERENCES company(id),
  site_id uuid REFERENCES site(id),
  period_month date NOT NULL,                 -- 该月 1 日
  sale_count int NOT NULL DEFAULT 0,
  total numeric(14,2) NOT NULL DEFAULT 0,
  submission_id uuid REFERENCES einvoice_submission(id),
  locked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, site_id, period_month)
);

-- 月结锁定：锁定月份内的移动不可再新增（performed_at 在锁定期内）
CREATE TABLE period_lock (
  company_id uuid NOT NULL REFERENCES company(id),
  period_month date NOT NULL,
  locked_by uuid, locked_at timestamptz NOT NULL DEFAULT now(),
  checklist jsonb,
  PRIMARY KEY (company_id, period_month)
);
CREATE OR REPLACE FUNCTION trg_movement_period_lock() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM period_lock pl WHERE pl.company_id = NEW.company_id AND date_trunc('month', NEW.performed_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date = pl.period_month) THEN
    RAISE EXCEPTION 'PERIOD_LOCKED' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER t_period_lock BEFORE INSERT ON movement FOR EACH ROW EXECUTE FUNCTION trg_movement_period_lock();

-- 公司级 API 密钥（Pandal 等开放接口）和大屏密钥
CREATE TABLE api_key (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id uuid NOT NULL REFERENCES company(id),
  site_id uuid REFERENCES site(id),
  name text NOT NULL,
  scope text NOT NULL CHECK (scope IN ('OPEN','KIOSK','POS')),
  key_prefix text NOT NULL,
  key_hash text NOT NULL,
  last_used_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz, created_by uuid, updated_at timestamptz, updated_by uuid
);
CREATE INDEX api_key_prefix ON api_key (key_prefix) WHERE is_active;
CREATE TRIGGER t_audit_cols BEFORE INSERT OR UPDATE ON api_key FOR EACH ROW EXECUTE FUNCTION trg_set_audit_cols();

-- Pandal / 外部系统同步日志
CREATE TABLE external_sync_log (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id uuid NOT NULL,
  system text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('PUSH','PULL','WEBHOOK')),
  entity text NOT NULL,
  external_ref text,
  status text NOT NULL CHECK (status IN ('OK','DUPLICATE','ERROR')),
  detail jsonb,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX external_sync_log_company ON external_sync_log (company_id, at DESC);

CREATE TABLE webhook_subscription (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id uuid NOT NULL REFERENCES company(id),
  url text NOT NULL,
  events text[] NOT NULL DEFAULT '{}',
  secret text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz, created_by uuid, updated_at timestamptz, updated_by uuid
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['customer','sale','invoice','payment','supplier_invoice','supplier_payment','einvoice_submission','api_key','cash_drawer_session'] LOOP
    EXECUTE format('CREATE TRIGGER t_audit AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION trg_audit_row()', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['customer','cash_drawer_session','sale','sale_line','invoice','payment','statement','supplier_invoice','supplier_invoice_line','supplier_payment','einvoice_submission','consolidated_invoice_period','period_lock','api_key','external_sync_log','webhook_subscription'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY rls_%I ON %I USING (company_id = app_company_id())', t, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO app_rw', t);
    EXECUTE format('GRANT ALL ON %I TO app_admin', t);
    EXECUTE format('GRANT SELECT ON %I TO app_ro', t);
  END LOOP;
END $$;
GRANT DELETE ON sale_line, supplier_invoice_line, webhook_subscription TO app_rw;
-- 挂单可删行；已完成销售不可改
CREATE OR REPLACE FUNCTION trg_sale_line_lock() RETURNS trigger AS $$
DECLARE st text;
BEGIN
  SELECT status INTO st FROM sale WHERE id = COALESCE(NEW.sale_id, OLD.sale_id);
  IF st IN ('COMPLETED','VOIDED') AND TG_OP IN ('UPDATE','DELETE') AND (TG_OP = 'DELETE' OR NEW.movement_id IS NOT DISTINCT FROM OLD.movement_id) THEN
    RAISE EXCEPTION 'SALE_LOCKED' USING ERRCODE = 'P0001';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$ LANGUAGE plpgsql;
CREATE TRIGGER t_lock BEFORE UPDATE OR DELETE ON sale_line FOR EACH ROW EXECUTE FUNCTION trg_sale_line_lock();
