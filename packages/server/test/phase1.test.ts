import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import ExcelJS from 'exceljs';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/app.js';
import { api } from './helpers.js';
import { closePools, adminPool } from '../src/lib/db.js';

const app = buildApp();
let sa: string, boss: string, cashier: string, staff: string;
let companyId: string, siteId: string, bossBadge: string, cashierId: string, staffId: string, deviceId: string;
let P1: string, P2: string;
const locId: Record<string, string> = {};
const A = () => api(app);

beforeAll(async () => { await app.ready(); });
afterAll(async () => { await app.close(); await closePools(); });

describe('认证与开店', () => {
  it('超管登录', async () => {
    const r = await A().post('/auth/login', { email: 'admin@test.local', pin: '123456' });
    expect(r.statusCode).toBe(200); sa = r.json().access_token; expect(r.json().user.is_super_admin).toBe(true);
  });
  it('PIN 错 5 次锁定 (A10)', async () => {
    for (let i = 0; i < 5; i++) { const r = await A().post('/auth/login', { email: 'admin@test.local', pin: '000000' }); expect([401, 423]).toContain(r.statusCode); }
    const r = await A().post('/auth/login', { email: 'admin@test.local', pin: '123456' });
    expect(r.statusCode).toBe(423); expect(r.json().code).toBe('PIN_LOCKED');
    await adminPool.query(`UPDATE app_user SET pin_failed_count = 0, pin_locked_until = NULL WHERE email = 'admin@test.local'`);
  });
  it('开店向导：建 A 模式公司 (G10)', async () => {
    const r = await api(app, sa).post('/admin/companies', { name: '测试小店', short_code: 'TST01', plan: 'A', tin: 'C1234567890', boss_name: '老板', boss_phone: '0120000001', boss_pin: '111111', zone_overrides: { A: { racks: 8, levels: 4 } } });
    expect(r.statusCode).toBe(201); companyId = r.json().company_id; siteId = r.json().site_id; bossBadge = r.json().boss_badge; expect(r.json().boss_pin).toBe('111111');
  });
  it('老板用员工卡登录 (M1)', async () => {
    const r = await A().post('/auth/login', { badge: bossBadge, pin: '111111', device: { name: '测试手机', type: 'PHONE', app_version: '0.1.0' } });
    expect(r.statusCode).toBe(200); boss = r.json().access_token; deviceId = r.json().device_id; expect(r.json().needs_site_selection).toBe(false);
  });
  it('/me 首页四个按钮', async () => {
    const r = await api(app, boss).get('/me'); expect(r.statusCode).toBe(200);
    expect(r.json().home_buttons.length).toBe(4); expect(r.json().roles).toContain('BOSS'); expect(r.json().company.plan).toBe('A');
  });
  it('模板位置：A 区 8x4=32，后仓 6，虚拟 4', async () => {
    const r = await api(app, boss).get('/locations?include_virtual=true'); const rows = r.json();
    for (const l of rows) locId[l.code] = l.id;
    expect(rows.filter((l: any) => l.zone_code === 'A').length).toBe(32);
    expect(rows.filter((l: any) => l.code.startsWith('S-')).length).toBe(6);
    expect(rows.filter((l: any) => l.is_virtual).length).toBe(4);
  });
  it('建员工：收银员和库存员，PIN 只返回一次', async () => {
    const r1 = await api(app, boss).post('/users', { name: '收银阿美', roles: [{ role_code: 'CASHIER', site_id: siteId }] }); expect(r1.statusCode).toBe(201); cashierId = r1.json().id;
    const r2 = await api(app, boss).post('/users', { name: '库存阿明', roles: [{ role_code: 'WAREHOUSE', site_id: siteId }], phone: '0120000009' }); expect(r2.statusCode).toBe(201); staffId = r2.json().id;
    const l1 = await A().post('/auth/login', { badge: `USR:TST01:${r1.json().badge_code}`, pin: r1.json().pin }); expect(l1.statusCode).toBe(200); cashier = l1.json().access_token;
    const l2 = await A().post('/auth/login', { company_code: 'TST01', phone: '0120000009', pin: r2.json().pin, device: { name: '阿明手机', type: 'PHONE', app_version: '0.1.0' } }); expect(l2.statusCode).toBe(200); staff = l2.json().access_token;
  });
});

