// 自助申请端到端：登录页两个入口 → 员工申请加入 DEMO1 → 老板网页批准 → 员工登录；开新店（宽屏）→ 公司代码 → 进入
import { chromium, devices } from 'playwright';
import { fileURLToPath } from 'node:url';
const BASE = process.env.BASE || 'http://localhost:5173';
const shots = fileURLToPath(new URL('./shots/', import.meta.url));
const results = []; const ok = (n, c, e = '') => { results.push([c ? 'PASS' : 'FAIL', n, e]); if (!c) process.exitCode = 1; };
const b = await chromium.launch(); const ph = '016' + String(Date.now()).slice(-7);
try {
  const m = await (await b.newContext({ ...devices['Pixel 7'], locale: 'zh-CN', reducedMotion: 'reduce' })).newPage();
  await m.goto(BASE + '/'); await m.getByTestId('link-join').waitFor(); ok('登录页有两个入口', await m.getByTestId('link-signup').isVisible());
  await m.screenshot({ path: shots + 'su-01-login.png' });
  await m.getByTestId('link-join').click(); await m.getByTestId('join-code').fill('DEMO1'); await m.getByTestId('join-shop').waitFor(); ok('输公司代码显示店名', (await m.getByTestId('join-shop').textContent()).includes('示范小店'));
  await m.getByTestId('join-name').fill('新来的阿华'); await m.getByTestId('join-phone').fill(ph); await m.getByTestId('join-role-CASHIER').click(); await m.getByTestId('join-pin').fill('778899'); await m.getByTestId('join-pin2').fill('778899');
  await m.screenshot({ path: shots + 'su-02-join.png' });
  await m.getByTestId('join-submit').click(); await m.getByTestId('join-done').waitFor(); ok('申请送出', true); await m.screenshot({ path: shots + 'su-03-join-done.png' });
  // 老板网页批准
  const w = await (await b.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN', reducedMotion: 'reduce' })).newPage();
  await w.goto(BASE + '/'); await w.getByTestId('mode-phone').click(); await w.getByTestId('company').fill('DEMO1'); await w.getByTestId('phone').fill('0120000001'); for (const d of '111111') await w.locator(`.keypad [data-key="${d}"]`).click();
  await w.waitForURL(/\/w\//); await w.goto(BASE + '/w/users'); await w.getByTestId('join-panel').waitFor(); ok('用户管理显示申请', await w.getByTestId('join-row').filter({ hasText: '新来的阿华' }).isVisible());
  await w.screenshot({ path: shots + 'su-04-approve.png' });
  await w.getByTestId('join-row').filter({ hasText: '新来的阿华' }).getByTestId('join-approve').click(); await w.getByText('已加入').waitFor(); ok('老板批准', true);
  // 员工查状态并登录
  await m.getByTestId('join-check').click(); await m.getByTestId('join-status').waitFor(); ok('员工看到已批准', (await m.getByTestId('join-status').textContent()).includes('批准'));
  await m.goto(BASE + '/'); await m.getByTestId('mode-phone').click(); await m.getByTestId('company').fill('DEMO1'); await m.getByTestId('phone').fill(ph); for (const d of '778899') await m.locator(`.keypad [data-key="${d}"]`).click();
  await m.waitForURL(/\/m/, { timeout: 15000 }); ok('员工用自己设的 PIN 登录', true);
  // 开新店
  const s = await (await b.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN', reducedMotion: 'reduce' })).newPage();
  await s.goto(BASE + '/signup'); await s.getByTestId('su-shop').fill('Kedai Test ' + ph.slice(-3)); await s.getByTestId('su-name').fill('测试老板'); await s.getByTestId('su-phone').fill(ph); await s.getByTestId('su-pin').fill('121212'); await s.getByTestId('su-pin2').fill('121212');
  await s.screenshot({ path: shots + 'su-05-signup.png' });
  await s.getByTestId('su-submit').click(); await s.getByTestId('signup-done').waitFor(); const code = (await s.getByTestId('signup-code').textContent()).trim(); ok('开店显示公司代码', /^[A-Z0-9]{3,8}$/.test(code), code);
  await s.screenshot({ path: shots + 'su-06-signup-done.png' });
  await s.getByTestId('signup-enter').click(); await s.waitForURL(/\/w\//, { timeout: 15000 }); ok('一键进入新店后台', true);
} catch (e) { ok('流程中断', false, String(e).slice(0, 300)); }
await b.close();
for (const r of results) console.log(r.join('  ')); console.log(`${results.filter((r) => r[0] === 'PASS').length}/${results.length} passed`);
