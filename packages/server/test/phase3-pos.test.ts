// 模块 C：自有 POS + 开放接口。DATABASE_NAME=warehouse_test_pos pnpm exec vitest run test/phase3-pos.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/app.js';
import { api } from './helpers.js';
import { closePools, adminPool, withCompany } from '../src/lib/db.js';
import { decideApproval } from '../src/lib/approvals.js';
import type { RequestCtx } from '../src/lib/auth.js';
import { buildReceiptText, displayWidth } from '../src/lib/receipt.js';

const app = buildApp();
let sa: string, boss: string, cashier: string;
let companyId: string, siteId: string, bossId: string, cashierId: string, deviceId: string;
let COKE: string, FISH: string, BISC: string, SST6: string;
let sessionId: string, sale1: any, approvalId: string, openKey: string, kioskKey: string, openKeyId: string;
const A = () => api(app);
const B = () => api(app, boss); const C = () => api(app, cashier);
const bossCtx = (): RequestCtx => ({ userId: bossId, companyId, siteId, isSuperAdmin: false, deviceId: null, roles: ['BOSS'], permissions: new Map([['approval.decide', null]]), plan: 'A', lang: 'zh', name: '老板', settings: {} });
const stockAt = async (barcode: string, code: string) => { const r = await B().get(`/stock/lookup/${barcode}`); return Number(r.json().locations.find((l: any) => l.code === code)?.qty ?? 0); };

beforeAll(async () => {
  await app.ready();
  sa = (await A().post('/auth/login', { email: 'admin@test.local', pin: '123456' })).json().access_token;
  const c = await api(app, sa).post('/admin/companies', { name: 'POS 测试店', short_code: 'POSTST', plan: 'A', tin: 'C9876543210', boss_name: '老板', boss_phone: '0130000001', boss_pin: '111111' });
  expect(c.statusCode).toBe(201); companyId = c.json().company_id; siteId = c.json().site_id; bossId = c.json().boss_user_id;
  boss = (await A().post('/auth/login', { badge: c.json().boss_badge, pin: '111111' })).json().access_token;
  SST6 = (await adminPool.query(`INSERT INTO tax_code (company_id, code, rate, myinvois_tax_type) VALUES ($1,'SST-6',6,'01') RETURNING id`, [companyId])).rows[0].id;
  const cats = (await B().get('/categories')).json();
  const cat = (code: string) => cats.find((x: any) => x.code === code).id;
  COKE = (await B().post('/products', { name_zh: '可口可乐 325ml', name_en: 'Coca-Cola 325ml', category_id: cat('BEV'), cost_price: 1.2, sell_price: 1.99, min_level: 24, reorder_qty: 48, barcode: '9556001234567', tax_code_id: SST6 })).json().id;
  await B().post(`/products/${COKE}/barcodes`, { barcode: '19556001234564', pack_qty: 24, barcode_type: 'CASE' });
  const fish = await B().post('/products', { name_zh: '鲜鱼', name_en: 'Fresh Fish', category_id: cat('SEA'), unit: 'KG', is_weighed: true, plu_code: '00123', cost_price: 12, sell_price: 20, min_level: 2, reorder_qty: 5 });
  expect(fish.statusCode).toBe(201); FISH = fish.json().id;
  BISC = (await B().post('/products', { name_zh: '饼干', name_en: 'Biscuit', category_id: cat('SNK'), cost_price: 2, sell_price: 3.5, min_level: 12, reorder_qty: 24, barcode: '9556002222222' })).json().id;
  // 库存：收到后仓 → 补货上架登记货架
  for (const m of [
    { barcode: '19556001234564', from_location_code: 'SUPPLIER', to_location_code: 'S-01', qty: 3, reason: 'RECEIVE' },
    { product_id: FISH, from_location_code: 'SUPPLIER', to_location_code: 'S-05', qty: 10, reason: 'RECEIVE' },
    { barcode: '9556002222222', from_location_code: 'SUPPLIER', to_location_code: 'S-02', qty: 20, reason: 'RECEIVE' },
    { barcode: '9556001234567', from_location_code: 'S-01', to_location_code: 'A-01-1', qty: 48, reason: 'REFILL', assign_shelf: true },
    { product_id: FISH, from_location_code: 'S-05', to_location_code: 'A-02-1', qty: 5, reason: 'REFILL', assign_shelf: true },
    { barcode: '9556002222222', from_location_code: 'S-02', to_location_code: 'A-03-1', qty: 10, reason: 'REFILL', assign_shelf: true },
  ]) { const r = await B().post('/movements', m); expect(r.statusCode, JSON.stringify(m) + r.body).toBe(201); }
  const u1 = await B().post('/users', { name: '收银阿美', phone: '0130000008', pin: '444444', roles: [{ role_code: 'CASHIER', site_id: siteId }] }); expect(u1.statusCode).toBe(201); cashierId = u1.json().id;
  const l1 = await A().post('/auth/login', { company_code: 'POSTST', phone: '0130000008', pin: '444444', device: { name: '收银机 P1', type: 'POS', app_version: '0.1.0' } });
  expect(l1.statusCode).toBe(200); cashier = l1.json().access_token; deviceId = l1.json().device_id;
});
afterAll(async () => { await app.close(); await closePools(); });

