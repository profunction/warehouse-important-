-- 第十三组：设备和同步；工单最小版
CREATE TABLE device (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id uuid NOT NULL REFERENCES company(id),
  site_id uuid REFERENCES site(id),
  type text NOT NULL CHECK (type IN ('PHONE','POS','KIOSK','SCANNER','SCALE','LABEL_PRINTER','RECEIPT_PRINTER','CASH_DRAWER')),
  name text NOT NULL,
  serial text,
  device_key_hash text,
  paired_to_device_id uuid REFERENCES device(id),
  last_seen_at timestamptz,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','OFFLINE','DISABLED')),
  app_version text,
  pending_count integer NOT NULL DEFAULT 0,
  config_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz, created_by uuid, updated_at timestamptz, updated_by uuid
);
CREATE INDEX device_company ON device (company_id, site_id);
CREATE TRIGGER t_audit_cols BEFORE INSERT OR UPDATE ON device FOR EACH ROW EXECUTE FUNCTION trg_set_audit_cols();

CREATE TABLE sync_batch (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL,
  device_id uuid NOT NULL,
  user_id uuid NOT NULL,
  received_count integer NOT NULL,
  applied_count integer NOT NULL,
  duplicate_count integer NOT NULL,
  rejected_count integer NOT NULL,
  quarantined_count integer NOT NULL,
  clock_skew_seconds integer,
  errors jsonb,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sync_batch_device ON sync_batch (company_id, device_id, received_at DESC);

CREATE TABLE sync_quarantine (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id uuid NOT NULL,
  device_id uuid NOT NULL,
  user_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  client_id uuid NOT NULL,
  entity text NOT NULL,
  payload jsonb NOT NULL,
  reason_code text NOT NULL,
  reason_message text,
  ticket_id uuid,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','RETRIED','DISCARDED')),
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sync_quarantine_company ON sync_quarantine (company_id, status);

-- 同步幂等：所有实体的 client_id 登记
CREATE TABLE sync_applied (
  company_id uuid NOT NULL,
  entity text NOT NULL,
  client_id uuid NOT NULL,
  server_id uuid,
  applied_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity, client_id)
);

CREATE TABLE ticket (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id uuid NOT NULL REFERENCES company(id),
  site_id uuid REFERENCES site(id),
  ticket_no bigint GENERATED ALWAYS AS IDENTITY,
  type text NOT NULL CHECK (type IN ('COUNT_VARIANCE','RECEIVE_VARIANCE','TRANSFER_VARIANCE','NEGATIVE_STOCK','CUSTOMER_HELP','BOT_UNANSWERED','DEVICE','UNKNOWN_BARCODE','OVERDUE_AR','SYNC_QUARANTINE','MANUAL','RECEIVE_DAMAGE')),
  title text NOT NULL,
  ref_type text, ref_id uuid,
  owner_id uuid REFERENCES app_user(id),
  owner_role_code text,
  status text NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW','IN_PROGRESS','WAITING','RESOLVED','CLOSED')),
  priority text NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW','NORMAL','HIGH','URGENT')),
  deadline_at timestamptz,
  resolved_at timestamptz,
  resolution text,
  created_at timestamptz, created_by uuid, updated_at timestamptz, updated_by uuid
);
CREATE INDEX ticket_company ON ticket (company_id, status, owner_id);
CREATE TRIGGER t_audit_cols BEFORE INSERT OR UPDATE ON ticket FOR EACH ROW EXECUTE FUNCTION trg_set_audit_cols();

CREATE TABLE ticket_event (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id uuid NOT NULL,
  ticket_id uuid NOT NULL REFERENCES ticket(id) ON DELETE CASCADE,
  user_id uuid,
  event text NOT NULL CHECK (event IN ('COMMENT','STATUS','ASSIGN','PHOTO','CREATED')),
  text text,
  photo_url text,
  at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE knowledge_article (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id uuid REFERENCES company(id),  -- 空 = 系统 SOP
  screen_ref text,
  question_zh text, question_ms text, question_en text,
  answer_zh text, answer_ms text, answer_en text,
  role_codes text[],
  source_ticket_id uuid,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz, created_by uuid, updated_at timestamptz, updated_by uuid
);
CREATE TRIGGER t_audit_cols BEFORE INSERT OR UPDATE ON knowledge_article FOR EACH ROW EXECUTE FUNCTION trg_set_audit_cols();

CREATE TABLE notification (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id uuid NOT NULL,
  user_id uuid NOT NULL,
  channel text NOT NULL DEFAULT 'APP' CHECK (channel IN ('APP','TELEGRAM','SMS')),
  type text NOT NULL,
  ref_type text, ref_id uuid,
  text text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);
CREATE INDEX notification_user ON notification (user_id, read_at, sent_at DESC);