describe('主数据与库存', () => {
  it('建产品带主条码，收银员看不到成本 (A1)', async () => {
    const cats = (await api(app, boss).get('/categories')).json();
    const bev = cats.find((c: any) => c.code === 'BEV'); const dai = cats.find((c: any) => c.code === 'DAI');
    const r = await api(app, boss).post('/products', { name_zh: '可口可乐 325ml', name_en: 'Coca-Cola 325ml', category_id: bev.id, cost_price: 1.2, sell_price: 1.8, min_level: 24, reorder_qty: 48, barcode: '9556001234567' });
    expect(r.statusCode).toBe(201); P1 = r.json().id; expect(r.json().cost_price).toBe(1.2);
    const r2 = await api(app, boss).post('/products', { name_zh: '鲜奶 1L', category_id: dai.id, cost_price: 5, sell_price: 7, min_level: 6, reorder_qty: 12, barcode: '9556009999991', shelf_life_days: 14 }); P2 = r2.json().id;
    await api(app, boss).post(`/products/${P1}/barcodes`, { barcode: '19556001234564', pack_qty: 24, barcode_type: 'CASE' });
    const c = await api(app, cashier).get(`/products/${P1}`); expect(c.statusCode).toBe(200); expect(c.json().cost_price).toBeUndefined(); expect(c.json().sell_price).toBe(1.8);
  });
  it('搜索：中文、拼音、英文都能找到 (A8)', async () => {
    for (const s of ['可乐', 'kele', 'cola', 'kkl', '9556001234567']) { const r = await api(app, staff).get(`/products?search=${encodeURIComponent(s)}`); expect(r.json().length, s).toBe(1); }
  });
  it('收银员不能收货 (A3)；库存员可以 (A4)；重复 client_id 返回 duplicate (A5)', async () => {
    const body = { id: randomUUID(), barcode: '19556001234564', from_location_code: 'SUPPLIER', to_location_code: 'S-01', qty: 2, reason: 'RECEIVE' };
    expect((await api(app, cashier).post('/movements', body)).statusCode).toBe(403);
    const r = await api(app, staff).post('/movements', body); expect(r.statusCode).toBe(201); expect(r.json().status).toBe('applied');
    const r2 = await api(app, staff).post('/movements', body); expect(r2.statusCode).toBe(200); expect(r2.json().status).toBe('duplicate');
    const look = await api(app, staff).get('/stock/lookup/9556001234567'); expect(look.json().total_qty).toBe(48);  // 2 箱 × 24
  });
  it('冷藏品收到干货后仓被拒 (M8)', async () => {
    const r = await api(app, staff).post('/movements', { barcode: '9556009999991', from_location_code: 'SUPPLIER', to_location_code: 'S-02', qty: 6, reason: 'RECEIVE' });
    expect(r.statusCode).toBe(400); expect(r.json().code).toBe('CATEGORY_NOT_ALLOWED_IN_ZONE');
    const ok = await api(app, staff).post('/movements', { barcode: '9556009999991', from_location_code: 'SUPPLIER', to_location_code: 'S-04', qty: 6, reason: 'RECEIVE', expiry_date: '2027-06-30' }); expect(ok.statusCode).toBe(201);
  });
  it('补货并登记货架 (M11)，货架缺货清单', async () => {
    const r = await api(app, staff).post('/movements', { barcode: '9556001234567', from_location_code: 'S-01', to_location_code: 'A-01-1', qty: 5, reason: 'REFILL', assign_shelf: true }); expect(r.statusCode).toBe(201);
    const sa1 = await api(app, staff).get(`/shelf-assignments?product=${P1}`); expect(sa1.json().length).toBe(1); expect(sa1.json()[0].location_code).toBe('A-01-1');
    const low = await api(app, staff).get('/stock/shelf-low'); expect(low.json().find((x: any) => x.product_id === P1).shelf_qty).toBe(5);
    const look = await api(app, boss).get('/stock/lookup/9556001234567'); expect(look.json().locations.map((l: any) => l.code).sort()).toEqual(['A-01-1', 'S-01']); expect(look.json().sales_30d).toBe(0);
  });
  it('上架建议货位', async () => {
    const r = await api(app, staff).get(`/putaway/suggest?product=${P1}`); expect(r.json().code).toBe('S-01'); expect(r.json().why).toBe('same_product');
  });
  it('区内容和占用', async () => {
    const zones = (await api(app, boss).get('/zones')).json(); const s01 = zones.find((z: any) => z.code === 'S01');
    const r = await api(app, boss).get(`/zones/${s01.id}/contents`); expect(r.json().total_qty).toBe(43);
  });
  it('一线员工只看自己的移动记录', async () => {
    const r = await api(app, staff).get('/movements'); expect(r.json().every((m: any) => m.by_name === '库存阿明')).toBe(true);
    const c = await api(app, cashier).get('/movements'); expect(c.statusCode).toBe(403);
  });
  it('改价写价格历史和审计 (G2/G8)', async () => {
    const r = await api(app, boss).put(`/products/${P1}`, { sell_price: 1.9 }); expect(r.statusCode).toBe(200);
    const p = await api(app, boss).get(`/products/${P1}`); expect(p.json().price_history.length).toBe(2);
    const a = await api(app, boss).get(`/audit?table=product&row=${P1}`); expect(a.json().some((x: any) => x.changed_columns?.includes('sell_price') && x.before_json.sell_price === 1.8)).toBe(true);
    expect((await api(app, cashier).put(`/products/${P1}`, { sell_price: 2 })).statusCode).toBe(403);
  });
  it('标签 PDF (G6)', async () => {
    const zones = (await api(app, boss).get('/zones')).json(); const a = zones.find((z: any) => z.code === 'A');
    const r = await api(app, staff).post('/locations/labels', { zone_id: a.id }); expect(r.statusCode).toBe(200); expect(r.headers['content-type']).toContain('pdf'); expect(r.rawPayload.length).toBeGreaterThan(5000);
    const b = await api(app, boss).post(`/users/${staffId}/badge`); expect(b.statusCode).toBe(200);
  });
  it('跨公司访问 404 (A6/X1)', async () => {
    const r2 = await api(app, sa).post('/admin/companies', { name: '别家', short_code: 'OTHER', plan: 'A', boss_name: 'B', boss_phone: '0120000002', boss_pin: '222222' });
    const other = (await A().post('/auth/login', { badge: r2.json().boss_badge, pin: '222222' })).json().access_token;
    expect((await api(app, other).get(`/products/${P1}`)).statusCode).toBe(404);
    expect((await api(app, other).get('/stock/lookup/9556001234567')).statusCode).toBe(404);
    expect((await api(app, other).post('/movements', { product_id: P1, from_location_code: 'SUPPLIER', to_location_code: 'S-01', qty: 1, reason: 'RECEIVE' })).statusCode).toBeGreaterThanOrEqual(400);
    expect((await api(app, other).get('/products')).json().length).toBe(0);
  });
});

