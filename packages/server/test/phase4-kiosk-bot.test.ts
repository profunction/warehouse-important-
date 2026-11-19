// 第四阶段 模块 E：大屏、机器人、地图、工单完整版。DATABASE_NAME=warehouse_test_kiosk
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/app.js';
import { api } from './helpers.js';
import { closePools, adminPool } from '../src/lib/db.js';
import { generateApiKey } from '../src/lib/apikey.js';
import { runOverdueCheck, runHelpEscalation } from '../src/lib/ticketJobs.js';
import { classifyByRules } from '../src/lib/botIntent.js';
import { tokenize } from '../src/routes/bot.js';
import { computeRoute, type MapLayout } from '../src/routes/map.js';
import { kioskKeyGuard } from '../src/routes/kiosk.js';

const app = buildApp();
let sa: string, boss: string, stocker: string, manager: string, cashier: string;
let companyId: string, whSiteId: string, shopId: string, stockerId: string, managerId: string, cashierId: string;
let P1: string, P2: string, kioskKey: string, shelfLoc: string, zoneA: string, backLoc: string;
const A = () => api(app);
const K = () => api(app, undefined, { 'x-api-key': kioskKey });
const login = async (phone: string, pin: string) => { const r = await A().post('/auth/login', { company_code: 'KSK01', phone, pin, device: { name: `${phone} 手机`, type: 'PHONE', app_version: '0.1.0' } }); expect(r.statusCode).toBe(200); return r.json(); };

beforeAll(async () => {
  await app.ready();
  sa = (await A().post('/auth/login', { email: 'admin@test.local', pin: '123456' })).json().access_token;
  const c = await api(app, sa).post('/admin/companies', { name: '大屏测试公司', short_code: 'KSK01', plan: 'B', boss_name: '老板', boss_phone: '0130000001', boss_pin: '111111' });
  expect(c.statusCode).toBe(201); companyId = c.json().company_id; whSiteId = c.json().site_id;
  const bl = await login('0130000001', '111111'); boss = bl.access_token;
  // POST /sites 在 B 模式会重复建 RCV-01-1（位置码公司内唯一，模块外的问题），这里直接插站点
  shopId = (await adminPool.query(`INSERT INTO site (company_id, code, name, type) VALUES ($1,'SHOP1','测试店','SHOP') RETURNING id`, [companyId])).rows[0].id;
  let cats = (await api(app, boss).get('/categories')).json(); let bev = cats.find((x: any) => x.code === 'BEV');
  if (!bev) { const cr = await api(app, boss).post('/categories', { code: 'BEV', name_zh: '饮料', name_ms: 'Minuman', name_en: 'Beverages' }); expect(cr.statusCode).toBe(201); bev = cr.json(); }
  const za = await api(app, boss).post('/zones', { site_id: shopId, code: 'A', name_zh: 'A 区', zone_type: 'SHELF', color: '#1565C0', racks: 4, levels: 2 }); expect(za.statusCode).toBe(201); zoneA = za.json().id;
  const zs = await api(app, boss).post('/zones', { site_id: shopId, code: 'S', name_zh: '后仓', zone_type: 'BACKROOM', color: '#9E9E9E', racks: 2, levels: 1 }); expect(zs.statusCode).toBe(201);
  const locs = (await api(app, boss).get(`/locations?site=${shopId}`)).json();
  shelfLoc = locs.find((l: any) => l.code === 'A-01-1').id; backLoc = locs.find((l: any) => l.code === 'S-01-1').id;
  const p1 = await api(app, boss).post('/products', { name_zh: '可口可乐 325ml', name_en: 'Coca-Cola 325ml', name_ms: 'Coca-Cola 325ml', category_id: bev.id, cost_price: 1.2, sell_price: 1.8, min_level: 24, reorder_qty: 48, barcode: '9556001234567' }); expect(p1.statusCode).toBe(201); P1 = p1.json().id;
  const p2 = await api(app, boss).post('/products', { name_zh: '美禄 400g', name_en: 'Milo 400g', category_id: bev.id, cost_price: 9, sell_price: 12.5, min_level: 6, reorder_qty: 12, barcode: '9556002222222' }); P2 = p2.json().id;
  // 用户：上架员、经理、收银员（都绑到店）
  const mk = async (name: string, role: string, phone: string) => { const r = await api(app, boss).post('/users', { name, phone, roles: [{ role_code: role, site_id: shopId }] }); expect(r.statusCode).toBe(201); return { id: r.json().id, pin: r.json().pin }; };
  const s = await mk('上架小王', 'STOCKER', '0130000002'); stockerId = s.id; stocker = (await login('0130000002', s.pin)).access_token;
  const m = await mk('经理小李', 'MANAGER', '0130000003'); managerId = m.id; manager = (await login('0130000003', m.pin)).access_token;
  const ca = await mk('收银小陈', 'CASHIER', '0130000004'); cashierId = ca.id; cashier = (await login('0130000004', ca.pin)).access_token;
  // 老板选店（B 模式两个站点）
  boss = (await api(app, boss).post('/auth/select-site', { site_id: shopId })).json().access_token;
  // 库存：收货到后仓 48，补货 5 到货架 A-01-1 并登记位置（现有 /shelf-assignments）
  expect((await api(app, boss).post('/movements', { barcode: '9556001234567', from_location_code: 'SUPPLIER', to_location_code: 'S-01-1', qty: 48, reason: 'RECEIVE' })).statusCode).toBe(201);
  expect((await api(app, boss).post('/movements', { barcode: '9556001234567', from_location_code: 'S-01-1', to_location_code: 'A-01-1', qty: 5, reason: 'REFILL' })).statusCode).toBe(201);
  const sa1 = await api(app, stocker).post('/shelf-assignments', { product_id: P1, location_id: shelfLoc, is_primary: true }); expect([200, 201]).toContain(sa1.statusCode);
  // 大屏密钥：直接插表（/api-keys 由模块 C 实现）
  const gk = generateApiKey(); kioskKey = gk.key;
  await adminPool.query(`INSERT INTO api_key (company_id, site_id, name, scope, key_prefix, key_hash) VALUES ($1,$2,'门口大屏','KIOSK',$3,$4)`, [companyId, shopId, gk.key_prefix, gk.key_hash]);
});
afterAll(async () => { await app.close(); await closePools(); });

