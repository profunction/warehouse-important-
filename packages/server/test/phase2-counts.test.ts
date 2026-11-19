// 模块 B：盲盘盘点、统一审批、代理、手动调整、Telegram 入口。DATABASE_NAME=warehouse_test_counts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/app.js';
import { api } from './helpers.js';
import { closePools, adminPool } from '../src/lib/db.js';
import { invalidatePermCache } from '../src/lib/auth.js';
import { dailyReportText, expireDelegations, overdueTicketReminders } from '../src/lib/countJobs.js';

process.env.TELEGRAM_WEBHOOK_SECRET = 'test-webhook-secret';
const app = buildApp();
let sa: string, boss: string, manager: string, counter: string, wh: string, staffX: string;
let companyId: string, siteId: string, bossId: string, managerId: string, counterId: string, whId: string, staffXId: string, counterDevice: string;
const P: Record<string, string> = {}; const L: Record<string, string> = {};
let S1: string, S1approval: string, S1lines: any[] = [], recountId: string, S4approval: string, bigAdjust: string;
const A = () => api(app);
const login = async (phone: string, pin: string, dev = false) => { const r = await A().post('/auth/login', { company_code: 'CNT01', phone, pin, device: dev ? { name: 'ph', type: 'PHONE', app_version: '0.1.0' } : undefined }); expect(r.statusCode).toBe(200); return r.json(); };
const mkUser = async (name: string, role: string, phone: string) => { const r = await api(app, boss).post('/users', { name, phone, roles: [{ role_code: role, site_id: siteId }] }); expect(r.statusCode).toBe(201); return { id: r.json().id as string, pin: r.json().pin as string }; };
const stockAt = async (tok: string, pid: string, code: string) => Number(((await api(app, tok).get(`/stock/by-product/${pid}`)).json().find((r: any) => r.code === code)?.qty) ?? 0);
/** 跑一个盘点：建会话（单货位）→ start → 录行 → 完成 → 提交，返回提交结果 */
async function runCount(locCode: string, lines: { pid: string; qty: number }[], assignee = counterId, tok = counter) {
  const c = await api(app, manager).post('/counts', { location_codes: [locCode], assigned_to: assignee }); expect(c.statusCode).toBe(201);
  const id = c.json().id;
  expect((await api(app, tok).post(`/counts/${id}/start`)).statusCode).toBe(200);
  for (const l of lines) expect((await api(app, tok).post(`/counts/${id}/lines`, { client_id: randomUUID(), location_id: L[locCode], product_id: l.pid, counted_qty: l.qty })).statusCode).toBe(201);
  expect((await api(app, tok).post(`/counts/${id}/location-done`, { location_id: L[locCode], is_empty: lines.length === 0 })).statusCode).toBe(200);
  const s = await api(app, tok).post(`/counts/${id}/submit`); expect(s.statusCode).toBe(200);
  return s.json();
}

beforeAll(async () => {
  await app.ready();
  sa = (await A().post('/auth/login', { email: 'admin@test.local', pin: '123456' })).json().access_token;
  const c = await api(app, sa).post('/admin/companies', { name: '盘点测试公司', short_code: 'CNT01', plan: 'B', boss_name: '老板', boss_phone: '0130000001', boss_pin: '111111' });
  expect(c.statusCode).toBe(201); companyId = c.json().company_id; siteId = c.json().site_id; bossId = c.json().boss_user_id;
  boss = (await login('0130000001', '111111')).access_token;
  const m = await mkUser('经理', 'MANAGER', '0130000002'); managerId = m.id; manager = (await login('0130000002', m.pin)).access_token;
  const k = await mkUser('盘点员', 'COUNTER', '0130000003'); counterId = k.id; const kl = await login('0130000003', k.pin, true); counter = kl.access_token; counterDevice = kl.device_id;
  const w = await mkUser('仓库员', 'WAREHOUSE', '0130000004'); whId = w.id; wh = (await login('0130000004', w.pin)).access_token;
  const x = await mkUser('上架小李', 'STOCKER', '0130000005'); staffXId = x.id; staffX = (await login('0130000005', x.pin)).access_token;
  // 区 A：2 架 2 层；区 B：1 架 1 层（给循环盘点用）
  expect((await api(app, boss).post('/zones', { site_id: siteId, code: 'A', zone_type: 'STORAGE', racks: 2, levels: 2, name_zh: 'A 区' })).statusCode).toBe(201);
  expect((await api(app, boss).post('/zones', { site_id: siteId, code: 'B', zone_type: 'STORAGE', racks: 1, levels: 1, name_zh: 'B 区' })).statusCode).toBe(201);
  for (const l of (await api(app, boss).get('/locations?include_virtual=true')).json()) L[l.code] = l.id;
  const catR = await api(app, boss).post('/categories', { code: 'GEN', name_zh: '通用' }); expect(catR.statusCode).toBe(201); const cat = catR.json().id;
  const mk = async (key: string, zh: string, cost: number, bc: string) => { const r = await api(app, boss).post('/products', { name_zh: zh, name_en: key, category_id: cat, cost_price: cost, sell_price: cost * 1.5, min_level: 1, reorder_qty: 10, barcode: bc }); expect(r.statusCode).toBe(201); P[key] = r.json().id; };
  await mk('P1', '贵货', 20, '9550000000011'); await mk('P2', '中货', 5, '9550000000028'); await mk('P3', '便宜货', 1, '9550000000035'); await mk('P4', '普通货', 3, '9550000000042');
  const recv = async (pid: string, code: string, qty: number) => { const r = await api(app, wh).post('/movements', { product_id: pid, from_location_code: 'SUPPLIER', to_location_code: code, qty, reason: 'RECEIVE' }); expect(r.statusCode).toBe(201); };
  await recv(P.P1, 'A-01-1', 10); await recv(P.P2, 'A-01-1', 10); await recv(P.P3, 'A-01-2', 10); await recv(P.P4, 'A-02-1', 10); await recv(P.P4, 'A-02-2', 10);
});
afterAll(async () => { await app.close(); await closePools(); });