describe('开班', () => {
  it('开班 201 并可查当前班次', async () => {
    const r = await C().post('/pos/sessions/open', { terminal_code: 'P1', opening_cash: 100, device_id: deviceId });
    expect(r.statusCode, r.body).toBe(201); sessionId = r.json().id; expect(r.json().status).toBe('OPEN'); expect(r.json().opening_cash).toBe(100);
    const cur = await C().get('/pos/sessions/current?terminal_code=P1'); expect(cur.json().session.id).toBe(sessionId); expect(cur.json().site.code).toBe('SHOP1');
  });
  it('同机重复开班 409 SESSION_ALREADY_OPEN', async () => {
    const r = await C().post('/pos/sessions/open', { terminal_code: 'P1', opening_cash: 50 });
    expect(r.statusCode).toBe(409); expect(r.json().code).toBe('SESSION_ALREADY_OPEN');
  });
  it('瘦目录：条码数组、税率、货架位置，无成本', async () => {
    const r = await C().get('/pos/catalog'); expect(r.statusCode).toBe(200);
    const coke = r.json().data.find((p: any) => p.id === COKE);
    expect(coke.barcodes.map((b: any) => b.barcode).sort()).toEqual(['19556001234564', '9556001234567']); expect(coke.tax_rate).toBe(6); expect(coke.cost_price).toBeUndefined(); expect(coke.shelf_location_id).toBeTruthy();
    expect(r.json().settings.cash_rounding).toBe(0.05);
  });
});

