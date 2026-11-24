// 顾客当场自助端到端：柜台二维码页登记会员（存电子发票资料）→ 企业记账申请 → 老板网页批准 → 收银找会员卖一单
//  → 收据链接（用局域网地址打开收银，收据才有公网链接）→ 顾客扫收据自己开电子发票
import { chromium, devices } from 'playwright';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
const lan = Object.values(networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address ?? 'localhost';
const BASE = process.env.BASE || `http://${lan}:5173`;
const shots = fileURLToPath(new URL('./shots/', import.meta.url));
const results = []; const ok = (n, c, e = '') => { results.push([c ? 'PASS' : 'FAIL', n, e]); if (!c) process.exitCode = 1; };
const b = await chromium.launch(); const ph = '015' + String(Date.now()).slice(-7); const brn = '2024' + String(Date.now()).slice(-8);
const login = async (p, phone, pin) => { await p.goto(BASE + '/'); await p.getByTestId('mode-phone').click(); await p.getByTestId('company').fill('DEMO1'); await p.getByTestId('phone').fill(phone); for (const d of pin) await p.locator(`.keypad [data-key="${d}"]`).click(); await p.waitForURL(/\/(m|w|pos)/, { timeout: 15000 }); await p.waitForTimeout(1200); };
try {
  const m = await (await b.newContext({ ...devices['Pixel 7'], locale: 'zh-CN', reducedMotion: 'reduce' })).newPage();
  await m.goto(BASE + '/c/DEMO1'); await m.getByTestId('cs-card').waitFor(); ok('柜台二维码页打开（不用登录）', await m.getByText('示范小店').first().isVisible());
  await m.getByTestId('cs-name').fill('林小姐'); await m.getByTestId('cs-phone').fill(ph); await m.getByTestId('cs-want-einv').check(); await m.getByTestId('cs-tin').fill('IG12345678901'); await m.getByTestId('cs-consent').check();
  await m.screenshot({ path: shots + 'cu-01-member.png' });
  await m.getByTestId('cs-submit-member').click(); await m.getByTestId('cs-done').waitFor(); ok('会员登记成功，有会员号', /^M\d{5}$/.test((await m.getByTestId('cs-member-no').textContent()).trim()));
  await m.screenshot({ path: shots + 'cu-02-member-done.png' });
  await m.goto(BASE + '/c/DEMO1'); await m.getByTestId('cs-tab-credit').click();
  await m.getByTestId('cr-company').fill('Syarikat Maju Sdn Bhd'); await m.getByTestId('cr-brn').fill(brn); await m.getByTestId('cr-address').fill('No 8, Jalan Maju, 50000 Kuala Lumpur'); await m.getByTestId('cr-contact').fill('Ali'); await m.getByTestId('cr-phone').fill('019' + ph.slice(3)); await m.getByTestId('cr-email').fill('ali@maju.my'); await m.getByTestId('cr-limit').fill('3000'); await m.getByTestId('cr-consent').check();
  await m.screenshot({ path: shots + 'cu-03-credit.png' });
  await m.getByTestId('cr-submit').click(); await m.getByTestId('cs-done').waitFor(); ok('企业记账申请送出', true);
  // 老板批准
  const w = await (await b.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN', reducedMotion: 'reduce' })).newPage();
  await login(w, '0120000001', '111111'); await w.goto(BASE + '/w/ar'); await w.getByTestId('credit-apps').waitFor();
  await w.getByTestId('self-qr-btn').click(); await w.getByTestId('self-qr').waitFor(); ok('后台能显示柜台二维码', (await w.getByTestId('self-qr').textContent()).includes('/c/DEMO1'));
  await w.screenshot({ path: shots + 'cu-04-approve.png' });
  await w.getByTestId('credit-app-row').filter({ hasText: 'Syarikat Maju' }).first().getByTestId('credit-approve').click(); await w.getByText('已开通记账').waitFor(); ok('老板批准记账', true);
  // 收银找会员卖一单
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN', reducedMotion: 'reduce' })).newPage();
  await login(p, '0120000008', '333333'); await p.goto(BASE + '/pos'); await p.waitForTimeout(2000);
  if (p.url().includes('/pos/open')) { await p.getByTestId('pos-open-confirm').click().catch(() => {}); await p.waitForTimeout(1500); }
  await p.getByTestId('pos-member').click(); for (const d of ph) await p.locator(`.pos-keypad button`, { hasText: new RegExp(`^${d}$`) }).first().click();
  await p.getByTestId('member-find').click(); await p.getByTestId('member-result').first().waitFor(); await p.screenshot({ path: shots + 'cu-05-pos-member.png' });
  await p.getByTestId('member-result').first().click(); ok('收银台挂上会员', (await p.getByTestId('pos-customer-chip').textContent()).includes('林小姐'));
  const scan = p.getByTestId('pos-scan'); await scan.fill('9556001234567'); await scan.press('Enter'); await p.waitForTimeout(400);
  await p.getByTestId('pos-pay').click(); await p.getByTestId('pay-exact').click().catch(() => {}); await p.getByTestId('pay-confirm').click(); await p.getByTestId('pos-done').waitFor({ timeout: 15000 });
  ok('会员结账后有"用会员资料开电子发票"', await p.getByTestId('done-einvoice-member').isVisible()); await p.screenshot({ path: shots + 'cu-06-pos-done.png' });
  // 收据链接
  const token = await p.evaluate(() => localStorage.getItem('wh.access'));
  const sales = await (await p.request.get(BASE + '/api/v1/pos/sales?limit=1', { headers: { authorization: `Bearer ${token}` } })).json();
  const rc = sales.rows?.[0]?.receipt_no ?? sales[0]?.receipt_no;
  const full = await (await p.request.get(BASE + `/api/v1/pos/sales/by-receipt/${encodeURIComponent(rc)}`, { headers: { authorization: `Bearer ${token}` } })).json();
  ok('收据有电子发票链接', !!full.einvoice_url, full.einvoice_url ?? 'none');
  if (full.einvoice_url) {
    await m.goto(full.einvoice_url); await m.getByTestId('ei-card').waitFor(); await m.screenshot({ path: shots + 'cu-07-einvoice.png' });
    await m.getByTestId('ei-name').fill('林小姐'); await m.getByTestId('ei-tin').fill('IG12345678901'); await m.getByTestId('ei-idno').fill('900202-10-1234'); await m.getByTestId('ei-email').fill('lin@example.my');
    await m.getByTestId('ei-submit').click(); await m.getByTestId('ei-done').waitFor(); ok('顾客自己开电子发票', true); await m.screenshot({ path: shots + 'cu-08-einvoice-done.png' });
  }
} catch (e) { ok('流程中断', false, String(e).slice(0, 300)); }
await b.close();
for (const r of results) console.log(r.join('  ')); console.log(`${results.filter((r) => r[0] === 'PASS').length}/${results.length} passed`);
