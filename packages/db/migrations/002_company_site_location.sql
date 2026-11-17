-- 第一组：公司和站点
CREATE TABLE company (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  short_code text NOT NULL UNIQUE CHECK (short_code ~ '^[A-Z0-9]{3,8}$'),
  plan text NOT NULL CHECK (plan IN ('A','B')),
  tin text,
  sst_no text,
  msic_code text CHECK (msic_code IS NULL OR msic_code ~ '^[0-9]{5}$'),
  address jsonb,
  currency text NOT NULL DEFAULT 'MYR',
  timezone text NOT NULL DEFAULT 'Asia/Kuala_Lumpur',
  telegram_chat_id text,
  feature_flags jsonb NOT NULL DEFAULT '{}'::jsonb,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz, created_by uuid, updated_at timestamptz, updated_by uuid
);
CREATE TRIGGER t_audit_cols BEFORE INSERT OR UPDATE ON company FOR EACH ROW EXECUTE FUNCTION trg_set_audit_cols();

CREATE TABLE site (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id uuid NOT NULL REFERENCES company(id) ON DELETE RESTRICT,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9]{2,10}$'),
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('WAREHOUSE','SHOP')),
  address jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz, created_by uuid, updated_at timestamptz, updated_by uuid,
  UNIQUE (company_id, code)
);
CREATE TRIGGER t_audit_cols BEFORE INSERT OR UPDATE ON site FOR EACH ROW EXECUTE FUNCTION trg_set_audit_cols();

CREATE TABLE zone (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id uuid NOT NULL REFERENCES company(id),
  site_id uuid NOT NULL REFERENCES site(id),
  code text NOT NULL CHECK (code ~ '^[A-Z0-9]{1,3}$'),
  name_zh text, name_ms text, name_en text,
  zone_type text NOT NULL CHECK (zone_type IN ('RECEIVING','STORAGE','SHELF','BACKROOM')),
  color text NOT NULL CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  capacity_boxes integer CHECK (capacity_boxes IS NULL OR capacity_boxes > 0),
  allowed_is_hard boolean NOT NULL DEFAULT false, -- 后仓硬限制
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz, created_by uuid, updated_at timestamptz, updated_by uuid,
  UNIQUE (site_id, code),
  CHECK (coalesce(name_zh, name_ms, name_en) IS NOT NULL)
);
CREATE TRIGGER t_audit_cols BEFORE INSERT OR UPDATE ON zone FOR EACH ROW EXECUTE FUNCTION trg_set_audit_cols();

CREATE TABLE location (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id uuid NOT NULL REFERENCES company(id),
  site_id uuid REFERENCES site(id),
  zone_id uuid REFERENCES zone(id),
  code text NOT NULL CHECK (length(code) BETWEEN 1 AND 20),
  rack smallint CHECK (rack IS NULL OR rack BETWEEN 1 AND 99),
  level smallint CHECK (level IS NULL OR level BETWEEN 1 AND 9),
  is_virtual boolean NOT NULL DEFAULT false,
  virtual_type text CHECK (virtual_type IS NULL OR virtual_type IN ('SUPPLIER','CUSTOMER','TRANSIT','DAMAGED')),
  capacity_boxes integer,
  qr_printed_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz, created_by uuid, updated_at timestamptz, updated_by uuid,
  UNIQUE (company_id, code),
  CHECK ((is_virtual AND virtual_type IS NOT NULL AND site_id IS NULL AND zone_id IS NULL)
      OR (NOT is_virtual AND virtual_type IS NULL AND site_id IS NOT NULL AND zone_id IS NOT NULL))
);
CREATE UNIQUE INDEX location_virtual_unique ON location (company_id, virtual_type) WHERE is_virtual;
CREATE INDEX location_site_zone ON location (company_id, site_id, zone_id);
CREATE TRIGGER t_audit_cols BEFORE INSERT OR UPDATE ON location FOR EACH ROW EXECUTE FUNCTION trg_set_audit_cols();

-- 公司创建时自动生成四个虚拟位置
CREATE OR REPLACE FUNCTION trg_company_virtual_locations() RETURNS trigger AS $$
BEGIN
  INSERT INTO location (company_id, code, is_virtual, virtual_type)
  VALUES (NEW.id, 'SUPPLIER', true, 'SUPPLIER'),
         (NEW.id, 'CUSTOMER', true, 'CUSTOMER'),
         (NEW.id, 'TRANSIT',  true, 'TRANSIT'),
         (NEW.id, 'DAMAGED',  true, 'DAMAGED');
  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER;
CREATE TRIGGER t_virtual_locations AFTER INSERT ON company FOR EACH ROW EXECUTE FUNCTION trg_company_virtual_locations();
