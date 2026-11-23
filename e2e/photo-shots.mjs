// 照片功能截图：产品页（缩略图 + 编辑里的照片框）、收银格子显示照片、手机查询的拍照按钮
import { chromium, devices } from 'playwright';
import { fileURLToPath } from 'node:url';
const BASE = process.env.BASE || 'http://localhost:5173';
const shots = fileURLToPath(new URL('./shots/', import.meta.url));
const b = await chromium.launch();
const login = async (p, phone, pin) => { await p.goto(BASE + '/'); await p.getByTestId('mode-phone').click(); await p.getByTestId('company').fill('DEMO1'); await p.getByTestId('phone').fill(phone); for (const d of pin) await p.locator(`.keypad [data-key="${d}"]`).click(); await p.waitForURL(/\/(m|w|pos)/, { timeout: 15000 }); await p.waitForTimeout(1500); };
try {
  { const c = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: 'zh-CN', reducedMotion: 'reduce' }); const p = await c.newPage();
    await login(p, '0120000001', '111111'); await p.goto(BASE + '/w/products'); await p.getByText('可口可乐 325ml').first().waitFor();
    await p.getByRole('row', { name: /可口可乐 325ml/ }).getByRole('button', { name: '编辑' }).click(); await p.getByTestId('photo-input').waitFor({ state: 'attached' }); await p.waitForTimeout(800);
    await p.screenshot({ path: shots + 'photo-01-products.png' }); console.log('ok products'); await c.close(); }
  { const c = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: 'zh-CN', reducedMotion: 'reduce' }); const p = await c.newPage();
    await login(p, '0120000008', '333333'); await p.goto(BASE + '/pos'); await p.waitForTimeout(2500);
    if (p.url().includes('/pos/open')) { await p.getByTestId('pos-open-confirm').click().catch(() => {}); await p.waitForTimeout(1500); }
    await p.getByTestId('pos-grid').waitFor(); await p.waitForTimeout(1200); await p.screenshot({ path: shots + 'photo-02-pos.png' }); console.log('ok pos'); await c.close(); }
  { const c = await b.newContext({ ...devices['Pixel 7'], locale: 'zh-CN', reducedMotion: 'reduce' }); const p = await c.newPage();
    await login(p, '0120000001', '111111'); await p.goto(BASE + '/m/lookup'); await p.getByTestId('scan-area').waitFor(); await p.keyboard.type('9556001234567'); await p.keyboard.press('Enter');
    await p.getByTestId('lookup-result').waitFor(); await p.waitForTimeout(800); await p.screenshot({ path: shots + 'photo-03-lookup.png' }); console.log('ok lookup'); await c.close(); }
} catch (e) { console.error('ERR', e.message); }
await b.close();
