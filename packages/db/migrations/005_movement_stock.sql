-- 第三组：库存和账本
CREATE TABLE movement_reason_enabled (
  company_id uuid NOT NULL REFERENCES company(id),
  reason text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  PRIMARY KEY (company_id, reason)
);

CREATE TABLE movement (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES company(id),
  product_id uuid NOT NULL REFERENCES product(id),
  from_location_id uuid NOT NULL REFERENCES location(id),
  to_location_id uuid NOT NULL REFERENCES location(id),
  qty numeric(14,3) NOT NULL CHECK (qty > 0),
  reason text NOT NULL CHECK (reason IN ('RECEIVE','PUTAWAY','REFILL','TRANSFER_OUT','TRANSFER_IN','SALE','RETURN','COUNT','ADJUST')),
  ref_type text CHECK (ref_type IS NULL OR ref_type IN ('IMPORT','GRN','TRANSFER','SALE','COUNT','ADJUST','MANUAL')),
  ref_id uuid,
  expiry_date date,
  unit_cost numeric(14,2) NOT NULL DEFAULT 0,
  performed_by uuid NOT NULL REFERENCES app_user(id),
  performed_at timestamptz NOT NULL,
  device_id uuid,
  client_created_at timestamptz NOT NULL DEFAULT now(),
  synced_at timestamptz NOT NULL DEFAULT now(),
  note text CHECK (note IS NULL OR length(note) <= 200),
  reversal_of uuid REFERENCES movement(id),
  CHECK (from_location_id <> to_location_id)
);
CREATE INDEX movement_product ON movement (company_id, product_id, performed_at DESC);
CREATE INDEX movement_from ON movement (company_id, from_location_id, performed_at DESC);
CREATE INDEX movement_to ON movement (company_id, to_location_id, performed_at DESC);
CREATE INDEX movement_user ON movement (company_id, performed_by, performed_at DESC);
CREATE INDEX movement_ref ON movement (ref_type, ref_id);
CREATE INDEX movement_reason ON movement (company_id, reason, performed_at);
CREATE TRIGGER t_forbid_update BEFORE UPDATE OR DELETE ON movement FOR EACH ROW EXECUTE FUNCTION trg_forbid_change();

CREATE TABLE stock (
  company_id uuid NOT NULL,
  product_id uuid NOT NULL REFERENCES product(id),
  location_id uuid NOT NULL REFERENCES location(id),
  qty numeric(14,3) NOT NULL DEFAULT 0,
  last_movement_at timestamptz NOT NULL DEFAULT now(),
  earliest_expiry date,
  PRIMARY KEY (product_id, location_id)
);
CREATE INDEX stock_location ON stock (company_id, location_id);
CREATE INDEX stock_product ON stock (company_id, product_id);
CREATE INDEX stock_negative ON stock (company_id) WHERE qty < 0;
CREATE INDEX stock_updated ON stock (company_id, last_movement_at);

CREATE TABLE expiry_lot (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id uuid NOT NULL,
  product_id uuid NOT NULL REFERENCES product(id),
  location_id uuid NOT NULL REFERENCES location(id),
  expiry_date date NOT NULL,
  qty numeric(14,3) NOT NULL DEFAULT 0 CHECK (qty >= 0),
  UNIQUE (product_id, location_id, expiry_date)
);

CREATE OR REPLACE FUNCTION reason_permission(r text) RETURNS text AS $$
  SELECT CASE r
    WHEN 'RECEIVE' THEN 'movement.receive'
    WHEN 'PUTAWAY' THEN 'movement.putaway'
    WHEN 'REFILL' THEN 'movement.refill'
    WHEN 'TRANSFER_OUT' THEN 'movement.transfer_out'
    WHEN 'TRANSFER_IN' THEN 'movement.transfer_in'
    WHEN 'SALE' THEN 'movement.sale'
    WHEN 'RETURN' THEN 'movement.return'
    WHEN 'COUNT' THEN 'count.approve'
    WHEN 'ADJUST' THEN 'movement.adjust'
  END
$$ LANGUAGE sql IMMUTABLE;