describe('盘点流程（A5/B8）', () => {
  it('经理建盘点指派盘点员：按区生成 4 个货位路线，不拍快照', async () => {
    const zones = (await api(app, manager).get('/zones')).json(); const za = zones.find((z: any) => z.code === 'A');
    const r = await api(app, manager).post('/counts', { zone_id: za.id, assigned_to: counterId, count_type: 'FULL' });
    expect(r.statusCode).toBe(201); S1 = r.json().id;
    expect(r.json().session_no).toBe('CS-0001'); expect(r.json().status).toBe('ASSIGNED'); expect(r.json().location_ids).toEqual([L['A-01-1'], L['A-01-2'], L['A-02-1'], L['A-02-2']]);
    expect(Number((await adminPool.query(`SELECT count(*) n FROM count_snapshot WHERE session_id = $1`, [S1])).rows[0].n)).toBe(0);
    expect((await api(app, counter).post('/counts', { zone_id: za.id, assigned_to: counterId })).statusCode).toBe(403);
  });
  it('盘点员 my-today：有任务、含货位路线、不含系统量', async () => {
    const r = await api(app, counter).get('/counts/my-today'); expect(r.statusCode).toBe(200);
    expect(r.json().length).toBe(1); expect(r.json()[0].locations.length).toBe(4); expect(r.json()[0].done).toBe(0);
    expect(r.body).not.toContain('system_qty'); expect(r.body).not.toContain('variance');
    expect((await api(app, wh).get('/counts/my-today')).json().length).toBe(0);
  });
  it('start：IN_PROGRESS 并拍快照（5 行，含 unit_cost）', async () => {
    const r = await api(app, counter).post(`/counts/${S1}/start`); expect(r.statusCode).toBe(200); expect(r.json().status).toBe('IN_PROGRESS');
    const snap = (await adminPool.query(`SELECT * FROM count_snapshot WHERE session_id = $1`, [S1])).rows;
    expect(snap.length).toBe(5); expect(Number(snap.find((s) => s.product_id === P.P1).unit_cost)).toBe(20);
    expect(r.body).not.toContain('system_qty');
  });
  it('录入：少 3、多 2、重扫覆盖、client_id 幂等、不返回系统量；别人的会话 403；不在路线的货位 400', async () => {
    const cid = randomUUID();
    const a = await api(app, counter).post(`/counts/${S1}/lines`, { client_id: cid, location_id: L['A-01-1'], product_id: P.P1, counted_qty: 8 }); expect(a.statusCode).toBe(201); expect(a.body).not.toContain('system_qty');
    const dup = await api(app, counter).post(`/counts/${S1}/lines`, { client_id: cid, location_id: L['A-01-1'], product_id: P.P1, counted_qty: 8 }); expect(dup.statusCode).toBe(200); expect(dup.json().duplicate).toBe(true);
    const b = await api(app, counter).post(`/counts/${S1}/lines`, { client_id: randomUUID(), location_code: 'A-01-1', barcode: '9550000000011', counted_qty: 7 }); expect(b.statusCode).toBe(201); expect(Number(b.json().counted_qty)).toBe(7);
    expect(Number((await adminPool.query(`SELECT count(*) n FROM count_line WHERE session_id = $1`, [S1])).rows[0].n)).toBe(1);   // 覆盖不是累加
    expect((await api(app, counter).post(`/counts/${S1}/lines`, { client_id: randomUUID(), location_id: L['A-01-1'], product_id: P.P2, counted_qty: 12 })).statusCode).toBe(201);
    expect((await api(app, counter).post(`/counts/${S1}/lines`, { client_id: randomUUID(), location_id: L['A-02-1'], product_id: P.P4, counted_qty: 10 })).statusCode).toBe(201);
    expect((await api(app, counter).post(`/counts/${S1}/lines`, { client_id: randomUUID(), location_id: L['A-02-2'], product_id: P.P4, counted_qty: 10 })).statusCode).toBe(201);
    const other = await api(app, wh).post(`/counts/${S1}/lines`, { client_id: randomUUID(), location_id: L['A-01-1'], product_id: P.P1, counted_qty: 1 }); expect(other.statusCode).toBe(403); expect(other.json().code).toBe('COUNT_NOT_YOURS');
    const bad = await api(app, counter).post(`/counts/${S1}/lines`, { client_id: randomUUID(), location_id: L['B-01-1'], product_id: P.P1, counted_qty: 1 }); expect(bad.statusCode).toBe(400); expect(bad.json().code).toBe('COUNT_LOCATION_NOT_IN_SESSION');
  });
  it('未全部货位完成提交 400', async () => {
    expect((await api(app, counter).post(`/counts/${S1}/location-done`, { location_id: L['A-01-1'] })).json().all_done).toBe(false);
    const r = await api(app, counter).post(`/counts/${S1}/submit`); expect(r.statusCode).toBe(400); expect(r.json().code).toBe('COUNT_STATE'); expect(r.json().detail.not_done.length).toBe(3);
  });
  it('全部完成提交：未数视为 0，3 行差异，PENDING_APPROVAL，毛金额 80', async () => {
    for (const c of ['A-01-2', 'A-02-1', 'A-02-2']) expect((await api(app, counter).post(`/counts/${S1}/location-done`, { location_id: L[c], is_empty: c === 'A-01-2' })).statusCode).toBe(200);
    const r = await api(app, counter).post(`/counts/${S1}/submit`); expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe('PENDING_APPROVAL'); expect(r.json().variance_lines).toBe(3); S1approval = r.json().approval_id; expect(S1approval).toBeTruthy();
    expect(r.body).not.toContain('variance_amount');
    const a = (await adminPool.query(`SELECT * FROM approval_request WHERE id = $1`, [S1approval])).rows[0];
    expect(a.type).toBe('COUNT_VARIANCE'); expect(a.status).toBe('PENDING'); expect(a.approver_role_code).toBe('MANAGER'); expect(Number(a.amount)).toBe(80);
    expect((await api(app, counter).post(`/counts/${S1}/submit`)).statusCode).toBe(400);
  });
  it('审批记录在经理待批清单里，Telegram 未配置 → notification 表有审批文字', async () => {
    const r = await api(app, manager).get('/approvals/pending'); expect(r.statusCode).toBe(200);
    const a = r.json().find((x: any) => x.id === S1approval); expect(a).toBeTruthy(); expect(a.as_self).toBe(true); expect(a.type_zh).toBe('盘点差异');
    const n = (await adminPool.query(`SELECT * FROM notification WHERE ref_id = $1 AND channel = 'TELEGRAM'`, [S1approval])).rows;
    expect(n.length).toBeGreaterThan(0); expect(n[0].text).toContain('盘点差异'); expect(n[0].user_id).toBe(bossId);
    expect((await api(app, counter).get('/approvals/pending')).json().length).toBe(0);
  });
  it('盘点员批自己 403；盘点员看不了差异明细', async () => {
    const r = await api(app, counter).post(`/approvals/${S1approval}/decide`, { decision: 'approve' }); expect(r.statusCode).toBe(403); expect(r.json().code).toBe('APPROVAL_NOT_ALLOWED');
    expect((await api(app, counter).get(`/counts/${S1}/variance`)).statusCode).toBe(403);
  });
  it('经理看差异明细：系统/实数/差/金额', async () => {
    const r = await api(app, manager).get(`/counts/${S1}/variance`); expect(r.statusCode).toBe(200);
    S1lines = r.json().lines; expect(S1lines.length).toBe(5);
    const p1 = S1lines.find((l: any) => l.product_id === P.P1); expect(Number(p1.system_qty)).toBe(10); expect(Number(p1.counted_qty)).toBe(7); expect(Number(p1.variance_qty)).toBe(-3); expect(Number(p1.variance_amount)).toBe(-60); expect(p1.counted_by_name).toBe('盘点员');
    const p3 = S1lines.find((l: any) => l.product_id === P.P3); expect(Number(p3.counted_qty)).toBe(0); expect(Number(p3.variance_qty)).toBe(-10);
    expect(S1lines.filter((l: any) => Number(l.variance_qty) !== 0).length).toBe(3);
    const d = await api(app, manager).get(`/approvals/${S1approval}`); expect(d.statusCode).toBe(200); expect(d.json().detail.lines.length).toBe(5); expect(d.json().can_decide).toBe(true);
  });
  it('经理 approve：ACCEPT 两行、RECOUNT 一行 → 会话 RECOUNT，审批 APPROVED', async () => {
    const p3 = S1lines.find((l: any) => l.product_id === P.P3);
    const r = await api(app, manager).post(`/counts/${S1}/approve`, { decision: 'approve', lines: [{ id: p3.id, decision: 'RECOUNT' }], note: '便宜货再数' });
    expect(r.statusCode).toBe(200); expect(r.json().approval.status).toBe('APPROVED'); expect(r.json().approval.approver_id).toBe(managerId); expect(r.json().approval.on_behalf_of).toBeNull();
    expect(r.json().session.status).toBe('RECOUNT'); recountId = r.json().recount?.id; expect(recountId).toBeTruthy();
    expect((await api(app, manager).post(`/approvals/${S1approval}/decide`, { decision: 'approve' })).json().code).toBe('APPROVAL_NOT_PENDING');
  });
  it('库存按差异变化：P1 10→7（3 进 DAMAGED），P2 10→12（SUPPLIER 来），P3 重盘不动', async () => {
    expect(await stockAt(manager, P.P1, 'A-01-1')).toBe(7); expect(await stockAt(manager, P.P2, 'A-01-1')).toBe(12); expect(await stockAt(manager, P.P3, 'A-01-2')).toBe(10);
    const dmg = (await adminPool.query(`SELECT s.qty FROM stock s JOIN location l ON l.id = s.location_id WHERE l.company_id = $1 AND l.virtual_type = 'DAMAGED' AND s.product_id = $2`, [companyId, P.P1])).rows[0]; expect(Number(dmg.qty)).toBe(3);
    const mv = (await adminPool.query(`SELECT * FROM movement WHERE ref_type = 'COUNT' AND ref_id = $1`, [S1])).rows; expect(mv.length).toBe(2); expect(mv.every((m) => m.reason === 'COUNT' && m.performed_by === managerId)).toBe(true);
  });
  it('新 RECOUNT 会话存在：指派原人、只含重盘货位、指回原会话；盘点员 my-today 看到它', async () => {
    const list = (await api(app, manager).get('/counts?status=ASSIGNED')).json(); const rc = list.find((s: any) => s.id === recountId);
    expect(rc).toBeTruthy(); expect(rc.parent_session_id).toBe(S1); expect(rc.assigned_to).toBe(counterId); expect(rc.location_ids).toEqual([L['A-01-2']]); expect(rc.session_no).toBe('CS-0002');
    const my = (await api(app, counter).get('/counts/my-today')).json(); expect(my.some((s: any) => s.id === recountId)).toBe(true);
    const detail = (await api(app, manager).get(`/counts/${S1}`)).json(); expect(detail.children.length).toBe(1); expect(detail.lines.length).toBe(5);
  });
  it('超门槛（毛 80 > 50）开 COUNT_VARIANCE 工单给经理 2 天', async () => {
    const t = (await api(app, manager).get('/tickets?type=COUNT_VARIANCE')).json().find((x: any) => x.ref_id === S1);
    expect(t).toBeTruthy(); expect(t.owner_role_code).toBe('MANAGER'); expect(t.title).toContain('CS-0001'); expect(new Date(t.deadline_at).getTime()).toBeGreaterThan(Date.now() + 40 * 3600_000);
  });
  it('离线同步 count_line / count_location_done → 重盘会话录入后提交，差异 0 直接 APPROVED', async () => {
    const batch = { batch_id: randomUUID(), device_id: counterDevice, app_version: '0.1.0', device_time: new Date().toISOString(), items: [
      { client_id: randomUUID(), entity: 'count_line', op: 'insert', seq: 1, payload: { session_id: recountId, location_id: L['A-01-2'], product_id: P.P3, counted_qty: 10, counted_at: new Date().toISOString() } },
      { client_id: randomUUID(), entity: 'count_location_done', op: 'insert', seq: 2, payload: { session_id: recountId, location_id: L['A-01-2'], is_empty: false } },
    ] };
    const r = await api(app, counter).post('/sync/push', batch); expect(r.statusCode).toBe(200); expect(r.json().results.every((x: any) => x.status === 'applied')).toBe(true);
    const dupR = await api(app, counter).post('/sync/push', { ...batch, batch_id: randomUUID() }); expect(dupR.json().results.every((x: any) => x.status === 'duplicate')).toBe(true);
    const s = await api(app, counter).post(`/counts/${recountId}/submit`); expect(s.statusCode).toBe(200); expect(s.json().status).toBe('APPROVED'); expect(s.json().approval_id).toBeNull();
    expect((await adminPool.query(`SELECT status FROM count_session WHERE id = $1`, [recountId])).rows[0].status).toBe('APPROVED');
  });
  it('我的记录（30 天）：会话、差异行数、准确率，不含系统量', async () => {
    const r = await api(app, counter).get('/counts/my-records'); expect(r.statusCode).toBe(200);
    expect(r.json().length).toBe(2); expect(r.body).not.toContain('system_qty'); expect(r.body).not.toContain('amount');
    const s1 = r.json().find((x: any) => x.id === S1); expect(Number(s1.variance_lines)).toBe(3); expect(Number(s1.accuracy_pct)).toBe(40);
    const st = await api(app, manager).get('/counts/stats'); expect(st.statusCode).toBe(200); expect(st.json()[0].name).toBe('盘点员');
  });
  it('审批退回 → 会话回到 IN_PROGRESS，可再提交', async () => {
    const sub = await runCount('A-02-1', [{ pid: P.P4, qty: 9 }]); expect(sub.status).toBe('PENDING_APPROVAL');
    const r = await api(app, manager).post(`/approvals/${sub.approval_id}/decide`, { decision: 'return', note: '再数一次' }); expect(r.statusCode).toBe(200); expect(r.json().status).toBe('RETURNED');
    const my = (await api(app, counter).get('/counts/my-today')).json().find((s: any) => s.id === sub.id); expect(my.status).toBe('IN_PROGRESS'); expect(my.done).toBe(0);
    expect((await api(app, counter).post(`/counts/${sub.id}/lines`, { client_id: randomUUID(), location_id: L['A-02-1'], product_id: P.P4, counted_qty: 10 })).statusCode).toBe(201);
    expect((await api(app, counter).post(`/counts/${sub.id}/location-done`, { location_id: L['A-02-1'] })).statusCode).toBe(200);
    const s2 = await api(app, counter).post(`/counts/${sub.id}/submit`); expect(s2.json().status).toBe('APPROVED');
  });
});

