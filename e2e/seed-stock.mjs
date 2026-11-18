// 往示范店放货，让 3D 视图有颜色：各后仓位和部分货架
const API = 'http://localhost:3000/api/v1';
const j = async (path, body, token, method) => { const r = await fetch(API + path, { method: method ?? (body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined }); const d = await r.json(); if (!r.ok) throw new Error(path + ' ' + JSON.stringify(d)); return d; };
const boss = (await j('/auth/login', { company_code: 'DEMO1', phone: '0120000001', pin: '111111' })).access_token;
const prods = await j('/products?limit=50', null, boss);
const byName = (s) => prods.find((p) => (p.name_zh ?? '').includes(s));
const plan = [
  ['可口可乐', 'S-01', 120], ['美禄', 'S-01', 30], ['乐事', 'S-02', 60], ['白米', 'S-02', 40], ['鲜奶', 'S-04', 18],
  ['可口可乐', 'A-01-1', 24], ['可口可乐', 'A-01-2', 12], ['美禄', 'A-02-1', 6], ['乐事', 'B-01-1', 18], ['乐事', 'B-01-2', 9], ['白米', 'B-02-1', 5], ['鲜奶', 'E-01-1', 8],
  ['可口可乐', 'A-03-3', 48], ['美禄', 'A-04-2', 20], ['白米', 'C-02-1', 30], ['乐事', 'B-03-4', 36],
];
let n = 0;
for (const [name, loc, qty] of plan) {
  const p = byName(name); if (!p) continue;
  const from = loc.startsWith('S-') ? 'SUPPLIER' : (name === '鲜奶' ? 'S-04' : name === '可口可乐' || name === '美禄' ? 'S-01' : 'S-02');
  const reason = loc.startsWith('S-') ? 'RECEIVE' : 'REFILL';
  try { await j('/movements', { product_id: p.id, from_location_code: from, to_location_code: loc, qty, reason, assign_shelf: reason === 'REFILL' }, boss); n++; } catch (e) { console.log('skip', name, loc, String(e).slice(0, 120)); }
}
console.log('seeded', n);