-- 移动记录插入前：补 unit_cost、校验公司、原因启用、权限、后仓硬限制
CREATE OR REPLACE FUNCTION trg_movement_before() RETURNS trigger AS $$
DECLARE
  f location%ROWTYPE; t location%ROWTYPE;
  p product%ROWTYPE;
  site_for_perm uuid;
  zc_count int; zc_match int; hard boolean;
BEGIN
  SELECT * INTO f FROM location WHERE id = NEW.from_location_id;
  SELECT * INTO t FROM location WHERE id = NEW.to_location_id;
  SELECT * INTO p FROM product WHERE id = NEW.product_id;
  IF f.id IS NULL OR t.id IS NULL THEN RAISE EXCEPTION 'LOCATION_NOT_FOUND'; END IF;
  IF p.id IS NULL THEN RAISE EXCEPTION 'PRODUCT_NOT_FOUND'; END IF;
  IF f.company_id <> NEW.company_id OR t.company_id <> NEW.company_id OR p.company_id <> NEW.company_id THEN
    RAISE EXCEPTION 'COMPANY_MISMATCH';
  END IF;
  IF NOT f.is_active OR NOT t.is_active THEN RAISE EXCEPTION 'LOCATION_INACTIVE'; END IF;
  IF NOT p.is_active THEN RAISE EXCEPTION 'PRODUCT_INACTIVE'; END IF;
  IF NOT EXISTS (SELECT 1 FROM movement_reason_enabled m WHERE m.company_id = NEW.company_id AND m.reason = NEW.reason AND m.enabled) THEN
    RAISE EXCEPTION 'REASON_DISABLED: %', NEW.reason;
  END IF;
  -- 跨站点只允许 TRANSFER 且一端 TRANSIT
  IF f.site_id IS NOT NULL AND t.site_id IS NOT NULL AND f.site_id <> t.site_id THEN
    RAISE EXCEPTION 'CROSS_SITE_NOT_ALLOWED';
  END IF;
  IF NEW.reason IN ('TRANSFER_OUT','TRANSFER_IN') AND NOT (f.virtual_type = 'TRANSIT' OR t.virtual_type = 'TRANSIT') THEN
    RAISE EXCEPTION 'TRANSFER_NEEDS_TRANSIT';
  END IF;
  -- 权限：按非虚拟一端的站点
  site_for_perm := COALESCE(t.site_id, f.site_id);
  IF NOT user_has_permission(NEW.performed_by, site_for_perm, reason_permission(NEW.reason), NEW.performed_at) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: %', reason_permission(NEW.reason);
  END IF;
  -- 后仓硬限制：目标区 allowed_is_hard 且有允许类别清单时必须匹配
  IF t.zone_id IS NOT NULL THEN
    SELECT z.allowed_is_hard INTO hard FROM zone z WHERE z.id = t.zone_id;
    IF hard THEN
      SELECT count(*), count(*) FILTER (WHERE zc.category_id = p.category_id OR zc.category_id = (SELECT parent_id FROM category WHERE id = p.category_id))
        INTO zc_count, zc_match FROM zone_category zc WHERE zc.zone_id = t.zone_id;
      IF zc_count > 0 AND zc_match = 0 THEN RAISE EXCEPTION 'CATEGORY_NOT_ALLOWED_IN_ZONE'; END IF;
    END IF;
  END IF;
  NEW.unit_cost := p.cost_price;
  NEW.synced_at := now();
  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER;
CREATE TRIGGER t_before BEFORE INSERT ON movement FOR EACH ROW EXECUTE FUNCTION trg_movement_before();

-- 移动记录插入后：更新 stock（按 location_id 排序防死锁）、负库存检查、到期批
CREATE OR REPLACE FUNCTION trg_movement_after() RETURNS trigger AS $$
DECLARE
  first_loc uuid; second_loc uuid; first_delta numeric; second_delta numeric;
  allow_neg boolean; new_from_qty numeric; from_virtual boolean;
