-- A 模式模板：类别、区、后仓位、设定。以函数形式，create_company 时调用。
CREATE TABLE IF NOT EXISTS template_category (
  plan text NOT NULL, code text NOT NULL, name_zh text, name_ms text, name_en text, icon text, color text,
  backroom_code text, shelf_life_days smallint, default_unit text NOT NULL DEFAULT 'PCS',
  min_rule jsonb, sort_order int, PRIMARY KEY (plan, code)
);
INSERT INTO template_category VALUES
('A','BEV','饮料','Minuman','Beverages','cup','#1565C0','S-01',365,'PCS','{"min":"1case|12","reorder":"2case|24","days":7}',1),
('A','SNK','零食','Snek','Snacks','cookie','#F9A825','S-02',180,'PCS','{"min":"1case|12","reorder":"2case|24","days":7}',2),
('A','DRY','干粮杂货','Barangan Kering','Dry Goods','wheat','#8D6E63','S-02',365,'PCS','{"min":"1case|12","reorder":"2case|24","days":7}',3),
('A','CAN','罐头调味','Tin & Perasa','Canned & Sauces','can','#6D4C41','S-03',540,'PCS','{"min":"1case|12","reorder":"2case|24","days":7}',4),
('A','DAI','冷藏乳品','Tenusu Sejuk','Chilled & Dairy','snowflake','#29B6F6','S-04',14,'PCS','{"min":"6","reorder":"12","days":3}',5),
('A','FRZ','冷冻','Sejuk Beku','Frozen','ice','#0277BD','S-04',180,'PCS','{"min":"1case|10","reorder":"1case|10","days":7}',6),
('A','FRS','生鲜蔬果','Sayur & Buah','Fresh Produce','leaf','#43A047','S-05',5,'KG','{"min":"2","reorder":"5","days":2}',7),
('A','SEA','海鲜肉类（称重）','Makanan Laut & Daging','Seafood & Meat','fish','#D84315','S-05',3,'KG','{"min":"2","reorder":"5","days":2}',8),
('A','HHD','日用品','Barangan Rumah','Household','home','#7E57C2','S-06',NULL,'PCS','{"min":"1case|12","reorder":"2case|24","days":7}',9),
('A','PER','个人护理','Penjagaan Diri','Personal Care','heart','#EC407A','S-06',720,'PCS','{"min":"1case|12","reorder":"2case|24","days":7}',10),
('A','BAB','母婴','Bayi','Baby','baby','#FFB74D','S-06',540,'PCS','{"min":"1case|12","reorder":"2case|24","days":7}',11),
('A','TOB','烟酒（限售）','Tembakau & Alkohol','Tobacco & Alcohol','lock','#424242','S-03',NULL,'PCS','{"min":"2","reorder":"5","days":14}',12)
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS template_zone (
  plan text NOT NULL, code text NOT NULL, name_zh text, name_ms text, name_en text, zone_type text, color text,
  allowed text[], racks int, levels int, hard boolean DEFAULT false, sort_order int, PRIMARY KEY (plan, code)
);
INSERT INTO template_zone VALUES
('A','A','A 走道','Lorong A','Aisle A','SHELF','#C62828','{BEV}',6,4,false,1),
('A','B','B 走道','Lorong B','Aisle B','SHELF','#EF6C00','{SNK,DRY}',6,4,false,2),
('A','C','C 走道','Lorong C','Aisle C','SHELF','#F9A825','{CAN,HHD}',6,4,false,3),
('A','D','D 走道','Lorong D','Aisle D','SHELF','#2E7D32','{FRS,SEA}',4,2,false,4),
('A','E','E 走道','Lorong E','Aisle E','SHELF','#1565C0','{DAI,FRZ}',4,3,false,5),
('A','F','收银台前','Depan Kaunter','Front Counter','SHELF','#6A1B9A','{PER,BAB,TOB}',3,4,false,6),
('A','S','后仓','Stor','Backroom','BACKROOM','#616161','{}',0,0,true,7)
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS template_backroom (
  plan text NOT NULL, code text NOT NULL, name_zh text, name_ms text, name_en text, allowed text[], PRIMARY KEY (plan, code)
);
INSERT INTO template_backroom VALUES
('A','S-01','后仓 饮料','Stor Minuman','Backroom Beverages','{BEV}'),
('A','S-02','后仓 干货','Stor Kering','Backroom Dry','{SNK,DRY}'),
('A','S-03','后仓 罐头上锁柜','Stor Tin & Kabinet Berkunci','Backroom Canned & Locked','{CAN,TOB}'),
('A','S-04','后仓 冷柜','Stor Peti Sejuk','Backroom Chiller','{DAI,FRZ}'),
('A','S-05','后仓 生鲜','Stor Segar','Backroom Fresh','{FRS,SEA}'),
('A','S-06','后仓 日用','Stor Barangan Rumah','Backroom Household','{HHD,PER,BAB}')
ON CONFLICT DO NOTHING;

