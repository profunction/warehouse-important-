// 模块 E 端到端冒烟：DEMO1 老板用 API 画简单地图并发布 → 生成 KIOSK 密钥（API 或直接插表）→ 大屏 1080×1920 截待机、搜"可乐"、结果地图 → 手机库存员 /m/help 问"可乐放哪里"截图
import { chromium, devices } from 'playwright';
import { createHash, randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';
const BASE = process.env.BASE || 'http://localhost:5173';
const shots = new URL('./shots/', import.meta.url).pathname;
const results = []; const ok = (n, c, e = '') => { results.push([c ? 'PASS' : 'FAIL', n, e]); if (!c) process.exitCode = 1; };
const j = async (path, body, token, method) => { const r = await fetch(BASE + '/api/v1' + path, { method: method ?? (body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); let d; try { d = JSON.parse(t); } catch { d = t; } if (!r.ok) throw new Error(`${method ?? 'POST'} ${path} ${r.status} ${t.slice(0, 200)}`); return d; };

const browser = await chromium.launch();
try {
  // 1. 老板登录，准备货架登记 + 地图
  const boss = (await j('/auth/login', { company_code: 'DEMO1', phone: '0120000001', pin: '111111' })).access_token;
  const sites = await j('/sites', null, boss); const shop = sites.find((s) => s.type === 'SHOP') ?? sites[0];
  const locs = await j(`/locations?site=${shop.id}`, null, boss); const zones = await j(`/zones?site=${shop.id}`, null, boss);
  const a1 = locs.find((l) => l.code === 'A-01-1'); const zoneA = zones.find((z) => z.code === 'A');
  const prods = await j('/products?search=9556001234567', null, boss); const cola = prods[0]; ok('找到示范产品可乐', !!cola);
  if (cola && a1) { const cur = await j(`/shelf-assignments?product=${cola.id}`, null, boss); if (!cur.some((s) => s.location_id === a1.id)) await j('/shelf-assignments', { product_id: cola.id, location_id: a1.id, is_primary: !cur.some((s) => s.is_primary) }, boss); }
  const racks = [1, 2, 3, 4].map((r) => ({ kind: 'RACK', zone_id: zoneA?.id ?? null, rack: r, location_id: locs.find((l) => l.code === `A-0${r}-1`)?.id ?? null, x: 3 + r * 3, y: 4, w: 1, h: 5, label: `A-0${r}` }));
  const elements = [{ kind: 'KIOSK', x: 1, y: 1, w: 1, h: 1, label: '屏' }, { kind: 'ENTRANCE', x: 0, y: 3, w: 1, h: 2, label: '入口' }, { kind: 'COUNTER', x: 14, y: 1, w: 4, h: 1, label: '收银' }, { kind: 'WALL', x: 10, y: 10, w: 8, h: 1 }, { kind: 'ZONE', zone_id: zoneA?.id ?? null, x: 5, y: 3, w: 13, h: 7, label: 'A 区', color: zoneA?.color ?? '#1565C0' }, ...racks];
  const draft = await j(`/sites/${shop.id}/map`, { width: 20, height: 14, kiosk: { x: 1, y: 1 }, entrance: { x: 0, y: 3 }, elements }, boss, 'PUT'); ok('G6 保存地图草稿', draft.status === 'DRAFT');
  const pub = await j(`/sites/${shop.id}/map/publish`, {}, boss); ok('G6 发布地图', pub.status === 'PUBLISHED');
  // 2. KIOSK 密钥：先试模块 C 的 /api-keys，失败就直接插表
  let key = null;
  try { const r = await j('/api-keys', { name: `e2e 大屏 ${Date.now()}`, scope: 'KIOSK', site_id: shop.id }, boss); key = r.key ?? r.api_key ?? null; } catch { /* */ }
  if (!key) {
    const prefix = randomBytes(4).toString('hex'); const secret = randomBytes(16).toString('hex'); key = `wh_${prefix}.${secret}`; const hash = createHash('sha256').update(key).digest('hex');
    execSync(`psql -U postgres -h localhost -d ${process.env.DATABASE_NAME || 'warehouse'} -c "INSERT INTO api_key (company_id, site_id, name, scope, key_prefix, key_hash) SELECT c.id, '${shop.id}', 'e2e 大屏', 'KIOSK', '${prefix}', '${hash}' FROM company c WHERE c.short_code = 'DEMO1'"`, { env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD || 'postgres' }, stdio: 'pipe' });
  }
  ok('大屏密钥', !!key);
  const kr = await fetch(BASE + '/api/v1/kiosk/search?q=kele', { headers: { 'x-api-key': key } }); const kj = await kr.json();
  ok('D 大屏 API 搜 kele 找到可乐且无成本字段', kr.ok && kj.length >= 1 && !JSON.stringify(kj).includes('cost'));
  const forbidden = await fetch(BASE + '/api/v1/products', { headers: { 'x-api-key': key } }); ok('KIOSK 密钥访问 /products 被挡', forbidden.status === 401 || forbidden.status === 403);

  // 3. 大屏 1080×1920
  const kctx = await browser.newContext({ viewport: { width: 1080, height: 1920 }, reducedMotion: 'reduce', locale: 'zh-CN' }); const k = await kctx.newPage();
  k.on('pageerror', (e) => console.error('PAGEERROR', e.message));
  await k.goto(`${BASE}/kiosk?key=${encodeURIComponent(key)}`); await k.getByTestId('kiosk-find').waitFor({ timeout: 20000 }); await k.waitForTimeout(1500);
  ok('D1 待机屏', await k.getByTestId('kiosk-find').isVisible()); await k.screenshot({ path: shots + 'k1-idle.png' });
  await k.getByTestId('kiosk-find').click(); await k.getByTestId('kiosk-search').waitFor();
  for (const ch of 'kele') await k.locator('.kiosk .kb button', { hasText: new RegExp(`^${ch}$`) }).first().click();
  await k.getByTestId('kiosk-result').first().waitFor({ timeout: 10000 }); await k.waitForTimeout(600);
  ok('D3 打字 kele 出可乐', (await k.getByTestId('kiosk-result').first().textContent())?.includes('可乐') ?? false); await k.screenshot({ path: shots + 'k2-search.png' });
  await k.getByTestId('kiosk-result').first().click(); await k.getByTestId('kiosk-result-map').waitFor(); await k.waitForTimeout(1500);
  const hasRoute = await k.locator('.kiosk-route').count(); const hasTarget = await k.locator('.kiosk-target').count();
  ok('D6 结果地图：货架闪烁 + 路线', hasTarget >= 1 && hasRoute >= 1, `target=${hasTarget} route=${hasRoute}`);
  ok('D6 显示有货/缺货不显示数量', (await k.locator('.kiosk .stock').count()) >= 1 && !((await k.locator('.kiosk .result').textContent()) ?? '').match(/\b\d+ ?件/));
  await k.screenshot({ path: shots + 'k3-result-map.png' });
  await k.getByTestId('kiosk-call').click(); await k.getByTestId('kiosk-help').waitFor(); ok('D7 叫员工倒计时', await k.locator('.kiosk .help .count').isVisible()); await k.screenshot({ path: shots + 'k4-help.png' });
  await kctx.close();

  // 4. 手机库存员问机器人
  const mctx = await browser.newContext({ ...devices['Pixel 5'], locale: 'zh-CN', reducedMotion: 'reduce' }); const m = await mctx.newPage();
  m.on('pageerror', (e) => console.error('PAGEERROR', e.message));
  await m.goto(BASE + '/'); await m.getByTestId('mode-phone').click(); await m.getByTestId('company').fill('DEMO1'); await m.getByTestId('phone').fill('0120000009');
  for (const d of '222222') await m.locator(`.keypad [data-key="${d}"]`).click();
  await m.getByTestId('home-grid').waitFor({ timeout: 15000 });
  await m.goto(BASE + '/m/help'); await m.getByTestId('bot-input').waitFor({ timeout: 15000 });
  await m.getByTestId('bot-input').fill('可乐放哪里'); await m.getByTestId('bot-send').click();
  await m.waitForFunction(() => document.querySelectorAll('[data-testid="bot-answer"]').length >= 2, null, { timeout: 15000 });
  const ans = await m.getByTestId('bot-answer').last().textContent(); ok('C5 机器人回答可乐位置 A-01-1', (ans ?? '').includes('A-01-1'), ans ?? '');
  await m.waitForTimeout(500); await m.screenshot({ path: shots + 'k5-mobile-bot.png' });
  // 顾客呼叫：库存员工单列表看到大屏呼叫
  await m.goto(BASE + '/m/tickets'); await m.waitForTimeout(1500); await m.screenshot({ path: shots + 'k6-mobile-tickets.png' });
  await mctx.close();
} catch (e) { console.error('E2E ERROR', e); process.exitCode = 1; }
finally { await browser.close(); }
for (const [s, n, e] of results) console.log(s, n, e);
console.log(results.filter((r) => r[0] === 'PASS').length + '/' + results.length + ' passed');
