// 外观设计页截图 + 切到 market/tiles 后的手机首页截图
import { chromium } from 'playwright';
const BASE = 'http://localhost:5173';
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' }); const p = await ctx.newPage();
page: {
  await p.goto(BASE + '/'); await p.getByTestId('mode-phone').click(); await p.getByTestId('company').fill('DEMO1'); await p.getByTestId('phone').fill('0120000001');
  for (const d of '111111') await p.locator(`.keypad [data-key="${d}"]`).click();
  await p.getByTestId('home-grid').waitFor({ timeout: 15000 });
  await p.goto(BASE + '/w/theme'); await p.getByText('实时预览').waitFor({ timeout: 15000 });
  await p.screenshot({ path: 'e2e/shots/w10-theme-editor.png' });
  await p.getByRole('button', { name: /市场晨光/ }).click(); await p.waitForTimeout(300);
  await p.screenshot({ path: 'e2e/shots/w11-theme-market.png' });
  await p.getByRole('button', { name: '保存并应用到全公司' }).click(); await p.getByText('已保存').waitFor({ timeout: 10000 });
  const m = await ctx.newPage(); await m.setViewportSize({ width: 393, height: 851 }); await m.goto(BASE + '/m'); await m.getByTestId('home-grid').waitFor({ timeout: 15000 }); await m.waitForTimeout(800);
  await m.screenshot({ path: 'e2e/shots/10-home-market-tiles.png' });
  // 恢复默认
  await p.getByRole('button', { name: '恢复默认' }).click(); await p.getByRole('button', { name: '保存并应用到全公司' }).click(); await p.getByText('已保存').waitFor({ timeout: 10000 });
}
await b.close(); console.log('ok');
