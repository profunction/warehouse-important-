import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import sharp from 'sharp';
import { buildApp } from '../src/app.js';
import { api } from './helpers.js';
import { closePools } from '../src/lib/db.js';

const app = buildApp();
let boss: string, cashier: string, pid: string, url: string;
const code = 'MED' + String(Date.now()).slice(-4);
const png = (color: string) => sharp({ create: { width: 1200, height: 600, channels: 3, background: color } }).png().toBuffer();
const multipart = (files: { name: string; buf: Buffer }[], field = 'files') => {
  const b = '----med' + Date.now(); const parts: Buffer[] = [];
  for (const f of files) parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${field}"; filename="${f.name}"\r\nContent-Type: image/png\r\n\r\n`), f.buf, Buffer.from('\r\n'));
  parts.push(Buffer.from(`--${b}--\r\n`));
  return { payload: Buffer.concat(parts), ct: `multipart/form-data; boundary=${b}` };
};

beforeAll(async () => {
  await app.ready();
  const sa = (await api(app).post('/auth/login', { email: 'admin@test.local', pin: '123456' })).json().access_token;
  const c = (await api(app, sa).post('/admin/companies', { name: '照片店', short_code: code, plan: 'A', boss_name: '老板', boss_phone: '0191110001', boss_pin: '111111' })).json();
  boss = (await api(app).post('/auth/login', { company_code: code, phone: '0191110001', pin: '111111' })).json().access_token;
  const cats = (await api(app, boss).get('/categories')).json();
  const p = (await api(app, boss).post('/products', { name_zh: '可乐', category_id: cats[0].id, cost_price: 1, sell_price: 2, min_level: 1, reorder_qty: 2, barcode: '9557000000017' })).json(); pid = p.id;
  await api(app, boss).post('/products', { name_zh: '饼干', category_id: cats[0].id, cost_price: 1, sell_price: 2, min_level: 1, reorder_qty: 2, barcode: '9557000000024' });
  await api(app, boss).post('/users', { name: '收银', phone: '0191110002', roles: [{ role_code: 'CASHIER', site_id: c.site_id }], pin: '333333' });
  cashier = (await api(app).post('/auth/login', { company_code: code, phone: '0191110002', pin: '333333' })).json().access_token;
});
afterAll(async () => { await app.close(); await closePools(); });

describe('产品照片', () => {
  it('老板上传单张：压成 800×800 JPEG，产品 photo_url 更新', async () => {
    const m = multipart([{ name: 'x.png', buf: await png('#ff0000') }], 'file');
    const r = await app.inject({ method: 'POST', url: `/api/v1/products/${pid}/photo`, headers: { authorization: `Bearer ${boss}`, 'content-type': m.ct }, payload: m.payload });
    expect(r.statusCode).toBe(200); url = r.json().photo_url; expect(url).toMatch(/^\/api\/v1\/media\/prod-/);
    const p = (await api(app, boss).get(`/products/${pid}`)).json(); expect(p.photo_url).toBe(url);
  });
  it('照片不用登录就能看（大屏、收银用），是 JPEG 正方形', async () => {
    const r = await app.inject({ method: 'GET', url });
    expect(r.statusCode).toBe(200); expect(r.headers['content-type']).toBe('image/jpeg');
    const meta = await sharp(r.rawPayload).metadata(); expect(meta.width).toBe(800); expect(meta.height).toBe(800);
  });
  it('换照片后旧文件删掉', async () => {
    const m = multipart([{ name: 'y.png', buf: await png('#00ff00') }], 'file');
    const r = await app.inject({ method: 'POST', url: `/api/v1/products/${pid}/photo`, headers: { authorization: `Bearer ${boss}`, 'content-type': m.ct }, payload: m.payload });
    expect(r.statusCode).toBe(200); expect(r.json().photo_url).not.toBe(url);
    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(404); url = r.json().photo_url;
  });
  it('不是图片 400；乱写文件名 404', async () => {
    const m = multipart([{ name: 'a.png', buf: Buffer.from('not an image') }], 'file');
    const r = await app.inject({ method: 'POST', url: `/api/v1/products/${pid}/photo`, headers: { authorization: `Bearer ${boss}`, 'content-type': m.ct }, payload: m.payload });
    expect(r.statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/v1/media/..%2F..%2Fetc%2Fpasswd' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/v1/media/export-x.xlsx' })).statusCode).toBe(404);
  });
  it('收银员不能上传 403', async () => {
    const m = multipart([{ name: 'z.png', buf: await png('#0000ff') }], 'file');
    const r = await app.inject({ method: 'POST', url: `/api/v1/products/${pid}/photo`, headers: { authorization: `Bearer ${cashier}`, 'content-type': m.ct }, payload: m.payload });
    expect(r.statusCode).toBe(403);
  });
  it('批量：文件名等于条码就配上，找不到的列出来', async () => {
    const m = multipart([{ name: '9557000000024.png', buf: await png('#123456') }, { name: '0000000000000.jpg', buf: await png('#654321') }]);
    const r = await app.inject({ method: 'POST', url: '/api/v1/products/photos/bulk', headers: { authorization: `Bearer ${boss}`, 'content-type': m.ct }, payload: m.payload });
    expect(r.statusCode).toBe(200); const j = r.json();
    expect(j.matched.map((x: any) => x.file)).toEqual(['9557000000024.png']); expect(j.unmatched).toEqual(['0000000000000.jpg']);
    const list = (await api(app, boss).get('/products?search=9557000000024')).json(); expect(list[0].photo_url).toMatch(/media\/prod-/);
  });
  it('删除照片', async () => {
    const r = await api(app, boss).del(`/products/${pid}/photo`); expect(r.statusCode).toBe(200);
    expect((await api(app, boss).get(`/products/${pid}`)).json().photo_url).toBeNull();
    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(404);
  });
});
