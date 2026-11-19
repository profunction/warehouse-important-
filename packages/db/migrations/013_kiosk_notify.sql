-- 模块 E（大屏/机器人/工单）：大屏实时事件 + 工单关闭原因
-- 1) 大屏事件：货架登记和售价变化由数据库触发器 pg_notify('kiosk', json)，服务器用专用连接 LISTEN 后推给 SSE 订阅者。
--    这样 routes/stock.ts（/shelf-assignments、movements 的 assign_shelf）不用改也能触发大屏更新。
CREATE OR REPLACE FUNCTION trg_kiosk_notify_shelf() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('kiosk', jsonb_build_object('event', 'shelf.updated', 'company_id', NEW.company_id, 'site_id', NEW.site_id,
    'product_id', NEW.product_id, 'location_id', NEW.location_id, 'is_primary', NEW.is_primary, 'is_active', NEW.is_active, 'at', now())::text);
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER t_kiosk_notify AFTER INSERT OR UPDATE ON shelf_assignment FOR EACH ROW EXECUTE FUNCTION trg_kiosk_notify_shelf();

CREATE OR REPLACE FUNCTION trg_kiosk_notify_price() RETURNS trigger AS $$
BEGIN
  IF NEW.sell_price IS DISTINCT FROM OLD.sell_price OR NEW.is_active IS DISTINCT FROM OLD.is_active OR NEW.photo_url IS DISTINCT FROM OLD.photo_url
      OR NEW.name_zh IS DISTINCT FROM OLD.name_zh OR NEW.name_ms IS DISTINCT FROM OLD.name_ms OR NEW.name_en IS DISTINCT FROM OLD.name_en THEN
    PERFORM pg_notify('kiosk', jsonb_build_object('event', 'price.updated', 'company_id', NEW.company_id, 'product_id', NEW.id, 'sell_price', NEW.sell_price, 'at', now())::text);
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER t_kiosk_notify_price AFTER UPDATE ON product FOR EACH ROW EXECUTE FUNCTION trg_kiosk_notify_price();

-- 2) 工单完整版：关闭原因代码（统计用）、大屏呼叫升级时间（10 分钟无人接升级给经理，只升级一次）
ALTER TABLE ticket ADD COLUMN IF NOT EXISTS close_reason text;
ALTER TABLE ticket ADD COLUMN IF NOT EXISTS escalated_at timestamptz;
CREATE INDEX IF NOT EXISTS ticket_deadline_open ON ticket (company_id, deadline_at) WHERE status NOT IN ('RESOLVED','CLOSED');
