import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/app.js';
import { api } from './helpers.js';
import { closePools, adminPool } from '../src/lib/db.js';

process.env.PUBLIC_URL = 'https://shop.example.my';
const app = buildApp(); const A = () => api(app);
let code: string, boss: string, cashier: string, cid: string, sale: any, b2b: string;
const tok = () => new URL(sale.einvoice_url).searchParams.get('t');
beforeAll(async () => {
  await app.ready();
  code = 'CS' + String(Date.now()).slice(-5);
  const sa = (await A().post('/auth/login', { email: 'admin@test.local', pin: '123456' })).json().access_token;
  const c = (await api(app, sa).post('/admin/companies', { name: '自助店', short_code: code, plan: 'A', boss_name: '老板', boss_phone: '0192220001', boss_pin: '111111' })).json(); cid = c.company_id;
  await adminPool.query(`UPDATE company SET tin = 'C1234567890', msic_code = '47111', sst_no = 'W10-1808-31000001', address = '{"line1":"1 Jalan Test","city":"Kuala Lumpur","postcode":"50000","state":"14"}'::jsonb WHERE id = $1`, [cid]);
  boss = (await A().post('/auth/login', { company_code: code, phone: '0192220001', pin: '111111' })).json().access_token;
  const cats = (await api(app, boss).get('/categories')).json();
  await api(app, boss).post('/products', { name_zh: '可乐', category_id: cats.find((x: any) => x.code === 'BEV').id, cost_price: 1, sell_price: 2, min_level: 1, reorder_qty: 2, barcode: '9558000000011' });
  await api(app, boss).post('/movements', { barcode: '9558000000011', from_location_code: 'SUPPLIER', to_location_code: 'S-01', qty: 50, reason: 'RECEIVE' });
  await api(app, boss).post('/users', { name: '收银', phone: '0192220002', roles: [{ role_code: 'CASHIER', site_id: c.site_id }], pin: '333333' });
  cashier = (await A().post('/auth/login', { company_code: code, phone: '0192220002', pin: '333333' })).json().access_token;
  const s = (await api(app, cashier).post('/pos/sessions/open', { terminal_code: 'P1', opening_cash: 50 })).json();
  sale = (await api(app, cashier).post('/pos/sales', { client_id: randomUUID(), terminal_code: 'P1', session_id: s.id, lines: [{ barcode: '9558000000011', qty: 3 }], payments: [{ method: 'CASH', tendered: 10 }] })).json();
});
afterAll(async () => { await app.close(); await closePools(); delete process.env.PUBLIC_URL; });

describe('收据二维码自己开电子发票', () => {
  it('收据带签名链接，打印文字有提示', () => {
    expect(sale.einvoice_url).toMatch(new RegExp(`^https://shop.example.my/e/${code}/`)); expect(sale.qr_content).toBe(sale.einvoice_url);
    expect(sale.receipt_text).toContain('扫码开电子发票');
  });
  it('签名对才看得到收据；签名错 404', async () => {
    const r = await A().get(`/public/receipt/${code}/${encodeURIComponent(sale.receipt_no)}?t=${tok()}`); expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ shop: '自助店', receipt_no: sale.receipt_no, total: 6, expired: false, submitted: false });
    expect((await A().get(`/public/receipt/${code}/${encodeURIComponent(sale.receipt_no)}?t=000000000000`)).statusCode).toBe(404);
  });
  it('没有 TIN 也没有证件号 400；填好提交 201，顺便存成会员', async () => {
    const url = `/public/receipt/${code}/${encodeURIComponent(sale.receipt_no)}/einvoice?t=${tok()}`;
    expect((await A().post(url, { name: '陈先生', email: 'a@b.my' })).statusCode).toBe(400);
    const r = await A().post(url, { name: '陈先生', email: 'tan@example.my', id_type: 'NRIC', id_no: '800101-14-5555', save_as_member: true, phone: '012-345 6789' });
    expect(r.statusCode, r.body).toBe(201); expect(['VALID', 'SUBMITTED', 'QUEUED']).toContain(r.json().status);
    const s = (await adminPool.query(`SELECT einvoice_required, einvoice_buyer, customer_id FROM sale WHERE id = $1`, [sale.id])).rows[0];
    expect(s.einvoice_required).toBe(true); expect(s.einvoice_buyer.id_no).toBe('800101-14-5555'); expect(s.customer_id).not.toBeNull();
    expect((await A().post(url, { name: '陈先生', email: 'tan@example.my', id_no: '800101-14-5555' })).statusCode).toBe(409);
    expect((await A().get(`/public/receipt/${code}/${encodeURIComponent(sale.receipt_no)}?t=${tok()}`)).json().submitted).toBe(true);
  });
  it('超过 72 小时不能再开', async () => {
    await adminPool.query(`UPDATE sale SET sold_at = now() - interval '80 hours' WHERE id = $1`, [sale.id]);
    await adminPool.query(`DELETE FROM einvoice_submission WHERE ref_id = $1`, [sale.id]);
    const r = await A().post(`/public/receipt/${code}/${encodeURIComponent(sale.receipt_no)}/einvoice?t=${tok()}`, { name: 'x', email: 'x@y.my', tin: 'IG1' });
    expect(r.statusCode).toBe(409); expect(r.json().code).toBe('EINVOICE_EXPIRED');
  });
});

