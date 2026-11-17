// 网页端端到端：超管开店向导 → 进入公司 → 加员工 → 导入 Excel 全流程 → 产品/库存/报表/审计页面
import { chromium } from 'playwright';
import ExcelJS from 'exceljs';
import { writeFileSync } from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:5173';
const shots = new URL('./shots/', import.meta.url).pathname;
const results = []; const ok = (n, c, e = '') => { results.push([c ? 'PASS' : 'FAIL', n, e]); if (!c) process.exitCode = 1; };
const browser = await chromium.launch(); const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-CN', acceptDownloads: true }); const page = await ctx.newPage();
page.on('pageerror', (e) => console.error('PAGEERROR', e.message)); page.on('dialog', (d) => d.accept());
const code = 'E2E' + String(Date.now()).slice(-4);
try {
  // 超管登录（电邮）
  await page.goto(BASE + '/'); await page.getByText('✉').click(); await page.getByTestId('email').fill('admin@demo.local');
  for (const d of '123456') await page.locator(`.keypad [data-key="${d}"]`).click();
  await page.waitForURL(/\/w\/admin\/companies/, { timeout: 15000 }); ok('超管登录进公司列表', true);
  await page.screenshot({ path: shots + 'w01-companies.png' });
  // 开店向导
  await page.goto(BASE + '/w/admin/wizard');
  await page.getByLabel('店名 / 公司名').fill('端到端测试店'); await page.getByLabel(/公司代码/).fill(code);
  await page.getByLabel('老板姓名').fill('测试老板'); await page.getByLabel(/老板手机/).fill('019' + String(Date.now()).slice(-7)); await page.getByLabel(/老板 PIN/).fill('111111');
  await page.getByRole('button', { name: '建立公司' }).click();
  await page.getByText('老板 PIN：').waitFor({ timeout: 15000 }); ok('A3 第 1 步建公司，显示老板 PIN', await page.getByText('111111').isVisible());
  await page.screenshot({ path: shots + 'w02-wizard-created.png' });
  await page.getByRole('button', { name: '跳过，下一步' }).click();
  await page.getByRole('button', { name: '进入该公司导入' }).click();
  await page.waitForURL(/\/w\/import/, { timeout: 15000 }); ok('进入该公司 → 导入页', true);
  // 模板下载
  const token = await page.evaluate(() => localStorage.getItem('wh.access'));
  const tr = await page.request.get(BASE + '/api/v1/import/templates/ALL', { headers: { authorization: `Bearer ${token}` } }); ok('E1 模板下载', tr.ok(), tr.ok() ? '' : `${tr.status()} ${(await tr.text()).slice(0, 200)}`);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await tr.body());
  const ws = wb.getWorksheet('产品'); ok('E1 模板三行表头', String(ws.getCell(1, 1).value) === '*主条码' && String(ws.getCell(2, 1).value).includes('Primary'));
  const keys = ['barcode', 'sku', 'name_zh', 'name_ms', 'name_en', 'category', 'unit', 'cost_price', 'sell_price', 'tax_code', 'supplier', 'min_level', 'reorder_qty', 'pack_qty'];
  const rows = Array.from({ length: 40 }, (_, i) => ({ barcode: String(9559000000000 + i), name_zh: `导入产品 ${i}`, name_en: `Imp ${i}`, category: i % 2 ? '零食' : '饮料', unit: '件', cost_price: 1 + i / 10, sell_price: 2 + i / 10, supplier: 'E2E 供应商', min_level: 12, reorder_qty: 24 }));
  rows.push({ barcode: '9559000000000', name_zh: '重复行', category: '饮料', unit: '件', cost_price: 1, sell_price: 2, min_level: 1, reorder_qty: 2 });   // 故意重复
  rows.forEach((r, i) => keys.forEach((k, j) => { if (r[k] !== undefined) ws.getCell(4 + i, j + 1).value = r[k]; }));
  const bad = shots + '../import-bad.xlsx'; writeFileSync(bad, Buffer.from(await wb.xlsx.writeBuffer()));
  await page.locator('input[type=file]').setInputFiles(bad); await page.getByRole('button', { name: '上传并验证' }).click();
  await page.getByText('错误和警告').waitFor({ timeout: 20000 });
  ok('E3 重复条码显示错误', await page.getByText(/与第 4 行重复/).first().isVisible());
  ok('E3 有错误时送审按钮禁用', await page.getByRole('button', { name: '送审批' }).isDisabled());
  await page.screenshot({ path: shots + 'w03-import-errors.png' });
  // 改好重传
  ws.spliceRows(4 + 40, 1); const good = shots + '../import-good.xlsx'; writeFileSync(good, Buffer.from(await wb.xlsx.writeBuffer()));
  await page.getByRole('button', { name: '关闭' }).click();
  await page.locator('input[type=file]').setInputFiles(good); await page.getByRole('button', { name: '上传并验证' }).click();
  await page.getByRole('button', { name: '送审批' }).waitFor({ timeout: 20000 }); ok('E2 正确文件可送审', await page.getByRole('button', { name: '送审批' }).isEnabled());
  await page.getByRole('button', { name: '送审批' }).click();
  await page.getByRole('button', { name: '批准并执行' }).waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: '批准并执行' }).click();
  await page.getByText(/已执行|APPLIED/).first().waitFor({ timeout: 20000 }); ok('E9 批准执行', true);
  await page.screenshot({ path: shots + 'w04-import-applied.png' });
  // 产品页
  await page.goto(BASE + '/w/products'); await page.getByText('导入产品 0').waitFor({ timeout: 15000 }); ok('G2 产品页显示导入产品', true);
  await page.screenshot({ path: shots + 'w05-products.png' });
  // 用户页加员工
  await page.goto(BASE + '/w/users'); await page.getByRole('button', { name: '+ 加员工' }).click();
  await page.getByLabel('姓名').fill('新库存员'); await page.getByLabel('手机').fill('018' + String(Date.now()).slice(-7));
  const roleSel = page.locator('select').filter({ has: page.locator('option', { hasText: '库存员' }) }).first(); await roleSel.selectOption({ label: '库存员' });
  await page.getByRole('button', { name: '保存' }).click();
  await page.getByText('员工已建立').waitFor({ timeout: 15000 }); ok('G7 加员工显示一次性 PIN', /\d{6}/.test(await page.locator('h2:has-text("员工已建立")').locator('..').textContent()));
  await page.screenshot({ path: shots + 'w06-user-created.png' });
  // 位置页标签 PDF
  await page.goto(BASE + '/w/locations'); await page.getByText('A 走道').first().waitFor({ timeout: 15000 });
  const lr = await page.request.post(BASE + '/api/v1/locations/labels', { headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, data: JSON.stringify({}) }); ok('G6 标签 PDF', lr.ok() && (lr.headers()['content-type'] ?? '').includes('pdf'));
  await page.screenshot({ path: shots + 'w07-locations.png' });
  // 库存、报表、审计、仪表板
  await page.goto(BASE + '/w/stock'); await page.waitForTimeout(1000); ok('G3 库存页', await page.getByText(/按产品|按位置|按区/).first().isVisible());
  await page.goto(BASE + '/w/reports'); await page.getByText(/低库存/).first().waitFor({ timeout: 10000 }); ok('G10 报表页', true);
  await page.getByRole('button', { name: /导出产品/ }).first().click().catch(() => {}); await page.waitForTimeout(1500);
  await page.screenshot({ path: shots + 'w08-reports.png' });
  await page.goto(BASE + '/w/audit'); await page.locator('table tbody tr').first().waitFor({ timeout: 10000 }); ok('G14 审计页有记录', (await page.locator('table tbody tr').count()) > 0);
  await page.goto(BASE + '/w/dashboard'); await page.getByText('产品数').waitFor({ timeout: 10000 });
  const pc = await page.locator('.stat', { hasText: '产品数' }).locator('.v').textContent(); ok('G1 仪表板产品数 40', pc?.trim() === '40', pc ?? '');
  await page.screenshot({ path: shots + 'w09-dashboard.png' });
  await page.goto(BASE + '/w/settings'); await page.getByText(/审批门槛|公司设定|基本资料/).first().waitFor({ timeout: 10000 }); ok('公司设定页', true);
  await page.goto(BASE + '/w/admin/sync-monitor'); await page.waitForTimeout(800); ok('A7 同步监控页', await page.getByText(/同步|设备/).first().isVisible());
} catch (e) { ok('流程中断', false, String(e).slice(0, 400)); await page.screenshot({ path: shots + 'w-error.png' }).catch(() => {}); }
await browser.close();
for (const [s, n, e] of results) console.log(s.padEnd(5), n, e ? '— ' + e : '');
console.log(`${results.filter((r) => r[0] === 'PASS').length}/${results.length} passed`);
