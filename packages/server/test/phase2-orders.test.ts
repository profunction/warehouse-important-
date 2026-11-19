// 模块 A：订货建议 → 预审 → 批准 → PO → 收货对单 → 调拨。真实 Postgres：DATABASE_NAME=warehouse_test_orders
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/app.js';
import { api } from './helpers.js';
import { closePools, adminPool } from '../src/lib/db.js';

const app = buildApp();
const CODE = 'ORD' + Math.random().toString(36).slice(2, 6).toUpperCase().replace(/[^A-Z0-9]/g, 'X');
const PHONE = '0129' + String(Math.floor(Math.random() * 1e6)).padStart(6, '0');
let sa: string, boss: string, purchaser: string, warehouse: string, manager: string, stocker: string;
let companyId: string, whSite: string, shopSite: string, supplierId: string, supplier2Id: string, P1: string, P2: string, P3: string, catId: string;
let bossSelected = false;
let proposalId: string, poId: string, grnId: string, manualPoId: string, transferId: string, tr2Id: string;
const A = () => api(app);
const login = async (phone: string, pin: string, siteId?: string) => {
  const r = await A().post('/auth/login', { company_code: CODE, phone, pin, device: { name: 'test ' + phone, type: 'PHONE', app_version: '0.1.0' } });
  expect(r.statusCode, r.body).toBe(200);
  let tok = r.json().access_token;
  if (r.json().needs_site_selection && siteId) { const s = await api(app, tok).post('/auth/select-site', { site_id: siteId }); expect(s.statusCode).toBe(200); tok = s.json().access_token; }
  return tok;
};
const mkUser = async (name: string, role: string, siteId: string | null, phone: string) => {
  const r = await api(app, boss).post('/users', { name, phone, roles: [{ role_code: role, site_id: siteId }], pin: '123456' });
  expect(r.statusCode, r.body).toBe(201); return login(phone, '123456', siteId ?? undefined);
};

beforeAll(async () => {
  await app.ready();
  sa = (await A().post('/auth/login', { email: 'admin@test.local', pin: '123456' })).json().access_token;
  const c = await api(app, sa).post('/admin/companies', { name: '订货测试公司', short_code: CODE, plan: 'B', tin: 'C1234567890', boss_name: '老板', boss_phone: PHONE, boss_pin: '111111' });
  expect(c.statusCode, c.body).toBe(201); companyId = c.json().company_id; whSite = c.json().site_id;
  boss = await login(PHONE, '111111');
  // 仓库存储区 A（2 架 × 2 层）
  expect((await api(app, boss).post('/zones', { site_id: whSite, code: 'A', zone_type: 'STORAGE', name_zh: '存储区', racks: 2, levels: 2 })).statusCode).toBe(201);
  // 店站点
  let s = await api(app, boss).post('/sites', { code: 'SHOP1', name: '测试店', type: 'SHOP' });
  if (s.statusCode !== 201) {
    // POST /sites 在 B 模式会重复建 RCV-01-1（位置代码公司内唯一）→ 退回直接建站点（主数据模块的问题，这里不改它）
    const row = (await adminPool.query(`INSERT INTO site (company_id, code, name, type) VALUES ($1,'SHOP1','测试店','SHOP') RETURNING *`, [companyId])).rows[0];
    shopSite = row.id;
    const z = (await adminPool.query(`INSERT INTO zone (company_id, site_id, code, name_zh, zone_type, color) VALUES ($1,$2,'RCV','店收货区','RECEIVING','#9E9E9E') RETURNING id`, [companyId, shopSite])).rows[0];
    await adminPool.query(`INSERT INTO location (company_id, site_id, zone_id, code, rack, level) VALUES ($1,$2,$3,'SRCV-01-1',1,1)`, [companyId, shopSite, z.id]);
  } else shopSite = s.json().id;
  expect((await api(app, boss).post('/zones', { site_id: shopSite, code: 'S', zone_type: 'BACKROOM', name_zh: '店后仓', racks: 1, levels: 2 })).statusCode).toBe(201);
  // 老板有两个站点了 → 重新登录选仓库站点
  boss = await login(PHONE, '111111', whSite); bossSelected = true;
  // 供应商、类别、产品
  const sup = await api(app, boss).post('/suppliers', { name: '测试供应商 A', lead_time_days: 2 }); expect(sup.statusCode).toBe(201); supplierId = sup.json().id;
  supplier2Id = (await api(app, boss).post('/suppliers', { name: '测试供应商 B', lead_time_days: 5 })).json().id;
  const cat = await api(app, boss).post('/categories', { code: 'BEV', name_zh: '饮料' }); expect(cat.statusCode).toBe(201); catId = cat.json().id;
  const p1 = await api(app, boss).post('/products', { name_zh: '可乐 325ml', name_en: 'Cola 325ml', category_id: catId, cost_price: 2.5, sell_price: 3.5, min_level: 48, reorder_qty: 24, reorder_days: 7, default_supplier_id: supplierId, barcode: '9557000000011' });
  expect(p1.statusCode, p1.body).toBe(201); P1 = p1.json().id;
  expect((await api(app, boss).post(`/products/${P1}/barcodes`, { barcode: '19557000000018', pack_qty: 12, barcode_type: 'CASE' })).statusCode).toBe(201);
  const p2 = await api(app, boss).post('/products', { name_zh: '美禄 1kg', name_en: 'Milo 1kg', category_id: catId, cost_price: 14, sell_price: 18.9, min_level: 10, reorder_qty: 20, default_supplier_id: supplier2Id, barcode: '9557000000022', shelf_life_days: 365 });
  P2 = p2.json().id;
  const p3 = await api(app, boss).post('/products', { name_zh: '矿泉水 500ml', name_en: 'Water 500ml', category_id: catId, cost_price: 0.5, sell_price: 1, min_level: 10, reorder_qty: 30, default_supplier_id: supplierId, barcode: '9557000000033' });
  P3 = p3.json().id;
  // 员工
  purchaser = await mkUser('采购小张', 'PURCHASER', null, '0128000001');
  warehouse = await mkUser('仓库阿明', 'WAREHOUSE', whSite, '0128000002');
  manager = await mkUser('经理阿强', 'MANAGER', null, '0128000003');
  stocker = await mkUser('店员小丽', 'STOCKER', shopSite, '0128000004');
  // 期初库存：P1 10 件、P3 100 件到 A-01-1（P2 没货）
  expect((await api(app, warehouse).post('/movements', { product_id: P1, from_location_code: 'SUPPLIER', to_location_code: 'A-01-1', qty: 10, reason: 'RECEIVE' })).statusCode).toBe(201);
  expect((await api(app, warehouse).post('/movements', { product_id: P3, from_location_code: 'SUPPLIER', to_location_code: 'A-01-1', qty: 100, reason: 'RECEIVE' })).statusCode).toBe(201);
}, 60000);
afterAll(async () => { await app.close(); await closePools(); });