describe('会员登记（不做积分）', () => {
  it('不用登录登记；同手机再登记就更新，不会重复', async () => {
    const r = await A().post(`/public/shop/${code}/member`, { name: '林小姐', phone: '017 888 9999', consent: true, einvoice: { tin: 'IG99887766', id_type: 'NRIC', id_no: '900202-10-1234' } });
    expect(r.statusCode).toBe(201); expect(r.json().member_no).toMatch(/^M\d{5}$/);
    const r2 = await A().post(`/public/shop/${code}/member`, { name: '林美美', phone: '0178889999', email: 'lin@ex.my', consent: true });
    expect(r2.statusCode).toBe(200); expect(r2.json().member_no).toBe(r.json().member_no);
    expect((await A().post(`/public/shop/${code}/member`, { name: 'x', phone: '0170000000' })).statusCode).toBe(400);   // 没同意不行
  });
  it('收银员按手机号找到会员，带电子发票资料', async () => {
    const rows = (await api(app, cashier).get('/pos/customers?search=0178889999')).json();
    expect(rows[0].name).toBe('林美美'); expect(rows[0].is_member).toBe(true); expect(rows[0].einvoice_profile.tin).toBe('IG99887766');
  });
  it('会员零售销售不算记账', async () => {
    const s = (await api(app, cashier).get('/pos/sessions/current?terminal_code=P1')).json().session;
    const mem = (await api(app, cashier).get('/pos/customers?search=0178889999')).json()[0];
    const r = await api(app, cashier).post('/pos/sales', { client_id: randomUUID(), terminal_code: 'P1', session_id: s.id, customer_id: mem.id, sale_type: 'RETAIL', lines: [{ barcode: '9558000000011', qty: 1 }], payments: [{ method: 'CASH', tendered: 2 }] });
    expect(r.statusCode, r.body).toBe(201); expect(r.json().sale_type).toBe('RETAIL'); expect(r.json().customer_name).toBe('林美美');
  });
});

describe('企业记账申请', () => {
  it('缺 BRN 和 TIN 400；正确申请 201，老板收到通知', async () => {
    const body = { company_name: 'Syarikat Maju Sdn Bhd', address: 'No 1 Jalan Maju, KL', contact_name: 'Ali', phone: '0193334444', email: 'ali@maju.my', requested_limit: 5000, requested_terms: 30, consent: true };
    expect((await A().post(`/public/shop/${code}/credit-apply`, body)).statusCode).toBe(400);
    const r = await A().post(`/public/shop/${code}/credit-apply`, { ...body, brn: '202301000123' }); expect(r.statusCode, r.body).toBe(201);
    expect((await A().post(`/public/shop/${code}/credit-apply`, { ...body, brn: '202301000123' })).statusCode).toBe(409);
    const n = (await adminPool.query(`SELECT text FROM notification WHERE company_id = $1 AND type = 'CREDIT_APPLICATION'`, [cid])).rows; expect(n[0].text).toContain('Syarikat Maju');
  });
  it('批准前不能记账；老板改额度批准后可以', async () => {
    const apps = (await api(app, boss).get('/customers/credit-applications')).json(); expect(apps).toHaveLength(1); b2b = apps[0].id;
    expect(Number(apps[0].credit_requested_limit)).toBe(5000);
    expect((await api(app, cashier).post(`/customers/${b2b}/credit-decision`, { approve: true })).statusCode).toBe(403);
    const r = await api(app, boss).post(`/customers/${b2b}/credit-decision`, { approve: true, credit_limit: 3000, credit_terms_days: 14 });
    expect(r.statusCode, r.body).toBe(200); expect(r.json()).toMatchObject({ credit_status: 'APPROVED', credit_terms_days: 14 }); expect(Number(r.json().credit_limit)).toBe(3000);
    expect((await api(app, boss).get('/customers/credit-applications')).json()).toHaveLength(0);
  });
  it('柜台二维码 PNG 指向 /c/公司代码', async () => {
    const r = await app.inject({ method: 'GET', url: `/api/v1/customers/self-register-qr?origin=${encodeURIComponent('https://shop.example.my')}`, headers: { authorization: `Bearer ${boss}` } });
    expect(r.statusCode).toBe(200); expect(r.headers['content-type']).toBe('image/png'); expect(r.headers['x-url']).toBe(`https://shop.example.my/c/${code}`);
    expect((await A().get(`/public/shop/${code}`)).json().name).toBe('自助店'); expect((await A().get('/public/shop/NOPE99')).statusCode).toBe(404);
  });
});
