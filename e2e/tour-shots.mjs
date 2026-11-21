// 全系统导览截图：手机（老板、库存员）、收银、网页、大屏。输出 e2e/shots/tour-*.png
import { chromium, devices } from 'playwright';
import { fileURLToPath } from 'node:url';
const BASE = process.env.BASE || 'http://localhost:5173';
const shots = fileURLToPath(new URL('./shots/', import.meta.url));
const b = await chromium.launch();
const J = async (path, body, token) => { const r = await fetch(BASE + '/api/v1' + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined }); return r.json(); };
const login = async (p, phone, pin) => {
  await p.goto(BASE + '/'); await p.getByTestId('mode-phone').click(); await p.getByTestId('company').fill('DEMO1'); await p.getByTestId('phone').fill(phone);
  for (const d of pin) await p.locator(`.keypad [data-key="${d}"]`).click();
  await p.waitForURL(/\/(m|w|pos)/, { timeout: 15000 }); await p.waitForTimeout(1200);
};
const shot = async (p, name, wait = 900) => { await p.waitForTimeout(wait); await p.screenshot({ path: `${shots}tour-${name}.png` }); console.log('ok', name); };
const phone = { ...devices['Pixel 7'], locale: 'zh-CN', reducedMotion: 'reduce' };
try {
  // 老板手机
  { const c = await b.newContext(phone); const p = await c.newPage();
    await p.goto(BASE + '/'); await shot(p, 'm00-login', 600);
    await login(p, '0120000001', '111111'); await p.goto(BASE + '/m'); await p.getByTestId('home-grid').waitFor(); await shot(p, 'm01-boss-home');
    await p.goto(BASE + '/m/reports'); await shot(p, 'm02-boss-reports', 2500);
    await p.goto(BASE + '/m/approvals'); await shot(p, 'm03-boss-approvals', 2000);
    await p.goto(BASE + '/m/delegation'); await shot(p, 'm04-boss-delegation', 1500);
    await c.close(); }
  // 库存员手机
  { const c = await b.newContext(phone); const p = await c.newPage();
    await login(p, '0120000009', '222222'); await p.goto(BASE + '/m'); await p.getByTestId('home-grid').waitFor(); await shot(p, 'm10-staff-home');
    await p.goto(BASE + '/m/receive'); await shot(p, 'm11-receive-po', 2000);
    await p.goto(BASE + '/m/count'); await shot(p, 'm12-count', 2000);
    await p.goto(BASE + '/m/help'); await p.waitForTimeout(800);
    const inp = p.getByTestId('bot-input'); if (await inp.isVisible()) { await inp.fill('可乐放哪里'); await inp.press('Enter'); }
    await shot(p, 'm13-bot', 2500);
    await c.close(); }
  // 收银平板
  { const c = await b.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, locale: 'zh-CN', reducedMotion: 'reduce' }); const p = await c.newPage();
    await login(p, '0120000008', '333333'); await p.goto(BASE + '/pos'); await p.waitForTimeout(1500);
    if (p.url().includes('/pos/open')) { await shot(p, 'p00-open'); const btn = p.getByRole('button', { name: /开始收银|开班/ }).first(); if (await btn.isVisible()) await btn.click(); await p.waitForTimeout(1500); }
    const scan = p.locator('input').first(); if (await scan.isVisible()) { for (const bc of ['9556001234567', '9556002000011', '9556003000022']) { await scan.fill(bc); await scan.press('Enter'); await p.waitForTimeout(500); } }
    await shot(p, 'p01-pos-main', 1200);
    await c.close(); }
  // 网页（老板）
  { const c = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: 'zh-CN', reducedMotion: 'reduce' }); const p = await c.newPage();
    await login(p, '0120000001', '111111');
    for (const [path, name, w] of [['dashboard', 'w01-dashboard', 2000], ['orders', 'w02-orders', 2000], ['counts', 'w03-counts', 1800], ['sales', 'w04-sales', 2200], ['ar', 'w05-ar', 1800], ['einvoice', 'w06-einvoice', 1800], ['map', 'w07-map', 2200], ['integrations', 'w08-integrations', 1800], ['tickets', 'w09-tickets', 1800]]) { await p.goto(`${BASE}/w/${path}`); await shot(p, name, w); }
    await c.close(); }
  // 大屏
  { const boss = (await J('/auth/login', { company_code: 'DEMO1', phone: '0120000001', pin: '111111' })).access_token;
    const me = await J('/me', null, boss);
    const k = await J('/api-keys', { name: '导览大屏', scope: 'KIOSK', site_id: me.site?.id ?? me.sites?.[0]?.id }, boss);
    const c = await b.newContext({ viewport: { width: 1080, height: 1920 }, locale: 'zh-CN', reducedMotion: 'reduce' }); const p = await c.newPage();
    await p.goto(`${BASE}/kiosk?key=${k.key}`); await shot(p, 'k01-kiosk-idle', 2500);
    await c.close(); }
} catch (e) { console.error('ERR', e.message); }
await b.close();
