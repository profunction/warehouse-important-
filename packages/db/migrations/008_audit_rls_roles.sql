-- 审计触发器挂载
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['company','site','zone','location','category','tax_code','supplier','product','barcode','app_user','role','user_site_role','shelf_assignment','import_job','approval_request','device','ticket']
  LOOP
    EXECUTE format('CREATE TRIGGER t_audit AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION trg_audit_row()', t);
  END LOOP;
END $$;
-- role_permission 没有 id/company_id，单独记
CREATE OR REPLACE FUNCTION trg_audit_role_permission() RETURNS trigger AS $$
DECLARE cid uuid;
BEGIN
  SELECT company_id INTO cid FROM role WHERE id = COALESCE(NEW.role_id, OLD.role_id);
  IF cid IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  PERFORM ensure_audit_partition(current_date);
  INSERT INTO audit_log(company_id, user_id, action, table_name, row_id, before_json, after_json, device_id)
  VALUES (cid, app_user_id(), TG_OP, 'role_permission', COALESCE(NEW.role_id, OLD.role_id), to_jsonb(OLD), to_jsonb(NEW), app_device_id());
  RETURN COALESCE(NEW, OLD);
END $$ LANGUAGE plpgsql SECURITY DEFINER;
CREATE TRIGGER t_audit AFTER INSERT OR UPDATE OR DELETE ON role_permission FOR EACH ROW EXECUTE FUNCTION trg_audit_role_permission();

-- 数据库账号
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_admin') THEN
    CREATE ROLE app_admin LOGIN PASSWORD 'app_admin' BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    CREATE ROLE app_rw LOGIN PASSWORD 'app_rw';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_ro') THEN
    CREATE ROLE app_ro LOGIN PASSWORD 'app_ro';
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO app_admin, app_rw, app_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_ro;
GRANT ALL ON ALL TABLES IN SCHEMA public TO app_admin;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO app_admin, app_rw;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO app_rw;
-- 收紧：账本只插入，库存只读，审计只插入
REVOKE UPDATE, DELETE ON movement FROM app_rw;
REVOKE INSERT, UPDATE, DELETE ON stock FROM app_rw;
REVOKE INSERT, UPDATE, DELETE ON expiry_lot FROM app_rw;
REVOKE UPDATE, DELETE ON audit_log FROM app_rw;
REVOKE UPDATE, DELETE ON price_history FROM app_rw;
REVOKE INSERT, UPDATE, DELETE ON permission_history FROM app_rw;
GRANT DELETE ON zone_category, product_supplier, role_permission, user_site_role, import_row TO app_rw;
GRANT DELETE ON audit_log TO app_admin;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT ON TABLES TO app_ro;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO app_admin;

-- 行级安全
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['company','site','zone','location','category','tax_code','supplier','product','barcode','price_history','app_user','user_site_role','permission_history','approval_request','movement_reason_enabled','movement','stock','expiry_lot','shelf_assignment','import_job','import_row','export_log','device','sync_batch','sync_quarantine','sync_applied','ticket','ticket_event','notification']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    IF t = 'company' THEN
      EXECUTE 'CREATE POLICY rls_company ON company USING (id = app_company_id())';
    ELSE
      EXECUTE format('CREATE POLICY rls_%I ON %I USING (company_id = app_company_id())', t, t);
    END IF;
  END LOOP;
END $$;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_audit ON audit_log USING (company_id = app_company_id());
-- 模板行（company_id 空）所有公司可读
ALTER TABLE role ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_role ON role USING (company_id IS NULL OR company_id = app_company_id());
ALTER TABLE knowledge_article ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_kb ON knowledge_article USING (company_id IS NULL OR company_id = app_company_id());
-- 通过 role 过滤
ALTER TABLE role_permission ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_rp ON role_permission USING (EXISTS (SELECT 1 FROM role r WHERE r.id = role_id AND (r.company_id IS NULL OR r.company_id = app_company_id())));
ALTER TABLE zone_category ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_zc ON zone_category USING (EXISTS (SELECT 1 FROM zone z WHERE z.id = zone_id AND z.company_id = app_company_id()));
ALTER TABLE product_supplier ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_ps ON product_supplier USING (EXISTS (SELECT 1 FROM product p WHERE p.id = product_id AND p.company_id = app_company_id()));
ALTER TABLE product_site_setting ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_pss ON product_site_setting USING (EXISTS (SELECT 1 FROM product p WHERE p.id = product_id AND p.company_id = app_company_id()));