describe('订货建议 → PO', () => {
  it('手动触发生成：低于最低量的 P1、P2 入建议，P3 不入；箱取整；B 模式 PENDING_REVIEW', async () => {
    const r = await api(app, purchaser).post('/order-proposals/generate', {});
    expect(r.statusCode, r.body).toBe(201); proposalId = r.json().proposal.id; expect(r.json().proposal.status).toBe('PENDING_REVIEW');
    const d = (await api(app, purchaser).get(`/order-proposals/${proposalId}`)).json();
    expect(d.lines.length).toBe(2);
    const l1 = d.lines.find((l: any) => l.product_id === P1); const l2 = d.lines.find((l: any) => l.product_id === P2);
    expect(Number(l1.current_qty)).toBe(10); expect(Number(l1.suggested_qty)).toBe(24); expect(l1.supplier_name).toBe('测试供应商 A'); expect(Number(l1.unit_cost)).toBe(2.5);
    expect(Number(l2.suggested_qty)).toBe(20); expect(l2.supplier_name).toBe('测试供应商 B');
    expect(d.lines.some((l: any) => l.product_id === P3)).toBe(false);
  });
  it('箱取整：reorder 25 + CASE 12 → 36', async () => {
    const pb = await api(app, boss).post('/products', { name_zh: '箱装测试', category_id: catId, cost_price: 1, sell_price: 2, min_level: 5, reorder_qty: 25, default_supplier_id: supplierId, barcode: '9557000000044' });
    await api(app, boss).post(`/products/${pb.json().id}/barcodes`, { barcode: '19557000000049', pack_qty: 12, barcode_type: 'CASE' });
    const r = await api(app, purchaser).post('/order-proposals/generate', {});
    const d = (await api(app, purchaser).get(`/order-proposals/${r.json().proposal.id}`)).json();
    expect(Number(d.lines.find((l: any) => l.product_id === pb.json().id).suggested_qty)).toBe(36);
    await api(app, boss).put(`/products/${pb.json().id}`, { is_active: false });
    await api(app, boss).post(`/order-proposals/${r.json().proposal.id}/approve`, { decision: 'reject' });
  });
  it('GET /order-proposals/today 返回今天的建议；列表按状态筛', async () => {
    const r = await api(app, purchaser).get('/order-proposals/today'); expect(r.statusCode).toBe(200); expect(r.json().id).toBeTruthy();
    const l = await api(app, purchaser).get('/order-proposals?status=PENDING_REVIEW'); expect(l.json().some((p: any) => p.id === proposalId)).toBe(true);
    expect((await api(app, warehouse).get('/order-proposals')).statusCode).toBe(403);
  });
  it('采购员预审：改数量、删行', async () => {
    const d = (await api(app, purchaser).get(`/order-proposals/${proposalId}`)).json();
    const l1 = d.lines.find((l: any) => l.product_id === P1); const l2 = d.lines.find((l: any) => l.product_id === P2);
    const r = await api(app, purchaser).put(`/order-proposals/${proposalId}/lines`, { lines: [{ id: l1.id, final_qty: 36 }, { id: l2.id, is_removed: true }], note: '只订可乐' });
    expect(r.statusCode, r.body).toBe(200);
    expect(Number(r.json().lines.find((l: any) => l.id === l1.id).final_qty)).toBe(36); expect(r.json().lines.find((l: any) => l.id === l2.id).is_removed).toBe(true);
    expect(r.json().total_amount).toBe(90);
    expect((await api(app, warehouse).put(`/order-proposals/${proposalId}/lines`, { lines: [] })).statusCode).toBe(403);
  });
  it('送审：建 ORDER 审批（金额 90），Telegram 清单写进 notification', async () => {
    const r = await api(app, purchaser).post(`/order-proposals/${proposalId}/submit`); expect(r.statusCode, r.body).toBe(200);
    expect(r.json().status).toBe('PENDING_APPROVAL'); expect(r.json().approval.type).toBe('ORDER'); expect(Number(r.json().approval.amount)).toBe(90); expect(r.json().approval.approver_role_code).toBe('BOSS');
    const n = (await adminPool.query(`SELECT text FROM notification WHERE company_id = $1 AND ref_id = $2 AND channel = 'TELEGRAM'`, [companyId, r.json().approval.id])).rows;
    expect(n.length).toBeGreaterThan(0); expect(n[0].text).toContain('订货审批'); expect(n[0].text).toContain('测试供应商 A'); expect(n[0].text).toContain('可乐');
    expect((await api(app, purchaser).post(`/order-proposals/${proposalId}/submit`)).statusCode).toBe(409);
  });
  it('采购员不能批；老板批准 → 自动生成 PO（SENT，有 pdf_url/xlsx_url），通知含 PO 号', async () => {
    expect((await api(app, purchaser).post(`/order-proposals/${proposalId}/approve`, {})).statusCode).toBe(403);
    const r = await api(app, boss).post(`/order-proposals/${proposalId}/approve`, {}); expect(r.statusCode, r.body).toBe(200);
    expect(r.json().status).toBe('APPROVED'); expect(r.json().purchase_orders.length).toBe(1);
    poId = r.json().purchase_orders[0].id;
    const po = (await api(app, boss).get(`/purchase-orders/${poId}`)).json();
    expect(po.status).toBe('SENT'); expect(po.po_no).toMatch(/^PO-\d{4}-\d{4}$/); expect(po.sent_via).toBe('TELEGRAM'); expect(po.pdf_url).toContain('/api/v1/files/'); expect(po.xlsx_url).toContain('.xlsx');
    expect(po.lines.length).toBe(1); expect(Number(po.lines[0].ordered_qty)).toBe(36); expect(Number(po.total_amount)).toBe(90); expect(po.supplier_name).toBe('测试供应商 A');
    const n = (await adminPool.query(`SELECT text FROM notification WHERE company_id = $1 AND type = 'PO_CREATED'`, [companyId])).rows;
    expect(n.some((x) => x.text.includes(po.po_no))).toBe(true);
  });
  it('PDF 和 Excel 接口 200', async () => {
    const pdf = await api(app, purchaser).get(`/purchase-orders/${poId}/pdf`); expect(pdf.statusCode).toBe(200); expect(pdf.headers['content-type']).toContain('pdf'); expect(pdf.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
    const x = await api(app, purchaser).get(`/purchase-orders/${poId}/xlsx`); expect(x.statusCode).toBe(200); expect(x.rawPayload.length).toBeGreaterThan(2000);
    expect((await api(app, warehouse).get(`/purchase-orders/${poId}/pdf`)).statusCode).toBe(403);
  });
  it('仓库员能看 PO 行但看不到 unit_cost / total_amount', async () => {
    const r = await api(app, warehouse).get(`/purchase-orders/${poId}`); expect(r.statusCode).toBe(200);
    expect(r.json().lines[0].unit_cost).toBeUndefined(); expect(r.json().total_amount).toBeUndefined(); expect(Number(r.json().lines[0].ordered_qty)).toBe(36);
    const list = await api(app, warehouse).get('/purchase-orders?status=SENT'); expect(list.statusCode).toBe(200); expect(list.json()[0].total_amount).toBeUndefined();
  });
  it('PO 列表筛选、发送记录 sent_via', async () => {
    const l = await api(app, purchaser).get(`/purchase-orders?status=SENT&supplier=${supplierId}`); expect(l.json().length).toBe(1);
    const s = await api(app, purchaser).post(`/purchase-orders/${poId}/send`, { via: 'WHATSAPP', to: '0123456789' }); expect(s.statusCode, s.body).toBe(200); expect(s.json().sent_via).toBe('WHATSAPP');
  });
  it('采购员手动开 PO → PENDING_APPROVAL + PO 审批；老板批 → SENT；重复 client_id 返回同一张', async () => {
    const cid = randomUUID();
    const r = await api(app, purchaser).post('/purchase-orders', { client_id: cid, supplier_id: supplier2Id, lines: [{ barcode: '9557000000022', qty: 6 }] });
    expect(r.statusCode, r.body).toBe(201); expect(r.json().status).toBe('PENDING_APPROVAL'); expect(r.json().approval.status).toBe('PENDING'); expect(Number(r.json().total_amount)).toBe(84);
    const dup = await api(app, purchaser).post('/purchase-orders', { client_id: cid, supplier_id: supplier2Id, lines: [{ barcode: '9557000000022', qty: 6 }] }); expect(dup.statusCode).toBe(200); expect(dup.json().id).toBe(r.json().id);
    expect((await api(app, warehouse).post('/purchase-orders', { supplier_id: supplier2Id, lines: [{ product_id: P2, qty: 1 }] })).statusCode).toBe(403);
    const a = await api(app, boss).post(`/purchase-orders/${r.json().id}/approve`, {}); expect(a.statusCode, a.body).toBe(200); expect(a.json().status).toBe('SENT');
    manualPoId = r.json().id;
  });
  it('老板手动开 PO 直接 SENT；未收货可取消，取消后不可再收', async () => {
    const r = await api(app, boss).post('/purchase-orders', { supplier_id: supplierId, deliver_to_site_id: whSite, lines: [{ product_id: P3, qty: 10 }], note: '临时' });
    expect(r.statusCode, r.body).toBe(201); expect(r.json().status).toBe('SENT'); expect(r.json().sent_via).toBe('MANUAL');
    const c = await api(app, boss).post(`/purchase-orders/${r.json().id}/cancel`, { note: '不要了' }); expect(c.statusCode).toBe(200); expect(c.json().status).toBe('CANCELLED');
    expect((await api(app, warehouse).post('/goods-receipts', { po_id: r.json().id })).statusCode).toBe(409);
  });
});

describe('收货对单', () => {
  it('待收清单：仓库站点看到 SENT 的 PO，含供应商、行数、预计日期', async () => {
    const r = await api(app, warehouse).get('/goods-receipts/pending'); expect(r.statusCode).toBe(200);
    const po = r.json().find((p: any) => p.id === poId); expect(po).toBeTruthy(); expect(po.supplier_name).toBe('测试供应商 A'); expect(Number(po.line_count)).toBe(1); expect(po.expected_date).toBeTruthy();
    expect(r.json().some((p: any) => p.id === manualPoId)).toBe(true);
  });
  it('开 GRN（grn_no），再开同一 PO 复用进行中的', async () => {
    const r = await api(app, warehouse).post('/goods-receipts', { po_id: poId }); expect(r.statusCode, r.body).toBe(201); grnId = r.json().id;
    expect(r.json().grn_no).toMatch(/^GRN-\d{4}-\d{4}$/); expect(r.json().status).toBe('IN_PROGRESS'); expect(r.json().po_no).toBeTruthy();
    const again = await api(app, warehouse).post('/goods-receipts', { po_id: poId }); expect(again.statusCode).toBe(200); expect(again.json().id).toBe(grnId);
  });
  it('收货行：扫箱码 2 箱 = 24 件进 RCV-01-1，1 件损坏到 DAMAGED；PO 行 received_qty 更新；重复 client_id → duplicate', async () => {
    const cid = randomUUID();
    const body = { client_id: cid, barcode: '19557000000018', qty: 2, damaged_qty: 1, photo_url: '/api/v1/files/photo-x.jpg' };
    const r = await api(app, warehouse).post(`/goods-receipts/${grnId}/lines`, body); expect(r.statusCode, r.body).toBe(201); expect(r.json().status).toBe('applied');
    expect(Number(r.json().line.received_qty)).toBe(24); expect(r.json().line.location_code).toBe('RCV-01-1'); expect(Number(r.json().line.expected_qty)).toBe(36);
    const d = await api(app, warehouse).post(`/goods-receipts/${grnId}/lines`, body); expect(d.statusCode).toBe(200); expect(d.json().status).toBe('duplicate');
    const po = (await api(app, warehouse).get(`/purchase-orders/${poId}`)).json(); expect(Number(po.lines[0].received_qty)).toBe(24); expect(Number(po.lines[0].damaged_qty)).toBe(1);
    const stock = (await api(app, warehouse).get(`/stock/by-product/${P1}`)).json();
    expect(stock.find((s: any) => s.code === 'RCV-01-1').qty).toBe(24); expect(stock.find((s: any) => s.code === 'A-01-1').qty).toBe(10);
    const dmg = (await adminPool.query(`SELECT qty FROM stock s JOIN location l ON l.id = s.location_id WHERE s.product_id = $1 AND l.virtual_type = 'DAMAGED'`, [P1])).rows[0]; expect(Number(dmg.qty)).toBe(1);
  });
  it('收银员级别（无 movement.receive）不能收', async () => {
    expect((await api(app, purchaser).post(`/goods-receipts/${grnId}/lines`, { product_id: P1, qty: 1 })).statusCode).toBe(403);
  });
  it('完成：少货 11 → PO PARTIAL，RECEIVE_VARIANCE 工单给采购员、RECEIVE_DAMAGE 带照片，Telegram 摘要', async () => {
    const r = await api(app, warehouse).post(`/goods-receipts/${grnId}/complete`); expect(r.statusCode, r.body).toBe(200);
    expect(r.json().status).toBe('COMPLETED'); expect(r.json().po_status).toBe('PARTIAL'); expect(r.json().short.length).toBe(1); expect(r.json().short[0].diff).toBe(11); expect(r.json().damaged[0].qty).toBe(1);
    expect(r.json().short_count).toBe(1); expect(r.json().damaged_count).toBe(1);
    const po = (await api(app, boss).get(`/purchase-orders/${poId}`)).json(); expect(po.status).toBe('PARTIAL');
    const tk = (await api(app, boss).get('/tickets?type=RECEIVE_VARIANCE')).json().filter((t: any) => t.ref_id === grnId);
    expect(tk.length).toBe(1); expect(tk[0].owner_role_code).toBe('PURCHASER'); expect(new Date(tk[0].deadline_at).getTime() - Date.now()).toBeGreaterThan(2.9 * 86400_000);
    const dm = (await api(app, boss).get('/tickets?type=RECEIVE_DAMAGE')).json().filter((t: any) => t.ref_id === grnId); expect(dm.length).toBe(1);
    const ev = (await api(app, boss).get(`/tickets/${dm[0].id}`)).json(); expect(ev.events.some((e: any) => e.photo_url)).toBe(true);
    const mine = await api(app, purchaser).get('/tickets/mine'); expect(mine.json().some((t: any) => t.id === tk[0].id)).toBe(true);
    const n = (await adminPool.query(`SELECT text FROM notification WHERE company_id = $1 AND type = 'GRN_COMPLETED'`, [companyId])).rows; expect(n.length).toBe(1); expect(n[0].text).toContain('少货');
    expect((await api(app, warehouse).post(`/goods-receipts/${grnId}/lines`, { product_id: P1, qty: 1 })).statusCode).toBe(409);
    const g = await api(app, warehouse).get(`/goods-receipts/${grnId}`); expect(g.json().lines.length).toBe(1); expect(g.json().tickets.length).toBe(2);
  });
  it('第二次收齐剩余 11 → PO RECEIVED，不再在待收清单', async () => {
    const g = (await api(app, warehouse).post('/goods-receipts', { po_id: poId })).json();
    expect((await api(app, warehouse).post(`/goods-receipts/${g.id}/lines`, { product_id: P1, qty: 11 })).statusCode).toBe(201);
    const r = await api(app, warehouse).post(`/goods-receipts/${g.id}/complete`); expect(r.json().po_status).toBe('RECEIVED'); expect(r.json().short.length).toBe(0);
    expect((await api(app, warehouse).get('/goods-receipts/pending')).json().some((p: any) => p.id === poId)).toBe(false);
    expect((await api(app, boss).post(`/purchase-orders/${poId}/cancel`)).statusCode).toBe(409);
  });
  it('无单收货：po_id 空，按条码收，完成无差异', async () => {
    const g = await api(app, warehouse).post('/goods-receipts', {}); expect(g.statusCode).toBe(201); expect(g.json().po_id).toBeNull();
    const l = await api(app, warehouse).post(`/goods-receipts/${g.json().id}/lines`, { barcode: '9557000000033', qty: 5, to_location_code: 'A-01-2' }); expect(l.statusCode, l.body).toBe(201); expect(l.json().line.location_code).toBe('A-01-2');
    const r = await api(app, warehouse).post(`/goods-receipts/${g.json().id}/complete`); expect(r.statusCode).toBe(200); expect(r.json().short.length + r.json().over.length).toBe(0); expect(r.json().po_status).toBeNull();
    expect((await api(app, warehouse).get(`/stock/by-product/${P3}`)).json().find((s: any) => s.code === 'A-01-2').qty).toBe(5);
  });
  it('离线同步 grn_line：推送 applied，重推 duplicate', async () => {
    const g = (await api(app, warehouse).post('/goods-receipts', {})).json();
    const dev = (await adminPool.query(`SELECT id FROM device WHERE company_id = $1 ORDER BY created_at LIMIT 1`, [companyId])).rows[0];
    const cid = randomUUID();
    const batch = (bid: string) => ({ batch_id: bid, device_id: dev.id, app_version: '0.1.0', device_time: new Date().toISOString(), items: [{ client_id: cid, entity: 'grn_line', op: 'insert', seq: 1, payload: { grn_id: g.id, product_id: P3, qty: 3, performed_at: new Date().toISOString() } }] });
    const r = await api(app, warehouse, { 'x-device-id': dev.id }).post('/sync/push', batch(randomUUID())); expect(r.statusCode, r.body).toBe(200); expect(r.json().results[0].status).toBe('applied');
    const r2 = await api(app, warehouse, { 'x-device-id': dev.id }).post('/sync/push', batch(randomUUID())); expect(r2.json().results[0].status).toBe('duplicate');
    expect((await api(app, warehouse).get(`/goods-receipts/${g.id}`)).json().lines.length).toBe(1);
    const c = await api(app, warehouse, { 'x-device-id': dev.id }).post('/sync/push', { ...batch(randomUUID()), items: [{ client_id: randomUUID(), entity: 'grn_complete', op: 'insert', seq: 2, payload: { grn_id: g.id } }] }); expect(c.json().results[0].status).toBe('applied');
    expect((await api(app, warehouse).get(`/goods-receipts/${g.id}`)).json().status).toBe('COMPLETED');
  });
  it('上架待办：收货区 RCV-01-1 里的 P1 带 GRN 号', async () => {
    const r = await api(app, warehouse).get('/putaway/pending'); expect(r.statusCode).toBe(200);
    const row = r.json().find((x: any) => x.product_id === P1); expect(row).toBeTruthy(); expect(row.location_code).toBe('RCV-01-1'); expect(Number(row.qty)).toBe(35); expect(row.grn_no).toMatch(/^GRN-/);
  });
});

describe('调拨', () => {
  it('店员申请调拨（数量空 = 按最低量补）：建 TRANSFER 审批给经理', async () => {
    const r = await api(app, stocker).post('/transfers', { lines: [{ product_id: P1 }, { product_id: P3, requested_qty: 20 }], note: '周末补货' });
    expect(r.statusCode, r.body).toBe(201); transferId = r.json().id;
    expect(r.json().status).toBe('REQUESTED'); expect(r.json().transfer_no).toMatch(/^TR-\d{4}$/); expect(r.json().from_site_id).toBe(whSite); expect(r.json().to_site_id).toBe(shopSite);
    const l1 = r.json().lines.find((l: any) => l.product_id === P1); expect(Number(l1.requested_qty)).toBe(48);   // 店里 0，最低 48
    expect(r.json().approval_status).toBe('PENDING'); expect(r.json().approver_role_code).toBe('MANAGER');
    expect((await api(app, warehouse).post('/transfers', { lines: [{ product_id: P1 }] })).statusCode).toBe(403);
  });
  it('功能开关关闭 → FEATURE_DISABLED', async () => {
    await adminPool.query(`UPDATE company SET feature_flags = feature_flags || '{"transfers": false}' WHERE id = $1`, [companyId]);
    const r = await api(app, stocker).get('/transfers'); expect(r.statusCode).toBe(403); expect(r.json().code).toBe('FEATURE_DISABLED');
    await adminPool.query(`UPDATE company SET feature_flags = feature_flags || '{"transfers": true}' WHERE id = $1`, [companyId]);
  });
  it('经理批准并改数量 → APPROVED，拣货位置 = 库存最多的货位', async () => {
    const t = (await api(app, manager).get(`/transfers/${transferId}`)).json();
    const l1 = t.lines.find((l: any) => l.product_id === P1);
    expect((await api(app, stocker).post(`/transfers/${transferId}/decide`, {})).statusCode).toBe(403);
    const r = await api(app, manager).post(`/transfers/${transferId}/decide`, { decision: 'approve', lines: [{ id: l1.id, approved_qty: 30 }] });
    expect(r.statusCode, r.body).toBe(200); expect(r.json().status).toBe('APPROVED'); expect(r.json().approved_by_name).toBe('经理阿强');
    const a1 = r.json().lines.find((l: any) => l.product_id === P1); expect(Number(a1.approved_qty)).toBe(30); expect(a1.pick_location_code).toBe('RCV-01-1');   // RCV 35 > A-01-1 10
    const a3 = r.json().lines.find((l: any) => l.product_id === P3); expect(Number(a3.approved_qty)).toBe(20); expect(a3.pick_location_code).toBe('A-01-1');
    expect((await api(app, manager).get('/transfers?status=APPROVED')).json().some((x: any) => x.id === transferId)).toBe(true);
  });
  it('仓库员拣货：TRANSFER_OUT 到 TRANSIT，状态 PICKING；重复 client_id duplicate', async () => {
    const cid = randomUUID();
    const r = await api(app, warehouse).post(`/transfers/${transferId}/pick-lines`, { lines: [{ client_id: cid, product_id: P1, location_code: 'RCV-01-1', qty: 30 }, { product_id: P3, location_code: 'A-01-1', qty: 20 }] });
    expect(r.statusCode, r.body).toBe(200); expect(r.json().results.every((x: any) => x.status === 'applied')).toBe(true); expect(r.json().transfer.status).toBe('PICKING');
    const d = await api(app, warehouse).post(`/transfers/${transferId}/pick-lines`, { lines: [{ client_id: cid, product_id: P1, location_code: 'RCV-01-1', qty: 30 }] }); expect(d.json().results[0].status).toBe('duplicate');
    expect((await api(app, warehouse).get(`/stock/by-product/${P1}`)).json().find((s: any) => s.code === 'RCV-01-1').qty).toBe(5);
    const transit = (await adminPool.query(`SELECT qty FROM stock s JOIN location l ON l.id = s.location_id WHERE s.product_id = $1 AND l.virtual_type = 'TRANSIT'`, [P1])).rows[0]; expect(Number(transit.qty)).toBe(30);
    expect((await api(app, stocker).post(`/transfers/${transferId}/pick-lines`, { lines: [{ product_id: P1, location_code: 'RCV-01-1', qty: 1 }] })).statusCode).toBe(403);
  });
  it('发运 → IN_TRANSIT，返回箱贴二维码 TR:<code>:<no>；箱贴 PDF', async () => {
    const r = await api(app, warehouse).post(`/transfers/${transferId}/dispatch`); expect(r.statusCode, r.body).toBe(200);
    expect(r.json().status).toBe('IN_TRANSIT'); expect(r.json().qr).toBe(`TR:${CODE}:${r.json().transfer_no}`);
    const l = await api(app, warehouse).get(`/transfers/${transferId}/labels?n=2`); expect(l.statusCode).toBe(200); expect(l.headers['content-type']).toContain('pdf');
    const by = await api(app, stocker).get(`/transfers/by-no/${encodeURIComponent(r.json().qr)}`); expect(by.statusCode).toBe(200); expect(by.json().id).toBe(transferId);
  });
  it('店收货少 1：TRANSFER_IN 到店收货区；完成 → 差异工单给经理 2 天，状态 RECEIVED', async () => {
    const r = await api(app, stocker).post(`/transfers/${transferId}/receive-lines`, { lines: [{ product_id: P1, qty: 29 }, { product_id: P3, qty: 20 }] });
    expect(r.statusCode, r.body).toBe(200); expect(r.json().results.every((x: any) => x.status === 'applied')).toBe(true);
    const c = await api(app, stocker).post(`/transfers/${transferId}/complete`); expect(c.statusCode, c.body).toBe(200);
    expect(c.json().status).toBe('RECEIVED'); expect(c.json().variance.length).toBe(1); expect(c.json().variance[0].diff).toBe(-1); expect(c.json().tickets_opened.length).toBe(1);
    const tk = c.json().tickets_opened[0]; expect(tk.type).toBe('TRANSFER_VARIANCE'); expect(tk.owner_role_code).toBe('MANAGER'); expect(new Date(tk.deadline_at).getTime() - Date.now()).toBeGreaterThan(1.9 * 86400_000);
    const shopStock = (await api(app, boss).get(`/stock/by-product/${P1}`)).json().filter((s: any) => s.site_id === shopSite); expect(shopStock.reduce((a: number, s: any) => a + Number(s.qty), 0)).toBe(29);
    const transit = (await adminPool.query(`SELECT qty FROM stock s JOIN location l ON l.id = s.location_id WHERE s.product_id = $1 AND l.virtual_type = 'TRANSIT'`, [P1])).rows[0]; expect(Number(transit.qty)).toBe(1);
    expect((await api(app, stocker).post(`/transfers/${transferId}/complete`)).json().duplicate).toBe(true);
  });
  it('离线同步 transfer_line_pick / transfer_line_receive', async () => {
    const t = (await api(app, stocker).post('/transfers', { lines: [{ product_id: P3, requested_qty: 5 }] })).json(); tr2Id = t.id;
    expect((await api(app, manager).post(`/transfers/${tr2Id}/decide`, {})).json().status).toBe('APPROVED');
    const dev = (await adminPool.query(`SELECT id FROM device WHERE company_id = $1 ORDER BY created_at LIMIT 1`, [companyId])).rows[0];
    const push = (tok: string, items: any[]) => api(app, tok, { 'x-device-id': dev.id }).post('/sync/push', { batch_id: randomUUID(), device_id: dev.id, app_version: '0.1.0', device_time: new Date().toISOString(), items });
    const r = await push(warehouse, [{ client_id: randomUUID(), entity: 'transfer_line_pick', op: 'insert', seq: 1, payload: { transfer_id: tr2Id, product_id: P3, location_code: 'A-01-1', qty: 5 } }]);
    expect(r.statusCode).toBe(200); expect(r.json().results[0].status, r.body).toBe('applied');
    expect((await api(app, warehouse).post(`/transfers/${tr2Id}/dispatch`)).json().status).toBe('IN_TRANSIT');
    const r2 = await push(stocker, [{ client_id: randomUUID(), entity: 'transfer_line_receive', op: 'insert', seq: 1, payload: { transfer_id: tr2Id, product_id: P3, qty: 5 } }]);
    expect(r2.json().results[0].status, r2.body).toBe('applied');
    const c = await api(app, stocker).post(`/transfers/${tr2Id}/complete`); expect(c.json().status).toBe('RECEIVED'); expect(c.json().variance.length).toBe(0);
  });
  it('经理拒绝申请 → REJECTED；申请人可取消 REQUESTED', async () => {
    const t = (await api(app, stocker).post('/transfers', { lines: [{ product_id: P3, requested_qty: 1 }] })).json();
    const r = await api(app, manager).post(`/transfers/${t.id}/decide`, { decision: 'reject', note: '不缺' }); expect(r.json().status).toBe('REJECTED');
    const t2 = (await api(app, stocker).post('/transfers', { lines: [{ product_id: P3, requested_qty: 1 }] })).json();
    expect((await api(app, stocker).post(`/transfers/${t2.id}/cancel`)).json().status).toBe('CANCELLED');
    expect((await api(app, manager).get('/transfers?status=RECEIVED')).json().length).toBe(2);
  });
});

describe('定时任务与审批引擎', () => {
  it('runDailyProposals 按公司设定时间生成（同一天不重复）', async () => {
    const { runDailyProposals } = await import('../src/lib/ordersJobs.js');
    await adminPool.query(`UPDATE order_proposal SET status = 'REJECTED' WHERE company_id = $1 AND status IN ('PENDING_REVIEW','PENDING_APPROVAL')`, [companyId]);
    const before = Number((await adminPool.query(`SELECT count(*) FROM order_proposal WHERE company_id = $1`, [companyId])).rows[0].count);
    await runDailyProposals('08:00');
    const after = Number((await adminPool.query(`SELECT count(*) FROM order_proposal WHERE company_id = $1`, [companyId])).rows[0].count);
    expect(after).toBe(before + 1);
    await runDailyProposals('08:00');
    expect(Number((await adminPool.query(`SELECT count(*) FROM order_proposal WHERE company_id = $1`, [companyId])).rows[0].count)).toBe(before + 1);
    expect(await runDailyProposals('03:33')).toBe(0);
  });
  it('老板拒绝建议 → REJECTED；退回 → RETURNED 可再送审', async () => {
    const p = (await api(app, purchaser).get('/order-proposals?status=PENDING_REVIEW')).json()[0]; expect(p).toBeTruthy();
    const s = await api(app, purchaser).post(`/order-proposals/${p.id}/submit`); expect(s.statusCode).toBe(200);
    const r = await api(app, boss).post(`/order-proposals/${p.id}/approve`, { decision: 'return', note: '再看看' }); expect(r.json().status).toBe('RETURNED');
    const s2 = await api(app, purchaser).post(`/order-proposals/${p.id}/submit`); expect(s2.statusCode, s2.body).toBe(200); expect(s2.json().status).toBe('PENDING_APPROVAL');
    const rj = await api(app, boss).post(`/order-proposals/${p.id}/approve`, { decision: 'reject' }); expect(rj.json().status).toBe('REJECTED');
    expect((await api(app, boss).post(`/order-proposals/${p.id}/approve`, {})).statusCode).toBe(409);
  });
  it('老板手机"新订单"：MANUAL 建议 → 直接批 → 按供应商拆两张 PO', async () => {
    const r = await api(app, boss).post('/order-proposals', { lines: [{ barcode: '19557000000018', qty: 1 }, { product_id: P2, qty: 2 }] });
    expect(r.statusCode, r.body).toBe(201); expect(r.json().source).toBe('MANUAL'); expect(Number(r.json().lines.find((l: any) => l.product_id === P1).final_qty)).toBe(12);
    const a = await api(app, boss).post(`/order-proposals/${r.json().id}/approve`, {}); expect(a.statusCode, a.body).toBe(200); expect(a.json().status).toBe('APPROVED'); expect(a.json().purchase_orders.length).toBe(2);
  });
  it('跨公司看不到', async () => {
    const other = await api(app, sa).post('/admin/companies', { name: '别家', short_code: CODE + 'X', plan: 'B', boss_name: 'B', boss_phone: '0127' + PHONE.slice(4), boss_pin: '222222' });
    const tok = (await A().post('/auth/login', { badge: other.json().boss_badge, pin: '222222' })).json().access_token;
    expect((await api(app, tok).get(`/purchase-orders/${poId}`)).statusCode).toBe(404);
    expect((await api(app, tok).get(`/goods-receipts/${grnId}`)).statusCode).toBe(404);
    expect((await api(app, tok).get(`/transfers/${transferId}`)).statusCode).toBe(404);
    expect((await api(app, tok).get('/purchase-orders')).json().length).toBe(0);
  });
});