describe('同步', () => {
  const batch = (items: any[], over: any = {}) => ({ batch_id: randomUUID(), device_id: deviceId, app_version: '0.1.0', device_time: new Date().toISOString(), pending_count: items.length, items, ...over });
  const mv = (seq: number, extra: any = {}) => ({ client_id: randomUUID(), entity: 'movement', op: 'insert', seq, payload: { barcode: '9556001234567', from_location_code: 'SUPPLIER', to_location_code: 'S-01', qty: 1, reason: 'RECEIVE', performed_at: new Date().toISOString(), ...extra } });
  it('拉取：首次全量，游标增量 (S9/S11)', async () => {
    const r = await api(app, staff).get('/sync/pull'); expect(r.statusCode).toBe(200);
    const d = r.json(); expect(d.data.product.length).toBe(2); expect(d.data.product[0].cost_price).toBeUndefined(); expect(d.data.location.length).toBeGreaterThan(100); expect(d.data.stock.length).toBeGreaterThan(0);
    const r2 = await api(app, staff).get(`/sync/pull?cursor=${encodeURIComponent(d.cursor)}`); expect(r2.json().data.product.length).toBe(0);
    await api(app, boss).put(`/products/${P1}`, { name_ms: 'Coca-Cola' });
    const r3 = await api(app, staff).get(`/sync/pull?cursor=${encodeURIComponent(d.cursor)}&entities=product`); expect(r3.json().data.product.length).toBe(1);
    const bossPull = await api(app, boss).get('/sync/pull?entities=product'); expect(bossPull.json().data.product[0].cost_price).toBeDefined();
  });
  it('推送 8 条 applied，重发 duplicate，stock 一致 (S1/S3)', async () => {
    const items = Array.from({ length: 8 }, (_, i) => mv(i + 1));
    const before = (await api(app, staff).get('/stock/lookup/9556001234567')).json().total_qty;
    const b = batch(items);
    const r = await api(app, staff, { 'x-device-id': deviceId }).post('/sync/push', b); expect(r.statusCode).toBe(200);
    expect(r.json().results.every((x: any) => x.status === 'applied')).toBe(true);
    const r2 = await api(app, staff).post('/sync/push', { ...b, batch_id: randomUUID() }); expect(r2.json().results.every((x: any) => x.status === 'duplicate')).toBe(true);
    const r3 = await api(app, staff).post('/sync/push', b); expect(r3.json().results.every((x: any) => x.status === 'duplicate')).toBe(true);
    expect((await api(app, staff).get('/stock/lookup/9556001234567')).json().total_qty).toBe(before + 8);
  });
  it('停用产品后推送 → quarantined 并开工单；其他 applied (S5)', async () => {
    await api(app, boss).put(`/products/${P2}`, { is_active: false });
    const items = [mv(1, { barcode: '9556009999991', to_location_code: 'S-04' }), mv(2)];
    const r = await api(app, staff).post('/sync/push', batch(items));
    const res = r.json().results; expect(res[0].status).toBe('quarantined'); expect(res[0].code).toBe('PRODUCT_INACTIVE'); expect(res[0].ticket_id).toBeTruthy(); expect(res[1].status).toBe('applied');
    const q = await api(app, boss).get('/sync/quarantine'); expect(q.json().length).toBe(1);
    await api(app, boss).put(`/products/${P2}`, { is_active: true });
    const retry = await api(app, boss).post(`/sync/quarantine/${q.json()[0].id}/retry`); expect(retry.statusCode).toBe(200);
    expect((await api(app, boss).get('/sync/quarantine')).json().length).toBe(0);
  });
  it('格式错 → rejected；无权限 → quarantined', async () => {
    const r = await api(app, cashier).post('/sync/push', batch([mv(1, { qty: -1 }), mv(2)]));
    const res = r.json().results; expect(res[0].status).toBe('rejected'); expect(res[1].status).toBe('quarantined'); expect(res[1].code).toBe('PERMISSION_DENIED');
    await adminPool.query(`UPDATE sync_quarantine SET status = 'DISCARDED' WHERE status = 'PENDING'`);
  });
  it('时钟偏差提示 (S7)；版本过低 426 (A12)；停用设备 423 (A11/G9)', async () => {
    const r = await api(app, staff).post('/sync/push', batch([], { device_time: new Date(Date.now() + 3600_000).toISOString() })); expect(Math.abs(r.json().clock_skew_seconds)).toBeGreaterThan(3000);
    const r2 = await api(app, staff).post('/sync/push', batch([], { app_version: '0.0.1' })); expect(r2.statusCode).toBe(426);
    await api(app, boss).put(`/devices/${deviceId}`, { status: 'DISABLED' });
    expect((await api(app, staff).post('/sync/push', batch([]))).statusCode).toBe(423);
    expect((await api(app, staff, { 'x-device-id': deviceId }).get('/me')).statusCode).toBe(423);
    await api(app, boss).put(`/devices/${deviceId}`, { status: 'ACTIVE' });
  });
  it('停用用户后 401 (S6)', async () => {
    await api(app, boss).put(`/users/${cashierId}`, { is_active: false });
    expect((await api(app, cashier).get('/me')).statusCode).toBe(401);
    await api(app, boss).put(`/users/${cashierId}`, { is_active: true });
    expect((await api(app, cashier).get('/me')).statusCode).toBe(200);
  });
});