-- 后仓按位分区：每个 S-xx 是一个 zone（BACKROOM，硬限制），下面一个 location 同 code。
-- 这样后仓硬限制可以按位设允许类别。

CREATE OR REPLACE FUNCTION default_settings(p_plan text) RETURNS jsonb AS $$
  SELECT jsonb_build_object(
    'cash_rounding', 0.05,
    'order_proposal_time', '08:00',
    'approval_threshold_count_variance', 0,
    'approval_threshold_adjust', 0,
    'approval_threshold_payment', 0,
    'cashier_discount_max_pct', 5,
    'allow_negative_stock', true,
    'receive_direct_to_backroom', p_plan = 'A',
    'pos_terminal_count', 2,
    'scale_barcode_format', jsonb_build_object('prefix','2','plu_len',5,'weight_len',5,'unit','g'),
    'languages', jsonb_build_array('zh','ms','en'),
    'min_app_version', '0.1.0'
  )
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION default_feature_flags(p_plan text) RETURNS jsonb AS $$
  SELECT jsonb_build_object(
    'transfers', p_plan = 'B', 'cycle_count', p_plan = 'B', 'b2b_invoice', p_plan = 'B', 'kiosk', p_plan = 'B',
    'pandal', p_plan = 'B', 'einvoice_consolidated', true, 'own_pos', p_plan = 'A'
  )
$$ LANGUAGE sql IMMUTABLE;

-- 创建公司（含站点、税码、类别、区、位置、角色、原因启用、老板账号）
CREATE OR REPLACE FUNCTION create_company_from_template(
  p_name text, p_short_code text, p_plan text, p_tin text, p_sst_no text, p_address jsonb,
  p_boss_name text, p_boss_phone text, p_boss_pin_hash text, p_boss_email text DEFAULT NULL,
  p_zone_overrides jsonb DEFAULT '{}'::jsonb   -- {"A":{"racks":8,"levels":4}}
) RETURNS TABLE (o_company_id uuid, o_site_id uuid, o_boss_user_id uuid, o_boss_badge_code text) AS $$
DECLARE
  cid uuid; sid uuid; uid uuid; badge text; zid uuid; lid uuid;
  tc template_category%ROWTYPE; tz template_zone%ROWTYPE; tb template_backroom%ROWTYPE;
  catid uuid; racks int; levels int; i int; j int; boss_role uuid; tax_default uuid;
  cat_ids jsonb := '{}'::jsonb;
