// 给示范店多加 40 个常见马来西亚超市商品（含期初库存），让收银格子和报表看起来像真店。可重复跑：已有条码跳过。
const API = process.env.API || 'http://localhost:3000/api/v1';
const j = async (path, body, token, method) => { const r = await fetch(API + path, { method: method ?? (body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); let d; try { d = JSON.parse(t); } catch { d = t; } return { ok: r.ok, d }; };
const boss = (await j('/auth/login', { company_code: 'DEMO1', phone: '0120000001', pin: '111111' })).d.access_token;
const cats = (await j('/categories', null, boss)).d; const cat = (c) => cats.find((x) => x.code === c)?.id;
const items = [
  ['100 Plus 500ml', '100 Plus 500ml', 'BEV', 1.5, 2.3], ['雪碧 325ml', 'Sprite 325ml', 'BEV', 1.2, 1.8], ['矿泉水 Spritzer 1.5L', 'Spritzer 1.5L', 'BEV', 1.1, 1.9], ['阿华田 400g', 'Ovaltine 400g', 'BEV', 9.8, 12.9], ['Nescafé 三合一 25包', 'Nescafe 3in1 25s', 'BEV', 11.5, 14.9], ['Boh 茶包 100包', 'Boh Tea 100s', 'BEV', 8.9, 11.5], ['Yeo’s 菊花茶 250ml', "Yeo's Chrysanthemum 250ml", 'BEV', 1.0, 1.6], ['Milo 罐装 240ml', 'Milo Can 240ml', 'BEV', 1.6, 2.4],
  ['Mamee 怪味面', 'Mamee Monster', 'SNK', 0.5, 0.9], ['Oreo 133g', 'Oreo 133g', 'SNK', 2.9, 4.2], ['Julie’s 花生夹心饼', "Julie's Peanut Butter", 'SNK', 3.4, 4.9], ['Twisties 60g', 'Twisties 60g', 'SNK', 1.6, 2.5], ['Super Ring 60g', 'Super Ring 60g', 'SNK', 1.5, 2.3], ['Hup Seng 苏打饼', 'Hup Seng Cream Crackers', 'SNK', 4.2, 5.9],
  ['Maggi 咖喱面 5包', 'Maggi Kari 5s', 'DRY', 3.9, 5.5], ['Cintan 面 5包', 'Cintan Mee 5s', 'DRY', 3.6, 5.2], ['Saji 食油 2kg', 'Saji Cooking Oil 2kg', 'DRY', 10.5, 13.9], ['砂糖 1kg', 'Gula 1kg', 'DRY', 2.6, 2.85], ['面粉 Blue Key 1kg', 'Blue Key Flour 1kg', 'DRY', 2.4, 3.3], ['Adabi 咖喱粉 250g', 'Adabi Curry Powder 250g', 'DRY', 4.1, 5.8],
  ['Ayam Brand 沙丁鱼', 'Ayam Brand Sardines', 'CAN', 4.3, 5.9], ['Kimball 番茄酱', 'Kimball Ketchup', 'CAN', 2.8, 3.9], ['Lee Kum Kee 蚝油', 'LKK Oyster Sauce', 'CAN', 5.6, 7.9], ['Habhal 酱油', 'Habhal Kicap', 'CAN', 3.2, 4.5],
  ['Dutch Lady 鲜奶 1L', 'Dutch Lady Milk 1L', 'DAI', 6.2, 8.2], ['Marigold 酸奶', 'Marigold Yogurt', 'DAI', 1.4, 2.1], ['Farm Fresh 巧克力奶', 'Farm Fresh Choc Milk', 'DAI', 4.6, 6.3], ['鸡蛋 10粒', 'Telur 10 biji', 'DAI', 3.6, 4.8],
  ['Ramly 牛肉汉堡', 'Ramly Beef Burger', 'FRZ', 7.9, 10.9], ['Kawan 印度煎饼', 'Kawan Roti Canai', 'FRZ', 6.3, 8.9], ['Wall’s 雪糕', "Wall's Ice Cream", 'FRZ', 9.5, 13.5],
  ['Dynamo 洗衣液 1.5kg', 'Dynamo 1.5kg', 'HHD', 13.9, 18.9], ['Glo 洗碗精', 'Glo Dishwash', 'HHD', 3.9, 5.5], ['Premier 纸巾 6卷', 'Premier Tissue 6 rolls', 'HHD', 7.5, 10.5], ['Ridsect 杀虫剂', 'Ridsect Spray', 'HHD', 9.9, 13.9],
  ['Colgate 牙膏', 'Colgate Toothpaste', 'PER', 5.2, 7.5], ['Dettol 沐浴露', 'Dettol Shower Gel', 'PER', 9.8, 13.9], ['Sunsilk 洗发水', 'Sunsilk Shampoo', 'PER', 10.5, 14.5],
  ['Pampers 纸尿裤 M', 'Pampers M', 'BAB', 32.0, 42.9], ['Johnson 婴儿爽身粉', "Johnson's Baby Powder", 'BAB', 6.9, 9.5],
];
let added = 0;
for (const [i, [zh, en, c, cost, sell]] of items.entries()) {
  const bc = String(9556100000000 + i * 7);
  const exists = (await j(`/products?search=${bc}`, null, boss)).d;
  if (Array.isArray(exists) && exists.length) continue;
  const r = await j('/products', { name_zh: zh, name_en: en, name_ms: en, category_id: cat(c), cost_price: cost, sell_price: sell, min_level: 6, reorder_qty: 24, barcode: bc }, boss);
  if (!r.ok) { console.log('skip', zh, JSON.stringify(r.d).slice(0, 120)); continue; }
  const backroom = cats.find((x) => x.code === c)?.default_backroom_code ?? 'S-01';
  await j('/movements', { barcode: bc, from_location_code: 'SUPPLIER', to_location_code: backroom, qty: 24 + (i % 5) * 12, reason: 'RECEIVE' }, boss);
  added++;
}
console.log('added', added);