describe('销售', () => {
  it('卖 3 行（单件、箱码、称重码）：金额与税正确，现金取整找零', async () => {
    const r = await C().post('/pos/sales', { client_id: randomUUID(), terminal_code: 'P1', session_id: sessionId,
      lines: [{ barcode: '9556001234567', qty: 2 }, { barcode: '19556001234564', qty: 1 }, { barcode: '200123015005', qty: 1 }],
      payments: [{ method: 'CASH', tendered: 100 }] });
    expect(r.statusCode, r.body).toBe(201); sale1 = r.json();
    expect(sale1.lines.map((l: any) => l.qty)).toEqual([2, 24, 1.5]);
    expect(sale1.lines[2].weight_kg).toBe(1.5);
    expect(sale1.lines[0].line_total).toBe(3.98); expect(sale1.lines[0].tax_amount).toBe(0.23);
    expect(sale1.lines[1].line_total).toBe(47.76); expect(sale1.lines[1].tax_amount).toBe(2.7);
    expect(sale1.lines[2].line_total).toBe(30); expect(sale1.lines[2].tax_amount).toBe(0);
    expect(sale1.subtotal).toBe(81.74); expect(sale1.tax_amount).toBe(2.93); expect(sale1.rounding).toBe(0.01); expect(sale1.total).toBe(81.75);
    expect(sale1.paid_total).toBe(100); expect(sale1.change_amount).toBe(18.25);
    expect(sale1.receipt_no).toBe('SHOP1-P1-000001'); expect(sale1.status).toBe('COMPLETED');
    expect(sale1.receipt_text).toContain('RCPT:SHOP1-P1-000001'); expect(sale1.escpos_base64.length).toBeGreaterThan(50);
    expect(sale1.lines[0].unit_cost).toBeUndefined();
  });
  it('库存从主货架减（箱码按 24 换算，称重按公斤）', async () => {
    expect(await stockAt('9556001234567', 'A-01-1')).toBe(48 - 26);
    expect(await stockAt('9556001234567', 'S-01')).toBe(24);
    const fish = await B().get(`/products/${FISH}`); const bc = fish.json().barcodes[0]?.barcode;
    const st = (await adminPool.query(`SELECT s.qty FROM stock s JOIN location l ON l.id = s.location_id WHERE s.product_id = $1 AND l.code = 'A-02-1'`, [FISH])).rows[0];
    expect(Number(st.qty)).toBe(3.5); void bc;
  });
  it('收据版式 32 字符、每行不超宽', async () => {
    for (const line of sale1.receipt_text.split('\n')) expect(displayWidth(line), line).toBeLessThanOrEqual(32);
    expect(sale1.receipt_text).toContain('谢谢 Terima kasih'); expect(sale1.receipt_text).toContain('TIN C9876543210');
    const t80 = buildReceiptText({ company: { name: 'X' }, receipt_no: 'A-P1-000001', sold_at: new Date(), lines: [{ name: '一个很长很长很长很长的中文产品名称', qty: 1, unit_price: 1, line_total: 1 }], subtotal: 1, discount_total: 0, tax_amount: 0, rounding: 0, total: 1, paid_total: 1, change_amount: 0, payments: [] }, 48);
    for (const line of t80.split('\n')) expect(displayWidth(line)).toBeLessThanOrEqual(48);
  });
  it('幂等：同 client_id 重发返回原单 200', async () => {
    const r = await C().post('/pos/sales', { client_id: sale1.client_id, terminal_code: 'P1', lines: [{ barcode: '9556001234567', qty: 1 }], payments: [{ method: 'CASH', tendered: 5 }] });
    expect(r.statusCode).toBe(200); expect(r.json().id).toBe(sale1.id); expect(r.json().duplicate).toBe(true);
    expect(await stockAt('9556001234567', 'A-01-1')).toBe(22);
  });
  it('卡付款不取整；付款不足 400 PAYMENT_SHORT', async () => {
    const r = await C().post('/pos/sales', { client_id: randomUUID(), terminal_code: 'P1', lines: [{ barcode: '9556002222222', qty: 1 }, { product_id: COKE, qty: 1 }], payments: [{ method: 'CARD', amount: 5.49, reference: 'VISA1234' }] });
    expect(r.statusCode, r.body).toBe(201); expect(r.json().total).toBe(5.49); expect(r.json().rounding).toBe(0); expect(r.json().change_amount).toBe(0);
    const s = await C().post('/pos/sales', { client_id: randomUUID(), terminal_code: 'P1', lines: [{ product_id: COKE, qty: 1 }], payments: [{ method: 'CASH', tendered: 1 }] });
    expect(s.statusCode).toBe(400); expect(s.json().code).toBe('PAYMENT_SHORT');
  });
  it('折扣超限 400 DISCOUNT_LIMIT；主管（A 模式老板）PIN 授权后成功并记 approved_by', async () => {
    const body = () => ({ client_id: randomUUID(), terminal_code: 'P1', lines: [{ product_id: COKE, qty: 10, discount_pct: 20 }], payments: [{ method: 'CASH', tendered: 20 }] });
    const r = await C().post('/pos/sales', body()); expect(r.statusCode).toBe(400); expect(r.json().code).toBe('DISCOUNT_LIMIT');
    const wrong = { ...body() }; (wrong.lines[0] as any).supervisor_pin = '000000';
    expect((await C().post('/pos/sales', wrong)).statusCode).toBe(400);
    const ok = { ...body() }; (ok.lines[0] as any).supervisor_pin = '111111';
    const r2 = await C().post('/pos/sales', ok); expect(r2.statusCode, r2.body).toBe(201);
    expect(r2.json().lines[0].approved_by).toBe(bossId); expect(r2.json().lines[0].discount).toBe(3.98); expect(r2.json().total).toBe(15.9); expect(r2.json().change_amount).toBe(4.1);
    const small = await C().post('/pos/sales', { client_id: randomUUID(), terminal_code: 'P1', lines: [{ product_id: COKE, qty: 1, discount_pct: 5 }], payments: [{ method: 'CASH', tendered: 2 }] }); expect(small.statusCode).toBe(201);
  });
  it('称重码解析接口', async () => {
    const r = await C().post('/pos/scale-barcode/parse', { barcode: '200123025003' }); expect(r.statusCode).toBe(200);
    expect(r.json().product.id).toBe(FISH); expect(r.json().weight_kg).toBe(2.5); expect(r.json().price).toBe(50); expect(r.json().product.cost_price).toBeUndefined();
    expect((await C().post('/pos/scale-barcode/parse', { barcode: '9556001234567' })).statusCode).toBe(400);
  });
  it('没开班的机器卖货 400 NO_OPEN_SESSION', async () => {
    const r = await C().post('/pos/sales', { client_id: randomUUID(), terminal_code: 'P9', lines: [{ product_id: COKE, qty: 1 }], payments: [{ method: 'CASH', tendered: 2 }] });
    expect(r.statusCode).toBe(400); expect(r.json().code).toBe('NO_OPEN_SESSION');
  });
});

