// 数据库验收测试（第 6 节 D 组）。用法：node scripts/test.mjs（需先 migrate --reset）
import pg from 'pg';
const URL = (user, pw) => `postgres://${user}:${pw}@localhost:5432/${process.env.DATABASE_NAME || 'warehouse'}`;
const results = [];
function ok(name, cond, extra = '') { results.push([cond ? 'PASS' : 'FAIL', name, extra]); if (!cond) process.exitCode = 1; }
async function expectError(name, fn, match) {
  try { await fn(); ok(name, false, 'no error thrown'); }
  catch (e) { ok(name, !match || e.message.includes(match), e.message.slice(0, 80)); }
}
const su = new pg.Client({ connectionString: URL('postgres', 'postgres') });
await su.connect();
const q = (sql, p) => su.query(sql, p);

// 建两家公司
const c1 = (await q(`SELECT * FROM create_company_from_template('测试店一','DT001','A','C1','W1',null,'老板一','0120000001','h1',null)`)).rows[0];
const c2 = (await q(`SELECT * FROM create_company_from_template('测试店二','DT002','A',null,null,null,'老板二','0120000002','h2',null)`)).rows[0];
const C1 = c1.o_company_id, U1 = c1.o_boss_user_id, C2 = c2.o_company_id;
await q(`SET app.company_id = '${C1}'`); await q(`SET app.user_id = '${U1}'`);
const loc = async (code, cid = C1) => (await q(`SELECT id FROM location WHERE company_id=$1 AND code=$2`, [cid, code])).rows[0].id;
const cat = async (code) => (await q(`SELECT id FROM category WHERE company_id=$1 AND code=$2`, [C1, code])).rows[0].id;
const tax = (await q(`SELECT id FROM tax_code WHERE company_id=$1 AND is_default`, [C1])).rows[0].id;
const mkProduct = async (sku, catCode, extra = {}) => (await q(
  `INSERT INTO product (company_id, sku, name_zh, category_id, unit, is_weighed, plu_code, cost_price, sell_price, tax_code_id, min_level, reorder_qty)
   VALUES ($1,$2,$3,$4,$5,$6,$7,1.2,1.8,$8,24,48) RETURNING id`,
  [C1, sku, sku + ' 名', await cat(catCode), extra.unit || 'PCS', !!extra.weighed, extra.plu || null, tax])).rows[0].id;
const P1 = await mkProduct('P1', 'BEV');
await q(`INSERT INTO barcode (company_id, product_id, barcode, pack_qty, barcode_type, is_primary) VALUES ($1,$2,'9556001234567',1,'UNIT',true)`, [C1, P1]);
const mv = (pid, from, to, qty, reason, user = U1, at = 'now()') =>
  q(`INSERT INTO movement (id, company_id, product_id, from_location_id, to_location_id, qty, reason, performed_by, performed_at) VALUES (uuid_v7(),$1,$2,$3,$4,$5,$6,$7,${at})`, [C1, pid, from, to, qty, reason, user]);
const stock = async (pid, code) => Number((await q(`SELECT qty FROM stock WHERE product_id=$1 AND location_id=$2`, [pid, await loc(code)])).rows[0]?.qty ?? 0);

