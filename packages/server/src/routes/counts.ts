// 模块 B：盲盘盘点（A5 / B8）、盘点规则、盘点差异审批回调。
// 设计文档没写而这里定下的规则：
//  - 指派时不拍快照；POST /counts/:id/start 时从 stock 表拍 count_snapshot（qty<>0 的行，unit_cost = cost_price）。盘点员若未先 start 就录行，服务器自动 start。
//  - 录入同货位同产品时「覆盖」（不累加）：盘点员重扫同一产品表示重数了这个货位上的这个产品，覆盖最直观也最容易改错；幂等靠 client_id。
//  - 盘点员接口（my-today / lines / location-done / submit / my-records）绝不返回系统量或金额。
//  - 提交：快照里有而未数视为 0（自动补一行 counted_qty 0）；数了快照没有的视为全部多出。行 variance_* 写入；会话 variance_qty / variance_amount 存净值（带符号），审批金额用各行 |金额| 之和（毛值），不让多的抵消少的。
//  - 差异为 0 直接 APPROVED，不建审批。
//  - 审批 approve：ACCEPT 行写 COUNT 移动（多 → SUPPLIER→货位；少 → 货位→DAMAGED），RECOUNT 行生成新会话指派原人（parent_session_id 指回原会话），原会话状态 = 有重盘行 ? RECOUNT : APPROVED。
//    毛差异金额超过 settings.count_variance_ticket_threshold（默认 RM 50）开 COUNT_VARIANCE 工单（B 模式给 MANAGER，A 模式给 BOSS）2 天。
//    reject → 会话 CANCELLED（不动库存）；return → 会话退回 IN_PROGRESS 让盘点员补数后再提交。
//  - 代理人代批时移动记录的 performed_by 用被代理人（他才有 count.approve 权限），approver_id 仍是代理人。
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withCompany, type Tx } from '../lib/db.js';
import { requireAuth, requirePerm, hasPerm, stripCost, type RequestCtx } from '../lib/auth.js';
import { AppError, notFound } from '../lib/errors.js';
import { applyMovement } from '../lib/movements.js';
import { createApproval, decideApproval, registerApprovalHandler, type ApprovalRow } from '../lib/approvals.js';
import { registerSyncHandler } from '../lib/syncHandlers.js';
import { nextDocNo } from '../lib/docno.js';
import { tgSendToUser } from '../lib/telegram.js';
import { generateCycleSessions } from '../lib/countJobs.js';

const COUNTER_COLS = ['id', 'session_no', 'site_id', 'zone_id', 'count_type', 'status', 'assigned_to', 'scheduled_for', 'started_at', 'submitted_at', 'location_ids', 'note', 'parent_session_id', 'created_at'];
const COUNTER_FIELDS = COUNTER_COLS.map((c) => 's.' + c).join(', ');   // 盘点员能看到的会话字段（无差异金额）
const COUNTER_RET = COUNTER_COLS.join(', ');