describe('手动调整（M4）', () => {
  it('门槛设定；经理小额调整 → 经理级审批，自己批 400 APPROVAL_SELF', async () => {
    expect((await api(app, boss).put('/company/settings', { settings: { approval_threshold_adjust: 100 } })).statusCode).toBe(200); invalidatePermCache();
    const r = await api(app, manager).post('/adjustments', { client_id: randomUUID(), product_id: P.P3, location_code: 'A-01-2', new_qty: 9, reason: 'DAMAGED', note: '包装破' });
    expect(r.statusCode).toBe(201); expect(r.json().type).toBe('ADJUST'); expect(r.json().approver_role_code).toBe('MANAGER'); expect(Number(r.json().amount)).toBe(1); expect(r.json().summary.diff).toBe(-1);
    const self = await api(app, manager).post(`/approvals/${r.json().id}/decide`, { decision: 'approve' }); expect(self.statusCode).toBe(400); expect(self.json().code).toBe('APPROVAL_SELF');
    expect((await api(app, counter).post('/adjustments', { product_id: P.P3, location_code: 'A-01-2', new_qty: 9, reason: 'DAMAGED' })).statusCode).toBe(403);
    expect((await api(app, manager).post('/adjustments', { product_id: P.P3, location_code: 'A-01-2', new_qty: 10, reason: 'OTHER' })).statusCode).toBe(400);   // 无变化
  });
  it('经理大额（超门槛）→ 老板；老板批准 → 库存变、移动 ADJUST；client_id 幂等', async () => {
    const cid = randomUUID();
    const r = await api(app, manager).post('/adjustments', { client_id: cid, barcode: '9550000000011', location_id: L['A-01-1'], new_qty: 0, reason: 'EXPIRED', photo_url: 'data:image/jpeg;base64,/9j/4AAQ' });
    expect(r.statusCode).toBe(201); bigAdjust = r.json().id; expect(r.json().approver_role_code).toBe('BOSS'); expect(Number(r.json().amount)).toBe(140);
    const dup = await api(app, manager).post('/adjustments', { client_id: cid, barcode: '9550000000011', location_id: L['A-01-1'], new_qty: 0, reason: 'EXPIRED' }); expect(dup.statusCode).toBe(200); expect(dup.json().id).toBe(bigAdjust);
    expect((await api(app, manager).post(`/approvals/${bigAdjust}/decide`, { decision: 'approve' })).statusCode).toBe(403);   // 经理不是老板级
    const pend = (await api(app, boss).get('/approvals/pending')).json(); expect(pend.some((a: any) => a.id === bigAdjust)).toBe(true);
    const ok = await api(app, boss).post(`/approvals/${bigAdjust}/decide`, { decision: 'approve', note: '看过照片' }); expect(ok.statusCode).toBe(200); expect(ok.json().status).toBe('APPROVED');
    expect(await stockAt(boss, P.P1, 'A-01-1')).toBe(0);
    const mv = (await adminPool.query(`SELECT * FROM movement WHERE id = $1`, [ok.json().ref_id])).rows[0]; expect(mv.reason).toBe('ADJUST'); expect(mv.ref_type).toBe('ADJUST'); expect(Number(mv.qty)).toBe(7); expect(mv.performed_by).toBe(bossId);
    const det = await api(app, boss).get(`/approvals/${bigAdjust}`); expect(det.json().detail.adjustment.reason).toBe('EXPIRED'); expect(det.json().approver_name).toBe('老板');
  });
  it('B 模式老板批自己发起的 400 APPROVAL_SELF', async () => {
    const r = await api(app, boss).post('/adjustments', { product_id: P.P2, location_code: 'A-01-1', new_qty: 40, reason: 'MISCOUNT' }); expect(r.statusCode).toBe(201); expect(r.json().approver_role_code).toBe('BOSS'); expect(r.json().status).toBe('PENDING');
    const self = await api(app, boss).post(`/approvals/${r.json().id}/decide`, { decision: 'approve' }); expect(self.statusCode).toBe(400); expect(self.json().code).toBe('APPROVAL_SELF');
    expect((await api(app, boss).post(`/approvals/${r.json().id}/decide`, { decision: 'reject', note: '不对' })).json().code).toBe('APPROVAL_SELF');
    await adminPool.query(`UPDATE approval_request SET status = 'REJECTED' WHERE id = $1`, [r.json().id]);
  });
  it('经理每日累计超 adjust_daily_limit（500）→ 升级老板', async () => {
    expect((await api(app, boss).put('/company/settings', { settings: { approval_threshold_adjust: 1000 } })).statusCode).toBe(200); invalidatePermCache();
    const r = await api(app, manager).post('/adjustments', { product_id: P.P2, location_code: 'A-01-1', new_qty: 92, reason: 'MISCOUNT' });   // +80 × 5 = 400；今日已 141 → 541 > 500
    expect(r.statusCode).toBe(201); expect(r.json().approver_role_code).toBe('BOSS'); expect(Number(r.json().amount)).toBe(400);
    const list = await api(app, manager).get('/adjustments'); expect(list.statusCode).toBe(200); expect(list.json().length).toBeGreaterThanOrEqual(3); expect(list.body).not.toContain('unit_cost');   // 经理看不到成本
    expect((await api(app, boss).put('/company/settings', { settings: { approval_threshold_adjust: 100 } })).statusCode).toBe(200); invalidatePermCache();
  });
});