describe('挂单与收据', () => {
  it('挂单 → 列表 → 取单后消失', async () => {
    const h = await C().post('/pos/sales/hold', { client_id: randomUUID(), terminal_code: 'P1', lines: [{ product_id: COKE, qty: 3 }, { product_id: BISC, qty: 1 }] });
    expect(h.statusCode, h.body).toBe(201); expect(h.json().hold_code).toBe('H-01'); expect(h.json().status).toBe('HELD'); expect(h.json().total).toBe(9.47);
    const list = await C().get('/pos/sales/held'); expect(list.json().length).toBe(1); expect(list.json()[0].lines.length).toBe(2);
    const rc = await C().post(`/pos/sales/held/${h.json().id}/recall`); expect(rc.statusCode).toBe(200); expect(rc.json().lines.map((l: any) => l.qty)).toEqual([3, 1]);
    expect((await C().get('/pos/sales/held')).json().length).toBe(0);
    expect((await C().post(`/pos/sales/held/${h.json().id}/recall`)).statusCode).toBe(404);
    expect(await stockAt('9556001234567', 'A-01-1')).toBe(22 - 1 - 10 - 1);   // 挂单不动库存
  });
  it('扫收据二维码查销售', async () => {
    const r = await C().get(`/pos/sales/by-receipt/${encodeURIComponent('RCPT:' + sale1.receipt_no)}`); expect(r.statusCode).toBe(200);
    expect(r.json().id).toBe(sale1.id); expect(r.json().lines.length).toBe(3); expect(r.json().payments[0].method).toBe('CASH');
    expect((await C().get('/pos/sales/by-receipt/SHOP1-P1-999999')).json().code).toBe('RECEIPT_NOT_FOUND');
  });
});

