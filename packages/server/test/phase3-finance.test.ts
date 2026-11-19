// 模块 D 财务：客户应收、供应商应付三方匹配、电子发票（STUB）、月结锁定、报表、会计导出。
// 跑法：cd packages/server && DATABASE_NAME=warehouse_test_finance pnpm exec vitest run test/phase3-finance.test.ts
// 说明：审批决定接口（POST /approvals/:id/decide）由另一模块实现，这里直接调 decideApproval。
//       种子里 ACCOUNTS 角色有 product.view_cost，所以"看不到成本列"用没有该权限的 MANAGER 验证。
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import ExcelJS from 'exceljs';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/app.js';
import { api } from './helpers.js';
import { closePools, adminPool, withCompany } from '../src/lib/db.js';
import { loadCtx, invalidatePermCache } from '../src/lib/auth.js';
import { decideApproval } from '../src/lib/approvals.js';
import { runOverdueArCheck, runMonthEndAuto, runEinvoiceRetry } from '../src/lib/einvoiceJobs.js';

const app = buildApp();
let sa: string, boss: string, acct: string, purch: string, mgr: string;
let companyId: string, siteId: string, bossId: string, supplierId: string, P1: string, P2: string, poId: string, poLineId: string, poLine2Id: string, locId: string, customerLocId: string;
const A = () => api(app);
const ym = (offset: number) => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + offset); return d.toISOString().slice(0, 7); };
const M1 = ym(-1), M2 = ym(-2), M0 = ym(0);
const ins = async (sql: string, params: any[]) => (await adminPool.query(sql, params)).rows[0];
const bossCtx = async () => loadCtx({ uid: bossId, cid: companyId, sid: null, typ: 'access' }, null);
const approve = async (id: string) => { invalidatePermCache(); const ctx = await bossCtx(); return withCompany({ companyId, userId: bossId }, (tx) => decideApproval(tx, ctx, id, 'approve', '测试批准')); };
const insertSale = async (o: { site?: string; type?: 'RETAIL' | 'B2B' | 'RETURN'; soldAt: string; lines: [string, number, number, number][]; buyer?: any; einv?: boolean; method?: string }) => {
  const total = o.lines.reduce((s, l) => s + l[1] * l[2], 0);
  const s = await ins(`INSERT INTO sale (company_id, site_id, receipt_no, sale_type, source, cashier_id, terminal_code, subtotal, total, paid_total, status, sold_at, einvoice_required, einvoice_buyer) VALUES ($1,$2,$3,$4,'OWN_POS',$5,'P1',$6,$6,$6,'COMPLETED',$7,$8,$9) RETURNING id`,
    [companyId, o.site ?? siteId, `WH1-P1-${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`, o.type ?? 'RETAIL', bossId, total, o.soldAt, !!o.einv, o.buyer ? JSON.stringify(o.buyer) : null]);
  let n = 1;
  for (const [pid, qty, price, cost] of o.lines) await adminPool.query(`INSERT INTO sale_line (company_id, sale_id, line_no, product_id, qty, unit_price, line_total, unit_cost) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [companyId, s.id, n++, pid, qty, price, qty * price, cost]);
  await adminPool.query(`INSERT INTO payment (company_id, sale_id, method, amount, received_at) VALUES ($1,$2,$3,$4,$5)`, [companyId, s.id, o.method ?? 'CASH', total, o.soldAt]);
  return s.id as string;
};

beforeAll(async () => {
  await app.ready();
  sa = (await A().post('/auth/login', { email: 'admin@test.local', pin: '123456' })).json().access_token;
  const c = await api(app, sa).post('/admin/companies', { name: '财务测试公司', short_code: 'FIN01', plan: 'B', tin: 'C2345678901', boss_name: '财务老板', boss_phone: '0130000001', boss_pin: '111111' });
  expect(c.statusCode).toBe(201); companyId = c.json().company_id; siteId = c.json().site_id; bossId = c.json().boss_user_id;
  await adminPool.query(`UPDATE company SET msic_code = '47111', address = '{"line1":"1 Jalan Test","city":"Kuala Lumpur","postcode":"50000","state_code":"14"}'::jsonb WHERE id = $1`, [companyId]);
  boss = (await A().post('/auth/login', { company_code: 'FIN01', phone: '0130000001', pin: '111111' })).json().access_token;
  const mk = async (name: string, role: string, phone: string) => { const r = await api(app, boss).post('/users', { name, phone, pin: '222222', roles: [{ role_code: role, site_id: siteId }] }); expect(r.statusCode).toBe(201); return (await A().post('/auth/login', { company_code: 'FIN01', phone, pin: '222222' })).json().access_token; };
  acct = await mk('会计阿花', 'ACCOUNTS', '0130000002'); purch = await mk('采购阿强', 'PURCHASER', '0130000003'); mgr = await mk('经理阿伦', 'MANAGER', '0130000004');
  const sup = await api(app, boss).post('/suppliers', { name: '测试供应商', tin: 'C1111111111', payment_terms_days: 30 }); expect(sup.statusCode).toBe(201); supplierId = sup.json().id;
  const cats = (await api(app, boss).get('/categories')).json();
  const p1 = await api(app, boss).post('/products', { name_zh: '矿泉水 500ml', name_en: 'Water 500ml', category_id: cats[0].id, cost_price: 5, sell_price: 8, min_level: 10, reorder_qty: 24, barcode: '9557000000011' }); expect(p1.statusCode).toBe(201); P1 = p1.json().id;
  const p2 = await api(app, boss).post('/products', { name_zh: '饼干 200g', name_en: 'Biscuit 200g', category_id: cats[0].id, cost_price: 3, sell_price: 4.5, min_level: 10, reorder_qty: 24, barcode: '9557000000022' }); P2 = p2.json().id;
  const locs = (await api(app, boss).get('/locations?include_virtual=true')).json();
  locId = locs.find((l: any) => !l.is_virtual).id; customerLocId = locs.find((l: any) => l.virtual_type === 'CUSTOMER').id;
  // 库存：收 100 瓶水、50 饼干到收货区
  for (const [pid, qty] of [[P1, 100], [P2, 50]] as const) { const r = await api(app, boss).post('/movements', { product_id: pid, from_location_code: 'SUPPLIER', to_location_id: locId, qty, reason: 'RECEIVE' }); expect(r.statusCode).toBe(201); }
  // PO 10 瓶 @ 5.00 + 10 饼干 @ 3.00；GRN 实收 8 + 10（直接插表，不依赖采购模块接口）
  const po = await ins(`INSERT INTO purchase_order (company_id, po_no, supplier_id, deliver_to_site_id, status, total_amount, expected_date, created_at) VALUES ($1,'PO-TEST-0001',$2,$3,'SENT',80,(now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date - 2, now() - interval '5 days') RETURNING id`, [companyId, supplierId, siteId]); poId = po.id;
  poLineId = (await ins(`INSERT INTO purchase_order_line (company_id, po_id, line_no, product_id, ordered_qty, unit_cost, received_qty) VALUES ($1,$2,1,$3,10,5,8) RETURNING id`, [companyId, poId, P1])).id;
  poLine2Id = (await ins(`INSERT INTO purchase_order_line (company_id, po_id, line_no, product_id, ordered_qty, unit_cost, received_qty) VALUES ($1,$2,2,$3,10,3,10) RETURNING id`, [companyId, poId, P2])).id;
  const grn = await ins(`INSERT INTO goods_receipt (company_id, grn_no, po_id, site_id, supplier_id, received_by, status, completed_at) VALUES ($1,'GRN-TEST-0001',$2,$3,$4,$5,'COMPLETED', now() - interval '1 day') RETURNING id`, [companyId, poId, siteId, supplierId, bossId]);
  await adminPool.query(`INSERT INTO goods_receipt_line (company_id, grn_id, po_line_id, product_id, expected_qty, received_qty) VALUES ($1,$2,$3,$4,10,8), ($1,$2,$5,$6,10,10)`, [companyId, grn.id, poLineId, P1, poLine2Id, P2]);
});
afterAll(async () => { await app.close(); await closePools(); });

let custId: string, invId: string, invNo: string;
describe('客户与应收 (B6)', () => {
  it('会计建客户（信用期 30 天，信用额 1000）', async () => {
    const r = await api(app, acct).post('/customers', { name: '大马贸易有限公司', tin: 'C9876543210', brn: '202001012345', email: 'ap@dama.my', phone: '0123456789', credit_terms_days: 30, credit_limit: 1000, address: { line1: '2 Jalan Dama', city: 'KL', postcode: '50000', state_code: '14' } });
    expect(r.statusCode).toBe(201); custId = r.json().id; expect(r.json().code).toMatch(/^C\d{4}$/); expect(r.json().balance).toBe(0);
    const list = await api(app, acct).get('/customers?search=大马'); expect(list.statusCode).toBe(200); expect(list.json().length).toBe(1); expect(list.json()[0].overdue_amount).toBe(0);
    const upd = await api(app, acct).put(`/customers/${custId}`, { credit_limit: 1500 }); expect(upd.json().credit_limit).toBe(1500);
  });
  it('收银员没有 customer.manage 不能建客户', async () => {
    const r = await api(app, purch).post('/customers', { name: 'X' }); expect(r.statusCode).toBe(403);
  });
  it('手动开票：INV-年-0001，UNPAID，客户余额增加', async () => {
    const r = await api(app, acct).post('/invoices', { customer_id: custId, lines: [{ description: '送货服务费', qty: 2, unit_price: 100 }, { product_id: P1, qty: 10, unit_price: 8 }] });
    expect(r.statusCode).toBe(201); invId = r.json().id; invNo = r.json().invoice_no;
    expect(invNo).toMatch(new RegExp(`^INV-${new Date().getFullYear()}-0001$`)); expect(r.json().status).toBe('UNPAID'); expect(r.json().total).toBe(280); expect(r.json().lines.length).toBe(2);
    const c = await api(app, acct).get(`/customers/${custId}`); expect(c.json().balance).toBe(280); expect(c.json().invoices.length).toBe(1);
    // 不动库存
    const stock = await api(app, boss).get(`/stock/lookup/9557000000011`); expect(stock.json().total_qty).toBe(100);
  });
  it('超过信用额被拒 CREDIT_LIMIT_EXCEEDED', async () => {
    const r = await api(app, acct).post('/invoices', { customer_id: custId, lines: [{ description: '大单', qty: 1, unit_price: 5000 }] });
    expect(r.statusCode).toBe(400); expect(r.json().code).toBe('CREDIT_LIMIT_EXCEEDED');
  });
  it('部分收款 → PARTIAL；付清 → PAID；余额归零；超付被拒', async () => {
    const p1 = await api(app, acct).post(`/invoices/${invId}/payments`, { amount: 80, method: 'BANK_TRANSFER', reference: 'TRX001' });
    expect(p1.statusCode).toBe(201); expect(p1.json().invoice.status).toBe('PARTIAL'); expect(p1.json().invoice.paid_amount).toBe(80);
    expect((await api(app, acct).get(`/customers/${custId}`)).json().balance).toBe(200);
    const over = await api(app, acct).post(`/invoices/${invId}/payments`, { amount: 500, method: 'CASH' }); expect(over.statusCode).toBe(400); expect(over.json().code).toBe('PAYMENT_EXCEEDS');
    const p2 = await api(app, acct).post(`/invoices/${invId}/payments`, { amount: 200, method: 'CASH' }); expect(p2.json().invoice.status).toBe('PAID');
    const c = await api(app, acct).get(`/customers/${custId}`); expect(c.json().balance).toBe(0); expect(c.json().payments.length).toBe(2);
    const again = await api(app, acct).post(`/invoices/${invId}/payments`, { amount: 1, method: 'CASH' }); expect(again.statusCode).toBe(409); expect(again.json().code).toBe('INVOICE_STATE');
  });
  it('发票 PDF 200', async () => {
    const r = await api(app, acct).get(`/invoices/${invId}/pdf`); expect(r.statusCode).toBe(200); expect(r.headers['content-type']).toContain('application/pdf'); expect(r.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
    const d = await api(app, acct).get(`/invoices/${invId}`); expect(d.json().lines.length).toBe(2); expect(d.json().payments.length).toBe(2);
  });
  it('对账单 JSON（期初 0，两笔收款，期末 0）+ PDF 200 + 发送建立 statement 记录和通知', async () => {
    const j = await api(app, acct).get(`/customers/${custId}/statement?month=${M0}`); expect(j.statusCode).toBe(200);
    expect(j.json().opening_balance).toBe(0); expect(j.json().lines.length).toBe(3); expect(j.json().closing_balance).toBe(0);
    const p = await api(app, acct).get(`/customers/${custId}/statement?month=${M0}&format=pdf`); expect(p.statusCode).toBe(200); expect(p.headers['content-type']).toContain('application/pdf');
    const s = await api(app, acct).post(`/customers/${custId}/statement/send`, { month: M0 }); expect(s.statusCode).toBe(200); expect(s.json().sent_at).toBeTruthy(); expect(s.json().pdf_url).toContain('/api/v1/files/');
    const n = await adminPool.query(`SELECT count(*)::int AS n FROM notification WHERE company_id = $1 AND type = 'STATEMENT'`, [companyId]); expect(n.rows[0].n).toBeGreaterThan(0);
    expect((await api(app, acct).get(`/customers/${custId}`)).json().statements.length).toBe(1);
  });
  it('逾期：到期日已过的发票每日任务改 OVERDUE 并开 OVERDUE_AR 工单给会计；账龄 31-60', async () => {
    const r = await api(app, acct).post('/invoices', { customer_id: custId, issue_date: '2026-01-01', due_date: '2026-01-31', lines: [{ description: '旧账', qty: 1, unit_price: 300 }] });
    expect(r.statusCode).toBe(201);
    const n = await runOverdueArCheck(companyId); expect(n).toBe(1);
    expect((await api(app, acct).get(`/invoices?status=OVERDUE`)).json().length).toBe(1);
    const t = await adminPool.query(`SELECT * FROM ticket WHERE company_id = $1 AND type = 'OVERDUE_AR'`, [companyId]); expect(t.rows.length).toBe(1); expect(t.rows[0].owner_role_code).toBe('ACCOUNTS'); expect(t.rows[0].ref_id).toBe(custId);
    expect(await runOverdueArCheck(companyId)).toBe(0);   // 不重复开
    const list = await api(app, acct).get('/customers'); expect(list.json()[0].overdue_amount).toBe(300);
    const ag = await api(app, acct).get('/ar/aging'); expect(ag.statusCode).toBe(200); expect(ag.json().totals.total).toBe(300); expect(ag.json().rows[0].b90p + ag.json().rows[0].b61_90 + ag.json().rows[0].b31_60).toBe(300);
    // 付清后工单自动解决
    const inv = (await api(app, acct).get(`/invoices?status=OVERDUE`)).json()[0];
    await api(app, acct).post(`/invoices/${inv.id}/payments`, { amount: 300, method: 'CASH' });
    expect((await adminPool.query(`SELECT status FROM ticket WHERE company_id = $1 AND type = 'OVERDUE_AR'`, [companyId])).rows[0].status).toBe('RESOLVED');
  });
  it('开票带 deduct_stock：建 B2B 销售并扣库存', async () => {
    const r = await api(app, acct).post('/invoices', { customer_id: custId, deduct_stock: true, from_location_id: locId, lines: [{ product_id: P1, qty: 5, unit_price: 8 }] });
    expect(r.statusCode).toBe(201); expect(r.json().sale_id).toBeTruthy();
    expect((await api(app, boss).get(`/stock/lookup/9557000000011`)).json().total_qty).toBe(95);
    const s = await adminPool.query(`SELECT sale_type, source, status FROM sale WHERE id = $1`, [r.json().sale_id]); expect(s.rows[0]).toMatchObject({ sale_type: 'B2B', source: 'WEB', status: 'COMPLETED' });
    await api(app, acct).post(`/invoices/${r.json().id}/payments`, { amount: 40, method: 'CASH' });
  });
});

let siOk: string, siVar: string, siBig: string, siPrice: string;
describe('供应商发票三方匹配 (B7)', () => {
  it('发票与 PO×GRN 一致 → PAYABLE', async () => {
    const r = await api(app, acct).post('/supplier-invoices', { supplier_id: supplierId, po_id: poId, invoice_no: 'SI-001', amount: 70, lines: [{ po_line_id: poLineId, invoiced_qty: 8, invoiced_unit_cost: 5 }, { po_line_id: poLine2Id, invoiced_qty: 10, invoiced_unit_cost: 3 }] });
    expect(r.statusCode).toBe(201); siOk = r.json().id; expect(r.json().status).toBe('PAYABLE'); expect(r.json().match.matched_amount).toBe(70); expect(r.json().match.variance_amount).toBe(0); expect(r.json().ticket_id).toBeNull();
  });
  it('发票单价高于 PO → VARIANCE + AP_VARIANCE 工单给采购员；match 逐行可见', async () => {
    const r = await api(app, acct).post('/supplier-invoices', { supplier_id: supplierId, po_id: poId, invoice_no: 'SI-002', amount: 78, lines: [{ po_line_id: poLineId, invoiced_qty: 8, invoiced_unit_cost: 6 }, { po_line_id: poLine2Id, invoiced_qty: 10, invoiced_unit_cost: 3 }] });
    expect(r.statusCode).toBe(201); siVar = r.json().id; expect(r.json().status).toBe('VARIANCE'); expect(r.json().match.variance_amount).toBe(8); expect(r.json().ticket_id).toBeTruthy();
    const t = (await adminPool.query(`SELECT * FROM ticket WHERE id = $1`, [r.json().ticket_id])).rows[0]; expect(t.type).toBe('AP_VARIANCE'); expect(t.owner_role_code).toBe('PURCHASER');
    const m = await api(app, purch).get(`/supplier-invoices/${siVar}/match`); expect(m.statusCode).toBe(200); expect(m.json().ok).toBe(false);
    const l1 = m.json().lines.find((l: any) => l.po_line_id === poLineId); expect(l1.received_qty).toBe(8); expect(l1.po_unit_cost).toBe(5); expect(l1.variance_amount).toBe(8); expect(l1.grns.length).toBe(1);
    expect((await api(app, acct).get('/supplier-invoices?status=VARIANCE')).json().length).toBe(1);
  });
  it('有差异的不能付款（AP_STATE）', async () => {
    const r = await api(app, acct).post(`/supplier-invoices/${siVar}/payments`, { amount: 78 }); expect(r.statusCode).toBe(409); expect(r.json().code).toBe('AP_STATE');
  });
  it('采购员 resolve ACCEPT → PAYABLE，工单解决；会计付款 → PAID，supplier_payment 存在', async () => {
    const r = await api(app, purch).post(`/supplier-invoices/${siVar}/resolve`, { action: 'ACCEPT', note: '运费差' }); expect(r.statusCode).toBe(200); expect(r.json().status).toBe('PAYABLE');
    expect((await adminPool.query(`SELECT status FROM ticket WHERE type = 'AP_VARIANCE' AND ref_id = $1`, [siVar])).rows[0].status).toBe('RESOLVED');
    const p = await api(app, acct).post(`/supplier-invoices/${siVar}/payments`, { amount: 78, method: 'BANK_TRANSFER', reference: 'IBG123' }); expect(p.statusCode).toBe(201); expect(p.json().invoice.status).toBe('PAID');
    expect((await adminPool.query(`SELECT count(*)::int AS n FROM supplier_payment WHERE supplier_invoice_id = $1`, [siVar])).rows[0].n).toBe(1);
    const part = await api(app, acct).post(`/supplier-invoices/${siOk}/payments`, { amount: 20, method: 'CASH' }); expect(part.json().invoice.status).toBe('PARTIAL');
  });
  it('无逐行金额时按总额匹配：差 0.50 在容差内 → PAYABLE', async () => {
    const r = await api(app, acct).post('/supplier-invoices', { supplier_id: supplierId, po_id: poId, invoice_no: 'SI-003', amount: 70.5 });
    expect(r.statusCode).toBe(201); siBig = r.json().id; expect(r.json().status).toBe('PAYABLE'); expect(r.json().match.variance_amount).toBe(0.5);
  });
  it('付款超门槛 → PAYMENT 审批 → 老板批准 → supplier_payment 写入、发票 PAID', async () => {
    await adminPool.query(`UPDATE company SET settings = settings || '{"approval_threshold_payment": 50}'::jsonb WHERE id = $1`, [companyId]); invalidatePermCache();
    const r = await api(app, acct).post(`/supplier-invoices/${siBig}/payments`, { amount: 70.5, method: 'BANK_TRANSFER', reference: 'BIG1' });
    expect(r.statusCode).toBe(202); expect(r.json().status).toBe('PENDING_APPROVAL'); const aid = r.json().approval_id;
    expect((await adminPool.query(`SELECT count(*)::int AS n FROM supplier_payment WHERE supplier_invoice_id = $1`, [siBig])).rows[0].n).toBe(0);
    const a = (await adminPool.query(`SELECT * FROM approval_request WHERE id = $1`, [aid])).rows[0]; expect(a.type).toBe('PAYMENT'); expect(a.approver_role_code).toBe('BOSS'); expect(Number(a.amount)).toBe(70.5);
    const dup = await api(app, acct).post(`/supplier-invoices/${siBig}/payments`, { amount: 1 }); expect(dup.statusCode).toBe(409);   // 审批中不能再付
    await approve(aid);
    const sp = (await adminPool.query(`SELECT * FROM supplier_payment WHERE supplier_invoice_id = $1`, [siBig])).rows; expect(sp.length).toBe(1); expect(Number(sp[0].amount)).toBe(70.5); expect(sp[0].approval_id).toBe(aid); expect(sp[0].reference).toBe('BIG1');
    expect((await api(app, acct).get(`/supplier-invoices/${siBig}`)).json().status).toBe('PAID');
    await adminPool.query(`UPDATE company SET settings = settings || '{"approval_threshold_payment": 0}'::jsonb WHERE id = $1`, [companyId]); invalidatePermCache();
  });
  it('resolve PO_PRICE_CHANGE → 老板批准 → PO 行单价更新、发票 PAYABLE', async () => {
    const r = await api(app, acct).post('/supplier-invoices', { supplier_id: supplierId, po_id: poId, invoice_no: 'SI-004', amount: 74, lines: [{ po_line_id: poLineId, invoiced_qty: 8, invoiced_unit_cost: 5.5 }, { po_line_id: poLine2Id, invoiced_qty: 10, invoiced_unit_cost: 3 }] });
    expect(r.json().status).toBe('VARIANCE'); siPrice = r.json().id;
    const res = await api(app, purch).post(`/supplier-invoices/${siPrice}/resolve`, { action: 'PO_PRICE_CHANGE', note: '供应商涨价' }); expect(res.statusCode).toBe(200); expect(res.json().approval_id).toBeTruthy(); expect(res.json().status).toBe('VARIANCE');
    await approve(res.json().approval_id);
    expect(Number((await adminPool.query(`SELECT unit_cost FROM purchase_order_line WHERE id = $1`, [poLineId])).rows[0].unit_cost)).toBe(5.5);
    const si = (await api(app, acct).get(`/supplier-invoices/${siPrice}`)).json(); expect(si.status).toBe('PAYABLE'); expect(si.matched_amount).toBe(74); expect(si.variance_amount).toBe(0);
    expect((await adminPool.query(`SELECT status FROM ticket WHERE type = 'AP_VARIANCE' AND ref_id = $1`, [siPrice])).rows[0].status).toBe('RESOLVED');
  });
  it('CREDIT_NOTE：金额调成匹配额；到期应付列表', async () => {
    const r = await api(app, acct).post('/supplier-invoices', { supplier_id: supplierId, po_id: poId, invoice_no: 'SI-005', amount: 90, lines: [{ po_line_id: poLineId, invoiced_qty: 10, invoiced_unit_cost: 6 }, { po_line_id: poLine2Id, invoiced_qty: 10, invoiced_unit_cost: 3 }] });
    expect(r.json().status).toBe('VARIANCE');
    const cn = await api(app, acct).post(`/supplier-invoices/${r.json().id}/resolve`, { action: 'CREDIT_NOTE' }); expect(cn.json().status).toBe('PAYABLE'); expect(cn.json().amount).toBe(74);
    const due = await api(app, acct).get('/ap/due?days=60'); expect(due.statusCode).toBe(200); expect(due.json().rows.length).toBeGreaterThanOrEqual(3); expect(due.json().total).toBeGreaterThan(0);
  });
});

let saleEinv: string, subId: string;
describe('电子发票 MyInvois（STUB）', () => {
  it('设定：GET/PUT，secret 只回掩码', async () => {
    const g = await api(app, boss).get('/einvoice/settings'); expect(g.statusCode).toBe(200); expect(g.json().env).toBe('STUB'); expect(g.json().tin).toBe('C2345678901');
    const p = await api(app, boss).put('/einvoice/settings', { client_id: 'abc123', client_secret: 'supersecretvalue', msic_code: '47111' }); expect(p.statusCode).toBe(200); expect(p.json().client_secret).toBe('••••alue'); expect(p.json().client_id).toBe('abc123');
    expect((await api(app, acct).put('/einvoice/settings', { env: 'STUB' })).statusCode).toBe(403);
  });
  it('个人电子发票：有 TIN 的销售 → 立即 VALID，有 uuid/longId/qr_url', async () => {
    saleEinv = await insertSale({ soldAt: new Date().toISOString(), lines: [[P1, 2, 8, 5]], buyer: { name: 'Ali bin Abu', tin: 'IG12345678901', id_type: 'NRIC', id_no: '900101145555' }, einv: true });
    const r = await api(app, acct).post(`/einvoice/sales/${saleEinv}`); expect(r.statusCode).toBe(201); subId = r.json().id;
    expect(r.json().status).toBe('VALID'); expect(r.json().document_uuid).toBeTruthy(); expect(r.json().long_id).toBeTruthy(); expect(r.json().qr_url).toContain(`/${r.json().document_uuid}/share/${r.json().long_id}`); expect(r.json().env).toBe('STUB');
    expect(r.json().payload.Invoice[0].AccountingCustomerParty[0].Party[0].PartyIdentification[0].ID[0]._).toBe('IG12345678901');
    const again = await api(app, acct).post(`/einvoice/sales/${saleEinv}`); expect(again.statusCode).toBe(200); expect(again.json().id).toBe(subId);
  });
  it('没有买家 TIN 的销售 → 400 EINVOICE_BUYER_REQUIRED', async () => {
    const s = await insertSale({ soldAt: new Date().toISOString(), lines: [[P2, 1, 4.5, 3]] });
    const r = await api(app, acct).post(`/einvoice/sales/${s}`); expect(r.statusCode).toBe(400); expect(r.json().code).toBe('EINVOICE_BUYER_REQUIRED');
    const ok = await api(app, acct).post(`/einvoice/sales/${s}`, { buyer: { name: 'Siti', id_type: 'NRIC', id_no: '880808105555' } }); expect(ok.statusCode).toBe(201); expect(ok.json().status).toBe('VALID');
  });
  it('二维码 PNG 200；列表按状态', async () => {
    const q = await api(app, acct).get(`/einvoice/submissions/${subId}/qr`); expect(q.statusCode).toBe(200); expect(q.headers['content-type']).toBe('image/png'); expect(q.rawPayload.subarray(1, 4).toString()).toBe('PNG');
    const l = await api(app, acct).get('/einvoice/submissions?status=VALID'); expect(l.statusCode).toBe(200); expect(l.json().length).toBeGreaterThanOrEqual(2); expect(l.json()[0].doc_no).toBeTruthy();
  });
  it('企业发票提交 → VALID 并挂到 invoice', async () => {
    const r = await api(app, acct).post(`/einvoice/invoices/${invId}`); expect(r.statusCode).toBe(201); expect(r.json().status).toBe('VALID');
    expect((await api(app, acct).get(`/invoices/${invId}`)).json().einvoice_status).toBe('VALID');
    expect((await api(app, acct).get(`/invoices/${invId}/pdf`)).statusCode).toBe(200);
  });
  it('取消（72 小时内）→ CANCELLED；超 72 小时拒绝', async () => {
    const r = await api(app, acct).post(`/einvoice/submissions/${subId}/cancel`, { reason: '开错' }); expect(r.statusCode).toBe(200); expect(r.json().status).toBe('CANCELLED');
    expect((await api(app, acct).get(`/einvoice/submissions/${subId}/qr`)).statusCode).toBe(409);
    const s2 = (await api(app, acct).get('/einvoice/submissions?status=VALID')).json()[0];
    await adminPool.query(`UPDATE einvoice_submission SET validated_at = now() - interval '4 days' WHERE id = $1`, [s2.id]);
    const late = await api(app, acct).post(`/einvoice/submissions/${s2.id}/cancel`, { reason: '太迟' }); expect(late.statusCode).toBe(400); expect(late.json().code).toBe('EINVOICE_CANCEL_WINDOW');
  });
  it('失败进重试队列：缺 TIN 的数据错误标 FAILED 并开 EINVOICE 工单；retry 接口', async () => {
    const s = await insertSale({ soldAt: new Date().toISOString(), lines: [[P2, 1, 4.5, 3]] });
    const sub = await ins(`INSERT INTO einvoice_submission (company_id, doc_type, ref_type, ref_id, env, status) VALUES ($1,'INVOICE','sale',$2,'STUB','QUEUED') RETURNING id`, [companyId, s]);
    expect(await runEinvoiceRetry()).toBeGreaterThanOrEqual(1);
    const row = (await adminPool.query(`SELECT * FROM einvoice_submission WHERE id = $1`, [sub.id])).rows[0]; expect(row.status).toBe('FAILED'); expect(row.error_json.code).toBe('EINVOICE_BUYER_REQUIRED');
    expect((await adminPool.query(`SELECT count(*)::int AS n FROM ticket WHERE type = 'EINVOICE' AND ref_id = $1`, [sub.id])).rows[0].n).toBe(1);
    await adminPool.query(`UPDATE sale SET einvoice_buyer = '{"name":"Fix","tin":"IG00000000001"}'::jsonb WHERE id = $1`, [s]);
    const retry = await api(app, acct).post(`/einvoice/submissions/${sub.id}/retry`); expect(retry.statusCode).toBe(200); expect(retry.json().status).toBe('VALID');
  });
  it('合并发票：上月零售预览 → 提交 CONSOLIDATED VALID → 重复提交 409', async () => {
    const mid = `${M1}-15T10:00:00+08:00`;
    for (let i = 0; i < 3; i++) await insertSale({ soldAt: mid, lines: [[P1, 2, 8, 5], [P2, 1, 4.5, 3]] });
    await insertSale({ soldAt: mid, lines: [[P1, 1, 8, 5]], buyer: { tin: 'IG999' }, einv: true });   // 要个人电子发票的不合并
    const pv = await api(app, acct).post(`/einvoice/consolidated/${siteId}/${M1}/preview`); expect(pv.statusCode).toBe(200);
    expect(pv.json().sale_count).toBe(3); expect(pv.json().total).toBe(61.5); expect(pv.json().by_category.length).toBeGreaterThanOrEqual(1); expect(pv.json().existing).toBeNull();
    const sub = await api(app, acct).post(`/einvoice/consolidated/${siteId}/${M1}/submit`); expect(sub.statusCode).toBe(201); expect(sub.json().status).toBe('VALID'); expect(sub.json().doc_type).toBe('CONSOLIDATED');
    expect(sub.json().payload.Invoice[0].AccountingCustomerParty[0].Party[0].PartyIdentification[0].ID[0]._).toBe('EI00000000010');
    const dup = await api(app, acct).post(`/einvoice/consolidated/${siteId}/${M1}/submit`); expect(dup.statusCode).toBe(409);
    const pv2 = await api(app, acct).post(`/einvoice/consolidated/${siteId}/${M1}/preview`); expect(pv2.json().existing.submission_status).toBe('VALID');
    expect((await api(app, acct).get('/einvoice/consolidated')).json().length).toBe(1);
  });
  it('关掉 einvoice_consolidated 开关 → 403 FEATURE_DISABLED', async () => {
    await adminPool.query(`UPDATE company SET feature_flags = feature_flags || '{"einvoice_consolidated": false}'::jsonb WHERE id = $1`, [companyId]);
    const r = await api(app, acct).post(`/einvoice/consolidated/${siteId}/${M2}/preview`); expect(r.statusCode).toBe(403); expect(r.json().code).toBe('FEATURE_DISABLED');
    await adminPool.query(`UPDATE company SET feature_flags = feature_flags || '{"einvoice_consolidated": true}'::jsonb WHERE id = $1`, [companyId]);
  });
});

describe('月结 (B12)', () => {
  it('检查清单：上月有未提交合并发票时不清；当前月份不能锁', async () => {
    // M2 没有任何销售 → 清单应全清
    const c2 = await api(app, acct).get(`/period/${M2}/checklist`); expect(c2.statusCode).toBe(200); expect(c2.json().all_clear).toBe(true); expect(c2.json().items.length).toBe(7); expect(c2.json().locked).toBe(false);
    const c0 = await api(app, acct).get(`/period/${M0}/checklist`); expect(c0.json().is_past).toBe(false);
    const r = await api(app, acct).post(`/period/${M0}/lock`); expect(r.statusCode).toBe(400); expect(r.json().code).toBe('PERIOD_NOT_PAST');
  });
  it('清单未清时 PERIOD_NOT_CLEAR，force 可强制', async () => {
    // 给上月（M1）制造一个未提交合并发票的店：建第二个站点并放一笔零售销售
    const s2 = await ins(`INSERT INTO site (company_id, code, name, type) VALUES ($1,'SHOP2','二店','SHOP') RETURNING id`, [companyId]);
    await insertSale({ site: s2.id, soldAt: `${M1}-20T12:00:00+08:00`, lines: [[P2, 2, 4.5, 3]] });
    const cl = await api(app, acct).get(`/period/${M1}/checklist`); expect(cl.json().all_clear).toBe(false);
    const item = cl.json().items.find((i: any) => i.key === 'consolidated_missing'); expect(item.count).toBe(1); expect(item.detail[0].site_code).toBe('SHOP2');
    const r = await api(app, acct).post(`/period/${M1}/lock`); expect(r.statusCode).toBe(400); expect(r.json().code).toBe('PERIOD_NOT_CLEAR');
    await api(app, acct).post(`/einvoice/consolidated/${s2.id}/${M1}/submit`);
    expect((await api(app, acct).get(`/period/${M1}/checklist`)).json().all_clear).toBe(true);
  });
  it('锁定 M2 → 该月 movement 插入 400 PERIOD_LOCKED → 其他月份正常 → 老板解锁', async () => {
    const r = await api(app, acct).post(`/period/${M2}/lock`, { note: '测试锁' }); expect(r.statusCode).toBe(201); expect(r.json().checklist.all_clear).toBe(true);
    expect((await api(app, acct).post(`/period/${M2}/lock`)).statusCode).toBe(409);
    const locks = await api(app, acct).get('/period/locks'); expect(locks.json().length).toBe(1); expect(locks.json()[0].month).toBe(M2); expect(locks.json()[0].locked_by_name).toBe('会计阿花');
    const blocked = await api(app, boss).post('/movements', { product_id: P2, from_location_code: 'SUPPLIER', to_location_id: locId, qty: 1, reason: 'RECEIVE', performed_at: `${M2}-10T09:00:00+08:00` });
    expect(blocked.statusCode).toBe(400); expect(blocked.json().code).toBe('PERIOD_LOCKED');
    const ok = await api(app, boss).post('/movements', { product_id: P2, from_location_code: 'SUPPLIER', to_location_id: locId, qty: 1, reason: 'RECEIVE', performed_at: `${M1}-10T09:00:00+08:00` }); expect(ok.statusCode).toBe(201);
    const now = await api(app, boss).post('/movements', { product_id: P2, from_location_code: 'SUPPLIER', to_location_id: locId, qty: 1, reason: 'RECEIVE' }); expect(now.statusCode).toBe(201);
    expect((await api(app, acct).post(`/period/${M2}/unlock`, { reason: '会计不能解锁' })).statusCode).toBe(403);
    const un = await api(app, boss).post(`/period/${M2}/unlock`, { reason: '补录' }); expect(un.statusCode).toBe(200);
    expect((await adminPool.query(`SELECT count(*)::int AS n FROM audit_log WHERE company_id = $1 AND action = 'PERIOD_UNLOCK'`, [companyId])).rows[0].n).toBe(1);
    const after = await api(app, boss).post('/movements', { product_id: P2, from_location_code: 'SUPPLIER', to_location_id: locId, qty: 1, reason: 'RECEIVE', performed_at: `${M2}-10T09:00:00+08:00` }); expect(after.statusCode).toBe(201);
  });
});

describe('报表与会计导出', () => {
  const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
  const from = `${M2}-01`;
  it('销售报表：按日/类别/产品 JSON，含毛利；xlsx 200', async () => {
    const r = await api(app, acct).get(`/reports/sales?from=${from}&to=${today}&group=day`); expect(r.statusCode).toBe(200);
    expect(r.json().rows.length).toBeGreaterThanOrEqual(2); expect(r.json().totals.net).toBeGreaterThan(0); expect(r.json().columns.some((c: any) => c.key === 'gross_profit')).toBe(true); expect(r.json().can_see_cost).toBe(true);
    const sku = (await api(app, boss).get(`/products/${P1}`)).json().sku;
    const prod = await api(app, acct).get(`/reports/sales?from=${from}&to=${today}&group=product`); const water = prod.json().rows.find((x: any) => x.key === sku); expect(water.gross_profit).toBeGreaterThan(0);
    for (const g of ['site', 'terminal', 'cashier', 'category']) expect((await api(app, acct).get(`/reports/sales?from=${from}&to=${today}&group=${g}`)).statusCode, g).toBe(200);
    const x = await api(app, acct).get(`/reports/sales?from=${from}&to=${today}&group=day&format=xlsx`); expect(x.statusCode).toBe(200); expect(x.headers['content-type']).toContain('spreadsheetml');
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(x.rawPayload as any); expect(wb.worksheets[0].getRow(1).getCell(1).value).toBe('日期');
    expect((await adminPool.query(`SELECT count(*)::int AS n FROM export_log WHERE company_id = $1 AND export_type = 'report-sales'`, [companyId])).rows[0].n).toBe(1);
  });
  it('经理（无 product.view_cost）看不到成本列', async () => {
    const r = await api(app, mgr).get(`/reports/sales?from=${from}&to=${today}&group=day`); expect(r.statusCode).toBe(200); expect(r.json().can_see_cost).toBe(false);
    expect(r.json().columns.some((c: any) => ['cost', 'gross_profit', 'margin_pct'].includes(c.key))).toBe(false);
    for (const row of r.json().rows) { expect(row.cost).toBeUndefined(); expect(row.gross_profit).toBeUndefined(); expect(row.net).toBeDefined(); }
    expect(r.json().totals.cost).toBeUndefined();
    const t = await api(app, mgr).get('/reports/turnover'); expect(t.json().columns.some((c: any) => c.key === 'stock_value')).toBe(false);
    expect((await api(app, purch).get(`/reports/sales?from=${from}&to=${today}`)).statusCode).toBe(403);
  });
  it('损耗报表：ADJUST 到 DAMAGED 按产品/类别，xlsx 200', async () => {
    const dmg = (await api(app, boss).get('/locations?include_virtual=true')).json().find((l: any) => l.virtual_type === 'DAMAGED');
    const mv = await api(app, boss).post('/movements', { product_id: P1, from_location_id: locId, to_location_id: dmg.id, qty: 3, reason: 'ADJUST', note: '破损' }); expect(mv.statusCode).toBe(201);
    const r = await api(app, acct).get(`/reports/shrinkage?from=${from}&to=${today}`); expect(r.statusCode).toBe(200);
    const row = r.json().rows.find((x: any) => x.reason === 'ADJUST'); expect(row.qty).toBe(3); expect(row.amount).toBe(15); expect(r.json().meta.by_category.length).toBe(1);
    expect((await api(app, acct).get(`/reports/shrinkage?from=${from}&to=${today}&format=xlsx`)).statusCode).toBe(200);
    expect((await api(app, mgr).get(`/reports/shrinkage?from=${from}&to=${today}`)).json().rows[0].amount).toBeUndefined();
  });
  it('周转、库龄、供应商准时率、日报汇总 200（JSON + xlsx）', async () => {
    const t = await api(app, acct).get('/reports/turnover?days=90'); expect(t.statusCode).toBe(200); const w = t.json().rows.find((x: any) => x.name === '矿泉水 500ml'); expect(w.sold_qty).toBeGreaterThan(0); expect(w.stock_qty).toBe(92); expect(t.json().meta.worst.length).toBeGreaterThan(0);
    expect((await api(app, acct).get('/reports/turnover?format=xlsx')).statusCode).toBe(200);
    const a = await api(app, acct).get('/reports/stock-aging'); expect(a.statusCode).toBe(200); expect(a.json().totals.value).toBeGreaterThan(0); expect(a.json().rows[0].v0_30).toBeGreaterThan(0);
    expect((await api(app, acct).get('/reports/stock-aging?format=xlsx')).statusCode).toBe(200);
    const o = await api(app, acct).get('/reports/supplier-otif'); expect(o.statusCode).toBe(200); expect(o.json().rows.length).toBe(1); expect(o.json().rows[0]).toMatchObject({ po_count: 1, received_pos: 1, on_time: 1, on_time_pct: 100, ordered_qty: 20, received_qty: 18, short_pct: 10 });
    expect((await api(app, acct).get('/reports/supplier-otif?format=xlsx')).statusCode).toBe(200);
    const d = await api(app, acct).get(`/reports/daily-summary?date=${today}`); expect(d.statusCode).toBe(200); expect(d.json().meta.sales.count).toBeGreaterThanOrEqual(3); expect(d.json().meta.sales.by_method[0].method).toBe('CASH'); expect(d.json().meta.einvoice.valid_today).toBeGreaterThanOrEqual(2);
    const list = await api(app, acct).get('/reports'); expect(list.json()).toContain('sales');
  });
  it('会计导出：CSV 借贷平衡；SQL Account / AutoCount xlsx 多工作表', async () => {
    const r = await api(app, acct).get(`/reports/accounting-export?month=${M0}&format=csv`); expect(r.statusCode).toBe(200); expect(r.headers['content-type']).toContain('text/csv');
    const lines = r.body.replace(/^﻿/, '').split('\r\n').filter(Boolean); expect(lines[0]).toBe('journal,date,doc_no,party_code,party_name,account_code,description,debit,credit,tax_code,tax_amount,reference'); expect(lines.length).toBeGreaterThan(5);
    const parse = (l: string) => l.match(/("([^"]|"")*"|[^,]*)(,|$)/g)!.map((c) => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"'));
    const body = lines.slice(1).map(parse).filter((c) => c[0] !== 'STOCK');
    const debit = body.reduce((s, c) => s + Number(c[7] || 0), 0), credit = body.reduce((s, c) => s + Number(c[8] || 0), 0); expect(Math.abs(debit - credit)).toBeLessThan(0.01);
    expect(body.some((c) => c[0] === 'SALES' && c[2] === invNo)).toBe(true); expect(body.some((c) => c[0] === 'PURCHASE' && c[2] === 'SI-001')).toBe(true); expect(body.some((c) => c[0] === 'PAYMENT')).toBe(true); expect(body.some((c) => c[0] === 'RECEIPT')).toBe(true);
    for (const f of ['sqlaccount', 'autocount'] as const) {
      const x = await api(app, acct).get(`/reports/accounting-export?month=${M0}&format=${f}`); expect(x.statusCode, f).toBe(200);
      const wb = new ExcelJS.Workbook(); await wb.xlsx.load(x.rawPayload as any); expect(wb.worksheets.map((w) => w.name)).toContain('APPayment'); expect(wb.worksheets.length).toBe(6);
    }
    expect((await adminPool.query(`SELECT count(*)::int AS n FROM export_log WHERE company_id = $1 AND export_type LIKE 'accounting-%'`, [companyId])).rows[0].n).toBe(3);
  });
  it('月结自动任务：对账单 + 报表 Excel + 通知（合并发票已提交过则跳过）', async () => {
    const out = await runMonthEndAuto(M1, companyId); expect(out.length).toBe(1);
    expect(out[0].errors).toEqual([]); expect(out[0].statements).toBeGreaterThanOrEqual(1); expect(out[0].reports).toBe(3); expect(out[0].consolidated).toBe(0);
    expect((await adminPool.query(`SELECT count(*)::int AS n FROM statement WHERE company_id = $1 AND period_start = $2::date`, [companyId, `${M1}-01`])).rows[0].n).toBeGreaterThanOrEqual(1);
    expect((await adminPool.query(`SELECT count(*)::int AS n FROM notification WHERE company_id = $1 AND type = 'MONTH_END'`, [companyId])).rows[0].n).toBe(1);
  });
});
