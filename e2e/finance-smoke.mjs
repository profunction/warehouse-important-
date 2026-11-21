// 模块 D 端到端：DEMO1 老板登录网页 → /w/ar 建客户、开票、收款 → /w/einvoice 看列表 → /w/month-end 看清单 → /w/sales 看报表；截图到 e2e/shots/。
// 跑法：bash e2e/up.sh && node e2e/finance-smoke.mjs
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
const BASE = process.env.BASE || 'http://localhost:5173';
const shots = fileURLToPath(new URL('./shots/', import.meta.url));
const results = []; const ok = (n, c, e = '') => { results.push([c ? 'PASS' : 'FAIL', n, e]); if (!c) process.exitCode = 1; };
const browser = await chromium.launch(); const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, locale: 'zh-CN', acceptDownloads: true, reducedMotion: 'reduce' }); const page = await ctx.newPage();
page.on('pageerror', (e) => console.error('PAGEERROR', e.message)); page.on('dialog', (d) => d.accept());
const stamp = String(Date.now()).slice(-5); const custName = `端到端客户 ${stamp}`;
try {
  // 老板手机号登录（DEMO1）
  await page.goto(BASE + '/'); await page.getByTestId('mode-phone').click(); await page.getByTestId('company').fill('DEMO1'); await page.getByTestId('phone').fill('0120000001');
  for (const d of '111111') await page.locator(`.keypad [data-key="${d}"]`).click();
  await page.getByTestId('home-grid').waitFor({ timeout: 15000 }); ok('老板登录', true);

  // 1. 客户与应收：建客户
  await page.goto(BASE + '/w/ar'); await page.getByText('客户与应收').first().waitFor({ timeout: 15000 });
  await page.getByTestId('new-customer').click(); await page.getByTestId('customer-form').waitFor();
  await page.getByTestId('customer-form').getByLabel('名称').fill(custName);
  await page.getByTestId('customer-form').getByLabel('TIN').fill('C1122334455');
  await page.getByTestId('customer-form').getByLabel(/信用期/).fill('30');
  await page.getByTestId('customer-form').getByRole('button', { name: '保存' }).click();
  await page.getByText('已保存').waitFor({ timeout: 10000 });
  await page.getByRole('cell', { name: custName }).first().waitFor({ timeout: 10000 }); ok('建客户出现在列表', true);
  // 打开客户 → 手动开票
  await page.getByRole('cell', { name: custName }).first().click(); await page.getByTestId('customer-detail').waitFor({ timeout: 10000 });
  await page.getByTestId('new-invoice').click(); await page.getByTestId('invoice-form').waitFor();
  await page.getByTestId('line-desc-0').fill('端到端服务费'); await page.getByTestId('line-qty-0').fill('2'); await page.getByTestId('line-price-0').fill('50');
  await page.getByTestId('invoice-submit').click();
  await page.getByText(/已开票 INV-/).waitFor({ timeout: 10000 });
  const invText = await page.getByText(/已开票 INV-/).textContent(); const invNo = invText.match(/INV-\d{4}-\d{4}/)?.[0];
  ok('手动开票得到发票号', !!invNo, invText ?? '');
  await page.screenshot({ path: shots + 'fin01-ar-invoice.png' });
  // 收款 60（部分）→ 部分付
  await page.getByTestId(`pay-${invNo}`).click(); await page.getByTestId('pay-form').waitFor();
  await page.getByTestId('pay-amount').fill('60'); await page.getByTestId('pay-submit').click();
  await page.getByText('已收款，发票部分付').waitFor({ timeout: 10000 }); ok('部分收款 → 部分付', true);
  // 再收 40 → 已付
  await page.getByTestId(`pay-${invNo}`).click(); await page.getByTestId('pay-amount').fill('40'); await page.getByTestId('pay-submit').click();
  await page.getByText('已收款，发票已付').waitFor({ timeout: 10000 }); ok('付清 → 已付', true);
  const detail = page.getByTestId('customer-detail'); ok('客户余额归零', (await detail.getByText(/余额 RM 0\.00/).count()) > 0);
  await page.screenshot({ path: shots + 'fin02-ar-paid.png' });
  // 账龄页
  await page.getByRole('button', { name: '账龄', exact: true }).click(); await page.getByText('0-30 天').first().waitFor(); ok('账龄页', true);

  // 2. 电子发票列表
  await page.goto(BASE + '/w/einvoice'); await page.getByText('电子发票 MyInvois').first().waitFor({ timeout: 15000 });
  await page.getByTestId('einvoice-table').waitFor(); ok('电子发票列表', true);
  await page.getByRole('button', { name: '月度合并发票' }).click(); await page.getByRole('button', { name: '预览' }).click();
  await page.getByText('零售收据').first().waitFor({ timeout: 10000 }); ok('合并发票预览', true);
  await page.screenshot({ path: shots + 'fin03-einvoice.png' });

  // 3. 月结清单
  await page.goto(BASE + '/w/month-end'); await page.getByText('检查清单').first().waitFor({ timeout: 15000 });
  await page.getByTestId('checklist').waitFor(); const items = await page.getByTestId('checklist').locator('tbody tr').count(); ok('月结清单 7 项', items === 7, String(items));
  await page.screenshot({ path: shots + 'fin04-month-end.png' });

  // 4. 销售报表
  await page.goto(BASE + '/w/sales'); await page.getByText('销售与经营报表').first().waitFor({ timeout: 15000 });
  await page.getByTestId('sales-table').waitFor({ timeout: 15000 }); ok('销售报表表格', true);
  await page.getByText('净销售 RM').first().waitFor();
  const tabs = page.getByRole('main').locator('.tabs');
  for (const t of ['损耗', '周转', '库龄', '应收账龄', '应付到期', '日结汇总']) { await tabs.getByRole('button', { name: t, exact: true }).click(); await page.waitForTimeout(600); }
  ok('各报表页签可切换', true);
  await tabs.getByRole('button', { name: '销售', exact: true }).click(); await page.getByTestId('sales-table').waitFor();
  await page.screenshot({ path: shots + 'fin05-sales.png' });
  // 报表中心导航
  await page.goto(BASE + '/w/reports'); await page.getByTestId('report-center').waitFor({ timeout: 15000 }); ok('报表中心', true);
  await page.screenshot({ path: shots + 'fin06-report-center.png' });
} catch (e) { ok('流程异常', false, e.message); await page.screenshot({ path: shots + 'fin99-error.png' }).catch(() => {}); }
await browser.close();
for (const r of results) console.log(r.join('  '));
console.log(process.exitCode ? 'FAILED' : 'ALL PASS');