describe('代理（老板不在）', () => {
  it('老板指定上架小李为代理：范围 COUNT_VARIANCE，单笔 ≤ 100；通知；/me/delegations', async () => {
    const ends = new Date(Date.now() + 7 * 86400_000).toISOString();
    const r = await api(app, boss).post('/delegations', { delegate_id: staffXId, scope_types: ['COUNT_VARIANCE'], per_item_limit: 100, ends_at: ends, note: '出国一周' });
    expect(r.statusCode).toBe(201); expect(r.json().status).toBe('ACTIVE'); expect(r.json().delegator_id).toBe(bossId); expect(r.json().delegate_name).toBe('上架小李');
    const me = await api(app, staffX).get('/me/delegations'); expect(me.json().length).toBe(1); expect(me.json()[0].delegator_name).toBe('老板'); expect(me.json()[0].delegator_roles).toContain('BOSS');
    expect((await adminPool.query(`SELECT count(*) n FROM notification WHERE user_id = $1 AND type = 'DELEGATION'`, [staffXId])).rows[0].n).toBe(1);
    // 规则：经理不能替老板设；超 30 天；自己指定自己
    expect((await api(app, manager).post('/delegations', { delegate_id: staffXId, delegator_id: bossId, ends_at: ends })).statusCode).toBe(403);
    expect((await api(app, boss).post('/delegations', { delegate_id: staffXId, ends_at: new Date(Date.now() + 40 * 86400_000).toISOString() })).json().code).toBe('DELEGATION_INVALID');
    expect((await api(app, boss).post('/delegations', { delegate_id: bossId, ends_at: ends })).json().code).toBe('DELEGATION_INVALID');
    expect((await api(app, counter).post('/delegations', { delegate_id: staffXId, ends_at: ends })).statusCode).toBe(403);
  });
  it('小李批小额（老板级盘点差异 15）成功：on_behalf_of = 老板，库存变', async () => {
    expect((await api(app, boss).put('/company/settings', { settings: { approval_threshold_count_variance: 10 } })).statusCode).toBe(200); invalidatePermCache();
    const sub = await runCount('A-02-1', [{ pid: P.P4, qty: 5 }]);   // 10 → 5：-5 × 3 = 15 > 10 → BOSS
    const a = (await adminPool.query(`SELECT approver_role_code FROM approval_request WHERE id = $1`, [sub.approval_id])).rows[0]; expect(a.approver_role_code).toBe('BOSS');
    const pend = (await api(app, staffX).get('/approvals/pending')).json(); const row = pend.find((x: any) => x.id === sub.approval_id);
    expect(row).toBeTruthy(); expect(row.as_self).toBe(false); expect(row.as_delegate).toBe(true); expect(row.on_behalf_name).toBe('老板');
    expect((await api(app, staffX).get(`/approvals/${sub.approval_id}`)).json().detail.lines.length).toBeGreaterThan(0);   // 代理人能看差异明细
    const r = await api(app, staffX).post(`/approvals/${sub.approval_id}/decide`, { decision: 'approve' }); expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe('APPROVED'); expect(r.json().approver_id).toBe(staffXId); expect(r.json().on_behalf_of).toBe(bossId); expect(r.json().delegation_id).toBeTruthy();
    expect(await stockAt(manager, P.P4, 'A-02-1')).toBe(5);
    const mv = (await adminPool.query(`SELECT performed_by FROM movement WHERE ref_type = 'COUNT' AND ref_id = $1`, [sub.id])).rows[0]; expect(mv.performed_by).toBe(bossId);   // 移动记在被代理人名下
    const hist = (await api(app, boss).get('/approvals?type=COUNT_VARIANCE')).json().find((x: any) => x.id === sub.approval_id); expect(hist.on_behalf_name).toBe('老板'); expect(hist.approver_name).toBe('上架小李');
  });
  it('小李批大额（150 > 100）403 DELEGATION_LIMIT；经理也批不了老板级', async () => {
    const sub = await runCount('A-02-2', [{ pid: P.P4, qty: 60 }]);   // 10 → 60：+50 × 3 = 150
    S4approval = sub.approval_id;
    const r = await api(app, staffX).post(`/approvals/${S4approval}/decide`, { decision: 'approve' }); expect(r.statusCode).toBe(403); expect(r.json().code).toBe('DELEGATION_LIMIT');
    expect((await api(app, staffX).get('/approvals/pending')).json().some((x: any) => x.id === S4approval)).toBe(false);
    const m = await api(app, manager).post(`/approvals/${S4approval}/decide`, { decision: 'approve' }); expect(m.statusCode).toBe(403); expect(m.json().code).toBe('APPROVAL_NOT_ALLOWED');
  });
  it('撤销后小李批 403；列表显示 REVOKED', async () => {
    const d = (await api(app, boss).get('/delegations')).json().find((x: any) => x.delegate_id === staffXId && x.status === 'ACTIVE'); expect(Number(d.used_count)).toBe(1);
    expect((await api(app, manager).post(`/delegations/${d.id}/revoke`)).statusCode).toBe(403);
    const r = await api(app, boss).post(`/delegations/${d.id}/revoke`); expect(r.statusCode).toBe(200); expect(r.json().status).toBe('REVOKED');
    const sub = await runCount('A-01-2', [{ pid: P.P3, qty: 0 }]);   // 10 → 0：-10 × 1 = 10，不超 10 → MANAGER；换个老板级的用 S4
    expect((await adminPool.query(`SELECT approver_role_code FROM approval_request WHERE id = $1`, [sub.approval_id])).rows[0].approver_role_code).toBe('MANAGER');
    const x = await api(app, staffX).post(`/approvals/${S4approval}/decide`, { decision: 'approve' }); expect(x.statusCode).toBe(403); expect(x.json().code).toBe('APPROVAL_NOT_ALLOWED');
    expect((await api(app, staffX).get('/me/delegations')).json().length).toBe(0);
    expect((await api(app, boss).get('/delegations?status=REVOKED')).json().length).toBe(1);
    expect((await api(app, manager).post(`/approvals/${sub.approval_id}/decide`, { decision: 'reject', note: '重数' })).json().status).toBe('REJECTED');
    expect((await adminPool.query(`SELECT status FROM count_session WHERE id = $1`, [sub.id])).rows[0].status).toBe('CANCELLED');
  });
});

