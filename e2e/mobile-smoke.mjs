// 手机端端到端冒烟：登录 → 首页 → 收货（键盘枪模拟）→ 完成 → 查询 → 离线补货 → 恢复同步
import { fileURLToPath } from 'node:url';
import { chromium, devices } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:5173';
const shots = fileURLToPath(new URL('./shots/', import.meta.url));
const results = [];
const ok = (n, c, e = '') => { results.push([c ? 'PASS' : 'FAIL', n, e]); if (!c) process.exitCode = 1; };
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['Pixel 5'], permissions: [], locale: 'zh-CN', reducedMotion: 'reduce' });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.error('PAGEERROR', e.message));
const wedge = async (code) => { for (const ch of code) await page.keyboard.press(ch); await page.keyboard.press('Enter'); };  // 模拟 HID 扫描枪
try {
  await page.goto(BASE + '/');
  await page.getByTestId('mode-phone').click();
  await page.getByTestId('company').fill('DEMO1'); await page.getByTestId('phone').fill('0120000009');
  for (const d of '222222') await page.locator(`.keypad [data-key="${d}"]`).click();
  await page.getByTestId('home-grid').waitFor({ timeout: 15000 });
  await page.screenshot({ path: shots + '01-home.png' });
  const tiles = await page.locator('.home-tile').count(); ok('M2 首页四个按钮', tiles === 4, String(tiles));
  ok('M2 首页含收货/补货/盘点/查询', await page.getByTestId('tile-receive').isVisible() && await page.getByTestId('tile-refill').isVisible() && await page.getByTestId('tile-count').isVisible() && await page.getByTestId('tile-lookup').isVisible());
  // 等首次同步完成
  await page.waitForFunction(async () => (await (await import('/src/offline/db.ts')).db.product.count()) > 0, null, { timeout: 15000 }).catch(() => {});
  // 先查一次当前总量，后面按增量比较（测试可重复跑）
  await page.getByTestId('tile-lookup').click(); await page.getByTestId('scan-area').waitFor();
  await wedge('9556001234567'); await page.getByTestId('lookup-result').waitFor();
  const base = parseFloat((await page.getByTestId('total-qty').textContent()) ?? '0') || 0;
  await page.getByTestId('back').click(); await page.getByTestId('back').click();
  // 收货
  await page.getByTestId('tile-receive').click();
  // 第二阶段起收货先列待收 PO；示范公司有 PO 时点无单收货
  await Promise.race([page.getByTestId('scan-area').waitFor({ timeout: 15000 }), page.getByTestId('receive-no-po').waitFor({ timeout: 15000 })]);
  if (await page.getByTestId('receive-no-po').isVisible()) await page.getByTestId('receive-no-po').click();
  await page.getByTestId('scan-area').waitFor();
  await page.screenshot({ path: shots + '02-receive-scan.png' });
  await wedge('9556001234567');
  await page.getByTestId('keypad').waitFor({ timeout: 5000 });
  ok('W2 扫到产品显示名称', await page.getByText('可口可乐 325ml').isVisible());
  ok('W3 默认放后仓 S-01', (await page.locator('.prod-head .k').textContent())?.includes('S-01') ?? false);
  await page.locator('.keypad [data-key="2"]').click(); await page.locator('.keypad [data-key="4"]').click();
  ok('T4 数量显示 24', (await page.getByTestId('qty-value').textContent()) === '24');
  await page.screenshot({ path: shots + '03-receive-qty.png' });
  await page.getByTestId('qty-confirm').click();
  await page.getByTestId('finish').waitFor();
  ok('W5 回到扫描并显示上一个', await page.getByText('上一个').isVisible());
  await page.getByTestId('finish').click();
  await page.getByTestId('done-screen').waitFor();
  ok('完成屏', await page.getByText('收货完成！').isVisible());
  await page.screenshot({ path: shots + '04-receive-done.png' });
  await page.getByTestId('done-home').click();
  // 查询（在线）
  await page.getByTestId('tile-lookup').click(); await page.getByTestId('scan-area').waitFor();
  await page.waitForTimeout(1500);  // 等 outbox 上传
  await wedge('9556001234567');
  await page.getByTestId('lookup-result').waitFor();
  const total = await page.getByTestId('total-qty').textContent();
  ok('C4 查询总库存 +24', parseFloat(total ?? '0') === base + 24, `${base} → ${total}`);
  ok('C4 库存员看不到成本', !(await page.getByText('成本').isVisible().catch(() => false)));
  await page.screenshot({ path: shots + '05-lookup.png' });
  await page.getByTestId('back').click(); await page.getByTestId('back').click();
  // 离线补货：扫货架 A-01-1，扫产品，设为位置，输 5
  await ctx.setOffline(true);
  await page.getByTestId('tile-refill').click();
  await page.getByTestId('bar-offline').waitFor({ timeout: 5000 });
  ok('S2 离线横条', await page.getByTestId('bar-offline').isVisible());
  await page.getByTestId('refill-scan').click(); await page.getByTestId('scan-area').waitFor();
  await wedge('LOC:DEMO1:A-01-1');
  await page.getByText('A-01-1').first().waitFor();
  await wedge('9556001234567');
  // 首次放这个货架会问"设为位置？"，已登记过则直接进数量
  await Promise.race([page.getByTestId('confirm-ok').waitFor(), page.getByTestId('keypad').waitFor()]);
  if (await page.getByTestId('confirm-ok').isVisible().catch(() => false)) { ok('S3 首次放货架询问设为位置', true); await page.getByTestId('confirm-ok').click(); }
  await page.getByTestId('keypad').waitFor();
  await page.locator('.keypad [data-key="5"]').click();
  await page.screenshot({ path: shots + '06-refill-offline.png' });
  await page.getByTestId('qty-confirm').click();
  await page.waitForTimeout(500);
  const pendingTxt = await page.getByTestId('bar-offline').textContent();
  ok('S1 离线记录进 outbox', /1 笔待上传|1 /.test(pendingTxt ?? ''), pendingTxt ?? '');
  // 离线查询用本地（返回 → 完成屏 → 首页）
  await page.getByTestId('back').click();
  await page.getByTestId('done-screen').waitFor(); ok('补货完成屏', await page.getByText('补货完成！').isVisible());
  await page.getByTestId('done-home').click();
  await page.getByTestId('tile-lookup').click(); await page.getByTestId('scan-area').waitFor();
  await wedge('9556001234567');
  await page.getByTestId('lookup-result').waitFor();
  const offTotal = await page.getByTestId('total-qty').textContent();
  ok('C4 离线查询用本地快照，总量不变，A-01-1 有货', parseFloat(offTotal ?? '0') === base + 24 && await page.getByText('A-01-1').first().isVisible(), offTotal ?? '');
  ok('离线数据提示', await page.getByText('离线数据').isVisible());
  await page.screenshot({ path: shots + '07-lookup-offline.png' });
  // 恢复在线 → 自动上传
  await ctx.setOffline(false);
  await page.waitForFunction(() => !document.querySelector('[data-testid="bar-offline"]'), null, { timeout: 15000 });
  await page.waitForTimeout(2500);
  await page.getByTestId('back').click(); await page.getByTestId('back').click();
  await page.getByTestId('tile-lookup').click(); await page.getByTestId('scan-area').waitFor();
  await wedge('9556001234567');
  await page.getByTestId('lookup-result').waitFor();
  ok('S1 恢复后服务器有 A-01-1', await page.getByText('A-01-1').first().isVisible() && !(await page.getByText('离线数据').isVisible().catch(() => false)));
  await page.screenshot({ path: shots + '08-lookup-synced.png' });
  // 语言切换
  await page.getByTestId('back').click(); await page.getByTestId('back').click();
  await page.locator('.lang', { hasText: 'BM' }).click();
  ok('M3 切换马来文', await page.getByText('Terima').isVisible());
  await page.locator('.lang', { hasText: 'EN' }).click();
  ok('M3 切换英文', await page.getByText('Receive').isVisible());
  await page.screenshot({ path: shots + '09-home-en.png' });
  await page.locator('.lang', { hasText: '中' }).click();
  // 退出二次确认
  await page.getByTestId('logout').click(); ok('M20 退出二次确认', await page.getByTestId('confirm-ok').isVisible());
  await page.getByTestId('confirm-ok').click(); await page.getByTestId('mode-scan').waitFor(); ok('退出回登录', true);
} catch (e) { ok('流程中断', false, String(e).slice(0, 300)); await page.screenshot({ path: shots + 'error.png' }).catch(() => {}); }
await browser.close();
for (const [s, n, e] of results) console.log(s.padEnd(5), n, e ? '— ' + e : '');
console.log(`${results.filter((r) => r[0] === 'PASS').length}/${results.length} passed`);
