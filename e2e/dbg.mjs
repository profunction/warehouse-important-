import { chromium, devices } from 'playwright';
const browser = await chromium.launch(); const ctx = await browser.newContext({ ...devices['Pixel 5'] }); const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 200)); });
await page.goto('http://localhost:5173/'); await page.getByTestId('mode-phone').click();
await page.getByTestId('company').fill('DEMO1'); await page.getByTestId('phone').fill('0120000009');
for (const d of '222222') await page.locator(`.keypad [data-key="${d}"]`).click();
await page.getByTestId('home-grid').waitFor(); await page.waitForTimeout(3000);
const info = await page.evaluate(async () => {
  const { db } = await import('/src/offline/db.ts');
  const counts = { product: await db.product.count(), stock: await db.stock.count(), zone: await db.zone.count(), location: await db.location.count(), shelf: await db.shelf_assignment.count() };
  const st = await db.stock.toArray(); const out = [];
  for (const s of st) { const l = await db.location.get(s.location_id); const z = l?.zone_id ? await db.zone.get(l.zone_id) : null; out.push({ loc: l?.code, zone: z?.zone_type, qty: s.qty, virtual: l?.is_virtual }); }
  return { counts, out, cursor: (await db.kv.get('sync.cursor'))?.value?.slice(0, 40) };
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