describe('A 模式', () => {
  let bossA: string, staffA: string, pA: string, cidA: string;
  it('A 模式老板自己手动调整：直接批准生效（自批 OK）', async () => {
    const c = await api(app, sa).post('/admin/companies', { name: 'A 小店', short_code: 'CNTA1', plan: 'A', boss_name: 'A 老板', boss_phone: '0130000011', boss_pin: '111111' }); expect(c.statusCode).toBe(201); cidA = c.json().company_id;
    bossA = (await A().post('/auth/login', { company_code: 'CNTA1', phone: '0130000011', pin: '111111' })).json().access_token;
    const cats = (await api(app, bossA).get('/categories')).json();
    pA = (await api(app, bossA).post('/products', { name_zh: '可乐', category_id: cats.find((x: any) => x.code === 'BEV').id, cost_price: 2, sell_price: 3, min_level: 1, reorder_qty: 10, barcode: '9550000000110' })).json().id;
    const st = await api(app, bossA).post('/users', { name: '小店库存员', phone: '0130000012', roles: [{ role_code: 'WAREHOUSE', site_id: c.json().site_id }] });
    staffA = (await A().post('/auth/login', { company_code: 'CNTA1', phone: '0130000012', pin: st.json().pin })).json().access_token;
    expect((await api(app, staffA).post('/movements', { product_id: pA, from_location_code: 'SUPPLIER', to_location_code: 'S-01', qty: 10, reason: 'RECEIVE' })).statusCode).toBe(201);
    const r = await api(app, bossA).post('/adjustments', { product_id: pA, location_code: 'S-01', new_qty: 8, reason: 'SAMPLE' });
    expect(r.statusCode).toBe(201); expect(r.json().status).toBe('APPROVED'); expect(r.json().approver_id).toBe(r.json().requested_by); expect(r.json().approver_role_code).toBe('BOSS');
    expect(await stockAt(bossA, pA, 'S-01')).toBe(8);
  });
  it('A 模式：库存员盘点 → 老板审批（Telegram 文字落在通知表）→ 库存变', async () => {
    const loc = (await api(app, bossA).get('/locations')).json().find((l: any) => l.code === 'S-01');
    const c = await api(app, bossA).post('/counts', { location_ids: [loc.id], assigned_to: (await api(app, bossA).get('/users')).json().find((u: any) => u.name === '小店库存员').id }); expect(c.statusCode).toBe(201);
    expect((await api(app, staffA).post(`/counts/${c.json().id}/lines`, { client_id: randomUUID(), location_id: loc.id, product_id: pA, counted_qty: 6 })).statusCode).toBe(201);   // 未 start 自动 start
    expect((await api(app, staffA).post(`/counts/${c.json().id}/location-done`, { location_id: loc.id })).statusCode).toBe(200);
    const sub = await api(app, staffA).post(`/counts/${c.json().id}/submit`); expect(sub.json().status).toBe('PENDING_APPROVAL');
    const a = (await adminPool.query(`SELECT approver_role_code FROM approval_request WHERE id = $1`, [sub.json().approval_id])).rows[0]; expect(a.approver_role_code).toBe('BOSS');
    expect((await api(app, bossA).post(`/approvals/${sub.json().approval_id}/decide`, { decision: 'approve' })).json().status).toBe('APPROVED');
    expect(await stockAt(bossA, pA, 'S-01')).toBe(6);
    expect((await adminPool.query(`SELECT count(*) n FROM ticket WHERE company_id = $1 AND type = 'COUNT_VARIANCE'`, [cidA])).rows[0].n).toBe(0);   // 4 元差异不超门槛
  });
});

