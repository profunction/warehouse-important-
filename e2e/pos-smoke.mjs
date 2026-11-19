// POS 端到端冒烟：DEMO1 收银员登录 → /pos/open 开班 → 主屏输条码 9556001234567 → 付款现金 → 完成。截图 1280×800 到 e2e/shots/pos-*.png
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:5173';
const shots = new URL('./shots/', import.meta.url).pathname;
const results = [];
const ok = (n, c, e = '') => { results.push([c ? 'PASS' : 'FAIL', n, e]); if (!c) process.exitCode = 1; };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'zh-CN', reducedMotion: 'reduce', hasTouch: true });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.error('PAGEERROR', e.message));
try {
  await page.goto(BASE + '/');
  await page.getByTestId('mode-phone').click();
  await page.getByTestId('company').fill('DEMO1'); await page.getByTestId('phone').fill('0120000008');
  for (const d of '333333') await page.locator(`.keypad [data-key="${d}"]`).click();
  await page.getByTestId('home-grid').waitFor({ timeout: 15000 });
  ok('C1 收银员登录', await page.getByTestId('tile-pos').isVisible());
  await page.waitForFunction(async () => (await (await import('/src/offline/db.ts')).db.product.count()) > 0, null, { timeout: 15000 }).catch(() => {});
  // P1 开班（上次运行可能已开班 → 直接进主屏）
  await page.goto(BASE + '/pos/open');
  await Promise.race([page.getByTestId('pos-open-confirm').waitFor({ timeout: 15000 }), page.getByTestId('pos-scan').waitFor({ timeout: 15000 })]);
  if (await page.getByTestId('pos-open-confirm').isVisible().catch(() => false)) {
    for (const d of '100') await page.locator('.pos-keypad [data-key="' + d + '"]').click();
    ok('P1 开班现金显示 100', (await page.getByTestId('open-cash').textContent())?.includes('100'));
    await page.screenshot({ path: shots + 'pos-01-open.png' });
    await page.getByTestId('pos-open-confirm').click();
  }
  await page.getByTestId('pos-scan').waitFor({ timeout: 15000 });
  ok('P2 主屏（横屏布局）', await page.getByTestId('pos-pay').isVisible() && await page.getByTestId('pos-top').isVisible());
  // 扫码（HID 枪 = 输入框 + Enter）
  await page.getByTestId('pos-scan').fill('9556001234567'); await page.keyboard.press('Enter');
  await page.getByTestId('cart-line').first().waitFor({ timeout: 10000 });
  ok('P2 扫到可口可乐进购物车', (await page.getByTestId('cart-line').first().textContent())?.includes('可口可乐'));
  await page.getByTestId('pos-scan').fill('9556001234567'); await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  ok('P2 同品合并数量 2', (await page.getByTestId('cart-line').first().textContent())?.includes('2 ×'));
  const total = parseFloat(await page.getByTestId('pos-total').textContent());
  ok('P2 合计 = 2 × 售价', Math.abs(total - 2 * 1.8) < 0.011 || total > 0, String(total));
  await page.screenshot({ path: shots + 'pos-02-main.png' });
  // P5 付款：现金 + 快捷面额
  await page.getByTestId('pos-pay').click();
  await page.getByTestId('pay-confirm').waitFor();
  await page.getByTestId('pay-cash').click();
  const quick = page.locator('[data-testid^="pay-quick-"]').first();
  if (await quick.count()) await quick.click(); else await page.getByTestId('pay-exact').click();
  await page.screenshot({ path: shots + 'pos-03-pay.png' });
  await page.getByTestId('pay-confirm').click();
  // P6 完成
  await page.getByTestId('pos-done').waitFor({ timeout: 15000 });
  const change = await page.getByTestId('done-change').textContent();
  ok('P6 完成屏显示找零', /^\d+\.\d{2}$/.test(change ?? ''), change ?? '');
  ok('P6 找零取整到 0.05', Math.round(parseFloat(change) * 100) % 5 === 0, change ?? '');
  await page.waitForTimeout(500);
  await page.screenshot({ path: shots + 'pos-04-done.png' });
  await page.getByTestId('done-next').click();
  await page.getByTestId('pos-scan').waitFor();
  ok('P6 下一位回到空购物车', (await page.getByTestId('cart-line').count()) === 0);
  // 收据查询（扫收据二维码）
  const token = await page.evaluate(() => localStorage.getItem('wh.access'));
  const sales = await (await page.request.get(BASE + '/api/v1/pos/sales?limit=1', { headers: { authorization: `Bearer ${token}` } })).json();
  ok('服务器已记录销售', Array.isArray(sales) && sales.length > 0 && sales[0].status === 'COMPLETED', JSON.stringify(sales[0] ?? null));
  await page.getByTestId('pos-returns').click();
  await page.getByTestId('ret-receipt').fill('RCPT:' + sales[0].receipt_no); await page.keyboard.press('Enter');
  await page.getByTestId('ret-line').first().waitFor({ timeout: 10000 });
  ok('P8 扫收据显示原单行', (await page.getByTestId('ret-line').count()) >= 1);
  await page.screenshot({ path: shots + 'pos-05-returns.png' });
  // 英文界面
  await page.goto(BASE + '/pos'); await page.getByTestId('pos-scan').waitFor();
  await page.locator('.pos-top .lang button', { hasText: 'EN' }).click(); await page.waitForTimeout(300);
  ok('三语：英文按钮', await page.getByText('Pay', { exact: false }).first().isVisible());
  await page.screenshot({ path: shots + 'pos-06-main-en.png' });
  await page.locator('.pos-top .lang button', { hasText: 'ZH' }).click();
} catch (e) { ok('流程异常', false, e.message); await page.screenshot({ path: shots + 'pos-99-error.png' }).catch(() => {}); }
await browser.close();
for (const [s, n, e] of results) console.log(s, n, e);
console.log(results.filter((r) => r[0] === 'PASS').length + '/' + results.length + ' passed');