/** 会话的货位（按 location_ids 顺序）+ 完成标记 + 已数行数（不含系统量） */
async function sessionLocations(tx: Tx, s: any) {
  const rows = (await tx.query(
    `SELECT l.id, l.code, z.code AS zone_code, z.color AS zone_color, d.is_empty, d.done_at, (d.location_id IS NOT NULL) AS done,
            (SELECT count(*) FROM count_line cl WHERE cl.session_id = $1 AND cl.location_id = l.id) AS lines_count
     FROM unnest($2::uuid[]) WITH ORDINALITY u(id, ord) JOIN location l ON l.id = u.id LEFT JOIN zone z ON z.id = l.zone_id
     LEFT JOIN count_location_done d ON d.session_id = $1 AND d.location_id = l.id ORDER BY u.ord`, [s.id, s.location_ids])).rows;
  return rows.map((r) => ({ ...r, lines_count: Number(r.lines_count) }));
}
/** 已数的行（盘点员视图：不含系统量） */
async function sessionLinesBlind(tx: Tx, sessionId: string) {
  return (await tx.query(`SELECT cl.id, cl.location_id, cl.product_id, cl.counted_qty, cl.counted_at, cl.client_id, p.sku, p.name_zh, p.name_ms, p.name_en, p.photo_url, p.unit FROM count_line cl JOIN product p ON p.id = cl.product_id WHERE cl.session_id = $1 ORDER BY cl.counted_at`, [sessionId])).rows;
}
async function loadSession(tx: Tx, id: string, lock = false) {
  const s = (await tx.query(`SELECT * FROM count_session WHERE id = $1 ${lock ? 'FOR UPDATE' : ''}`, [id])).rows[0];
  if (!s) throw notFound();
  return s;
}
function assertMine(ctx: RequestCtx, s: any) {
  if (s.assigned_to !== ctx.userId && !hasPerm(ctx, 'count.assign') && !ctx.isSuperAdmin) throw new AppError(403, 'COUNT_NOT_YOURS');
}
/** 开始：状态 → IN_PROGRESS，拍快照（只拍一次） */
async function startSession(tx: Tx, ctx: RequestCtx, s: any) {
  if (s.status === 'IN_PROGRESS') return s;
  if (s.status !== 'ASSIGNED') throw new AppError(400, 'COUNT_STATE', s.status);
  await tx.query(
    `INSERT INTO count_snapshot (company_id, session_id, product_id, location_id, system_qty, unit_cost)
     SELECT st.company_id, $1, st.product_id, st.location_id, st.qty, p.cost_price FROM stock st JOIN product p ON p.id = st.product_id
     WHERE st.location_id = ANY($2::uuid[]) AND st.qty <> 0 ON CONFLICT DO NOTHING`, [s.id, s.location_ids]);
  return (await tx.query(`UPDATE count_session SET status = 'IN_PROGRESS', started_at = coalesce(started_at, now()) WHERE id = $1 RETURNING *`, [s.id])).rows[0];
}
const lineSchema = z.object({ client_id: z.string().uuid().optional(), location_id: z.string().uuid().optional(), location_code: z.string().optional(), product_id: z.string().uuid().optional(), barcode: z.string().optional(), counted_qty: z.number().min(0), counted_at: z.string().optional() });
/** 录一行（覆盖同货位同产品；client_id 幂等）。返回盲行。 */
export async function addCountLine(tx: Tx, ctx: RequestCtx, sessionId: string, input: z.infer<typeof lineSchema>) {
  let s = await loadSession(tx, sessionId, true);
  assertMine(ctx, s);
  if (s.status === 'ASSIGNED') s = await startSession(tx, ctx, s);
  if (s.status !== 'IN_PROGRESS') throw new AppError(400, 'COUNT_STATE', s.status);
  if (input.client_id) {
    const dup = (await tx.query(`SELECT * FROM count_line WHERE client_id = $1`, [input.client_id])).rows[0];
    if (dup) return { ...dup, duplicate: true };
  }
  let locId = input.location_id;
  if (!locId && input.location_code) locId = (await tx.query(`SELECT id FROM location WHERE code = $1`, [input.location_code.replace(/^LOC:[A-Z0-9]+:/i, '')])).rows[0]?.id;
  if (!locId || !s.location_ids.includes(locId)) throw new AppError(400, 'COUNT_LOCATION_NOT_IN_SESSION');
  let productId = input.product_id; let qty = input.counted_qty;
  if (!productId && input.barcode) {
    const b = (await tx.query(`SELECT product_id, pack_qty FROM barcode WHERE barcode = $1`, [input.barcode])).rows[0];
    if (!b) throw new AppError(404, 'BARCODE_NOT_FOUND');
    productId = b.product_id; qty = qty * Number(b.pack_qty);
  }
  if (!productId) throw new AppError(400, 'VALIDATION', 'product_id or barcode required');
  const p = (await tx.query(`SELECT id FROM product WHERE id = $1 AND is_active`, [productId])).rows[0]; if (!p) throw notFound('PRODUCT_NOT_FOUND');
  const row = (await tx.query(
    `INSERT INTO count_line (company_id, session_id, location_id, product_id, counted_qty, counted_by, counted_at, client_id)
     VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7::timestamptz, now()),$8)
     ON CONFLICT (session_id, location_id, product_id) DO UPDATE SET counted_qty = EXCLUDED.counted_qty, counted_by = EXCLUDED.counted_by, counted_at = EXCLUDED.counted_at, client_id = COALESCE(EXCLUDED.client_id, count_line.client_id)
     RETURNING id, session_id, location_id, product_id, counted_qty, counted_at, client_id`, [ctx.companyId, s.id, locId, productId, qty, ctx.userId, input.counted_at ?? null, input.client_id ?? null])).rows[0];
  return { ...row, duplicate: false };
}
async function markLocationDone(tx: Tx, ctx: RequestCtx, sessionId: string, locationId: string, isEmpty: boolean) {
  let s = await loadSession(tx, sessionId, true);
  assertMine(ctx, s);
  if (s.status === 'ASSIGNED') s = await startSession(tx, ctx, s);
  if (s.status !== 'IN_PROGRESS') throw new AppError(400, 'COUNT_STATE', s.status);
  if (!s.location_ids.includes(locationId)) throw new AppError(400, 'COUNT_LOCATION_NOT_IN_SESSION');
  await tx.query(`INSERT INTO count_location_done (company_id, session_id, location_id, is_empty, done_by) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (session_id, location_id) DO UPDATE SET is_empty = EXCLUDED.is_empty, done_by = EXCLUDED.done_by, done_at = now()`, [ctx.companyId, s.id, locationId, isEmpty, ctx.userId]);
  const done = Number((await tx.query(`SELECT count(*) n FROM count_location_done WHERE session_id = $1`, [s.id])).rows[0].n);
  return { ok: true, done, total: s.location_ids.length, all_done: done >= s.location_ids.length };
}
/** 提交：算差异、建审批 */
async function submitSession(tx: Tx, ctx: RequestCtx, sessionId: string) {
  const s = await loadSession(tx, sessionId, true);
  assertMine(ctx, s);
  if (s.status !== 'IN_PROGRESS') throw new AppError(400, 'COUNT_STATE', s.status);
  const notDone = (await tx.query(`SELECT u.id FROM unnest($2::uuid[]) u(id) WHERE NOT EXISTS (SELECT 1 FROM count_location_done d WHERE d.session_id = $1 AND d.location_id = u.id)`, [s.id, s.location_ids])).rows;
  if (notDone.length) throw new AppError(400, 'COUNT_STATE', { not_done: notDone.map((r) => r.id) });
  // 快照里有而未数 → 补 0 行
  await tx.query(
    `INSERT INTO count_line (company_id, session_id, location_id, product_id, counted_qty, counted_by)
     SELECT sn.company_id, sn.session_id, sn.location_id, sn.product_id, 0, $2 FROM count_snapshot sn
     WHERE sn.session_id = $1 AND NOT EXISTS (SELECT 1 FROM count_line cl WHERE cl.session_id = sn.session_id AND cl.location_id = sn.location_id AND cl.product_id = sn.product_id)`, [s.id, ctx.userId]);
  await tx.query(
    `UPDATE count_line cl SET variance_qty = x.vq, variance_amount = x.va, decision = NULL
     FROM (SELECT c.id, c.counted_qty - coalesce(sn.system_qty, 0) AS vq, round((c.counted_qty - coalesce(sn.system_qty, 0)) * coalesce(sn.unit_cost, p.cost_price), 2) AS va
           FROM count_line c JOIN product p ON p.id = c.product_id
           LEFT JOIN count_snapshot sn ON sn.session_id = c.session_id AND sn.product_id = c.product_id AND sn.location_id = c.location_id
           WHERE c.session_id = $1) x
     WHERE cl.id = x.id`, [s.id]);
  const agg = (await tx.query(`SELECT coalesce(sum(variance_qty),0) net_qty, coalesce(sum(variance_amount),0) net_amount, coalesce(sum(abs(variance_amount)),0) gross, count(*) FILTER (WHERE variance_qty <> 0) var_lines, count(*) lines FROM count_line WHERE session_id = $1`, [s.id])).rows[0];
  const gross = Number(agg.gross); const varLines = Number(agg.var_lines);
  if (varLines === 0) {
    const r = (await tx.query(`UPDATE count_session SET status = 'APPROVED', submitted_at = now(), approved_at = now(), variance_qty = 0, variance_amount = 0 WHERE id = $1 RETURNING ${COUNTER_RET}`, [s.id])).rows[0];
    return { ...r, variance_lines: 0, approval_id: null };
  }
  const a = await createApproval(tx, ctx, { type: 'COUNT_VARIANCE', ref_type: 'count_session', ref_id: s.id, amount: gross, site_id: s.site_id, summary: { title: `${s.session_no} · ${varLines} 行差异 · 净 RM ${Number(agg.net_amount).toFixed(2)}`, session_no: s.session_no, variance_lines: varLines, lines: Number(agg.lines), net_qty: Number(agg.net_qty), net_amount: Number(agg.net_amount), gross_amount: gross } });
  const r = (await tx.query(`UPDATE count_session SET status = 'PENDING_APPROVAL', submitted_at = now(), approval_id = $2, variance_qty = $3, variance_amount = $4 WHERE id = $1 RETURNING ${COUNTER_RET}`, [s.id, a.id, agg.net_qty, agg.net_amount])).rows[0];
  return { ...r, variance_lines: varLines, approval_id: a.id };
}
/** 差异明细（审批视图：含系统量、金额、谁数、上次差异） */
export async function varianceLines(tx: Tx, ctx: RequestCtx, sessionId: string) {
  const rows = (await tx.query(
    `SELECT cl.id, cl.location_id, l.code AS location_code, cl.product_id, p.sku, p.name_zh, p.name_ms, p.name_en, p.photo_url, p.unit,
            coalesce(sn.system_qty, 0) AS system_qty, cl.counted_qty, cl.variance_qty, cl.variance_amount, coalesce(sn.unit_cost, p.cost_price) AS unit_cost, cl.decision, cl.movement_id,
            u.name AS counted_by_name, cl.counted_at,
            (SELECT prev.variance_qty FROM count_line prev JOIN count_session ps ON ps.id = prev.session_id WHERE prev.product_id = cl.product_id AND prev.location_id = cl.location_id AND prev.session_id <> cl.session_id AND prev.variance_qty IS NOT NULL ORDER BY prev.counted_at DESC LIMIT 1) AS last_variance_qty
     FROM count_line cl JOIN product p ON p.id = cl.product_id JOIN location l ON l.id = cl.location_id LEFT JOIN app_user u ON u.id = cl.counted_by
     LEFT JOIN count_snapshot sn ON sn.session_id = cl.session_id AND sn.product_id = cl.product_id AND sn.location_id = cl.location_id
     WHERE cl.session_id = $1 ORDER BY (cl.variance_qty = 0), l.code, p.sku`, [sessionId])).rows;
  return rows.map((r) => stripCost(ctx, r));
}
/** 逐行决定：ACCEPT / RECOUNT（没指定的差异行默认 ACCEPT） */
export async function applyLineDecisions(tx: Tx, sessionId: string, decisions: { id: string; decision: 'ACCEPT' | 'RECOUNT' }[] | undefined) {
  for (const d of decisions ?? []) await tx.query(`UPDATE count_line SET decision = $3 WHERE id = $1 AND session_id = $2`, [d.id, sessionId, d.decision]);
  await tx.query(`UPDATE count_line SET decision = 'ACCEPT' WHERE session_id = $1 AND variance_qty <> 0 AND decision IS NULL`, [sessionId]);
}