describe('大屏只读接口', () => {
  it('无密钥 401', async () => { expect((await A().get('/kiosk/search?q=cola')).statusCode).toBe(401); });
  it('KIOSK 密钥访问非 /kiosk 路径被挡（登录接口 401 无令牌；带 Bearer 形式的密钥 403）', async () => {
    const r = await K().get('/products'); expect([401, 403]).toContain(r.statusCode); expect(r.body).not.toContain(P1);
    const r2 = await api(app, kioskKey).get('/products'); expect([401, 403]).toContain(r2.statusCode); expect(r2.body).not.toContain(P1);
    // 对外开放接口（OPEN scope）用 KIOSK 密钥 → requireApiKey 回 403 KIOSK_ONLY
    const r3 = await K().get('/open/products'); expect([403, 404]).toContain(r3.statusCode); if (r3.statusCode === 403) expect(r3.json().code).toBe('KIOSK_ONLY');
    // 根级守卫函数：KIOSK 密钥访问 /products 直接 403
    await expect(kioskKeyGuard({ headers: { 'x-api-key': kioskKey }, url: '/api/v1/products' } as any)).rejects.toMatchObject({ status: 403, code: 'KIOSK_ONLY' });
    await expect(kioskKeyGuard({ headers: { 'x-api-key': kioskKey }, url: '/api/v1/kiosk/search' } as any)).resolves.toBeUndefined();
  });
  it('搜索：中文/拼音/英文找到可乐，响应没有成本和数量', async () => {
    for (const q of ['可乐', 'kele', 'cola', '9556001234567']) { const r = await K().get(`/kiosk/search?q=${encodeURIComponent(q)}`); expect(r.statusCode).toBe(200); expect(r.json().length, q).toBeGreaterThanOrEqual(1); expect(r.json()[0].id).toBe(P1); const body = r.body; expect(body).not.toMatch(/cost/i); expect(body).not.toMatch(/"qty"/); }
  });
  it('where：本店货架 + in_stock 布尔，无数量无仓库位置', async () => {
    const r = await K().get(`/kiosk/products/${P1}/where`); expect(r.statusCode).toBe(200);
    const j = r.json(); expect(j.locations.map((l: any) => l.code)).toEqual(['A-01-1']); expect(j.in_stock).toBe(true); expect(j.primary_location_id).toBe(shelfLoc);
    expect(r.body).not.toMatch(/cost/i); expect(r.body).not.toMatch(/qty/i); expect(r.body).not.toContain('S-01-1');
    const r2 = await K().get(`/kiosk/products/${P2}/where`); expect(r2.json().in_stock).toBe(false); expect(r2.json().locations.length).toBe(0);
  });
  it('目录、类别、条码、促销', async () => {
    const c = await K().get('/kiosk/catalog'); expect(c.statusCode).toBe(200); expect(c.json().items.length).toBe(2); expect(c.body).not.toMatch(/cost/i);
    expect((await K().get('/kiosk/categories')).json().length).toBeGreaterThan(0);
    expect((await K().get('/kiosk/products/9556002222222')).json().id).toBe(P2);
    expect((await K().get('/kiosk/products/0000000000000')).statusCode).toBe(404);
    const pr = await api(app, boss).post('/promotions', { site_id: shopId, product_id: P1, title_zh: '可乐特价', promo_price: 1.5 }); expect(pr.statusCode).toBe(201);
    const list = await K().get('/kiosk/promotions'); expect(list.json().length).toBe(1); expect(list.json()[0].product_name_zh).toContain('可乐');
    expect((await api(app, boss).put(`/promotions/${pr.json().id}`, { is_active: false })).statusCode).toBe(200);
    expect((await K().get('/kiosk/promotions')).json().length).toBe(0);
  });
  it('心跳建 KIOSK 设备', async () => {
    const r = await K().post('/kiosk/heartbeat', { app_version: '0.1.0' }); expect(r.statusCode).toBe(200);
    const d = (await adminPool.query(`SELECT * FROM device WHERE id = $1`, [r.json().device_id])).rows[0]; expect(d.type).toBe('KIOSK'); expect(d.site_id).toBe(shopId);
    expect((await K().post('/kiosk/heartbeat', {})).json().device_id).toBe(r.json().device_id);
  });
});