describe('Telegram 入口', () => {
  const hook = (body: any, secret = 'test-webhook-secret') => app.inject({ method: 'POST', url: '/api/v1/bot/telegram/webhook', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': secret }, payload: JSON.stringify(body) });
  it('密钥不对 403；绑定码 + /start 绑定老板', async () => {
    expect((await hook({ message: { text: 'hi' } }, 'wrong')).statusCode).toBe(403);
    const l = await api(app, boss).post('/me/telegram-link'); expect(l.statusCode).toBe(200); expect(l.json().code).toMatch(/^\d{6}$/);
    expect((await api(app, boss).get('/me/telegram-link')).json().bound).toBe(false);
    expect((await hook({ message: { from: { id: 777001 }, chat: { id: 777001 }, text: '/start 000000' } })).json().handled).toBe('bad_code');
    const r = await hook({ message: { from: { id: 777001 }, chat: { id: 777001 }, text: `/start ${l.json().code}` } }); expect(r.statusCode).toBe(200); expect(r.json().handled).toBe('linked');
    expect((await adminPool.query(`SELECT telegram_user_id FROM app_user WHERE id = $1`, [bossId])).rows[0].telegram_user_id).toBe('777001');
    expect((await api(app, boss).get('/me/telegram-link')).json().bound).toBe(true);
    expect((await hook({ message: { from: { id: 777001 }, chat: { id: 777001 }, text: `/start ${l.json().code}` } })).json().handled).toBe('bad_code');   // 一次性
    expect((await hook({ message: { from: { id: 777001 }, chat: { id: 777001 }, text: '今天卖了多少' } })).json().handled).toBe('echo');
  });
  it('按钮回调 approve → 审批 APPROVED（老板），库存变；未绑定的人 → unbound；detail 回明细', async () => {
    const un = await hook({ callback_query: { id: '1', from: { id: 555 }, data: `apr:${S4approval}:approve`, message: { chat: { id: 555 } } } }); expect(un.json().handled).toBe('unbound');
    const d = await hook({ callback_query: { id: '2', from: { id: 777001 }, data: `apr:${S4approval}:detail`, message: { chat: { id: 777001 } } } }); expect(d.json().handled).toBe('detail');
    const r = await hook({ callback_query: { id: '3', from: { id: 777001 }, data: `apr:${S4approval}:approve`, message: { chat: { id: 777001 } } } });
    expect(r.statusCode).toBe(200); expect(r.json().handled).toBe('approve'); expect(r.json().result).toBe('APPROVED');
    const a = (await adminPool.query(`SELECT * FROM approval_request WHERE id = $1`, [S4approval])).rows[0]; expect(a.status).toBe('APPROVED'); expect(a.approver_id).toBe(bossId); expect(a.decision_note).toBe('Telegram');
    expect(await stockAt(boss, P.P4, 'A-02-2')).toBe(60);
    const again = await hook({ callback_query: { id: '4', from: { id: 777001 }, data: `apr:${S4approval}:reject`, message: { chat: { id: 777001 } } } }); expect(again.json().error).toBe('APPROVAL_NOT_PENDING');
    expect((await hook({ callback_query: { id: '5', from: { id: 777001 }, data: 'nonsense' } })).json().handled).toBe('unknown_callback');
  });
  it('公司 Telegram 设定：无 PUBLIC_URL 时记录设定不调 setWebhook', async () => {
    const r = await api(app, boss).post('/company/telegram', { chat_id: '-100123', bot_username: '@wh_test_bot' }); expect(r.statusCode).toBe(200); expect(r.json().webhook.set).toBe(false);
    const g = await api(app, boss).get('/company/telegram'); expect(g.json().chat_id).toBe('-100123'); expect(g.json().has_secret).toBe(true); expect(g.json().bot_username).toBe('wh_test_bot');
    expect((await api(app, counter).get('/company/telegram')).statusCode).toBe(403);
    const sec = (await adminPool.query(`SELECT settings->>'telegram_webhook_secret' s FROM company WHERE id = $1`, [companyId])).rows[0].s;
    expect((await hook({ message: { text: 'x' } }, sec)).statusCode).toBe(200);   // 公司自己的密钥也行
  });
});

describe('循环盘点规则与定时任务', () => {
  it('规则 CRUD（count.rules）', async () => {
    const r = await api(app, manager).post('/count-rules', { name: '高价值每周', condition: { min_value: 50 }, frequency_days: 7, lines_per_day: 20 }); expect(r.statusCode).toBe(201);
    expect((await api(app, counter).post('/count-rules', { name: 'x' })).statusCode).toBe(403);
    const u = await api(app, manager).put(`/count-rules/${r.json().id}`, { lines_per_day: 5 }); expect(u.json().lines_per_day).toBe(5);
    const list = await api(app, manager).get('/count-rules'); expect(list.json().length).toBe(1); expect(list.json()[0].condition.min_value).toBe(50);
  });
  it('生成 CYCLE 会话：B 区高价值货位指派给盘点员；再跑一次不重复；A 模式关了功能 403', async () => {
    expect((await api(app, wh).post('/movements', { product_id: P.P1, from_location_code: 'SUPPLIER', to_location_code: 'B-01-1', qty: 30, reason: 'RECEIVE' })).statusCode).toBe(201);
    const r = await api(app, manager).post('/counts/generate-cycle'); expect(r.statusCode).toBe(200);
    expect(r.json().created.length).toBe(1); expect(r.json().created[0].assigned_to).toBe(counterId); expect(r.json().created[0].locations).toBe(1);
    const s = (await api(app, manager).get(`/counts/${r.json().created[0].id}`)).json(); expect(s.count_type).toBe('CYCLE'); expect(s.location_ids).toEqual([L['B-01-1']]); expect(s.rule_id).toBeTruthy();
    expect((await api(app, manager).post('/counts/generate-cycle')).json().created.length).toBe(0);
    const bossA = (await A().post('/auth/login', { company_code: 'CNTA1', phone: '0130000011', pin: '111111' })).json().access_token;
    const fa = await api(app, bossA).post('/counts/generate-cycle'); expect(fa.statusCode).toBe(403); expect(fa.json().code).toBe('FEATURE_DISABLED');
  });
  it('日报文字、代理过期、工单超期提醒', async () => {
    const text = await dailyReportText(companyId); expect(text).toContain('日报'); expect(text).toContain('销售：RM 0.00'); expect(text).toContain('待审批');
    const d = await api(app, boss).post('/delegations', { delegate_id: managerId, starts_at: new Date(Date.now() - 2 * 3600_000).toISOString(), ends_at: new Date(Date.now() - 3600_000).toISOString() }); expect(d.statusCode).toBe(201);
    expect(await expireDelegations()).toBeGreaterThanOrEqual(1);
    expect((await adminPool.query(`SELECT status FROM delegation WHERE id = $1`, [d.json().id])).rows[0].status).toBe('EXPIRED');
    expect((await adminPool.query(`SELECT count(*) n FROM notification WHERE user_id = $1 AND text LIKE '%代理到期%'`, [managerId])).rows[0].n).toBe(1);
    await adminPool.query(`UPDATE ticket SET deadline_at = now() - interval '1 hour', owner_id = $2 WHERE company_id = $1 AND type = 'COUNT_VARIANCE'`, [companyId, managerId]);
    await overdueTicketReminders();
    expect(Number((await adminPool.query(`SELECT count(*) n FROM notification WHERE company_id = $1 AND type = 'TICKET_OVERDUE' AND user_id = $2`, [companyId, managerId])).rows[0].n)).toBeGreaterThanOrEqual(1);
    expect(Number((await adminPool.query(`SELECT count(*) n FROM notification WHERE company_id = $1 AND type = 'TICKET_OVERDUE' AND user_id = $2`, [companyId, bossId])).rows[0].n)).toBeGreaterThanOrEqual(1);
  });
  it('通知接口：列表、标记已读、全部已读', async () => {
    const r = await api(app, boss).get('/notifications'); expect(r.statusCode).toBe(200); expect(r.json().length).toBeGreaterThan(3); expect(r.json().every((n: any) => n.user_id === bossId)).toBe(true);
    expect((await api(app, boss).post(`/notifications/${r.json()[0].id}/read`)).json().ok).toBe(true);
    expect((await api(app, boss).get('/notifications?unread=true')).json().length).toBe(r.json().length - 1);
    expect((await api(app, boss).post('/notifications/read-all')).json().count).toBe(r.json().length - 1);
    expect((await api(app, boss).get('/notifications?unread=true')).json().length).toBe(0);
  });
});
