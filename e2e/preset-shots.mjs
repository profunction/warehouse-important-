// 每个预设的真实首页、数量、查询截图
import { chromium } from 'playwright';
const BASE = 'http://localhost:5173';
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' }); const p = await ctx.newPage();
await p.goto(BASE + '/'); await p.getByTestId('mode-phone').click(); await p.getByTestId('company').fill('DEMO1'); await p.getByTestId('phone').fill('0120000001');
for (const d of '111111') await p.locator(`.keypad [data-key="${d}"]`).click();
await p.getByTestId('home-grid').waitFor({ timeout: 15000 });
const m = await ctx.newPage(); await m.setViewportSize({ width: 393, height: 851 });
const wedge = async (code) => { for (const ch of code) await m.keyboard.press(ch); await m.keyboard.press('Enter'); };
for (const preset of (process.argv[2] ? [process.argv[2]] : ['super', 'fresh'])) {
  await p.goto(BASE + '/w/theme'); await p.getByText('实时预览').waitFor();
  await p.locator('button', { hasText: preset === 'super' ? '超级应用' : preset === 'fresh' ? '清新薄荷' : preset === 'minimal' ? '深林与黄铜' : '市场晨光' }).first().click();
  await p.getByRole('button', { name: '保存并应用到全公司' }).click(); await p.getByText('已保存').waitFor({ timeout: 10000 });
  await m.goto(BASE + '/m'); await m.getByTestId('home-grid').waitFor({ timeout: 15000 }); await m.waitForTimeout(600);
  await m.screenshot({ path: `e2e/shots/preset-${preset}-home.png` });
  await m.getByTestId('tile-lookup').click(); await m.getByTestId('scan-area').waitFor(); await wedge('9556001234567'); await m.getByTestId('lookup-result').waitFor(); await m.waitForTimeout(300);
  await m.screenshot({ path: `e2e/shots/preset-${preset}-lookup.png` });
}
await p.goto(BASE + '/w/theme'); await p.getByText('实时预览').waitFor(); await p.getByRole('button', { name: '恢复默认' }).click(); await p.getByRole('button', { name: '保存并应用到全公司' }).click(); await p.getByText('已保存').waitFor({ timeout: 10000 });
await b.close(); console.log('ok');
