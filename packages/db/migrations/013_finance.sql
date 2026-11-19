-- 模块 D（财务）：手动开票需要发票行（invoice 表原本只有合计）。电子发票 UBL 文档和发票 PDF 都从这里取行。
CREATE TABLE invoice_line (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id uuid NOT NULL,
  invoice_id uuid NOT NULL REFERENCES invoice(id) ON DELETE CASCADE,
  line_no int NOT NULL DEFAULT 1,
  product_id uuid REFERENCES product(id),
  description text NOT NULL,
  qty numeric(14,3) NOT NULL CHECK (qty > 0),
  unit_price numeric(14,2) NOT NULL,
  tax_code_id uuid REFERENCES tax_code(id),
  tax_rate numeric(5,2) NOT NULL DEFAULT 0,
  tax_amount numeric(14,2) NOT NULL DEFAULT 0,
  line_total numeric(14,2) NOT NULL,
  unit_cost numeric(14,2) NOT NULL DEFAULT 0
);
CREATE INDEX invoice_line_invoice ON invoice_line (invoice_id);
ALTER TABLE invoice_line ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_invoice_line ON invoice_line USING (company_id = app_company_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON invoice_line TO app_rw;
GRANT ALL ON invoice_line TO app_admin;
GRANT SELECT ON invoice_line TO app_ro;
-- 月结解锁（仅老板）需要删 period_lock 行
GRANT DELETE ON period_lock TO app_rw;