describe('退货', () => {
  it('收银员申请退货 → 审批 PENDING，原单 PENDING_RETURN', async () => {
    const r = await C().post('/pos/returns', { sale_id: sale1.id, lines: [{ sale_line_id: sale1.lines[0].id, qty: 1 }], reason: '顾客不要了' });
    expect(r.statusCode, r.body).toBe(201); approvalId = r.json().approval.id; expect(r.json().approval.status).toBe('PENDING'); expect(r.json().refund).toBe(1.99); expect(r.json().method).toBe('CASH');
    expect((await C().get(`/pos/sales/${sale1.id}`)).json().status).toBe('PENDING_RETURN');
    const n = await adminPool.query(`SELECT * FROM notification WHERE company_id = $1 AND ref_id = $2`, [companyId, approvalId]); expect(n.rowCount).toBeGreaterThan(0);
    const dup = await C().post('/pos/returns', { sale_id: sale1.id, lines: [{ sale_line_id: sale1.lines[0].id, qty: 1 }], reason: 'x' }); expect(dup.json().duplicate).toBe(true);
    const over = await C().post('/pos/returns', { sale_id: sale1.id, lines: [{ sale_line_id: sale1.lines[0].id, qty: 5 }], reason: 'x' }); expect([200, 400]).toContain(over.statusCode);
  });
  it('老板批准 → RETURN 销售、库存回货架、现金退款记入班次', async () => {
    const shelfBefore = await stockAt('9556001234567', 'A-01-1');
    const sessBefore = (await C().get('/pos/sessions/current?terminal_code=P1')).json().session;
    await withCompany({ companyId, userId: bossId }, (tx) => decideApproval(tx, bossCtx(), approvalId, 'approve'));
    const r = await C().get(`/pos/sales/by-receipt/${sale1.receipt_no}`); expect(r.json().status).toBe('COMPLETED');
    expect(r.json().returns.length).toBe(1); expect(r.json().returns[0].total).toBe(1.99); expect(r.json().lines[0].returned_qty).toBe(1);
    const ret = (await C().get(`/pos/sales/${r.json().returns[0].id}`)).json(); expect(ret.sale_type).toBe('RETURN'); expect(ret.original_sale_id).toBe(sale1.id); expect(ret.receipt_text).toContain('RETURN');
    expect(await stockAt('9556001234567', 'A-01-1')).toBe(shelfBefore + 1);
    const sess = (await C().get('/pos/sessions/current?terminal_code=P1')).json().session;
    expect(sess.refund_total).toBe(Number(sessBefore.refund_total) + 1.99);
    const mv = await adminPool.query(`SELECT reason FROM movement WHERE company_id = $1 AND reason = 'RETURN'`, [companyId]); expect(mv.rowCount).toBe(1);
  });
  it('老板（A 模式）直接作废已完成销售：库存回去、班次合计回退', async () => {
    const s = await C().post('/pos/sales', { client_id: randomUUID(), terminal_code: 'P1', lines: [{ product_id: BISC, qty: 2 }], payments: [{ method: 'CASH', tendered: 7 }] }); expect(s.statusCode).toBe(201);
    const before = await stockAt('9556002222222', 'A-03-1'); const sess = (await C().get('/pos/sessions/current?terminal_code=P1')).json().session;
    expect((await C().post(`/pos/sales/${s.json().id}/void`, { reason: '输错' })).statusCode).toBe(403);   // 收银员无 pos.void_closed
    const v = await B().post(`/pos/sales/${s.json().id}/void`, { reason: '输错' }); expect(v.statusCode, v.body).toBe(200); expect(v.json().status).toBe('VOIDED');
    expect(await stockAt('9556002222222', 'A-03-1')).toBe(before + 2);
    const after = (await C().get('/pos/sessions/current?terminal_code=P1')).json().session;
    expect(after.sales_total).toBe(Number(sess.sales_total) - 7); expect(after.sales_count).toBe(sess.sales_count - 1); expect(after.cash_total).toBe(Number(sess.cash_total) - 7);
  });
});

