-- 顾客当场自助：会员登记、电子发票资料、企业记账申请。三种共用 customer 一行。
ALTER TABLE customer ADD COLUMN IF NOT EXISTS is_member boolean NOT NULL DEFAULT false;
ALTER TABLE customer ADD COLUMN IF NOT EXISTS member_since timestamptz;
ALTER TABLE customer ADD COLUMN IF NOT EXISTS credit_status text NOT NULL DEFAULT 'NONE' CHECK (credit_status IN ('NONE','PENDING','APPROVED','REJECTED'));
ALTER TABLE customer ADD COLUMN IF NOT EXISTS credit_requested_limit numeric(14,2);
ALTER TABLE customer ADD COLUMN IF NOT EXISTS credit_requested_terms int;
ALTER TABLE customer ADD COLUMN IF NOT EXISTS credit_decided_by uuid;
ALTER TABLE customer ADD COLUMN IF NOT EXISTS credit_decided_at timestamptz;
ALTER TABLE customer ADD COLUMN IF NOT EXISTS credit_note text;
ALTER TABLE customer ADD COLUMN IF NOT EXISTS contact_name text;
ALTER TABLE customer ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'STAFF' CHECK (source IN ('STAFF','SELF','IMPORT','POS'));
ALTER TABLE customer ADD COLUMN IF NOT EXISTS consent_at timestamptz;
ALTER TABLE customer ADD COLUMN IF NOT EXISTS einvoice_profile jsonb;   -- {tin,id_type,id_no,name,email,phone,address,sst_no} 以后开电子发票自动用
-- 已经有信用额的老客户视为已批准
UPDATE customer SET credit_status = 'APPROVED' WHERE credit_limit > 0 AND credit_status = 'NONE';
CREATE INDEX IF NOT EXISTS customer_phone ON customer (company_id, phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS customer_credit_pending ON customer (company_id) WHERE credit_status = 'PENDING';
ALTER TABLE ticket DROP CONSTRAINT IF EXISTS ticket_type_check;
ALTER TABLE ticket ADD CONSTRAINT ticket_type_check CHECK (type IN ('COUNT_VARIANCE','RECEIVE_VARIANCE','TRANSFER_VARIANCE','NEGATIVE_STOCK','CUSTOMER_HELP','BOT_UNANSWERED','DEVICE','UNKNOWN_BARCODE','OVERDUE_AR','OVERDUE_AP','SYNC_QUARANTINE','MANUAL','RECEIVE_DAMAGE','EINVOICE','PANDAL_UNKNOWN','AP_VARIANCE','CREDIT_APPLICATION'));