BEGIN
  IF NEW.from_location_id < NEW.to_location_id THEN
    first_loc := NEW.from_location_id; first_delta := -NEW.qty; second_loc := NEW.to_location_id; second_delta := NEW.qty;
  ELSE
    first_loc := NEW.to_location_id; first_delta := NEW.qty; second_loc := NEW.from_location_id; second_delta := -NEW.qty;
  END IF;
  INSERT INTO stock (company_id, product_id, location_id, qty, last_movement_at)
  VALUES (NEW.company_id, NEW.product_id, first_loc, first_delta, NEW.performed_at)
  ON CONFLICT (product_id, location_id) DO UPDATE
    SET qty = stock.qty + EXCLUDED.qty, last_movement_at = greatest(stock.last_movement_at, EXCLUDED.last_movement_at);
  INSERT INTO stock (company_id, product_id, location_id, qty, last_movement_at)
  VALUES (NEW.company_id, NEW.product_id, second_loc, second_delta, NEW.performed_at)
  ON CONFLICT (product_id, location_id) DO UPDATE
    SET qty = stock.qty + EXCLUDED.qty, last_movement_at = greatest(stock.last_movement_at, EXCLUDED.last_movement_at);

  SELECT is_virtual INTO from_virtual FROM location WHERE id = NEW.from_location_id;
  IF NOT from_virtual THEN
    SELECT qty INTO new_from_qty FROM stock WHERE product_id = NEW.product_id AND location_id = NEW.from_location_id;
    SELECT coalesce((settings->>'allow_negative_stock')::boolean, true) INTO allow_neg FROM company WHERE id = NEW.company_id;
    IF new_from_qty < 0 AND NEW.reason <> 'SALE' AND NOT allow_neg THEN
      RAISE EXCEPTION 'INSUFFICIENT_STOCK: % at location', new_from_qty;
    END IF;
  END IF;

  IF NEW.expiry_date IS NOT NULL THEN
    INSERT INTO expiry_lot (company_id, product_id, location_id, expiry_date, qty)
    VALUES (NEW.company_id, NEW.product_id, NEW.to_location_id, NEW.expiry_date, NEW.qty)
    ON CONFLICT (product_id, location_id, expiry_date) DO UPDATE SET qty = expiry_lot.qty + EXCLUDED.qty;
    UPDATE stock SET earliest_expiry = least(coalesce(earliest_expiry, NEW.expiry_date), NEW.expiry_date)
      WHERE product_id = NEW.product_id AND location_id = NEW.to_location_id;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER;
CREATE TRIGGER t_after AFTER INSERT ON movement FOR EACH ROW EXECUTE FUNCTION trg_movement_after();

CREATE TABLE shelf_assignment (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id uuid NOT NULL REFERENCES company(id),
  product_id uuid NOT NULL REFERENCES product(id),
  location_id uuid NOT NULL REFERENCES location(id),
  site_id uuid NOT NULL REFERENCES site(id),
  is_primary boolean NOT NULL DEFAULT false,
  facing_count smallint,
  assigned_by uuid NOT NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz, created_by uuid, updated_at timestamptz, updated_by uuid,
  UNIQUE (product_id, location_id)
);
CREATE UNIQUE INDEX shelf_primary_unique ON shelf_assignment (product_id, site_id) WHERE is_primary AND is_active;
CREATE INDEX shelf_site ON shelf_assignment (company_id, site_id, updated_at);
CREATE TRIGGER t_audit_cols BEFORE INSERT OR UPDATE ON shelf_assignment FOR EACH ROW EXECUTE FUNCTION trg_set_audit_cols();
CREATE OR REPLACE FUNCTION trg_shelf_check() RETURNS trigger AS $$
DECLARE st text; zt text; sid uuid;
BEGIN
  SELECT s.type, z.zone_type, l.site_id INTO st, zt, sid FROM location l JOIN site s ON s.id = l.site_id JOIN zone z ON z.id = l.zone_id WHERE l.id = NEW.location_id;
  IF st IS DISTINCT FROM 'SHOP' OR zt IS DISTINCT FROM 'SHELF' THEN
    RAISE EXCEPTION 'SHELF_ASSIGNMENT_NEEDS_SHOP_SHELF';
  END IF;
  NEW.site_id := sid;
  -- 新的 primary 取代旧的
  IF NEW.is_primary THEN
    UPDATE shelf_assignment SET is_primary = false WHERE product_id = NEW.product_id AND site_id = sid AND is_primary AND id <> NEW.id;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER;
CREATE TRIGGER t_check BEFORE INSERT OR UPDATE ON shelf_assignment FOR EACH ROW EXECUTE FUNCTION trg_shelf_check();