// ---------- 审批回调：盘点差异 ----------
registerApprovalHandler('COUNT_VARIANCE', async (tx, ctx, a: ApprovalRow, decision, note) => {
  const s = (await tx.query(`SELECT * FROM count_session WHERE id = $1 FOR UPDATE`, [a.ref_id])).rows[0];
  if (!s) return;
  if (decision === 'reject') { await tx.query(`UPDATE count_session SET status = 'CANCELLED', note = concat_ws(' | ', note, $2::text) WHERE id = $1`, [s.id, note ? `拒绝：${note}` : '拒绝']); return; }
  if (decision === 'return') {
    await tx.query(`UPDATE count_session SET status = 'IN_PROGRESS', submitted_at = NULL, approval_id = NULL, note = concat_ws(' | ', note, $2::text) WHERE id = $1`, [s.id, note ? `退回：${note}` : '退回']);
    await tx.query(`DELETE FROM count_location_done WHERE session_id = $1`, [s.id]);   // 退回 = 再数一遍再按完成
    if (s.assigned_to) void tgSendToUser(ctx.companyId, s.assigned_to, `盘点 ${s.session_no} 被退回，请重新数${note ? `：${note}` : ''}`, undefined, 'COUNT');
    return;
  }
  await applyLineDecisions(tx, s.id, undefined);
  const lines = (await tx.query(`SELECT cl.*, p.cost_price FROM count_line cl JOIN product p ON p.id = cl.product_id WHERE cl.session_id = $1 AND cl.variance_qty <> 0 ORDER BY cl.location_id`, [s.id])).rows;
  const performer = { companyId: ctx.companyId, userId: a.on_behalf_of ?? ctx.userId, deviceId: ctx.deviceId };
  const sup = (await tx.query(`SELECT id FROM location WHERE is_virtual AND virtual_type = 'SUPPLIER'`)).rows[0];
  const dmg = (await tx.query(`SELECT id FROM location WHERE is_virtual AND virtual_type = 'DAMAGED'`)).rows[0];
  const recountLocs: string[] = [];
  for (const cl of lines) {
    if (cl.decision === 'RECOUNT') { if (!recountLocs.includes(cl.location_id)) recountLocs.push(cl.location_id); continue; }
    const v = Number(cl.variance_qty);
    const m = await applyMovement(tx, performer, { product_id: cl.product_id, from_location_id: v > 0 ? sup.id : cl.location_id, to_location_id: v > 0 ? cl.location_id : dmg.id, qty: Math.abs(v), reason: 'COUNT', ref_type: 'COUNT', ref_id: s.id, note: `盘点 ${s.session_no}` });
    await tx.query(`UPDATE count_line SET movement_id = $2 WHERE id = $1`, [cl.id, m.id]);
  }
  let recount: any = null;
  if (recountLocs.length) {
    const ordered = (s.location_ids as string[]).filter((id) => recountLocs.includes(id));
    const no = await nextDocNo(tx, ctx.companyId, 'CS', 'CS-');
    recount = (await tx.query(
      `INSERT INTO count_session (company_id, session_no, site_id, zone_id, count_type, status, assigned_to, scheduled_for, location_ids, parent_session_id, note)
       VALUES ($1,$2,$3,$4,$5,'ASSIGNED',$6,current_date,$7,$8,$9) RETURNING id, session_no`, [ctx.companyId, no, s.site_id, s.zone_id, s.count_type, s.assigned_to, ordered, s.id, `重盘 ${s.session_no}`])).rows[0];
    if (s.assigned_to) void tgSendToUser(ctx.companyId, s.assigned_to, `请重盘 ${recount.session_no}（${ordered.length} 个货位，来自 ${s.session_no}）`, undefined, 'COUNT');
  }
  await tx.query(`UPDATE count_session SET status = $2, approved_by = $3, approved_at = now() WHERE id = $1`, [s.id, recount ? 'RECOUNT' : 'APPROVED', ctx.userId]);
  const threshold = Number(ctx.settings?.count_variance_ticket_threshold ?? 50);
  const gross = Number(a.amount ?? 0);
  if (gross > threshold) {
    const varLines = lines.length;
    await tx.query(
      `INSERT INTO ticket (company_id, site_id, type, title, ref_type, ref_id, owner_role_code, priority, deadline_at)
       VALUES ($1,$2,'COUNT_VARIANCE',$3,'count_session',$4,$5,'HIGH', now() + interval '2 days')`,
      [ctx.companyId, s.site_id, `盘点差异 ${s.session_no}：${varLines} 行，RM ${gross.toFixed(2)}`, s.id, ctx.plan === 'A' ? 'BOSS' : 'MANAGER']);
  }
});

