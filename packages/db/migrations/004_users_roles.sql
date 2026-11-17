-- 第十组：用户、角色、权限
CREATE TABLE permission (
  code text PRIMARY KEY,
  description text NOT NULL,
  phase smallint NOT NULL DEFAULT 1
);

CREATE TABLE role (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id uuid REFERENCES company(id),   -- 空 = 系统模板
  code text NOT NULL CHECK (code IN ('SUPER_ADMIN','BOSS','MANAGER','PURCHASER','WAREHOUSE','COUNTER','STOCKER','CASHIER','ACCOUNTS')),
  name_zh text NOT NULL, name_ms text NOT NULL, name_en text NOT NULL,
  home_buttons jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_array_length(home_buttons) <= 4),
  enabled_in_plan text[] NOT NULL DEFAULT '{A,B}',
  created_at timestamptz, created_by uuid, updated_at timestamptz, updated_by uuid
);
CREATE UNIQUE INDEX role_company_code ON role (coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid), code);
CREATE TRIGGER t_audit_cols BEFORE INSERT OR UPDATE ON role FOR EACH ROW EXECUTE FUNCTION trg_set_audit_cols();

CREATE TABLE role_permission (
  role_id uuid NOT NULL REFERENCES role(id) ON DELETE CASCADE,
  permission_code text NOT NULL REFERENCES permission(code),
  condition jsonb,
  PRIMARY KEY (role_id, permission_code)
);

CREATE TABLE app_user (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id uuid NOT NULL REFERENCES company(id),
  name text NOT NULL,
  phone text,
  email text,
  pin_hash text NOT NULL,
  pin_failed_count smallint NOT NULL DEFAULT 0,
  pin_locked_until timestamptz,
  badge_code text NOT NULL DEFAULT encode(gen_random_bytes(8), 'hex'),
  language text NOT NULL DEFAULT 'zh' CHECK (language IN ('zh','ms','en')),
  font_scale numeric(3,2) NOT NULL DEFAULT 1.00 CHECK (font_scale IN (1.00, 1.25)),
  telegram_user_id text,
  photo_url text,
  is_super_admin boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz, created_by uuid, updated_at timestamptz, updated_by uuid,
  UNIQUE (company_id, badge_code)
);
CREATE UNIQUE INDEX app_user_phone ON app_user (company_id, phone) WHERE phone IS NOT NULL;
CREATE UNIQUE INDEX app_user_email ON app_user (lower(email)) WHERE email IS NOT NULL;
CREATE TRIGGER t_audit_cols BEFORE INSERT OR UPDATE ON app_user FOR EACH ROW EXECUTE FUNCTION trg_set_audit_cols();

CREATE TABLE user_site_role (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id uuid NOT NULL REFERENCES company(id),
  user_id uuid NOT NULL REFERENCES app_user(id),
  site_id uuid REFERENCES site(id),     -- 空 = 全公司
  role_id uuid NOT NULL REFERENCES role(id),
  created_at timestamptz, created_by uuid, updated_at timestamptz, updated_by uuid
);
CREATE UNIQUE INDEX user_site_role_unique ON user_site_role (user_id, coalesce(site_id, '00000000-0000-0000-0000-000000000000'::uuid), role_id);
CREATE INDEX user_site_role_user ON user_site_role (user_id);
CREATE TRIGGER t_audit_cols BEFORE INSERT OR UPDATE ON user_site_role FOR EACH ROW EXECUTE FUNCTION trg_set_audit_cols();

-- 权限历史：同步校验"当时有没有权限"
CREATE TABLE permission_history (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id uuid NOT NULL,
  user_id uuid NOT NULL,
  site_id uuid,
  role_id uuid NOT NULL,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz
);
CREATE INDEX permission_history_user ON permission_history (user_id, valid_from, valid_to);
CREATE OR REPLACE FUNCTION trg_permission_history() RETURNS trigger AS $$
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN
    UPDATE permission_history SET valid_to = now()
    WHERE user_id = OLD.user_id AND role_id = OLD.role_id AND site_id IS NOT DISTINCT FROM OLD.site_id AND valid_to IS NULL;
  END IF;
  IF TG_OP IN ('INSERT','UPDATE') THEN
    INSERT INTO permission_history (company_id, user_id, site_id, role_id) VALUES (NEW.company_id, NEW.user_id, NEW.site_id, NEW.role_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$ LANGUAGE plpgsql SECURITY DEFINER;
CREATE TRIGGER t_history AFTER INSERT OR UPDATE OR DELETE ON user_site_role FOR EACH ROW EXECUTE FUNCTION trg_permission_history();

-- 某用户在某站点在某时刻是否有某权限
CREATE OR REPLACE FUNCTION user_has_permission(p_user uuid, p_site uuid, p_perm text, p_at timestamptz DEFAULT now())
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM permission_history h
    JOIN role_permission rp ON rp.role_id = h.role_id
    WHERE h.user_id = p_user
      AND rp.permission_code = p_perm
      AND (h.site_id IS NULL OR p_site IS NULL OR h.site_id = p_site)
      AND h.valid_from <= p_at + interval '5 minutes'
      AND (h.valid_to IS NULL OR h.valid_to >= p_at)
  ) OR EXISTS (SELECT 1 FROM app_user u WHERE u.id = p_user AND u.is_super_admin);
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE TABLE approval_request (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id uuid NOT NULL REFERENCES company(id),
  type text NOT NULL CHECK (type IN ('IMPORT','ORDER','COUNT_VARIANCE','RETURN','PO_PRICE_CHANGE','ADJUST','TRANSFER','PAYMENT','PRICE_CHANGE')),
  ref_type text NOT NULL,
  ref_id uuid NOT NULL,
  requested_by uuid NOT NULL REFERENCES app_user(id),
  approver_role_code text NOT NULL,
  approver_id uuid REFERENCES app_user(id),
  on_behalf_of uuid,
  delegation_id uuid,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED','RETURNED')),
  summary jsonb,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz, created_by uuid, updated_at timestamptz, updated_by uuid
);
CREATE INDEX approval_pending ON approval_request (company_id, status, approver_role_code);
CREATE TRIGGER t_audit_cols BEFORE INSERT OR UPDATE ON approval_request FOR EACH ROW EXECUTE FUNCTION trg_set_audit_cols();
-- 审批者不能批自己发起的（A 模式老板一人除外：由应用层判断 plan=A 时放行，数据库只拦 B）
CREATE OR REPLACE FUNCTION trg_approval_self_check() RETURNS trigger AS $$
DECLARE p text;
BEGIN
  IF NEW.approver_id IS NOT NULL AND NEW.approver_id = NEW.requested_by THEN
    SELECT plan INTO p FROM company WHERE id = NEW.company_id;
    IF p <> 'A' THEN
      RAISE EXCEPTION '审批者不能批准自己发起的请求 / Approver cannot approve own request';
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER t_self_check BEFORE INSERT OR UPDATE ON approval_request FOR EACH ROW EXECUTE FUNCTION trg_approval_self_check();