describe('日结', () => {
  it('expected/variance 正确，差额大开工单，Z 报表文本', async () => {
    const cur = (await C().get('/pos/sessions/current?terminal_code=P1')).json().session;
    const expected = Math.round((Number(cur.opening_cash) + Number(cur.cash_total) - Number(cur.refund_total)) * 100) / 100;
    expect(expected).toBe(cur.expected_now);
    const r = await C().post(`/pos/sessions/${sessionId}/close`, { counted_cash: Math.round((expected + 30) * 100) / 100 });
    expect(r.statusCode, r.body).toBe(200); expect(r.json().status).toBe('CLOSED'); expect(r.json().expected_cash).toBe(expected); expect(r.json().variance).toBe(30);
    expect(r.json().z_report).toContain('Z 报表'); expect(r.json().z_report).toContain('+30.00'); expect(r.json().z_report_url).toContain('/api/v1/files/');
    expect(r.json().ticket_id).toBeTruthy();
    const t = await adminPool.query(`SELECT * FROM ticket WHERE id = $1`, [r.json().ticket_id]); expect(t.rows[0].type).toBe('MANUAL'); expect(t.rows[0].owner_role_code).toBe('BOSS');
    const n = await adminPool.query(`SELECT * FROM notification WHERE company_id = $1 AND type = 'Z_REPORT'`, [companyId]); expect(n.rowCount).toBeGreaterThan(0);
    expect((await C().post(`/pos/sessions/${sessionId}/close`, { counted_cash: 1 })).statusCode).toBe(409);
    const list = await B().get(`/pos/sessions?date=${new Date().toISOString().slice(0, 10)}`); expect(list.json().sessions.length).toBeGreaterThanOrEqual(1); expect(list.json().totals.variance).toBe(30);
  });
  it('差额小不开工单', async () => {
    const o = await C().post('/pos/sessions/open', { terminal_code: 'P1', opening_cash: 50 }); expect(o.statusCode).toBe(201);
    const r = await C().post(`/pos/sessions/${o.json().id}/close`, { counted_cash: 45 }); expect(r.json().variance).toBe(-5); expect(r.json().ticket_id).toBeNull();
  });
});

describe('权限与离线同步', () => {
  it('收银员查产品无 cost_price（现有接口）', async () => {
    const r = await C().get(`/products/${COKE}`); expect(r.statusCode).toBe(200); expect(r.json().cost_price).toBeUndefined(); expect(r.json().sell_price).toBe(1.99);
    expect((await B().get(`/products/${COKE}`)).json().cost_price).toBe(1.2);
  });
  it('离线同步 push entity sale：applied，重发 duplicate，带客户端收据号', async () => {
    sessionId = (await C().post('/pos/sessions/open', { terminal_code: 'P1', opening_cash: 100 })).json().id;
    const item = { client_id: randomUUID(), entity: 'sale', op: 'insert', seq: 1, payload: { terminal_code: 'P1', session_id: sessionId, receipt_no: 'SHOP1-P1-900001', lines: [{ barcode: '9556001234567', qty: 2 }], payments: [{ method: 'CASH', tendered: 5 }], sold_at: new Date().toISOString() } };
    const batch = () => ({ batch_id: randomUUID(), device_id: deviceId, app_version: '0.1.0', device_time: new Date().toISOString(), items: [item] });
    const before = await stockAt('9556001234567', 'A-01-1');
    const r = await api(app, cashier, { 'x-device-id': deviceId }).post('/sync/push', batch()); expect(r.statusCode, r.body).toBe(200); expect(r.json().results[0].status).toBe('applied');
    const r2 = await api(app, cashier, { 'x-device-id': deviceId }).post('/sync/push', batch()); expect(r2.json().results[0].status).toBe('duplicate'); expect(r2.json().results[0].server_id).toBe(r.json().results[0].server_id);
    expect(await stockAt('9556001234567', 'A-01-1')).toBe(before - 2);
    const s = (await C().get(`/pos/sales/by-receipt/SHOP1-P1-900001`)).json(); expect(s.id).toBe(r.json().results[0].server_id); expect(s.total).toBe(4); expect(s.rounding).toBe(0.02);
  });
  it('B2B 记账：信用额内写发票并加余额；超额 400 CREDIT_LIMIT_EXCEEDED', async () => {
    const cust = (await adminPool.query(`INSERT INTO customer (company_id, code, name, credit_limit, credit_terms_days) VALUES ($1,'C001','ABC 贸易',100,14) RETURNING id`, [companyId])).rows[0].id;
    expect((await C().get('/pos/customers?search=ABC')).json()[0].credit_available).toBe(100);
    const r = await C().post('/pos/sales', { client_id: randomUUID(), terminal_code: 'P1', sale_type: 'B2B', customer_id: cust, lines: [{ product_id: BISC, qty: 10 }] });
    expect(r.statusCode, r.body).toBe(201); expect(r.json().total).toBe(35); expect(r.json().rounding).toBe(0); expect(r.json().payments[0].method).toBe('CREDIT'); expect(r.json().invoice_no).toMatch(/^INV-\d{4}-0001$/);
    const inv = await adminPool.query(`SELECT * FROM invoice WHERE sale_id = $1`, [r.json().id]); expect(inv.rows[0].status).toBe('UNPAID'); expect(inv.rows[0].total).toBe(35);
    expect((await adminPool.query(`SELECT balance FROM customer WHERE id = $1`, [cust])).rows[0].balance).toBe(35);
    const over = await C().post('/pos/sales', { client_id: randomUUID(), terminal_code: 'P1', sale_type: 'B2B', customer_id: cust, lines: [{ product_id: BISC, qty: 20 }] });
    expect(over.statusCode).toBe(400); expect(over.json().code).toBe('CREDIT_LIMIT_EXCEEDED');
  });
});

