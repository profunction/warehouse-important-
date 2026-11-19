-- 模块 B（盘点 / 审批 / 代理 / Telegram）追加：Telegram 绑定码表、重盘会话的父会话。
-- 绑定码：POST /me/telegram-link 生成 6 位码，用户在 Telegram 发 /start <码> 绑定 app_user.telegram_user_id。15 分钟过期，用一次。
CREATE TABLE IF NOT EXISTS telegram_link (
  code text PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES company(id),
  user_id uuid NOT NULL REFERENCES app_user(id),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS telegram_link_user ON telegram_link (user_id, created_at DESC);
ALTER TABLE telegram_link ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_telegram_link ON telegram_link USING (company_id = app_company_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON telegram_link TO app_rw;
GRANT ALL ON telegram_link TO app_admin;
GRANT SELECT ON telegram_link TO app_ro;

-- 重盘：审批时标 RECOUNT 的行生成新会话，指回原会话
ALTER TABLE count_session ADD COLUMN IF NOT EXISTS parent_session_id uuid REFERENCES count_session(id);
CREATE INDEX IF NOT EXISTS count_session_parent ON count_session (parent_session_id);
