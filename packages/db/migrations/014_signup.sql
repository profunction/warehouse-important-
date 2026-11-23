-- 自助申请：员工申请加入某家店（老板批准后才建账号）。开新店直接用 create_company_from_template，不需要新表。
CREATE TABLE staff_join_request (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id uuid NOT NULL REFERENCES company(id),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  phone text NOT NULL,
  language text NOT NULL DEFAULT 'zh' CHECK (language IN ('zh','ms','en')),
  role_code text NOT NULL,
  pin_hash text NOT NULL,
  note text,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  decided_by uuid, decided_at timestamptz, decision_note text,
  user_id uuid REFERENCES app_user(id),
  ip text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX staff_join_request_pending ON staff_join_request (company_id, status, created_at DESC);
CREATE UNIQUE INDEX staff_join_request_one_pending ON staff_join_request (company_id, phone) WHERE status = 'PENDING';
ALTER TABLE staff_join_request ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_staff_join_request ON staff_join_request USING (company_id = app_company_id());
GRANT SELECT, INSERT, UPDATE ON staff_join_request TO app_rw;
GRANT ALL ON staff_join_request TO app_admin;
GRANT SELECT ON staff_join_request TO app_ro;
CREATE TRIGGER t_audit AFTER INSERT OR UPDATE OR DELETE ON staff_join_request FOR EACH ROW EXECUTE FUNCTION trg_audit_row();