// ---------- 离线同步：count_line / count_location_done ----------
registerSyncHandler('count_line', async (tx, ctx, clientId, payload) => {
  const b = lineSchema.extend({ session_id: z.string().uuid() }).parse({ ...payload, client_id: clientId });
  if (!hasPerm(ctx, 'count.enter')) throw new AppError(403, 'PERMISSION_DENIED', 'count.enter');
  return (await addCountLine(tx, ctx, b.session_id, b)).id;
});
registerSyncHandler('count_location_done', async (tx, ctx, clientId, payload) => {
  const b = z.object({ session_id: z.string().uuid(), location_id: z.string().uuid(), is_empty: z.boolean().default(false) }).parse(payload);
  if (!hasPerm(ctx, 'count.enter')) throw new AppError(403, 'PERMISSION_DENIED', 'count.enter');
  await markLocationDone(tx, ctx, b.session_id, b.location_id, b.is_empty);
  return clientId;
});

export async function countsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);
  const cx = (req: any) => ({ companyId: req.ctx.companyId, userId: req.ctx.userId, deviceId: req.ctx.deviceId });
  const LIST_SQL = `SELECT s.*, u.name AS assigned_to_name, st.code AS site_code, z.code AS zone_code, cardinality(s.location_ids) AS location_count,
      (SELECT count(*) FROM count_location_done d WHERE d.session_id = s.id) AS done_count,
      (SELECT count(*) FROM count_line cl WHERE cl.session_id = s.id) AS lines_count,
      (SELECT count(*) FROM count_line cl WHERE cl.session_id = s.id AND cl.variance_qty <> 0) AS variance_lines,
      a.status AS approval_status
    FROM count_session s LEFT JOIN app_user u ON u.id = s.assigned_to LEFT JOIN site st ON st.id = s.site_id LEFT JOIN zone z ON z.id = s.zone_id LEFT JOIN approval_request a ON a.id = s.approval_id`;

  // ---- 指派（M3 / 网页） ----
  app.post('/counts', { preHandler: requirePerm('count.assign') }, async (req, reply) => {
    const b = z.object({ site_id: z.string().uuid().optional(), zone_id: z.string().uuid().optional(), location_ids: z.array(z.string().uuid()).optional(), location_codes: z.array(z.string()).optional(), assigned_to: z.string().uuid(), count_type: z.enum(['FULL', 'CYCLE', 'SPOT']).optional(), scheduled_for: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), note: z.string().max(200).optional() }).parse(req.body);
    const r = await withCompany(cx(req), async (tx) => {
      let locs: any[];
      if (b.zone_id) locs = (await tx.query(`SELECT l.id, l.site_id FROM location l WHERE l.zone_id = $1 AND l.is_active AND NOT l.is_virtual ORDER BY l.rack, l.level, l.code`, [b.zone_id])).rows;
      else {
        const ids = b.location_ids ?? [];
        const codes = (b.location_codes ?? []).map((c) => c.replace(/^LOC:[A-Z0-9]+:/i, ''));
        locs = (await tx.query(`SELECT l.id, l.site_id FROM location l JOIN zone z ON z.id = l.zone_id WHERE (l.id = ANY($1::uuid[]) OR l.code = ANY($2::text[])) AND l.is_active AND NOT l.is_virtual ORDER BY z.sort_order, z.code, l.rack, l.level, l.code`, [ids, codes])).rows;
      }
      if (!locs.length) throw new AppError(400, 'VALIDATION', 'no locations');
      const siteId = b.site_id ?? locs[0].site_id ?? req.ctx.siteId;
      if (locs.some((l) => l.site_id !== siteId)) throw new AppError(400, 'VALIDATION', 'locations must be in one site');
      const assignee = (await tx.query(`SELECT id, name FROM app_user WHERE id = $1 AND is_active`, [b.assigned_to])).rows[0]; if (!assignee) throw notFound('USER_NOT_FOUND');
      const no = await nextDocNo(tx, req.ctx.companyId, 'CS', 'CS-');
      const s = (await tx.query(
        `INSERT INTO count_session (company_id, session_no, site_id, zone_id, count_type, assigned_to, scheduled_for, location_ids, note)
         VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7::date, current_date),$8,$9) RETURNING *`, [req.ctx.companyId, no, siteId, b.zone_id ?? null, b.count_type ?? (b.zone_id ? 'FULL' : 'SPOT'), b.assigned_to, b.scheduled_for ?? null, locs.map((l) => l.id), b.note ?? null])).rows[0];
      void tgSendToUser(req.ctx.companyId, b.assigned_to, `新盘点任务 ${no}：${locs.length} 个货位，${s.scheduled_for instanceof Date ? s.scheduled_for.toISOString().slice(0, 10) : s.scheduled_for}`, undefined, 'COUNT');
      return s;
    });
    reply.status(201); return r;
  });
  /** 可指派的人：该站 COUNTER / WAREHOUSE（含全公司角色） */
  app.get('/counts/assignees', { preHandler: requirePerm('count.assign') }, async (req) => {
    const q = z.object({ site: z.string().uuid().optional() }).parse(req.query);
    return withCompany(cx(req), async (tx) => (await tx.query(
      `SELECT DISTINCT u.id, u.name, r.code AS role_code FROM app_user u JOIN user_site_role usr ON usr.user_id = u.id JOIN role r ON r.id = usr.role_id
       WHERE u.is_active AND r.code IN ('COUNTER','WAREHOUSE','STOCKER') AND (usr.site_id IS NULL OR $1::uuid IS NULL OR usr.site_id = $1) ORDER BY r.code, u.name`, [q.site ?? req.ctx.siteId ?? null])).rows);
  });
  // ---- 经理列表 / 统计 ----
  app.get('/counts', { preHandler: requirePerm('count.assign', 'count.approve', 'count.rules') }, async (req) => {
    const q = z.object({ status: z.string().optional(), site: z.string().uuid().optional(), limit: z.coerce.number().max(500).default(100) }).parse(req.query);
    return withCompany(cx(req), async (tx) => (await tx.query(`${LIST_SQL} WHERE ($1::text IS NULL OR s.status = $1) AND ($2::uuid IS NULL OR s.site_id = $2) ORDER BY s.scheduled_for DESC, s.created_at DESC LIMIT $3`, [q.status ?? null, q.site ?? null, q.limit])).rows.map((r: any) => stripCost(req.ctx, r)));
  });
  /** 30 天准确率：按盘点员 */
  app.get('/counts/stats', { preHandler: requirePerm('count.assign', 'count.approve', 'count.rules') }, async (req) => withCompany(cx(req), async (tx) => (await tx.query(
    `SELECT u.id AS user_id, u.name, count(DISTINCT s.id) AS sessions, count(cl.id) AS lines, count(cl.id) FILTER (WHERE cl.variance_qty <> 0) AS variance_lines,
            coalesce(sum(abs(cl.variance_amount)),0) AS gross_amount,
            CASE WHEN count(cl.id) = 0 THEN NULL ELSE round(100.0 * count(cl.id) FILTER (WHERE cl.variance_qty = 0) / count(cl.id), 1) END AS accuracy_pct
     FROM count_session s JOIN app_user u ON u.id = s.assigned_to LEFT JOIN count_line cl ON cl.session_id = s.id AND cl.variance_qty IS NOT NULL
     WHERE s.submitted_at > now() - interval '30 days' GROUP BY u.id ORDER BY accuracy_pct NULLS LAST, u.name`)).rows));
  /** 手动触发循环盘点生成（规则页「立即生成」；定时任务每天 06:00 也调它） */
  app.post('/counts/generate-cycle', { preHandler: requirePerm('count.rules') }, async (req) => {
    return withCompany(cx(req), async (tx) => {
      const ff = (await tx.query(`SELECT feature_flags FROM company WHERE id = $1`, [req.ctx.companyId])).rows[0]?.feature_flags ?? {};
      if (!ff.cycle_count) throw new AppError(403, 'FEATURE_DISABLED', 'cycle_count');
      return generateCycleSessions(tx, req.ctx.companyId);
    });
  });

  // ---- 盘点员（K1–K7） ----
  app.get('/counts/my-today', { preHandler: requirePerm('count.enter') }, async (req) => withCompany(cx(req), async (tx) => {
    const sessions = (await tx.query(`SELECT ${COUNTER_FIELDS}, z.code AS zone_code, z.name_zh AS zone_name_zh, z.name_ms AS zone_name_ms, z.name_en AS zone_name_en FROM count_session s LEFT JOIN zone z ON z.id = s.zone_id WHERE s.assigned_to = $1 AND s.status IN ('ASSIGNED','IN_PROGRESS') AND s.scheduled_for <= current_date ORDER BY s.scheduled_for, s.created_at`, [req.ctx.userId])).rows;
    const out = [];
    for (const s of sessions) {
      const locations = await sessionLocations(tx, s);
      out.push({ ...s, locations, lines: await sessionLinesBlind(tx, s.id), total: locations.length, done: locations.filter((l) => l.done).length });
    }
    return out;
  }));
  app.get('/counts/my-records', { preHandler: requirePerm('count.enter') }, async (req) => withCompany(cx(req), async (tx) => (await tx.query(
    `SELECT s.id, s.session_no, s.count_type, s.status, s.scheduled_for, s.submitted_at, s.approved_at, cardinality(s.location_ids) AS location_count,
            count(cl.id) AS lines, count(cl.id) FILTER (WHERE cl.variance_qty <> 0) AS variance_lines,
            CASE WHEN count(cl.id) FILTER (WHERE cl.variance_qty IS NOT NULL) = 0 THEN NULL ELSE round(100.0 * count(cl.id) FILTER (WHERE cl.variance_qty = 0) / count(cl.id) FILTER (WHERE cl.variance_qty IS NOT NULL), 1) END AS accuracy_pct
     FROM count_session s LEFT JOIN count_line cl ON cl.session_id = s.id
     WHERE s.assigned_to = $1 AND s.status <> 'CANCELLED' AND s.scheduled_for > current_date - 30 GROUP BY s.id ORDER BY s.scheduled_for DESC, s.created_at DESC`, [req.ctx.userId])).rows));
  /** 取消还没提交的盘点（指派错人、重复指派）：只允许 ASSIGNED / IN_PROGRESS，不动库存 */
  app.post('/counts/:id/cancel', { preHandler: requirePerm('count.assign') }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const b = z.object({ reason: z.string().max(200).optional() }).parse(req.body ?? {});
    return withCompany(cx(req), async (tx) => {
      const r = (await tx.query(`UPDATE count_session SET status = 'CANCELLED', note = concat_ws(' | ', note, $2::text) WHERE id = $1 AND status IN ('ASSIGNED','IN_PROGRESS') RETURNING id, session_no, status`, [id, `取消：${b.reason ?? ''}`])).rows[0];
      if (!r) throw new AppError(409, 'COUNT_STATE');
      return r;
    });
  });
  app.post('/counts/:id/start', { preHandler: requirePerm('count.enter', 'count.assign') }, async (req) => {
    const { id } = req.params as any;
    return withCompany(cx(req), async (tx) => { const s = await loadSession(tx, id, true); assertMine(req.ctx, s); const r = await startSession(tx, req.ctx, s); return { id: r.id, status: r.status, started_at: r.started_at, locations: await sessionLocations(tx, r), lines: await sessionLinesBlind(tx, r.id) }; });
  });
  app.post('/counts/:id/lines', { preHandler: requirePerm('count.enter') }, async (req, reply) => {
    const { id } = req.params as any; const b = lineSchema.parse(req.body);
    const r = await withCompany(cx(req), (tx) => addCountLine(tx, req.ctx, id, b));
    reply.status(r.duplicate ? 200 : 201); return r;
  });
  app.post('/counts/:id/location-done', { preHandler: requirePerm('count.enter') }, async (req) => {
    const { id } = req.params as any; const b = z.object({ location_id: z.string().uuid(), is_empty: z.boolean().default(false) }).parse(req.body);
    return withCompany(cx(req), (tx) => markLocationDone(tx, req.ctx, id, b.location_id, b.is_empty));
  });
  app.post('/counts/:id/submit', { preHandler: requirePerm('count.enter') }, async (req) => {
    const { id } = req.params as any;
    return withCompany(cx(req), (tx) => submitSession(tx, req.ctx, id));
  });

  // ---- 审批（M2 / 网页） ----
  app.get('/counts/:id', { preHandler: requirePerm('count.assign', 'count.approve', 'count.rules') }, async (req) => {
    const { id } = req.params as any;
    return withCompany(cx(req), async (tx) => {
      const s = (await tx.query(`${LIST_SQL} WHERE s.id = $1`, [id])).rows[0]; if (!s) throw notFound();
      const locations = await sessionLocations(tx, s);
      const lines = hasPerm(req.ctx, 'count.view_system_qty') ? await varianceLines(tx, req.ctx, id) : await sessionLinesBlind(tx, id);
      const children = (await tx.query(`SELECT id, session_no, status FROM count_session WHERE parent_session_id = $1`, [id])).rows;
      return { ...stripCost(req.ctx, s), locations, lines, children };
    });
  });
  app.get('/counts/:id/variance', { preHandler: requirePerm('count.approve') }, async (req) => {
    const { id } = req.params as any;
    return withCompany(cx(req), async (tx) => {
      const s = (await tx.query(`${LIST_SQL} WHERE s.id = $1`, [id])).rows[0]; if (!s) throw notFound();
      return { session: stripCost(req.ctx, s), lines: await varianceLines(tx, req.ctx, id) };
    });
  });
  app.post('/counts/:id/approve', { preHandler: requirePerm('count.approve') }, async (req) => {
    const { id } = req.params as any;
    const b = z.object({ decision: z.enum(['approve', 'reject', 'return']).default('approve'), note: z.string().max(500).optional(), lines: z.array(z.object({ id: z.string().uuid(), decision: z.enum(['ACCEPT', 'RECOUNT']) })).optional() }).parse(req.body);
    return withCompany(cx(req), async (tx) => {
      const s = await loadSession(tx, id, true);
      if (s.status !== 'PENDING_APPROVAL' || !s.approval_id) throw new AppError(400, 'COUNT_STATE', s.status);
      if (b.decision === 'approve') await applyLineDecisions(tx, s.id, b.lines);
      const a = await decideApproval(tx, req.ctx, s.approval_id, b.decision, b.note);
      const after = await loadSession(tx, id);
      return { approval: a, session: { id: after.id, status: after.status, session_no: after.session_no }, recount: (await tx.query(`SELECT id, session_no FROM count_session WHERE parent_session_id = $1 ORDER BY created_at DESC LIMIT 1`, [id])).rows[0] ?? null };
    });
  });

  // ---- 循环盘点规则（G9） ----
  const ruleSchema = z.object({ name: z.string().min(1), condition: z.record(z.any()).default({}), frequency_days: z.number().int().min(1).max(365).default(30), lines_per_day: z.number().int().min(1).max(500).default(20), is_active: z.boolean().default(true) });
  app.get('/count-rules', { preHandler: requirePerm('count.rules', 'count.assign') }, async (req) => withCompany(cx(req), async (tx) => (await tx.query(`SELECT r.*, (SELECT count(*) FROM count_session s WHERE s.rule_id = r.id AND s.created_at > now() - interval '30 days') AS sessions_30d FROM count_rule r ORDER BY r.is_active DESC, r.name`)).rows));
  app.post('/count-rules', { preHandler: requirePerm('count.rules') }, async (req, reply) => {
    const b = ruleSchema.parse(req.body);
    const r = await withCompany(cx(req), async (tx) => (await tx.query(`INSERT INTO count_rule (company_id, name, condition, frequency_days, lines_per_day, is_active) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [req.ctx.companyId, b.name, JSON.stringify(b.condition), b.frequency_days, b.lines_per_day, b.is_active])).rows[0]);
    reply.status(201); return r;
  });
  app.put('/count-rules/:id', { preHandler: requirePerm('count.rules') }, async (req) => {
    const { id } = req.params as any; const b = ruleSchema.partial().parse(req.body);
    return withCompany(cx(req), async (tx) => {
      const r = (await tx.query(`UPDATE count_rule SET name = COALESCE($2, name), condition = COALESCE($3::jsonb, condition), frequency_days = COALESCE($4, frequency_days), lines_per_day = COALESCE($5, lines_per_day), is_active = COALESCE($6, is_active) WHERE id = $1 RETURNING *`, [id, b.name ?? null, b.condition ? JSON.stringify(b.condition) : null, b.frequency_days ?? null, b.lines_per_day ?? null, b.is_active ?? null])).rows[0];
      if (!r) throw notFound(); return r;
    });
  });
}
