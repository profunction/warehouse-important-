// 重建示范数据：假设服务器已重启在干净库上。输出老板和员工登录信息。
const API = process.env.API || 'http://localhost:3000/api/v1';
const j = async (path, body, token) => { const r = await fetch(API + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined }); const d = await r.json(); if (!r.ok) throw new Error(path + ' ' + JSON.stringify(d)); return d; };
const sa = (await j('/auth/login', { email: 'admin@demo.local', pin: '123456' })).access_token;
const c = await j('/admin/companies', { name: '示范小店', short_code: 'DEMO1', plan: 'A', tin: 'C1234567890', boss_name: '陈老板', boss_phone: '0120000001', boss_pin: '111111' }, sa);
const boss = (await j('/auth/login', { company_code: 'DEMO1', phone: '0120000001', pin: '111111' })).access_token;
const cats = await j('/categories', null, boss); const cat = (code) => cats.find((x) => x.code === code).id;
const products = [
  ['可口可乐 325ml', 'Coca-Cola 325ml', 'BEV', 1.2, 1.8, '9556001234567', 24],
  ['美禄 1kg', 'Milo 1kg', 'BEV', 14.5, 18.9, '9556002000011', 6],
  ['乐事薯片 70g', 'Lays Chips 70g', 'SNK', 2.1, 3.2, '9556003000022', 12],
  ['鲜奶 1L', 'Fresh Milk 1L', 'DAI', 5.0, 7.0, '9556004000033', 6],
  ['白米 5kg', 'Rice 5kg', 'DRY', 16.0, 19.9, '9556005000044', 10],
];
for (const [zh, en, code, cost, sell, bc, min] of products) await j('/products', { name_zh: zh, name_en: en, name_ms: en, category_id: cat(code), cost_price: cost, sell_price: sell, min_level: min, reorder_qty: min * 2, barcode: bc, shelf_life_days: code === 'DAI' ? 14 : null }, boss);
const p1 = (await j('/products?search=9556001234567', null, boss))[0];
await j(`/products/${p1.id}/barcodes`, { barcode: '19556001234564', pack_qty: 24, barcode_type: 'CASE' }, boss);
await j('/users', { name: '库存阿明', phone: '0120000009', roles: [{ role_code: 'WAREHOUSE', site_id: c.site_id }], pin: '222222' }, boss);
await j('/users', { name: '收银阿美', phone: '0120000008', roles: [{ role_code: 'CASHIER', site_id: c.site_id }], pin: '333333' }, boss);
console.log(JSON.stringify({ company: c, boss: { company_code: 'DEMO1', phone: '0120000001', pin: '111111' }, staff: { phone: '0120000009', pin: '222222' }, cashier: { phone: '0120000008', pin: '333333' }, super_admin: { email: 'admin@demo.local', pin: '123456' } }, null, 1));