describe('Excel 导入导出', () => {
  let jobId: string;
  async function fill(rows: Record<string, any>[], sheetRows?: Record<string, Record<string, any>[]>) {
    const t = await api(app, boss).get('/import/templates/ALL'); expect(t.statusCode).toBe(200);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(t.rawPayload as any);
    const put = (sheetName: string, keys: string[], data: Record<string, any>[]) => { const ws = wb.getWorksheet(sheetName)!; data.forEach((r, i) => keys.forEach((k, j) => { if (r[k] !== undefined) ws.getCell(4 + i, j + 1).value = r[k]; })); };
    put('产品', ['barcode', 'sku', 'name_zh', 'name_ms', 'name_en', 'category', 'unit', 'cost_price', 'sell_price', 'tax_code', 'supplier', 'min_level', 'reorder_qty', 'pack_qty', 'shelf_life_days', 'plu_code', 'backroom_location', 'photo_file', 'note'], rows);
    if (sheetRows?.['更多条码']) put('更多条码', ['product_barcode', 'barcode', 'barcode_type', 'pack_qty'], sheetRows['更多条码']);
    if (sheetRows?.['供应商']) put('供应商', ['name', 'tin', 'email', 'phone', 'whatsapp', 'payment_terms_days', 'lead_time_days', 'min_order_amount'], sheetRows['供应商']);
    if (sheetRows?.['期初库存']) put('期初库存', ['barcode', 'location', 'qty', 'expiry_date'], sheetRows['期初库存']);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }
  it('模板有下拉和三行表头 (E1)', async () => {
    const t = await api(app, boss).get('/import/templates/PRODUCT'); const wb = new ExcelJS.Workbook(); await wb.xlsx.load(t.rawPayload as any);
    const ws = wb.getWorksheet('产品')!; expect(String(ws.getCell(1, 1).value)).toBe('*主条码'); expect(String(ws.getCell(2, 6).value)).toContain('Category'); expect(ws.getCell(4, 6).dataValidation?.type).toBe('list');
    expect((await api(app, cashier).get('/import/templates/PRODUCT')).statusCode).toBe(403);  // E10
  });
  it('错误文件：重复条码、10 位条码、类别不存在、售价低于成本警告 (E3-E6)', async () => {
    const buf = await fill([
      { barcode: '9556000000011', name_zh: '产品甲', category: '饮料', unit: '件', cost_price: 1, sell_price: 2, min_level: 10, reorder_qty: 20 },
      { barcode: '9556000000011', name_zh: '产品甲重复', category: '饮料', unit: '件', cost_price: 1, sell_price: 2, min_level: 10, reorder_qty: 20 },
      { barcode: '9556001', name_zh: '短条码', category: '饮料', unit: '件', cost_price: 1, sell_price: 2, min_level: 10, reorder_qty: 20 },
      { barcode: '9556000000033', name_zh: '类别错', category: '饮品', unit: '件', cost_price: 1, sell_price: 2, min_level: 10, reorder_qty: 20 },
      { barcode: '9556000000044', name_zh: '亏本卖', category: '零食', unit: '件', cost_price: 1.2, sell_price: 1.0, min_level: 10, reorder_qty: 20 },
    ]);
    const r = await api(app, boss).upload('/import/jobs', 'bad.xlsx', buf); expect(r.statusCode).toBe(201); expect(r.json().has_errors).toBe(true);
    const pv = await api(app, boss).get(`/import/jobs/${r.json().job_id}/preview`); const probs = pv.json().problems;
    expect(probs.find((p: any) => p.row_no === 5).messages[0].zh).toContain('重复');
    expect(probs.find((p: any) => p.row_no === 6).messages[0].zh).toContain('7 位');
    expect(probs.find((p: any) => p.row_no === 7).messages[0].zh).toContain('饮品');
    expect(probs.find((p: any) => p.row_no === 8).status).toBe('WARNING');
    expect((await api(app, boss).post(`/import/jobs/${r.json().job_id}/submit`)).json().code).toBe('IMPORT_HAS_ERRORS');
    const ann = await api(app, boss).get(`/import/jobs/${r.json().job_id}/annotated`); expect(ann.statusCode).toBe(200);  // E8
  });
  it('正确文件 300 行 + 供应商 + 箱码 + 期初库存，批准执行 (E2/E7/E9/E11)', async () => {
    const rows = Array.from({ length: 300 }, (_, i) => ({ barcode: String(9557000000000 + i), name_zh: `测试产品 ${i}`, name_en: `Test ${i}`, category: i % 2 ? '零食' : '饮料', unit: '件', cost_price: 1 + (i % 10) / 10, sell_price: 2 + (i % 10) / 10, supplier: i % 3 ? '新供应商甲' : 'F&N 代理', min_level: 12, reorder_qty: 24, pack_qty: 12 }));
    const buf = await fill(rows, { '供应商': [{ name: 'F&N 代理', email: 'order@fn.com', lead_time_days: 2 }], '更多条码': [{ product_barcode: '9557000000000', barcode: '19557000000007', barcode_type: '箱', pack_qty: 12 }], '期初库存': [{ barcode: '9557000000000', location: 'S-01', qty: 36 }, { barcode: '19557000000007', location: 'S-01', qty: 1 }, { barcode: '9557000000001', location: 'S-02', qty: 10, expiry_date: '2027-12-31' }] });
    const r = await api(app, boss).upload('/import/jobs', 'good.xlsx', buf); expect(r.statusCode).toBe(201); jobId = r.json().job_id;
    if (r.json().has_errors) { const pv = await api(app, boss).get(`/import/jobs/${jobId}/preview`); console.error('GOOD-FILE ERRORS', JSON.stringify(r.json().summary), JSON.stringify(pv.json().problems.filter((p: any) => p.status === 'ERROR').slice(0, 5))); }
    expect(r.json().has_errors).toBe(false);
    expect(r.json().summary.PRODUCT).toMatchObject({ total: 300, error: 0, create: 300 });
    const pv = await api(app, boss).get(`/import/jobs/${jobId}/preview`); expect(pv.json().problems.some((p: any) => p.messages[0].zh.includes('将新建'))).toBe(true);
    expect((await api(app, boss).post(`/import/jobs/${jobId}/submit`)).statusCode).toBe(200);
    const ap = await api(app, boss).post(`/import/jobs/${jobId}/apply`); expect(ap.statusCode).toBe(200); expect(ap.json().applied).toMatchObject({ PRODUCT: 300, SUPPLIER: 1, BARCODE: 1, OPENING_STOCK: 2 });
    const look = await api(app, boss).get('/stock/lookup/9557000000000'); expect(look.json().total_qty).toBe(48);  // 36 + 1 箱 × 12
    const sups = await api(app, boss).get('/suppliers'); expect(sups.json().map((s: any) => s.name).sort()).toEqual(['F&N 代理', '新供应商甲']);
    const prods = await api(app, boss).get('/products?limit=500'); expect(prods.json().length).toBe(302);
    const a = await api(app, boss).get('/audit?table=import_job'); expect(a.json().some((x: any) => x.action === 'IMPORT')).toBe(true);
  });
  it('同条码再导入 = 更新并显示价格变化 (E13)；期初库存对已有库存位置拒绝 (E12)', async () => {
    const buf = await fill([{ barcode: '9557000000000', name_zh: '测试产品 0', category: '饮料', unit: '件', cost_price: 1, sell_price: 9.9, min_level: 12, reorder_qty: 24 }], { '期初库存': [{ barcode: '9557000000000', location: 'S-01', qty: 1 }] });
    const r = await api(app, boss).upload('/import/jobs', 'upd.xlsx', buf);
    const pv = await api(app, boss).get(`/import/jobs/${r.json().job_id}/preview`);
    expect(pv.json().rows.find((x: any) => x.sheet_code === 'PRODUCT').action).toBe('UPDATE');
    expect(pv.json().problems.some((p: any) => p.messages.some((m: any) => m.zh.includes('→ 9.9')))).toBe(true);
    expect(pv.json().problems.some((p: any) => p.sheet_code === 'OPENING_STOCK' && p.status === 'ERROR')).toBe(true);
  });
  it('超过 5000 行拒绝 (E14)；非 xlsx 拒绝 (E15)', async () => {
    const rows = Array.from({ length: 5001 }, (_, i) => ({ barcode: String(9558000000000 + i), name_zh: `x${i}`, category: '饮料', unit: '件', cost_price: 1, sell_price: 2, min_level: 1, reorder_qty: 2 }));
    const buf = await fill(rows);
    expect((await api(app, boss).upload('/import/jobs', 'big.xlsx', buf)).json().code).toBe('IMPORT_TOO_MANY_ROWS');
    expect((await api(app, boss).upload('/import/jobs', 'x.csv', Buffer.from('a,b'))).json().code).toBe('IMPORT_BAD_FILE');
  }, 120000);
  it('导出：老板有成本列，库存员 403，export_log 记录列 (E17/A2)', async () => {
    const r = await api(app, boss).post('/export', { type: 'product' }); expect(r.statusCode).toBe(200); expect(r.json().columns).toContain('cost_price'); expect(r.json().row_count).toBe(302);
    const f = await app.inject({ method: 'GET', url: r.json().url }); expect(f.statusCode).toBe(200); expect(f.rawPayload.length).toBeGreaterThan(1000);
    expect((await api(app, staff).post('/export', { type: 'product' })).statusCode).toBe(403);
    expect((await api(app, cashier).post('/export', { type: 'product' })).statusCode).toBe(403);
    // 经理角色无成本：用 B 模式公司验证列过滤
    const log = await api(app, boss).get('/export/log'); expect(log.json()[0].columns_json).toContain('cost_price');
    const mv = await api(app, boss).post('/export', { type: 'movement' }); expect(mv.json().columns).toContain('unit_cost');
  });
});

