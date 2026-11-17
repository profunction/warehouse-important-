-- 九个系统角色模板（company_id 为空）
INSERT INTO role (company_id, code, name_zh, name_ms, name_en, home_buttons, enabled_in_plan) VALUES
(NULL,'SUPER_ADMIN','超级管理员','Pentadbir Utama','Super Admin','[]','{A,B}'),
(NULL,'BOSS','老板','Bos','Boss','[{"screen":"approvals","icon":"check","color":"#C62828"},{"screen":"lookup","icon":"search","color":"#616161"},{"screen":"reports","icon":"chart","color":"#1565C0"},{"screen":"settings","icon":"gear","color":"#1B8A3A"}]','{A,B}'),
(NULL,'MANAGER','经理','Pengurus','Manager','[{"screen":"approvals","icon":"check","color":"#C62828"},{"screen":"tickets","icon":"ticket","color":"#EF6C00"},{"screen":"count_plan","icon":"list","color":"#1565C0"},{"screen":"lookup","icon":"search","color":"#616161"}]','{B}'),
(NULL,'PURCHASER','采购员','Pembeli','Purchaser','[{"screen":"order_proposals","icon":"cart","color":"#1B8A3A"},{"screen":"purchase_orders","icon":"doc","color":"#1565C0"},{"screen":"tickets","icon":"ticket","color":"#EF6C00"},{"screen":"suppliers","icon":"truck","color":"#616161"}]','{B}'),
(NULL,'WAREHOUSE','库存员','Pekerja Stok','Stock Staff','[{"screen":"receive","icon":"box","color":"#1565C0"},{"screen":"refill","icon":"shelf","color":"#1B8A3A"},{"screen":"count","icon":"list","color":"#EF6C00"},{"screen":"lookup","icon":"search","color":"#616161"}]','{A,B}'),
(NULL,'COUNTER','盘点员','Pengira Stok','Stock Checker','[{"screen":"count","icon":"list","color":"#EF6C00"},{"screen":"lookup","icon":"search","color":"#616161"},{"screen":"tickets","icon":"ticket","color":"#1565C0"},{"screen":"my_records","icon":"history","color":"#1B8A3A"}]','{B}'),
(NULL,'STOCKER','上架员','Penyusun Rak','Shelf Stocker','[{"screen":"refill","icon":"shelf","color":"#1B8A3A"},{"screen":"assign_shelf","icon":"pin","color":"#1565C0"},{"screen":"tickets","icon":"ticket","color":"#EF6C00"},{"screen":"lookup","icon":"search","color":"#616161"}]','{B}'),
(NULL,'CASHIER','收银员','Juruwang','Cashier','[{"screen":"pos","icon":"cart","color":"#1B8A3A"},{"screen":"returns","icon":"undo","color":"#EF6C00"},{"screen":"lookup","icon":"search","color":"#616161"},{"screen":"close_day","icon":"sum","color":"#1565C0"}]','{A,B}'),
(NULL,'ACCOUNTS','会计','Akaun','Accounts','[{"screen":"ar","icon":"doc","color":"#1565C0"},{"screen":"ap","icon":"doc","color":"#EF6C00"},{"screen":"payments","icon":"cash","color":"#1B8A3A"},{"screen":"month_end","icon":"lock","color":"#616161"}]','{B}');

-- 仓库员在 B 模式的首页：收货、上架、拣货、查询（A 模式用上面的收货补货盘点查询，由 create_company 时按 plan 覆盖）

-- 权限分配（按第四部分矩阵，第一阶段先全量定义，后阶段权限随功能启用）
CREATE OR REPLACE FUNCTION grant_perms(role_code text, perms text[], cond jsonb DEFAULT NULL) RETURNS void AS $$
  INSERT INTO role_permission (role_id, permission_code, condition)
  SELECT r.id, p, cond FROM role r, unnest(perms) p WHERE r.company_id IS NULL AND r.code = role_code
  ON CONFLICT DO NOTHING;
$$ LANGUAGE sql;