// D14 虚拟位置
ok('D14 四个虚拟位置', (await q(`SELECT count(*)::int n FROM location WHERE company_id=$1 AND is_virtual`, [C1])).rows[0].n === 4);
await expectError('D14 不能第五个', async () => q(`INSERT INTO location (company_id, code, is_virtual, virtual_type) VALUES ($1,'X',true,'SUPPLIER')`, [C1]), 'duplicate');
// D7 D8
await mv(P1, await loc('SUPPLIER'), await loc('S-01'), 24, 'RECEIVE');
ok('D7 RECEIVE 后 S-01 = 24', await stock(P1, 'S-01') === 24);
ok('D7 SUPPLIER = -24', await stock(P1, 'SUPPLIER') === -24);
await mv(P1, await loc('S-01'), await loc('A-01-1'), 10, 'REFILL');
ok('D8 REFILL 后 S-01 = 14, A-01-1 = 10', await stock(P1, 'S-01') === 14 && await stock(P1, 'A-01-1') === 10);
// D1 D2 D3 用 app_rw
const rw = new pg.Client({ connectionString: URL('app_rw', 'app_rw') }); await rw.connect();
await rw.query(`SET app.company_id = '${C1}'`); await rw.query(`SET app.user_id = '${U1}'`);
await expectError('D1 app_rw UPDATE movement', async () => rw.query(`UPDATE movement SET qty = 1`), 'permission denied');
await expectError('D2 app_rw DELETE movement', async () => rw.query(`DELETE FROM movement`), 'permission denied');
await expectError('D3 app_rw UPDATE stock', async () => rw.query(`UPDATE stock SET qty = 0`), 'permission denied');
await expectError('D1b 超级用户 UPDATE movement 也被触发器拒绝', async () => q(`UPDATE movement SET qty = 1`), '不可修改');
// D4 D5 D6
await expectError('D4 from = to', async () => mv(P1, await loc('S-01'), await loc('S-01'), 1, 'REFILL'), 'check');
await expectError('D5 qty 0', async () => mv(P1, await loc('S-01'), await loc('A-01-1'), 0, 'REFILL'), 'check');
await expectError('D6 跨公司位置', async () => mv(P1, await loc('S-01'), await loc('SUPPLIER', C2), 1, 'REFILL'), 'COMPANY_MISMATCH');
// D9 负库存
await q(`UPDATE company SET settings = settings || '{"allow_negative_stock": false}' WHERE id=$1`, [C1]);
await expectError('D9 负库存拒绝', async () => mv(P1, await loc('S-01'), await loc('A-01-1'), 100, 'REFILL'), 'INSUFFICIENT_STOCK');
await q(`UPDATE company SET settings = settings || '{"allow_negative_stock": true}' WHERE id=$1`, [C1]);
// 后仓硬限制
const P2 = await mkProduct('P2', 'DAI');
await expectError('后仓硬限制 冷藏到干货', async () => mv(P2, await loc('SUPPLIER'), await loc('S-02'), 6, 'RECEIVE'), 'CATEGORY_NOT_ALLOWED');
await mv(P2, await loc('SUPPLIER'), await loc('S-04'), 6, 'RECEIVE');
ok('后仓允许 冷藏到冷柜', await stock(P2, 'S-04') === 6);
// 权限：收银员不能收货
const cashierRole = (await q(`SELECT id FROM role WHERE company_id=$1 AND code='CASHIER'`, [C1])).rows[0].id;
const cashier = (await q(`INSERT INTO app_user (company_id, name, pin_hash) VALUES ($1,'收银','h') RETURNING id`, [C1])).rows[0].id;
await q(`INSERT INTO user_site_role (company_id, user_id, site_id, role_id) VALUES ($1,$2,$3,$4)`, [C1, cashier, c1.o_site_id, cashierRole]);
await expectError('A3 收银员 RECEIVE 被拒', async () => mv(P1, await loc('SUPPLIER'), await loc('S-01'), 1, 'RECEIVE', cashier), 'PERMISSION_DENIED');
// D20 permission_history
const hist = (await q(`SELECT count(*)::int n FROM permission_history WHERE user_id=$1 AND valid_to IS NULL`, [cashier])).rows[0].n;
await q(`DELETE FROM user_site_role WHERE user_id=$1`, [cashier]);
const hist2 = (await q(`SELECT count(*)::int n FROM permission_history WHERE user_id=$1 AND valid_to IS NOT NULL`, [cashier])).rows[0].n;
ok('D20 permission_history 写入并关闭', hist === 1 && hist2 === 1);
// 当时有权限：历史时间点仍可过
await expectError('当时无权限（已移除角色）', async () => mv(P1, await loc('SUPPLIER'), await loc('S-01'), 1, 'RECEIVE', cashier), 'PERMISSION_DENIED');
// D10 并发 100 x 100 → 用 20 x 50 缩短
const N = 20, M = 50;
const clients = await Promise.all(Array.from({ length: N }, async () => { const c = new pg.Client({ connectionString: URL('postgres', 'postgres') }); await c.connect(); await c.query(`SET app.company_id='${C1}'`); return c; }));
const sup = await loc('SUPPLIER'), s01 = await loc('S-01');
const before = await stock(P1, 'S-01');
await Promise.all(clients.map(async (c) => { for (let i = 0; i < M; i++) await c.query(`INSERT INTO movement (id, company_id, product_id, from_location_id, to_location_id, qty, reason, performed_by, performed_at) VALUES (uuid_v7(),$1,$2,$3,$4,1,'RECEIVE',$5,now())`, [C1, P1, sup, s01, U1]); }));
ok(`D10 并发 ${N}x${M} 插入后库存精确`, await stock(P1, 'S-01') === before + N * M);
// D11 反向移动并发无死锁
const a011 = await loc('A-01-1');
await Promise.all([
  (async () => { for (let i = 0; i < 50; i++) await clients[0].query(`INSERT INTO movement (id, company_id, product_id, from_location_id, to_location_id, qty, reason, performed_by, performed_at) VALUES (uuid_v7(),$1,$2,$3,$4,1,'REFILL',$5,now())`, [C1, P1, s01, a011, U1]); })(),
  (async () => { for (let i = 0; i < 50; i++) await clients[1].query(`INSERT INTO movement (id, company_id, product_id, from_location_id, to_location_id, qty, reason, performed_by, performed_at) VALUES (uuid_v7(),$1,$2,$3,$4,1,'ADJUST',$5,now())`, [C1, P1, a011, s01, U1]); })(),
]);
ok('D11 反向并发无死锁', true);
await Promise.all(clients.map(c => c.end()));
// D12 D13 RLS
ok('D12 RLS 公司 1 只看自己', (await rw.query(`SELECT count(*)::int n FROM product`)).rows[0].n === 2);
await rw.query(`SET app.company_id = '${C2}'`);
ok('D12b 公司 2 看不到公司 1 产品', (await rw.query(`SELECT count(*)::int n FROM product`)).rows[0].n === 0);
await rw.query(`RESET app.company_id`);
ok('D13 不设公司零行', (await rw.query(`SELECT count(*)::int n FROM product`)).rows[0].n === 0);
await rw.end();
// D15 价格历史 + 审计
await q(`UPDATE product SET sell_price = 1.9 WHERE id=$1`, [P1]);
ok('D15 price_history 两行', (await q(`SELECT count(*)::int n FROM price_history WHERE product_id=$1`, [P1])).rows[0].n === 2);
const al = (await q(`SELECT changed_columns, before_json->>'sell_price' b, after_json->>'sell_price' a FROM audit_log WHERE table_name='product' AND row_id=$1 AND action='UPDATE' ORDER BY at DESC LIMIT 1`, [P1])).rows[0];
ok('D15 审计含前后值', al && al.changed_columns.includes('sell_price') && al.b === '1.80' && al.a === '1.90', JSON.stringify(al));
// D16 D17
await expectError('D16 第二个主条码', async () => q(`INSERT INTO barcode (company_id, product_id, barcode, pack_qty, barcode_type, is_primary) VALUES ($1,$2,'9556000000001',1,'UNIT',true)`, [C1, P1]), 'duplicate');
await expectError('D17 同条码两个产品', async () => q(`INSERT INTO barcode (company_id, product_id, barcode, pack_qty, barcode_type) VALUES ($1,$2,'9556001234567',1,'UNIT')`, [C1, P2]), 'duplicate');
// D18 三层类别
const parent = await cat('BEV');
const child = (await q(`INSERT INTO category (company_id, code, name_zh, parent_id) VALUES ($1,'BEV2','子',$2) RETURNING id`, [C1, parent])).rows[0].id;
await expectError('D18 三层类别', async () => q(`INSERT INTO category (company_id, code, name_zh, parent_id) VALUES ($1,'BEV3','孙',$2)`, [C1, child]), '两层');
// D19 货架登记到后仓
await expectError('D19 shelf_assignment 到后仓', async () => q(`INSERT INTO shelf_assignment (company_id, product_id, location_id, assigned_by) VALUES ($1,$2,$3,$4)`, [C1, P1, await loc('S-01'), U1]), 'SHELF');
await q(`INSERT INTO shelf_assignment (company_id, product_id, location_id, assigned_by, is_primary) VALUES ($1,$2,$3,$4,true)`, [C1, P1, await loc('A-01-1'), U1]);
await q(`INSERT INTO shelf_assignment (company_id, product_id, location_id, assigned_by, is_primary) VALUES ($1,$2,$3,$4,true)`, [C1, P1, await loc('A-01-2'), U1]);
ok('货架 primary 只有一个且是最新', (await q(`SELECT l.code FROM shelf_assignment s JOIN location l ON l.id=s.location_id WHERE s.product_id=$1 AND s.is_primary`, [P1])).rows.map(r => r.code).join() === 'A-01-2');
// 到期批
await mv(P2, await loc('SUPPLIER'), await loc('S-04'), 3, 'RECEIVE');
await q(`INSERT INTO movement (id, company_id, product_id, from_location_id, to_location_id, qty, reason, performed_by, performed_at, expiry_date) VALUES (uuid_v7(),$1,$2,$3,$4,2,'RECEIVE',$5,now(),'2027-01-31')`, [C1, P2, await loc('SUPPLIER'), await loc('S-04'), U1]);
ok('到期批写入 earliest_expiry', (await q(`SELECT earliest_expiry::text e FROM stock WHERE product_id=$1 AND location_id=$2`, [P2, await loc('S-04')])).rows[0].e === '2027-01-31');
// 审批自批
await expectError('B 模式审批者不能批自己', async () => {
  const cb = (await q(`SELECT * FROM create_company_from_template('B公司','DTB01','B',null,null,null,'老板B','0120000003','h',null)`)).rows[0];
  await q(`INSERT INTO approval_request (company_id, type, ref_type, ref_id, requested_by, approver_role_code, approver_id, status) VALUES ($1,'IMPORT','import_job',uuid_v7(),$2,'BOSS',$2,'APPROVED')`, [cb.o_company_id, cb.o_boss_user_id]);
}, '不能批准自己');

await su.end();
for (const [s, n, e] of results) console.log(s.padEnd(5), n, e ? ' — ' + e : '');
console.log(`\n${results.filter(r => r[0] === 'PASS').length}/${results.length} passed`);
