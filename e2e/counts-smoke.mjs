// 盘点端到端冒烟：DEMO1 老板网页 /w/counts 新建盘点指派库存员 → 库存员手机 /m/count 走一个货位 → 提交 → 老板手机 /m/approvals 批准
import { chromium, devices } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:5173';
const shots = new URL('./shots/', import.meta.url).pathname;
const results = [];
const ok = (n, c, e = '') => { results.push([c ? 'PASS' : 'FAIL', n, e]); if (!c) process.exitCode = 1; };
const browser = await chromium.launch();
const loginPhone = async (page, phone, pin) => {
  await page.goto(BASE + '/'); await page.getByTestId('mode-phone').click();
  await page.getByTestId('company').fill('DEMO1'); await page.getByTestId('phone').fill(phone);
  for (const d of pin) await page.locator(`.keypad [data-key="${d}"]`).click();
  await page.getByTestId('home-grid').waitFor({ timeout: 20000 });
  return page.evaluate(() => localStorage.getItem('wh.access'));
};
const wedge = async (page, code) => { for (const ch of code) await page.keyboard.press(ch); await page.keyboard.press('Enter'); };
try {
  // ---- 老板网页：新建盘点 ----
  const web = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', locale: 'zh-CN' });
  const w = await web.newPage(); w.on('pageerror', (e) => console.error('PAGEERROR', e.message));
  const bossToken = await loginPhone(w, '0120000001', '111111');
  const h = { authorization: `Bearer ${bossToken}` };
  const get = async (p) => (await w.request.get(BASE + '/api/v1' + p, { headers: h })).json();
  // 保证 S-01 有可乐库存（第一次跑时可能是空的）
  const loc = (await get('/locations')).find((l) => l.code === 'S-01');
  let atLoc = (await get(`/stock/by-location/${loc.id}`)).find((r) => r.barcode === '9556001234567');
  if (!atLoc || Number(atLoc.qty) <= 0) {
    await w.request.post(BASE + '/api/v1/movements', { headers: h, data: { barcode: '19556001234564', from_location_code: 'SUPPLIER', to_location_code: 'S-01', qty: 1, reason: 'RECEIVE' } });
    atLoc = (await get(`/stock/by-location/${loc.id}`)).find((r) => r.barcode === '9556001234567');
  }
  const systemQty = Number(atLoc.qty); const countQty = systemQty + 1;   // 故意多数 1 个，制造差异
  await w.goto(BASE + '/w/counts'); await w.getByTestId('new-count').waitFor({ timeout: 15000 });
  await w.getByTestId('new-count').click();
  await w.getByTestId('count-codes').fill('S-01');
  await w.getByTestId('count-assignee').waitFor();
  await w.waitForFunction(() => document.querySelector('[data-testid="count-assignee"]')?.options.length > 1, null, { timeout: 10000 });
  await w.getByTestId('count-assignee').selectOption({ label: '库存阿明（WAREHOUSE）' });
  await w.getByTestId('count-create').click();
  await w.getByText(/已建 CS-/).waitFor({ timeout: 10000 });
  const sessionNo = (await w.getByText(/已建 CS-/).textContent()).match(/CS-\d+/)[0];
  ok('G 老板网页新建盘点并指派', !!sessionNo, sessionNo);
  await w.waitForTimeout(500); await w.screenshot({ path: shots + 'c01-web-counts-created.png' });
  await web.close();

  // ---- 库存员手机：盘点 ----
  const m = await browser.newContext({ ...devices['Pixel 5'], permissions: [], locale: 'zh-CN', reducedMotion: 'reduce' });
  const p = await m.newPage(); p.on('pageerror', (e) => console.error('PAGEERROR', e.message));
  await loginPhone(p, '0120000009', '222222');
  await p.waitForFunction(async () => (await (await import('/src/offline/db.ts')).db.location.count()) > 0, null, { timeout: 20000 }).catch(() => {});
  await p.getByTestId('tile-count').click();
  await p.getByTestId('count-loc-S-01').waitFor({ timeout: 15000 });
  ok('K1 今日盘点显示货位 S-01', await p.getByTestId('count-loc-S-01').isVisible());
  const body1 = await p.content(); ok('K1 不显示系统量', !body1.includes('system_qty') && !body1.includes(`系统 ${systemQty}`));
  await p.screenshot({ path: shots + 'c02-count-list.png' });
  await p.getByTestId('count-loc-S-01').click();
  await p.getByTestId('scan-area').waitFor();
  await wedge(p, 'A-01-1');
  await p.getByTestId('error-screen').waitFor({ timeout: 5000 });
  ok('K2 扫错货位红屏', await p.getByText(/A-01-1/).first().isVisible());
  await p.screenshot({ path: shots + 'c03-count-wrong-location.png' });
  await p.getByTestId('error-screen').getByRole('button').click();
  await wedge(p, 'S-01');
  await p.getByTestId('counted-list').waitFor({ timeout: 5000 });
  ok('K3 扫对货位进入扫产品', await p.getByText('已数产品').isVisible());
  await wedge(p, '9556001234567');
  await p.getByTestId('keypad').waitFor({ timeout: 5000 });
  for (const d of String(countQty)) await p.locator(`.keypad [data-key="${d}"]`).click();
  ok('K4 数量显示', (await p.getByTestId('qty-value').textContent()) === String(countQty));
  await p.screenshot({ path: shots + 'c04-count-qty.png' });
  await p.getByTestId('qty-confirm').click();
  await p.getByTestId('counted-list').waitFor();
  ok('K3 已数清单含可乐', await p.getByTestId('counted-list').getByText('可口可乐 325ml').isVisible());
  await p.screenshot({ path: shots + 'c05-count-counted.png' });
  await p.getByTestId('loc-done').click();
  await p.getByTestId('count-submit').waitFor({ timeout: 10000 });
  ok('K5 货位完成后出现提交按钮', true);
  await p.getByTestId('count-submit').click();
  await p.getByTestId('done-screen').waitFor({ timeout: 15000 });
  ok('K6 绿屏已送主管审批', await p.getByText('已送主管审批').isVisible());
  await p.screenshot({ path: shots + 'c06-count-submitted.png' });
  await m.close();

  // ---- 老板手机：审批 ----
  const b = await browser.newContext({ ...devices['Pixel 5'], permissions: [], locale: 'zh-CN', reducedMotion: 'reduce' });
  const q = await b.newPage(); q.on('pageerror', (e) => console.error('PAGEERROR', e.message));
  await loginPhone(q, '0120000001', '111111');
  await q.getByTestId('tile-approvals').click();
  await q.getByTestId('approval-card').first().waitFor({ timeout: 15000 });
  ok('M1 待审批清单有盘点差异', await q.getByTestId('approval-card').filter({ hasText: '盘点差异' }).first().isVisible());
  await q.screenshot({ path: shots + 'c07-approvals-list.png' });
  await q.getByTestId('approval-card').filter({ hasText: sessionNo }).first().click();
  await q.getByTestId('variance-line').first().waitFor({ timeout: 10000 });
  const line = await q.getByTestId('variance-line').first().textContent();
  ok('M2 差异行显示系统/实数/差', line.includes(`系统 ${systemQty}`) && line.includes(`实数 ${countQty}`) && line.includes('+1'), line);
  await q.screenshot({ path: shots + 'c08-approval-detail.png' });
  await q.getByTestId('approve-btn').click();
  await q.getByTestId('done-screen').waitFor({ timeout: 15000 });
  ok('M2 批准完成屏', await q.getByText('已批准').isVisible());
  await q.screenshot({ path: shots + 'c09-approval-done.png' });
  const token = await q.evaluate(() => localStorage.getItem('wh.access'));
  const after = (await (await q.request.get(BASE + `/api/v1/stock/by-location/${loc.id}`, { headers: { authorization: `Bearer ${token}` } })).json()).find((r) => r.barcode === '9556001234567');
  ok('库存按差异 +1', Number(after.qty) === countQty, `${after?.qty}`);
  await b.close();
} catch (e) {
  console.error('ERROR', e); process.exitCode = 1;
  try { for (const c of browser.contexts()) for (const pg of c.pages()) await pg.screenshot({ path: shots + 'c-error.png' }); } catch { /* */ }
} finally { await browser.close(); }
for (const [s, n, e] of results) console.log(s, n, e);
console.log(`${results.filter((r) => r[0] === 'PASS').length}/${results.length} passed`);
