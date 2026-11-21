// 电脑大屏截图（1440×900）：登录、库存员首页、收货输数量、老板登录后的网页后台、收银
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
const BASE = process.env.BASE || 'http://localhost:5173';
const shots = fileURLToPath(new URL('./shots/', import.meta.url));
const b = await chromium.launch();
const ctxOpt = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: 'zh-CN', reducedMotion: 'reduce' };
const login = async (p, phone, pin) => { await p.goto(BASE + '/'); await p.getByTestId('mode-phone').click(); await p.getByTestId('company').fill('DEMO1'); await p.getByTestId('phone').fill(phone); for (const d of pin) await p.locator(`.keypad [data-key="${d}"]`).click(); await p.waitForURL(/\/(m|w|pos)/, { timeout: 15000 }); await p.waitForTimeout(1200); };
const shot = async (p, n, w = 900) => { await p.waitForTimeout(w); await p.screenshot({ path: `${shots}desk-${n}.png` }); console.log('ok', n, p.url()); };
try {
  { const c = await b.newContext(ctxOpt); const p = await c.newPage(); await p.goto(BASE + '/'); await p.getByTestId('mode-phone').click(); await shot(p, '01-login');
    await p.getByTestId('company').fill('DEMO1'); await p.getByTestId('phone').fill('0120000009'); for (const d of '222222') await p.locator(`.keypad [data-key="${d}"]`).click(); await p.waitForURL(/\/m/); await p.getByTestId('home-grid').waitFor(); await shot(p, '02-staff-home', 1500);
    await p.getByTestId('tile-receive').click(); await Promise.race([p.getByTestId('scan-area').waitFor({ timeout: 8000 }), p.getByTestId('receive-no-po').waitFor({ timeout: 8000 })]).catch(() => {}); await shot(p, '03-receive-list', 800);
    if (await p.getByTestId('receive-no-po').isVisible()) await p.getByTestId('receive-no-po').click(); await p.getByTestId('scan-area').waitFor();
    await p.keyboard.type('9556001234567'); await p.keyboard.press('Enter'); await p.getByTestId('keypad').waitFor({ timeout: 8000 }).catch(() => {}); await shot(p, '04-receive-qty', 800);
    await c.close(); }
  { const c = await b.newContext(ctxOpt); const p = await c.newPage(); await login(p, '0120000001', '111111'); await shot(p, '05-boss-landing', 1500); await c.close(); }
  { const c = await b.newContext(ctxOpt); const p = await c.newPage(); await login(p, '0120000008', '333333'); await p.goto(BASE + '/pos'); await p.waitForTimeout(1500);
    if (p.url().includes('/pos/open')) { await shot(p, '06-pos-open'); const btn = p.getByTestId('pos-open-submit').or(p.getByRole('button', { name: /开始收银|开班/ })).first(); if (await btn.isVisible()) await btn.click(); await p.waitForTimeout(1500); }
    const scan = p.locator('.pos-scan input').first(); for (const bc of ['9556001234567', '9556002000011', '9556003000022']) { await scan.fill(bc); await scan.press('Enter'); await p.waitForTimeout(400); }
    await shot(p, '07-pos-main', 1000); await c.close(); }
} catch (e) { console.error('ERR', e.message); }
await b.close();
