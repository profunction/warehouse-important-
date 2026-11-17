-- 第十一组：Excel 导入导出
CREATE TABLE import_template (
  code text PRIMARY KEY CHECK (code IN ('PRODUCT','BARCODE','SUPPLIER','OPENING_STOCK','LOCATION','CUSTOMER')),
  version smallint NOT NULL DEFAULT 1,
  sheet_name_zh text NOT NULL, sheet_name_ms text NOT NULL, sheet_name_en text NOT NULL,
  columns jsonb NOT NULL,
  required_permission text NOT NULL REFERENCES permission(code),
  plans text[] NOT NULL DEFAULT '{A,B}'
);

CREATE TABLE import_job (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id uuid NOT NULL REFERENCES company(id),
  file_url text NOT NULL,
  file_hash text NOT NULL,
  file_name text NOT NULL,
  uploaded_by uuid NOT NULL REFERENCES app_user(id),
  status text NOT NULL DEFAULT 'UPLOADED' CHECK (status IN ('UPLOADED','VALIDATING','VALIDATED','PENDING_APPROVAL','APPLYING','APPLIED','REJECTED','FAILED')),
  options jsonb NOT NULL DEFAULT '{}'::jsonb,
  sheets_summary jsonb,
  approval_request_id uuid REFERENCES approval_request(id),
  approved_by uuid,
  applied_at timestamptz,
  error_message text,
  created_at timestamptz, created_by uuid, updated_at timestamptz, updated_by uuid
);
CREATE INDEX import_job_company ON import_job (company_id, created_at DESC);
CREATE TRIGGER t_audit_cols BEFORE INSERT OR UPDATE ON import_job FOR EACH ROW EXECUTE FUNCTION trg_set_audit_cols();

CREATE TABLE import_row (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id uuid NOT NULL,
  job_id uuid NOT NULL REFERENCES import_job(id) ON DELETE CASCADE,
  sheet_code text NOT NULL,
  row_no integer NOT NULL,
  raw_json jsonb NOT NULL,
  normalized_json jsonb,
  status text NOT NULL CHECK (status IN ('OK','WARNING','ERROR')),
  messages jsonb,
  action text CHECK (action IS NULL OR action IN ('CREATE','UPDATE','SKIP')),
  result_id uuid,
  UNIQUE (job_id, sheet_code, row_no)
);

CREATE TABLE export_log (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id uuid NOT NULL,
  user_id uuid NOT NULL,
  export_type text NOT NULL,
  filters_json jsonb,
  columns_json jsonb NOT NULL,
  row_count integer NOT NULL,
  file_url text NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);
