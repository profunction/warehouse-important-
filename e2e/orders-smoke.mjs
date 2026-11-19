// 模块 A 端到端冒烟：DEMO1 老板网页 /w/orders 手动建 PO（截图）→ 库存员手机 /m/receive 选 PO 收货（截图）→ 完成对单 → PO 已收齐
// 登录与扫码方式同 e2e/web-shot.mjs、e2e/mobile-smoke.mjs（手机模式登录 + HID 扫描枪模拟）
import { chromium, devices } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:5173';
const shots = new URL('./shots/', import.meta.url).pathname;
const results = [];
const ok = (n, c, e = '') => { results.push([c ? 'PASS' : 'FAIL', n, e]); if (!c) process.exitCode = 1; };
const browser = await chromium.launch();
const j = async (page, path, body, token, method) => { const r = await page.request.fetch(BASE + '/api/v1' + path, { method: method ?? (body ? 'POST' : 'GET'), headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, data: body ? JSON.stringify(body) : undefined }); const d = await r.json(); if (!r.ok()) throw new Error(path + ' ' + JSON.stringify(d)); return d; };
const loginPhone = async (page, phone, pin) => {
  await page.goto(BASE + '/'); await page.getByTestId('mode-phone').click();
  await page.getByTestId('company').fill('DEMO1'); await page.getByTestId('phone').fill(phone);
  for (const d of pin) await page.locator(`.keypad [data-key="${d}"]`).click();
  await page.getByTestId('home-grid').waitFor({ timeout: 15000 });
  return page.evaluate(() => localStorage.getItem('wh.access'));
};
let poNo = '';
// ---------- 老板：网页手动建 PO ----------
const wctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', locale: 'zh-CN' });
const w = await wctx.newPage(); w.on('pageerror', (e) => console.error('PAGEERROR', e.message));
try {
  const boss = await loginPhone(w, '0120000001', '111111');
  // 示范数据没有供应商：没有就建一个
  let sups = await j(w, '/suppliers', null, boss);
  if (!sups.length) { await j(w, '/suppliers', { name: '示范供应商', lead_time_days: 2 }, boss); sups = await j(w, '/suppliers', null, boss); }
  await w.goto(BASE + '/w/orders?tab=new'); await w.getByTestId('tab-new').waitFor({ timeout: 15000 });
  await w.getByTestId('new-supplier').selectOption(sups[0].id);
  await w.getByTestId('new-search').fill('可乐'); await w.getByTestId('new-cand').first().click();
  await w.getByTestId('new-qty').fill('24');
  await w.screenshot({ path: shots + 'o1-web-new-po.png' });
  await w.getByTestId('create-po').click();
  await w.getByTestId('po-detail').waitFor({ timeout: 15000 });
  poNo = (await w.locator('[data-testid="po-detail"] h2').textContent())?.match(/PO-\d{4}-\d{4}/)?.[0] ?? '';
  ok('B1 老板网页手动建 PO 直接 SENT', /PO-\d{4}-\d{4}/.test(poNo) && (await w.getByText('已发出').first().isVisible()), poNo);
  await w.screenshot({ path: shots + 'o2-web-po-detail.png' });
  const pdf = await w.request.get(BASE + `/api/v1/purchase-orders/${new URL(w.url()).searchParams.get('id')}/pdf`, { headers: { authorization: `Bearer ${boss}` } });
  ok('PO PDF 接口 200', pdf.status() === 200 && (pdf.headers()['content-type'] ?? '').includes('pdf'));
} catch (e) { ok('网页流程中断', false, String(e).slice(0, 300)); await w.screenshot({ path: shots + 'o-error-web.png' }).catch(() => {}); }
await wctx.close();

// ---------- 库存员：手机选 PO 收货 ----------
const mctx = await browser.newContext({ ...devices['Pixel 5'], permissions: [], locale: 'zh-CN', reducedMotion: 'reduce' });
const m = await mctx.newPage(); m.on('pageerror', (e) => console.error('PAGEERROR', e.message));
const wedge = async (code) => { for (const ch of code) await m.keyboard.press(ch); await m.keyboard.press('Enter'); };
try {
  const staff = await loginPhone(m, '0120000009', '222222');
  await m.waitForFunction(async () => (await (await import('/src/offline/db.ts')).db.product.count()) > 0, null, { timeout: 15000 }).catch(() => {});
  const look0 = await j(m, '/stock/lookup/9556001234567', null, staff); const base = Number(look0.total_qty);
  await m.getByTestId('tile-receive').click();
  await m.getByTestId('po-list').waitFor({ timeout: 15000 });
  ok('W1 待收清单显示这张 PO', await m.getByTestId(`po-${poNo}`).isVisible(), poNo);
  await m.screenshot({ path: shots + 'o3-receive-po-list.png' });
  await m.getByTestId(`po-${poNo}`).click();
  await m.getByTestId('scan-area').waitFor({ timeout: 15000 });
  ok('W2 标题带 PO 号，列出应收 0/24', (await m.locator('.topbar .title').textContent())?.includes(poNo) && await m.getByText('0 / 24').isVisible());
  await wedge('19556001234564');   // 箱码 = 24
  await m.getByTestId('keypad').waitFor({ timeout: 5000 });
  ok('W2 扫到产品显示应收/已收', (await m.locator('.prod-head .k').textContent())?.includes('应收 24') ?? false);
  await m.locator('.keypad [data-key="1"]').click();
  await m.screenshot({ path: shots + 'o4-receive-qty.png' });
  await m.getByTestId('qty-confirm').click();
  await m.getByTestId('finish').waitFor({ timeout: 10000 });
  ok('W3 收 1 箱后已收 24 / 24', await m.getByText('24 / 24').isVisible());
  await m.screenshot({ path: shots + 'o5-receive-progress.png' });
  await m.getByTestId('finish').click();
  await m.getByTestId('done-screen').waitFor({ timeout: 15000 });
  ok('W5 完成屏：采购单已收齐、无差异', await m.getByText('采购单已收齐').isVisible() && await m.getByText('数量全部对上').isVisible());
  await m.screenshot({ path: shots + 'o6-receive-done.png' });
  const look1 = await j(m, '/stock/lookup/9556001234567', null, staff);
  ok('库存 +24（GRN 移动已入账）', Number(look1.total_qty) === base + 24, `${base} → ${look1.total_qty}`);
  const pend = await j(m, '/goods-receipts/pending', null, staff);
  ok('PO 不再在待收清单', !pend.some((p) => p.po_no === poNo));
  await m.getByTestId('done-home').click();
} catch (e) { ok('手机流程中断', false, String(e).slice(0, 300)); await m.screenshot({ path: shots + 'o-error-mobile.png' }).catch(() => {}); }
await browser.close();
for (const [s, n, e] of results) console.log(s.padEnd(5), n, e ? '— ' + e : '');
console.log(`${results.filter((r) => r[0] === 'PASS').length}/${results.length} passed`);