SELECT grant_perms('SUPER_ADMIN', ARRAY(SELECT code FROM permission WHERE code NOT LIKE 'movement.%' AND code NOT LIKE 'pos.%' AND code NOT IN ('order.review','order.approve','po.create','po.cancel','count.enter','count.assign','count.approve','invoice.manage','statement.send','ap.manage','ap.pay','ap.approve','period.lock','approval.decide','import.approve.po')));
SELECT grant_perms('BOSS', ARRAY(SELECT code FROM permission WHERE code NOT IN ('company.manage','role.edit','count.enter','movement.sale','pos.sell')));
SELECT grant_perms('BOSS', ARRAY['movement.sale','pos.sell'], '{"plan_a_or_cover": true}');
SELECT grant_perms('MANAGER', ARRAY['product.view','product.view_margin','product.edit','barcode.add','customer.manage','label.print','stock.view','movement.view','movement.view_all',
  'movement.receive','movement.putaway','movement.refill','movement.transfer_out','movement.transfer_in','movement.adjust','shelf.assign','order.view','po.view','receive.variance',
  'transfer.request','transfer.approve','transfer.view','count.assign','count.approve','count.rules','count.view_system_qty','report.stock','ticket.view_own','ticket.create','ticket.manage',
  'import.upload','export.product','export.po','user.reset_pin','device.manage','device.view','approval.decide','delegation.manage','kb.edit','bot.ask','pos.discount','pos.void_open','pos.b2b','pos.close']);
SELECT grant_perms('MANAGER', ARRAY['price.edit','minlevel.edit','location.manage','map.edit','stock.view_other_sites','report.shrinkage','ticket.view_all','export.stock','export.sales','import.approve.location','user.manage','audit.view','pos.sell','pos.void_closed','report.sales'], '{"own_site_only": true}');
SELECT grant_perms('PURCHASER', ARRAY['product.view','product.view_cost','product.view_margin','product.edit','cost.edit','minlevel.edit','barcode.add','supplier.manage','stock.view','stock.view_other_sites','order.view','order.review','po.view','po.send','receive.variance','ticket.view_own','ticket.create','import.upload','import.approve.supplier','export.product','export.product_with_cost','export.stock','export.po','bot.ask']);
SELECT grant_perms('PURCHASER', ARRAY['po.create','po.cancel','movement.view','ticket.manage'], '{"own_scope": true}');
SELECT grant_perms('WAREHOUSE', ARRAY['product.view','label.print','stock.view','movement.receive','movement.putaway','movement.transfer_out','ticket.view_own','ticket.create','bot.ask','report.stock']);
SELECT grant_perms('WAREHOUSE', ARRAY['barcode.add','movement.view','movement.refill','shelf.assign','count.enter','movement.transfer_in'], '{"own_only": true}');
SELECT grant_perms('COUNTER', ARRAY['product.view','stock.view','count.enter','ticket.view_own','ticket.create','bot.ask']);
SELECT grant_perms('COUNTER', ARRAY['movement.view'], '{"own_only": true}');
SELECT grant_perms('STOCKER', ARRAY['product.view','label.print','stock.view','movement.refill','movement.transfer_in','shelf.assign','transfer.request','ticket.view_own','ticket.create','bot.ask']);
SELECT grant_perms('STOCKER', ARRAY['barcode.add','movement.view','movement.receive','stock.view_other_sites'], '{"own_only": true}');
SELECT grant_perms('CASHIER', ARRAY['product.view','stock.view','movement.sale','pos.sell','pos.close','ticket.view_own','ticket.create','bot.ask']);
SELECT grant_perms('CASHIER', ARRAY['movement.return','pos.discount','pos.void_open','pos.b2b','einvoice.manage'], '{"limited": true}');
SELECT grant_perms('ACCOUNTS', ARRAY['product.view','product.view_cost','product.view_margin','customer.manage','stock.view','stock.view_other_sites','movement.view','movement.view_all','po.view','report.sales','report.shrinkage','report.stock','ticket.view_own','ticket.create','import.upload','export.product','export.product_with_cost','export.stock','export.po','export.sales','export.movement','pos.close','invoice.manage','statement.send','ap.manage','ap.pay','einvoice.manage','period.lock','bot.ask']);
SELECT grant_perms('ACCOUNTS', ARRAY['supplier.manage','ticket.view_all','ticket.manage','export.audit','import.approve.customer'], '{"own_scope": true}');