describe('店地图', () => {
  it('保存草稿（版本 1）、发布、大屏拿到已发布版', async () => {
    const elements = [
      { kind: 'KIOSK', x: 0, y: 0, w: 1, h: 1 }, { kind: 'ENTRANCE', x: 0, y: 1, w: 1, h: 1 },
      { kind: 'RACK', zone_id: zoneA, rack: 1, location_id: shelfLoc, x: 4, y: 2, w: 1, h: 3, label: 'A-01' }, { kind: 'RACK', zone_id: zoneA, rack: 2, x: 6, y: 2, w: 1, h: 3, label: 'A-02' },
      { kind: 'WALL', x: 2, y: 0, w: 1, h: 8 }, { kind: 'COUNTER', x: 8, y: 0, w: 2, h: 1 },
    ];
    expect((await api(app, stocker).put(`/sites/${shopId}/map`, { width: 12, height: 10, kiosk: { x: 0, y: 0 }, elements })).statusCode).toBe(403);
    const r = await api(app, boss).put(`/sites/${shopId}/map`, { width: 12, height: 10, kiosk: { x: 0, y: 0 }, entrance: { x: 0, y: 1 }, elements }); expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe('DRAFT'); expect(r.json().version).toBe(1); expect(r.json().elements.length).toBe(6);
    expect((await K().get('/kiosk/map')).json().status).toBe('NONE');
    const p = await api(app, boss).post(`/sites/${shopId}/map/publish`); expect(p.statusCode).toBe(200); expect(p.json().status).toBe('PUBLISHED');
    const km = await K().get('/kiosk/map'); expect(km.json().status).toBe('PUBLISHED'); expect(km.json().elements.find((e: any) => e.location_id === shelfLoc).location_code).toBe('A-01-1');
    // 再改 → 新草稿 version 2，大屏仍是 1
    const r2 = await api(app, boss).put(`/sites/${shopId}/map`, { width: 12, height: 10, kiosk: { x: 0, y: 0 }, elements }); expect(r2.json().version).toBe(2); expect(r2.json().status).toBe('DRAFT');
    expect((await K().get('/kiosk/map')).json().version).toBe(1);
  });
  it('route：A* 绕过墙到货架旁', async () => {
    const r = await K().get(`/kiosk/route?to=${shelfLoc}`); expect(r.statusCode).toBe(200);
    const j = r.json(); expect(j.found).toBe(true); expect(j.path[0]).toEqual({ x: 0, y: 0 }); expect(j.path.length).toBeGreaterThan(8);
    for (const c of j.path) expect(c.x === 2 && c.y < 8, `wall at ${c.x},${c.y}`).toBe(false);
    const last = j.path[j.path.length - 1]; expect(Math.abs(last.x - 4) <= 1 && last.y >= 1 && last.y <= 5).toBe(true);
    const s = await api(app, manager).get(`/sites/${shopId}/map/route?to=${shelfLoc}&published=true`); expect(s.json().found).toBe(true);
  });
  it('纯函数：无路可走 found=false', () => {
    const m: MapLayout = { id: 'x', site_id: 's', version: 1, width: 5, height: 3, kiosk_x: 0, kiosk_y: 0, entrance_x: null, entrance_y: null, walkable_grid: null, status: 'PUBLISHED', published_at: null, elements: [{ kind: 'WALL', x: 2, y: 0, w: 1, h: 3 }, { kind: 'RACK', x: 4, y: 1, w: 1, h: 1 }] };
    expect(computeRoute(m, m.elements[1]).found).toBe(false);
    m.elements[0].h = 2; expect(computeRoute(m, m.elements[1]).found).toBe(true);
  });
});

