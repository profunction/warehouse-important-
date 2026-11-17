-- 扩展和通用函数
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- UUID v7（时间前缀），客户端也用同一规范
CREATE OR REPLACE FUNCTION uuid_v7() RETURNS uuid AS $$
DECLARE
  ts bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  b bytea := gen_random_bytes(16);
BEGIN
  b := set_byte(b, 0, ((ts >> 40) & 255)::int);
  b := set_byte(b, 1, ((ts >> 32) & 255)::int);
  b := set_byte(b, 2, ((ts >> 24) & 255)::int);
  b := set_byte(b, 3, ((ts >> 16) & 255)::int);
  b := set_byte(b, 4, ((ts >> 8) & 255)::int);
  b := set_byte(b, 5, (ts & 255)::int);
  b := set_byte(b, 6, (get_byte(b, 6) & 15) | 112); -- version 7
  b := set_byte(b, 8, (get_byte(b, 8) & 63) | 128); -- variant
  RETURN encode(b, 'hex')::uuid;
END $$ LANGUAGE plpgsql VOLATILE;

-- 会话变量读取：当前公司 / 用户 / 设备
CREATE OR REPLACE FUNCTION app_company_id() RETURNS uuid AS $$
  SELECT NULLIF(current_setting('app.company_id', true), '')::uuid
$$ LANGUAGE sql STABLE;
CREATE OR REPLACE FUNCTION app_user_id() RETURNS uuid AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$ LANGUAGE sql STABLE;
CREATE OR REPLACE FUNCTION app_device_id() RETURNS uuid AS $$
  SELECT NULLIF(current_setting('app.device_id', true), '')::uuid
$$ LANGUAGE sql STABLE;

-- 审计列自动填充
CREATE OR REPLACE FUNCTION trg_set_audit_cols() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := COALESCE(NEW.created_at, now());
    NEW.created_by := COALESCE(NEW.created_by, app_user_id());
  END IF;
  NEW.updated_at := now();
  NEW.updated_by := COALESCE(app_user_id(), NEW.updated_by);
  RETURN NEW;
END $$ LANGUAGE plpgsql;

-- 拒绝修改删除（账本）
CREATE OR REPLACE FUNCTION trg_forbid_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '移动记录不可修改，请插入反向记录 / Rekod pergerakan tidak boleh diubah / Movement records are immutable'
    USING ERRCODE = 'P0001';
END $$ LANGUAGE plpgsql;

-- 审计日志（独立表，先建，触发器函数在 008）
CREATE TABLE audit_log (
  id uuid NOT NULL DEFAULT uuid_v7(),
  company_id uuid NOT NULL,
  user_id uuid,
  action text NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE','LOGIN','LOGOUT','EXPORT','APPROVE','REJECT','IMPORT','SYNC')),
  table_name text NOT NULL,
  row_id uuid,
  before_json jsonb,
  after_json jsonb,
  changed_columns text[],
  ip inet,
  device_id uuid,
  at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, at)
) PARTITION BY RANGE (at);

-- 自动按月建分区
CREATE OR REPLACE FUNCTION ensure_audit_partition(d date) RETURNS void AS $$
DECLARE
  start_d date := date_trunc('month', d)::date;
  end_d date := (start_d + interval '1 month')::date;
  pname text := 'audit_log_' || to_char(start_d, 'YYYYMM');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = pname) THEN
    EXECUTE format('CREATE TABLE %I PARTITION OF audit_log FOR VALUES FROM (%L) TO (%L)', pname, start_d, end_d);
    EXECUTE format('CREATE INDEX ON %I (company_id, at DESC)', pname);
    EXECUTE format('CREATE INDEX ON %I (company_id, table_name, row_id)', pname);
  END IF;
END $$ LANGUAGE plpgsql;
SELECT ensure_audit_partition(current_date);
SELECT ensure_audit_partition((current_date + interval '1 month')::date);
SELECT ensure_audit_partition((current_date + interval '2 month')::date);

CREATE OR REPLACE FUNCTION trg_audit_row() RETURNS trigger AS $$
DECLARE
  cid uuid;
  rid uuid;
  cols text[];
  nj jsonb; oj jsonb;
BEGIN
  IF TG_OP IN ('INSERT','UPDATE') THEN nj := to_jsonb(NEW); END IF;
  IF TG_OP IN ('UPDATE','DELETE') THEN oj := to_jsonb(OLD); END IF;
  IF TG_TABLE_NAME = 'company' THEN
    cid := COALESCE(nj ->> 'id', oj ->> 'id')::uuid;
  ELSE
    cid := COALESCE(nj ->> 'company_id', oj ->> 'company_id')::uuid;
  END IF;
  rid := COALESCE(nj ->> 'id', oj ->> 'id')::uuid;
  IF cid IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;  -- 系统模板行不审计
  IF TG_OP = 'UPDATE' THEN
    SELECT array_agg(key) INTO cols FROM jsonb_each(nj) n
      WHERE n.value IS DISTINCT FROM (oj -> n.key) AND n.key NOT IN ('updated_at','updated_by','search_text','last_seen_at','pending_count');
    IF cols IS NULL THEN RETURN NEW; END IF;
  END IF;
  PERFORM ensure_audit_partition(current_date);
  INSERT INTO audit_log(company_id, user_id, action, table_name, row_id, before_json, after_json, changed_columns, device_id)
  VALUES (cid, app_user_id(), TG_OP, TG_TABLE_NAME, rid,
          oj - 'pin_hash' - 'device_key_hash' - 'search_text',
          nj - 'pin_hash' - 'device_key_hash' - 'search_text',
          cols, app_device_id());
  RETURN COALESCE(NEW, OLD);
END $$ LANGUAGE plpgsql SECURITY DEFINER;
