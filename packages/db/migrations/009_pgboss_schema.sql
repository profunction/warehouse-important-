-- pg-boss 需要在库上有 CREATE 权限（它自己建 pgboss 模式和表）
DO $$ BEGIN EXECUTE format('GRANT CREATE, CONNECT, TEMP ON DATABASE %I TO app_admin', current_database()); END $$;
CREATE SCHEMA IF NOT EXISTS pgboss AUTHORIZATION app_admin;
GRANT ALL ON SCHEMA pgboss TO app_admin;