describe('叫员工', () => {
  let ticketId: string;
  it('help 开 CUSTOMER_HELP 给 STOCKER，10 分钟 HIGH，通知上架员', async () => {
    const r = await K().post('/kiosk/help', { product_id: P1, location_id: shelfLoc, note: '找不到' }); expect(r.statusCode).toBe(201); ticketId = r.json().ticket_id;
    const t = (await adminPool.query(`SELECT * FROM ticket WHERE id = $1`, [ticketId])).rows[0];
    expect(t.type).toBe('CUSTOMER_HELP'); expect(t.owner_id).toBe(stockerId); expect(t.owner_role_code).toBe('STOCKER'); expect(t.priority).toBe('HIGH'); expect(t.site_id).toBe(shopId);
    expect(new Date(t.deadline_at).getTime() - Date.now()).toBeLessThan(11 * 60_000);
    const n = await adminPool.query(`SELECT * FROM notification WHERE user_id = $1 AND type = 'CUSTOMER_HELP'`, [stockerId]); expect(n.rows.length).toBe(1);
    expect((await K().get(`/kiosk/help/${ticketId}`)).json().accepted).toBe(false);
  });
  it('上架员 /tickets/mine?type=CUSTOMER_HELP 看到并 accept，大屏看到 accepted + 名字', async () => {
    const mine = await api(app, stocker).get('/tickets/mine?type=CUSTOMER_HELP'); expect(mine.json().some((t: any) => t.id === ticketId)).toBe(true);
    const a = await api(app, stocker).post(`/tickets/${ticketId}/accept`); expect(a.statusCode).toBe(200); expect(a.json().status).toBe('IN_PROGRESS');
    const h = await K().get(`/kiosk/help/${ticketId}`); expect(h.json().accepted).toBe(true); expect(h.json().by_name).toBe('上架小王');
    expect((await api(app, cashier).post(`/tickets/${ticketId}/accept`)).statusCode).toBe(409);
  });
  it('10 分钟无人接升级给经理（runHelpEscalation）', async () => {
    const r = await K().post('/kiosk/help', { client_id: randomUUID(), note: '老人需要帮忙' }); const id = r.json().ticket_id;
    expect(await runHelpEscalation(companyId)).toBe(0);
    await adminPool.query(`UPDATE ticket SET created_at = now() - interval '11 minutes' WHERE id = $1`, [id]);
    expect(await runHelpEscalation(companyId)).toBe(1);
    const t = (await adminPool.query(`SELECT * FROM ticket WHERE id = $1`, [id])).rows[0]; expect(t.escalated_at).not.toBeNull(); expect(t.owner_role_code).toBe('MANAGER'); expect(t.owner_id).toBe(managerId); expect(t.priority).toBe('URGENT');
    expect(await runHelpEscalation(companyId)).toBe(0);
    await api(app, manager).post(`/tickets/${id}/close`, { reason_code: 'CUSTOMER_LEFT' });
  });
  it('help 幂等 client_id', async () => { const cid = randomUUID(); const a = await K().post('/kiosk/help', { client_id: cid }); const b = await K().post('/kiosk/help', { client_id: cid }); expect(a.statusCode).toBe(201); expect(b.statusCode).toBe(200); expect(b.json().ticket_id).toBe(a.json().ticket_id); });
});