BEGIN
  INSERT INTO company (name, short_code, plan, tin, sst_no, address, feature_flags, settings)
  VALUES (p_name, p_short_code, p_plan, p_tin, p_sst_no, p_address, default_feature_flags(p_plan), default_settings(p_plan))
  RETURNING id INTO cid;
  PERFORM set_config('app.company_id', cid::text, true);

  INSERT INTO site (company_id, code, name, type) VALUES (cid, CASE WHEN p_plan='A' THEN 'SHOP1' ELSE 'WH1' END, p_name, CASE WHEN p_plan='A' THEN 'SHOP' ELSE 'WAREHOUSE' END) RETURNING id INTO sid;

  INSERT INTO tax_code (company_id, code, rate, myinvois_tax_type, is_default) VALUES
    (cid,'SST-0',0,'06',true),(cid,'SST-5',5,'01',false),(cid,'SST-10',10,'01',false),(cid,'EXEMPT',0,'E',false);

  FOR tc IN SELECT * FROM template_category WHERE plan = p_plan ORDER BY sort_order LOOP
    INSERT INTO category (company_id, code, name_zh, name_ms, name_en, icon, color, default_backroom_code, default_shelf_life_days, default_unit, sort_order)
    VALUES (cid, tc.code, tc.name_zh, tc.name_ms, tc.name_en, tc.icon, tc.color, tc.backroom_code, tc.shelf_life_days, tc.default_unit, tc.sort_order)
    RETURNING id INTO catid;
    cat_ids := cat_ids || jsonb_build_object(tc.code, catid);
  END LOOP;

  -- 店面区和货位（A 模式）
  IF p_plan = 'A' THEN
    FOR tz IN SELECT * FROM template_zone WHERE plan = 'A' AND zone_type = 'SHELF' ORDER BY sort_order LOOP
      racks := COALESCE((p_zone_overrides -> tz.code ->> 'racks')::int, tz.racks);
      levels := COALESCE((p_zone_overrides -> tz.code ->> 'levels')::int, tz.levels);
      INSERT INTO zone (company_id, site_id, code, name_zh, name_ms, name_en, zone_type, color, allowed_is_hard, sort_order)
      VALUES (cid, sid, tz.code, tz.name_zh, tz.name_ms, tz.name_en, 'SHELF', tz.color, false, tz.sort_order) RETURNING id INTO zid;
      INSERT INTO zone_category (zone_id, category_id) SELECT zid, (cat_ids ->> c)::uuid FROM unnest(tz.allowed) c WHERE cat_ids ? c;
      FOR i IN 1..racks LOOP FOR j IN 1..levels LOOP
        INSERT INTO location (company_id, site_id, zone_id, code, rack, level) VALUES (cid, sid, zid, format('%s-%s-%s', tz.code, lpad(i::text,2,'0'), j), i, j);
      END LOOP; END LOOP;
    END LOOP;
    -- 后仓：每个 S-xx 一个硬限制区加一个位置
    FOR tb IN SELECT * FROM template_backroom WHERE plan = 'A' ORDER BY code LOOP
      INSERT INTO zone (company_id, site_id, code, name_zh, name_ms, name_en, zone_type, color, allowed_is_hard, sort_order)
      VALUES (cid, sid, replace(tb.code,'-',''), tb.name_zh, tb.name_ms, tb.name_en, 'BACKROOM', '#616161', true, 100 + substr(tb.code, 3)::int) RETURNING id INTO zid;
      INSERT INTO zone_category (zone_id, category_id) SELECT zid, (cat_ids ->> c)::uuid FROM unnest(tb.allowed) c WHERE cat_ids ? c;
      INSERT INTO location (company_id, site_id, zone_id, code, rack, level) VALUES (cid, sid, zid, tb.code, substr(tb.code, 3)::int, 1) RETURNING id INTO lid;
    END LOOP;
  ELSE
    -- B 模式：一个收货区，其余由位置导入建
    INSERT INTO zone (company_id, site_id, code, name_zh, name_ms, name_en, zone_type, color, sort_order)
    VALUES (cid, sid, 'RCV', '收货区', 'Zon Terima', 'Receiving', 'RECEIVING', '#9E9E9E', 0) RETURNING id INTO zid;
    INSERT INTO location (company_id, site_id, zone_id, code, rack, level) VALUES (cid, sid, zid, 'RCV-01-1', 1, 1);
  END IF;

  -- 角色复制（按 plan 启用）
  INSERT INTO role (company_id, code, name_zh, name_ms, name_en, home_buttons, enabled_in_plan)
  SELECT cid, r0.code, r0.name_zh, r0.name_ms, r0.name_en,
    CASE WHEN p_plan = 'B' AND r0.code = 'WAREHOUSE' THEN '[{"screen":"receive","icon":"box","color":"#1565C0"},{"screen":"putaway","icon":"shelf","color":"#1B8A3A"},{"screen":"pick","icon":"truck","color":"#EF6C00"},{"screen":"lookup","icon":"search","color":"#616161"}]'::jsonb
         ELSE r0.home_buttons END,
    r0.enabled_in_plan
  FROM role r0 WHERE r0.company_id IS NULL AND p_plan = ANY(r0.enabled_in_plan);
  INSERT INTO role_permission (role_id, permission_code, condition)
  SELECT cr.id, rp.permission_code, rp.condition FROM role cr JOIN role sr ON sr.code = cr.code AND sr.company_id IS NULL
  JOIN role_permission rp ON rp.role_id = sr.id WHERE cr.company_id = cid;

  -- 移动原因启用：第一阶段 RECEIVE/PUTAWAY/REFILL/COUNT/ADJUST
  INSERT INTO movement_reason_enabled (company_id, reason, enabled)
  SELECT cid, rr.v, rr.v IN ('RECEIVE','PUTAWAY','REFILL','COUNT','ADJUST') FROM unnest(ARRAY['RECEIVE','PUTAWAY','REFILL','TRANSFER_OUT','TRANSFER_IN','SALE','RETURN','COUNT','ADJUST']) AS rr(v);

  -- 老板
  INSERT INTO app_user (company_id, name, phone, email, pin_hash, language) VALUES (cid, p_boss_name, p_boss_phone, p_boss_email, p_boss_pin_hash, 'zh')
  RETURNING id, app_user.badge_code INTO uid, badge;
  SELECT id INTO boss_role FROM role WHERE role.company_id = cid AND code = 'BOSS';
  INSERT INTO user_site_role (company_id, user_id, site_id, role_id) VALUES (cid, uid, NULL, boss_role);

  RETURN QUERY SELECT cid, sid, uid, badge;
END $$ LANGUAGE plpgsql SECURITY DEFINER;