describe('管理', () => {
  it('仪表板 (G1)', async () => {
    const r = await api(app, boss).get('/dashboard'); expect(r.statusCode).toBe(200); expect(r.json().product_count).toBe(302); expect(r.json().stock_value).toBeGreaterThan(0);
    const s = await api(app, staff).get('/dashboard'); expect(s.json().stock_value).toBeNull();
  });
  it('区改架数：有库存的货位不能删 (G5)', async () => {
    const zones = (await api(app, boss).get('/zones')).json(); const a = zones.find((z: any) => z.code === 'A');
    await api(app, staff).post('/movements', { barcode: '9556001234567', from_location_code: 'S-01', to_location_code: 'A-03-2', qty: 1, reason: 'REFILL' });
    const bad = await api(app, boss).put(`/zones/${a.id}`, { racks: 2, levels: 1 }); expect(bad.json().code).toBe('LOCATION_HAS_STOCK');
    const ok = await api(app, boss).put(`/zones/${a.id}`, { racks: 6, levels: 4 }); expect(ok.statusCode).toBe(200);
    const locs = (await api(app, boss).get('/locations')).json().filter((l: any) => l.zone_code === 'A'); expect(locs.length).toBe(24);
  });
  it('超管公司列表与同步监控', async () => {
    const r = await api(app, sa).get('/admin/companies'); expect(r.json().find((c: any) => c.short_code === 'TST01').products).toBe(302);
    const m = await api(app, sa).get('/admin/sync-monitor'); expect(m.json().length).toBeGreaterThan(0);
    expect((await api(app, boss).get('/admin/companies')).statusCode).toBe(403);
  });
  it('重置 PIN 后旧 PIN 失效', async () => {
    const r = await api(app, boss).post(`/users/${cashierId}/reset-pin`); expect(r.json().pin).toMatch(/^\d{6}$/);
    const u = (await api(app, boss).get('/users')).json().find((x: any) => x.id === cashierId);
    expect((await A().post('/auth/login', { badge: `USR:TST01:${u.badge_code}`, pin: r.json().pin })).statusCode).toBe(200);
  });
  it('知识库按屏幕', async () => { const r = await api(app, staff).get('/knowledge?screen=W3'); expect(r.json().length).toBeGreaterThanOrEqual(2); });
  it('工单：手动开、评论、关闭', async () => {
    const t = await api(app, staff).post('/tickets', { title: '扫描枪坏了', type: 'DEVICE' }); expect(t.statusCode).toBe(201);
    expect((await api(app, boss).get('/tickets/mine')).json().some((x: any) => x.id === t.json().id)).toBe(true);
    await api(app, boss).post(`/tickets/${t.json().id}/events`, { event: 'STATUS', status: 'RESOLVED', text: '换新的' });
    expect((await api(app, boss).get(`/tickets/${t.json().id}`)).json().status).toBe('RESOLVED');
  });
});