describe('机器人', () => {
  let convId: string, botTicket: string;
  it('意图规则：三语', () => {
    expect(classifyByRules('可乐放哪里')).toMatchObject({ intent: 'DATA', query_code: 'PRODUCT_LOCATION_SHOP', params: { product: '可乐' }, language: 'zh' });
    expect(classifyByRules('Milo kat mana')).toMatchObject({ query_code: 'PRODUCT_LOCATION_SHOP', params: { product: 'Milo' }, language: 'ms' });
    expect(classifyByRules('where is the coke')).toMatchObject({ query_code: 'PRODUCT_LOCATION_SHOP', params: { product: 'coke' }, language: 'en' });
    expect(classifyByRules('可乐成本多少')).toMatchObject({ query_code: 'PRODUCT_COST', params: { product: '可乐' } });
    expect(classifyByRules('今天要补什么')).toMatchObject({ query_code: 'LOW_STOCK' });
    expect(classifyByRules('Apa perlu diisi hari ini')).toMatchObject({ query_code: 'LOW_STOCK' });
    expect(classifyByRules('这周什么到期')).toMatchObject({ query_code: 'EXPIRING', params: { days: 7 } });
    expect(classifyByRules('今天卖了多少')).toMatchObject({ query_code: 'TODAY_SALES' });
    expect(classifyByRules('我有什么工单')).toMatchObject({ query_code: 'MY_TICKETS' });
    expect(classifyByRules('什么等我批')).toMatchObject({ query_code: 'PENDING_APPROVALS' });
    expect(classifyByRules('调拨到了没')).toMatchObject({ query_code: 'TRANSFER_STATUS' });
    expect(classifyByRules('哪台掉线')).toMatchObject({ query_code: 'DEVICE_STATUS' });
    expect(classifyByRules('A 区有什么')).toMatchObject({ query_code: 'ZONE_CONTENTS', params: { zone_code: 'A' } });
    expect(classifyByRules('9556001234567 还有多少')).toMatchObject({ query_code: 'STOCK_BY_BARCODE', params: { barcode_or_name: '9556001234567' } });
    expect(classifyByRules('怎么收货').intent).toBe('HOWTO');
    expect(classifyByRules('how do I receive goods').intent).toBe('HOWTO');
    expect(tokenize('怎么申请年假')).toEqual(expect.arrayContaining(['申请年假', '申请', '年假']));
    expect(tokenize('怎么申请年假')).not.toContain('怎么');
  });
  it('上架员问"可乐放哪里"得位置', async () => {
    const r = await api(app, stocker).post('/bot/ask', { text: '可乐放哪里' }); expect(r.statusCode).toBe(200);
    expect(r.json().intent).toBe('DATA'); expect(r.json().query_code).toBe('PRODUCT_LOCATION_SHOP'); expect(r.json().answer).toContain('A-01-1'); expect(r.json().answered).toBe(true);
    expect(r.json().rows[0].location_code).toBe('A-01-1');
  });
  it('上架员问"成本多少"被拒，不开工单', async () => {
    const before = Number((await adminPool.query(`SELECT count(*) n FROM ticket WHERE company_id = $1 AND type = 'BOT_UNANSWERED'`, [companyId])).rows[0].n);
    const r = await api(app, stocker).post('/bot/ask', { text: '可乐成本多少' }); expect(r.statusCode).toBe(200);
    expect(r.json().denied).toBe(true); expect(r.json().answer).toContain('不能看'); expect(r.body).not.toContain('1.2');
    expect(Number((await adminPool.query(`SELECT count(*) n FROM ticket WHERE company_id = $1 AND type = 'BOT_UNANSWERED'`, [companyId])).rows[0].n)).toBe(before);
    const b = await api(app, boss).post('/bot/ask', { text: '可乐成本多少' }); expect(b.json().answer).toContain('1.20');
  });
  it('经理问"今天要补什么"得清单', async () => {
    const r = await api(app, manager).post('/bot/ask', { text: '今天要补什么' }); expect(r.statusCode).toBe(200);
    expect(r.json().query_code).toBe('LOW_STOCK'); expect(r.json().rows.some((x: any) => x.id === P1)).toBe(true); expect(r.json().answer).toContain('可乐');
    expect((await api(app, stocker).post('/bot/ask', { text: '今天要补什么' })).json().denied).toBe(true);
  });
  it('系统 SOP 命中（忘记 PIN）并计 hit', async () => {
    const r = await api(app, cashier).post('/bot/ask', { text: '忘记 PIN 怎么办' }); expect(r.statusCode).toBe(200);
    expect(r.json().intent).toBe('HOWTO'); expect(r.json().answer).toContain('重置'); expect(r.json().screen_ref).toBe('C1');
    const k = (await adminPool.query(`SELECT hit_count FROM knowledge_article WHERE id = $1`, [r.json().knowledge_id])).rows[0]; expect(k.hit_count).toBeGreaterThanOrEqual(1);
    const en = await api(app, cashier).post('/bot/ask', { text: 'Forgot my PIN', language: 'en' }); expect(en.json().answer).toContain('reset');
  });
  it('问 SOP 没有的 → BOT_UNANSWERED 工单给经理 + conversation unanswered', async () => {
    const r = await api(app, stocker).post('/bot/ask', { text: '怎么申请年假' }); expect(r.statusCode).toBe(200);
    expect(r.json().answered).toBe(false); expect(r.json().answer).toContain('已转给主管'); convId = r.json().conversation_id; botTicket = r.json().ticket_id;
    const t = (await adminPool.query(`SELECT * FROM ticket WHERE id = $1`, [botTicket])).rows[0]; expect(t.type).toBe('BOT_UNANSWERED'); expect(t.owner_role_code).toBe('MANAGER'); expect(t.owner_id).toBe(managerId);
    expect(new Date(t.deadline_at).getTime() - Date.now()).toBeGreaterThan(20 * 3600_000);
    const c = (await adminPool.query(`SELECT * FROM bot_conversation WHERE id = $1`, [convId])).rows[0]; expect(c.answered).toBe(false); expect(c.ticket_id).toBe(botTicket);
    const list = await api(app, manager).get('/bot/conversations?unanswered=true'); expect(list.statusCode).toBe(200); expect(list.json().some((x: any) => x.id === convId)).toBe(true);
    expect((await api(app, stocker).get('/bot/conversations?unanswered=true')).statusCode).toBe(403);
  });
  it('经理 POST /knowledge 回答 → conversation answered、工单 RESOLVED、提问者收到通知', async () => {
    const r = await api(app, manager).post('/knowledge', { conversation_id: convId, question_zh: '怎么申请年假', question_en: 'How to apply annual leave', answer_zh: '找经理填假单，提前 3 天', answer_en: 'Fill the leave form with your manager 3 days ahead', screen_ref: 'C6' }); expect(r.statusCode).toBe(201);
    const c = (await adminPool.query(`SELECT * FROM bot_conversation WHERE id = $1`, [convId])).rows[0]; expect(c.answered).toBe(true); expect(c.knowledge_id).toBe(r.json().id);
    expect((await adminPool.query(`SELECT status FROM ticket WHERE id = $1`, [botTicket])).rows[0].status).toBe('RESOLVED');
    const n = await adminPool.query(`SELECT * FROM notification WHERE user_id = $1 AND type = 'BOT_ANSWERED'`, [stockerId]); expect(n.rows.length).toBe(1); expect(n.rows[0].text).toContain('假单');
    expect((await api(app, manager).get('/bot/conversations?unanswered=true')).json().some((x: any) => x.id === convId)).toBe(false);
  });
  it('第二人同样问题直接得答', async () => {
    const r = await api(app, cashier).post('/bot/ask', { text: '我要怎么申请年假？' }); expect(r.statusCode).toBe(200);
    expect(r.json().answered).toBe(true); expect(r.json().answer).toContain('假单'); expect(r.json().ticket_id).toBeFalsy();
  });
  it('知识库 CRUD：改、搜、删，系统 SOP 不能改', async () => {
    const mine = (await api(app, manager).get('/knowledge?all=true')).json().find((k: any) => k.question_zh === '怎么申请年假');
    expect((await api(app, manager).put(`/knowledge/${mine.id}`, { keywords: '年假 请假 leave cuti' })).statusCode).toBe(200);
    expect((await api(app, manager).get('/bot/knowledge/search?q=请假')).json().some((k: any) => k.id === mine.id)).toBe(true);
    const sys = (await api(app, manager).get('/knowledge')).json().find((k: any) => k.company_id === null);
    expect((await api(app, manager).put(`/knowledge/${sys.id}`, { answer_zh: 'x' })).statusCode).toBe(404);
    expect((await api(app, stocker).post('/knowledge', { question_zh: 'q', answer_zh: 'a' })).statusCode).toBe(403);
    const tmp = await api(app, manager).post('/knowledge', { question_zh: '临时', answer_zh: '临时答案' }); expect((await api(app, manager).del(`/knowledge/${tmp.json().id}`)).statusCode).toBe(200);
    expect((await api(app, manager).get('/knowledge')).json().some((k: any) => k.id === tmp.json().id)).toBe(false);
  });
  it('/bot/queries 按角色、/bot/queries/:code/run 权限、/bot/stats', async () => {
    const s = (await api(app, stocker).get('/bot/queries')).json().map((q: any) => q.code); expect(s).toContain('PRODUCT_LOCATION_SHOP'); expect(s).not.toContain('PRODUCT_COST');
    const b = (await api(app, boss).get('/bot/queries')).json().map((q: any) => q.code); expect(b).toContain('PRODUCT_COST'); expect(b.length).toBeGreaterThanOrEqual(14);
    expect((await api(app, stocker).post('/bot/queries/PRODUCT_COST/run', { params: { product: '可乐' } })).statusCode).toBe(403);
    const r = await api(app, stocker).post('/bot/queries/STOCK_BY_BARCODE/run', { params: { barcode_or_name: '9556001234567' } }); expect(r.statusCode).toBe(200); expect(r.json().text).toContain('48');
    const st = await api(app, manager).get('/bot/stats'); expect(st.statusCode).toBe(200); expect(st.json().conversations.total).toBeGreaterThanOrEqual(8);
  });
  it('语音上传：转文字未接入时回"请打字"', async () => {
    const r = await api(app, stocker).upload('/bot/ask', 'q.webm', Buffer.from('fake-audio'), {}, stocker);
    expect(r.statusCode).toBe(200); expect(r.json().needs_text).toBe(true); expect(r.json().answer).toContain('请打字');
  });
  it('/bot/escalate 直接转主管', async () => {
    const r = await api(app, cashier).post('/bot/escalate', { text: '收银机抽屉打不开' }); expect(r.statusCode).toBe(200);
    expect((await adminPool.query(`SELECT type, owner_id FROM ticket WHERE id = $1`, [r.json().ticket_id])).rows[0]).toMatchObject({ type: 'BOT_UNANSWERED', owner_id: managerId });
  });
});