describe('开放接口', () => {
  it('建 OPEN 密钥（明文只回一次）、列表不含明文', async () => {
    const r = await B().post('/api-keys', { name: 'Pandal', scope: 'OPEN' }); expect(r.statusCode, r.body).toBe(201); openKey = r.json().key; openKeyId = r.json().id; expect(openKey).toMatch(/^wh_[0-9a-f]{8}\.[0-9a-f]{32}$/);
    kioskKey = (await B().post('/api-keys', { name: '大屏', scope: 'KIOSK', site_id: siteId })).json().key;
    const list = await B().get('/api-keys'); expect(list.json().length).toBe(2); expect(list.json()[0].key).toBeUndefined(); expect(list.json()[0].key_hash).toBeUndefined();
    expect((await C().post('/api-keys', { name: 'x', scope: 'OPEN' })).statusCode).toBe(403);
  });
  it('无密钥 401；KIOSK 密钥 403 KIOSK_ONLY', async () => {
    const r = await A().get('/open/products'); expect(r.statusCode).toBe(401); expect(r.json().code).toBe('API_KEY_INVALID');
    const k = await api(app, undefined, { 'x-api-key': kioskKey }).get('/open/products'); expect(k.statusCode).toBe(403); expect(k.json().code).toBe('KIOSK_ONLY');
  });
  it('/open/health、/open/products 无成本无库存、按条码查、库存有无', async () => {
    const O = api(app, undefined, { 'x-api-key': openKey });
    expect((await O.get('/open/health')).json().ok).toBe(true);
    const p = await O.get('/open/products'); expect(p.statusCode).toBe(200); expect(p.json().data.length).toBe(3);
    for (const x of p.json().data) { expect(x.cost_price).toBeUndefined(); expect(x.qty).toBeUndefined(); expect(x.stock).toBeUndefined(); }
    const one = await O.get('/open/products/19556001234564'); expect(one.json().id).toBe(COKE); expect(one.json().scanned_pack_qty).toBe(24); expect(one.json().tax_rate).toBe(6);
    const st = await O.get('/open/stock/9556001234567?site=SHOP1'); expect(st.json().in_stock).toBe(true); expect(typeof st.json().qty).toBe('number');
    expect((await O.get('/open/products/0000000000000')).statusCode).toBe(404);
    const auth = await api(app, undefined, { authorization: `Bearer ${openKey}` }).get('/open/health'); expect(auth.statusCode).toBe(200);
  });
  it('/open/sales 推送：建 PANDAL 销售扣库存；同 external_ref 幂等', async () => {
    const O = api(app, undefined, { 'x-api-key': openKey });
    const before = await stockAt('9556001234567', 'A-01-1');
    const body = { external_ref: 'T2-100001', site_code: 'SHOP1', terminal_code: 'T2', sold_at: new Date().toISOString(), lines: [{ barcode: '9556001234567', qty: 3, unit_price: 1.99 }, { barcode: '9556002222222', qty: 1 }], payments: [{ method: 'CASH', amount: 9.47 }] };
    const r = await O.post('/open/sales', body); expect(r.statusCode, r.body).toBe(201); expect(r.json().duplicate).toBe(false); expect(r.json().total).toBe(9.45); expect(r.json().receipt_no).toBe('SHOP1-T2-000001');
    const r2 = await O.post('/open/sales', body); expect(r2.statusCode).toBe(200); expect(r2.json().duplicate).toBe(true); expect(r2.json().sale_id).toBe(r.json().sale_id);
    expect(await stockAt('9556001234567', 'A-01-1')).toBe(before - 3);
    const s = await adminPool.query(`SELECT source, cashier_id, status FROM sale WHERE id = $1`, [r.json().sale_id]); expect(s.rows[0].source).toBe('PANDAL'); expect(s.rows[0].cashier_id).toBeNull();
    const log = await adminPool.query(`SELECT status FROM external_sync_log WHERE company_id = $1 AND external_ref = 'T2-100001' ORDER BY at`, [companyId]); expect(log.rows.map((x) => x.status)).toEqual(['OK', 'DUPLICATE']);
  });
  it('未知条码：该行跳过并开 PANDAL_UNKNOWN 工单，其余行照常', async () => {
    const O = api(app, undefined, { 'x-api-key': openKey });
    const r = await O.post('/open/sales', { external_ref: 'T2-100002', site_code: 'SHOP1', sold_at: new Date().toISOString(), lines: [{ barcode: '8888888888888', qty: 1, unit_price: 5 }, { barcode: '9556002222222', qty: 2 }], payments: [{ method: 'CARD', amount: 7 }] });
    expect(r.statusCode, r.body).toBe(201); expect(r.json().skipped_barcodes).toEqual(['8888888888888']); expect(r.json().lines.length).toBe(1); expect(r.json().total).toBe(7);
    const t = await adminPool.query(`SELECT * FROM ticket WHERE company_id = $1 AND type = 'PANDAL_UNKNOWN'`, [companyId]); expect(t.rowCount).toBe(1); expect(t.rows[0].owner_role_code).toBe('MANAGER'); expect(t.rows[0].title).toContain('8888888888888');
    const all = await O.post('/open/sales', { external_ref: 'T2-100003', sold_at: new Date().toISOString(), lines: [{ barcode: '7777777777777', qty: 1 }] }); expect(all.statusCode).toBe(400);
  });
  it('/open/sales 对账列表、作废、退货、webhook 注册', async () => {
    const O = api(app, undefined, { 'x-api-key': openKey });
    const list = await O.get(`/open/sales?from=${encodeURIComponent(new Date(Date.now() - 3600_000).toISOString())}&source=PANDAL`); expect(list.json().data.length).toBe(2); expect(list.json().data[0].external_ref).toBe('T2-100001');
    const before = await stockAt('9556002222222', 'A-03-1');
    const ret = await O.post('/open/returns', { external_ref: 'T2-100002', return_ref: 'T2-R-1', lines: [{ barcode: '9556002222222', qty: 1 }], reason: '退' }); expect(ret.statusCode, ret.body).toBe(201); expect(ret.json().total).toBe(3.5);
    expect((await O.post('/open/returns', { external_ref: 'T2-100002', return_ref: 'T2-R-1', lines: [{ barcode: '9556002222222', qty: 1 }] })).json().duplicate).toBe(true);
    expect(await stockAt('9556002222222', 'A-03-1')).toBe(before + 1);
    const v = await O.post('/open/sales/T2-100001/void', { reason: 'cancel' }); expect(v.statusCode).toBe(200); expect(v.json().status).toBe('VOIDED');
    expect((await adminPool.query(`SELECT status FROM sale WHERE external_ref = 'T2-100001'`)).rows[0].status).toBe('VOIDED');
    const w = await O.post('/open/webhooks', { url: 'https://pandal.example.com/hook', events: ['price.updated', 'product.updated'] }); expect(w.statusCode).toBe(201); expect(w.json().secret).toBeTruthy();
    expect((await O.get('/open/webhooks')).json().length).toBe(1);
  });
  it('停用密钥后 401', async () => {
    const d = await B().post(`/api-keys/${openKeyId}/disable`); expect(d.json().is_active).toBe(false);
    expect((await api(app, undefined, { 'x-api-key': openKey }).get('/open/health')).statusCode).toBe(401);
  });
});
