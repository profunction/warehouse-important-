// 网页端截图：切到指定预设（默认 stitch，顶部导航）截仪表板、产品、库存、外观页，然后恢复原主题
import { chromium } from 'playwright';
const BASE = 'http://localhost:5173'; const preset = process.argv[2] ?? 'stitch';
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', deviceScaleFactor: 2 }); const p = await ctx.newPage();
p.on('pageerror', (e) => console.error('PAGEERROR', e.message));
await p.goto(BASE + '/'); await p.getByTestId('mode-phone').click(); await p.getByTestId('company').fill('DEMO1'); await p.getByTestId('phone').fill('0120000001');
for (const d of '111111') await p.locator(`.keypad [data-key="${d}"]`).click();
await p.waitForURL(/\/(m|w)(\/|$)/, { timeout: 15000 }).then(() => p.waitForTimeout(800));
const token = await p.evaluate(() => localStorage.getItem('wh.access'));
const h = { authorization: `Bearer ${token}` };
const me = await (await p.request.get(BASE + '/api/v1/me', { headers: h })).json(); const prev = me.company.settings?.theme ?? null;
const put = (theme) => p.request.put(BASE + '/api/v1/company/settings', { headers: h, data: { settings: { theme } } });
await put({ preset, font: 'sans', radius: 12, home: 'tiles', density: 'normal', nav: 'top' });
for (const [path, name, wait] of [['dashboard', 'dashboard', '库存中枢'], ['products', 'products', '产品'], ['stock', 'stock', '库存查询'], ['theme', 'theme', '实时预览']]) {
  await p.goto(BASE + '/w/' + path); await p.getByText(wait).first().waitFor({ timeout: 15000 }); await p.waitForTimeout(900);
  await p.screenshot({ path: `e2e/shots/w20-${preset}-${name}.png` });
}
await put(prev ?? { preset: 'minimal', font: 'serif', radius: 0, home: 'list', density: 'normal' });
await b.close(); console.log('ok');