describe('工单完整版', () => {
  let id: string;
  it('创建：期限按类型默认、默认负责角色；重复 client_id 返回原单', async () => {
    const cid = randomUUID();
    const r = await api(app, stocker).post('/tickets', { client_id: cid, type: 'MANUAL', title: '货架 A-02 松了', text: '需要修' }); expect(r.statusCode).toBe(201); id = r.json().id;
    expect(r.json().owner_role_code).toBe('MANAGER'); expect(new Date(r.json().deadline_at).getTime() - Date.now()).toBeGreaterThan(47 * 3600_000);
    const d = await api(app, stocker).post('/tickets', { client_id: cid, type: 'MANUAL', title: '货架 A-02 松了' }); expect(d.statusCode).toBe(200); expect(d.json().id).toBe(id);
    const neg = await api(app, manager).post('/tickets', { type: 'NEGATIVE_STOCK', title: '负库存' }); expect(neg.json().owner_role_code).toBe('COUNTER'); expect(new Date(neg.json().deadline_at).getHours()).toBe(23);
  });
  it('经理在 /tickets/mine 看到角色工单；上架员看到自己建的；收银员看不到详情', async () => {
    expect((await api(app, manager).get('/tickets/mine')).json().some((t: any) => t.id === id)).toBe(true);
    expect((await api(app, stocker).get('/tickets/mine')).json().some((t: any) => t.id === id)).toBe(true);
    expect((await api(app, cashier).get(`/tickets/${id}`)).statusCode).toBe(403);
    expect((await api(app, cashier).get('/tickets')).statusCode).toBe(403);
  });
  it('评论 + 照片事件写时间线', async () => {
    expect((await api(app, manager).post(`/tickets/${id}/events`, { event: 'COMMENT', text: '明天修' })).statusCode).toBe(200);
    expect((await api(app, manager).post(`/tickets/${id}/events`, { event: 'PHOTO', photo_url: '/api/v1/files/x.jpg', text: '现场' })).statusCode).toBe(200);
    const t = (await api(app, manager).get(`/tickets/${id}`)).json(); expect(t.events.map((e: any) => e.event)).toEqual(['CREATED', 'COMMENT', 'PHOTO']); expect(t.events[1].user_name).toBe('经理小李');
  });
  it('转派给收银员（ticket.manage）并通知；上架员不能转派', async () => {
    expect((await api(app, stocker).post(`/tickets/${id}/assign`, { owner_id: cashierId })).statusCode).toBe(403);
    const r = await api(app, manager).post(`/tickets/${id}/assign`, { owner_id: cashierId, deadline_at: new Date(Date.now() + 86400_000).toISOString() }); expect(r.statusCode).toBe(200); expect(r.json().owner_id).toBe(cashierId);
    expect((await adminPool.query(`SELECT count(*) n FROM notification WHERE user_id = $1 AND type = 'TICKET_ASSIGNED'`, [cashierId])).rows[0].n).toBe(1);
    expect((await api(app, cashier).get(`/tickets/${id}`)).statusCode).toBe(200);
  });
  it('关闭带原因；stats 按类型/原因/超期率', async () => {
    const c = await api(app, cashier).post(`/tickets/${id}/close`, { reason_code: 'FIXED', text: '已修好' }); expect(c.statusCode).toBe(200); expect(c.json().status).toBe('CLOSED'); expect(c.json().close_reason).toBe('FIXED');
    const s = await api(app, manager).get('/tickets/stats'); expect(s.statusCode).toBe(200);
    expect(s.json().by_type.find((x: any) => x.type === 'MANUAL').total).toBeGreaterThanOrEqual(1);
    expect(s.json().close_reasons.some((x: any) => x.type === 'MANUAL' && x.close_reason === 'FIXED')).toBe(true);
    expect(s.json().close_reasons.some((x: any) => x.type === 'CUSTOMER_HELP' && x.close_reason === 'CUSTOMER_LEFT')).toBe(true);
    expect(typeof s.json().overdue_rate).toBe('number');
    const all = await api(app, manager).get('/tickets?type=MANUAL&status=CLOSED'); expect(all.json().some((t: any) => t.id === id)).toBe(true);
  });
  it('超期提醒 runOverdueCheck：老板和负责人都收到 notification', async () => {
    const r = await api(app, manager).post('/tickets', { type: 'MANUAL', title: '超期测试', owner_id: stockerId, deadline_at: new Date(Date.now() - 3600_000).toISOString() }); expect(r.statusCode).toBe(201);
    const n = await runOverdueCheck(companyId); expect(n).toBeGreaterThanOrEqual(1);
    const bossN = await adminPool.query(`SELECT n.* FROM notification n JOIN app_user u ON u.id = n.user_id WHERE n.company_id = $1 AND n.type = 'TICKET_OVERDUE' AND u.phone = '0130000001'`, [companyId]); expect(bossN.rows.length).toBe(1); expect(bossN.rows[0].text).toContain('超期测试');
    const mine = await adminPool.query(`SELECT * FROM notification WHERE user_id = $1 AND type = 'TICKET_OVERDUE'`, [stockerId]); expect(mine.rows.length).toBe(1);
  });
});
