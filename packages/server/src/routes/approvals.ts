// 模块 B：统一审批接口、代理、手动调整、通知。审批引擎在 lib/approvals.ts，这里只是入口。
// 设计文档没写而这里定下的：
//  - GET /approvals（历史）：有 approval.decide 的看全公司，其他人只看自己发起的。
//  - IMPORT 类型不在这里 decide（导入要执行表格，走导入页 /import/jobs/:id/apply|reject），这里返回 400 并提示。
//  - 手动调整没有自己的表：申请内容存在 approval_request.summary，ref_type ADJUST，ref_id = 将来写入的 movement id（client_id 幂等就靠它）。
//    差额按申请当时的库存算（新数 − 当时数），批准时按这个差额写 ADJUST 移动，不重新读库存（经理看到的就是他批的）。
//    经理每日累计（当天他发起的、未被拒绝的 ADJUST 金额）超过 settings.adjust_daily_limit（默认 500）→ 升级给 BOSS。A 模式老板自己发起 → 建审批后立即批准生效（A 模式允许自批）。
//  - 代理：delegator 默认自己；非老板只能给自己设代理。不在服务器限制被指定人的角色（UI 按模式列人），最长 30 天。
//  - 通知：GET /notifications 只看自己的，Telegram 未配置时审批/日报都落在这里。
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withCompany, type Tx } from '../lib/db.js';
import { requireAuth, requirePerm, hasPerm, stripCost, type RequestCtx } from '../lib/auth.js';
import { AppError, notFound } from '../lib/errors.js';
import { applyMovement } from '../lib/movements.js';
import { createApproval, decideApproval, listPending, registerApprovalHandler, defaultApproverRole, TYPE_ZH, type ApprovalRow, type ApprovalType } from '../lib/approvals.js';
import { tgSend, tgSendToUser } from '../lib/telegram.js';
import { applyLineDecisions, varianceLines } from './counts.js';

const APPROVAL_TYPES = ['IMPORT', 'ORDER', 'COUNT_VARIANCE', 'RETURN', 'PO_PRICE_CHANGE', 'ADJUST', 'TRANSFER', 'PAYMENT', 'PRICE_CHANGE', 'PO', 'VOID_SALE', 'SUPPLIER_INVOICE', 'DISCOUNT'] as const;
const ADJUST_REASONS = ['DAMAGED', 'EXPIRED', 'SAMPLE', 'MISCOUNT', 'OTHER'] as const;
export const ADJUST_REASON_ZH: Record<string, string> = { DAMAGED: '损坏', EXPIRED: '过期', SAMPLE: '试吃/样品', MISCOUNT: '数错', OTHER: '其他' };

/** 我作为代理人的有效代理（带被代理人姓名和角色） */
async function myDelegations(tx: Tx, ctx: RequestCtx) {
  return (await tx.query(
    `SELECT d.*, u.name AS delegator_name, (SELECT array_agg(DISTINCT r.code) FROM user_site_role usr JOIN role r ON r.id = usr.role_id WHERE usr.user_id = d.delegator_id) AS delegator_roles
     FROM delegation d JOIN app_user u ON u.id = d.delegator_id WHERE d.delegate_id = $1 AND d.status = 'ACTIVE' AND now() BETWEEN d.starts_at AND d.ends_at ORDER BY d.ends_at`, [ctx.userId])).rows;
}
function behalfName(a: any, dels: any[]) {
  const d = dels.find((x) => (x.delegator_roles ?? []).includes(a.approver_role_code) && (!x.scope_types?.length || x.scope_types.includes(a.type)) && (x.per_item_limit == null || Math.abs(Number(a.amount ?? 0)) <= Number(x.per_item_limit)));
  return d?.delegator_name ?? null;
}
/** 审批详情：按 ref_type 取明细 */
async function approvalDetail(tx: Tx, ctx: RequestCtx, a: any) {
  if (a.type === 'COUNT_VARIANCE') {
    const s = (await tx.query(`SELECT s.id, s.session_no, s.status, s.count_type, s.scheduled_for, s.submitted_at, s.location_ids, u.name AS assigned_to_name, z.code AS zone_code, st.code AS site_code FROM count_session s LEFT JOIN app_user u ON u.id = s.assigned_to LEFT JOIN zone z ON z.id = s.zone_id LEFT JOIN site st ON st.id = s.site_id WHERE s.id = $1`, [a.ref_id])).rows[0];
    const canSeeLines = hasPerm(ctx, 'count.view_system_qty') || a.as_self || a.as_delegate;
    return { session: s, lines: canSeeLines && s ? await varianceLines(tx, ctx, s.id) : [] };
  }
  if (a.type === 'ADJUST') return { adjustment: stripCost(ctx, a.summary ?? {}) };
  return {};
}

// ---------- 审批回调：手动调整 ----------
registerApprovalHandler('ADJUST', async (tx, ctx, a: ApprovalRow, decision) => {
  if (decision !== 'approve') return;
  const s = a.summary ?? {};
  const diff = Number(s.diff ?? 0); if (!diff) return;
  const performer = { companyId: ctx.companyId, userId: a.on_behalf_of ?? ctx.userId, deviceId: ctx.deviceId };
  const sup = (await tx.query(`SELECT id FROM location WHERE is_virtual AND virtual_type = 'SUPPLIER'`)).rows[0];
  const dmg = (await tx.query(`SELECT id FROM location WHERE is_virtual AND virtual_type = 'DAMAGED'`)).rows[0];
  await applyMovement(tx, performer, { id: a.ref_id, product_id: s.product_id, from_location_id: diff > 0 ? sup.id : s.location_id, to_location_id: diff > 0 ? s.location_id : dmg.id, qty: Math.abs(diff), reason: 'ADJUST', ref_type: 'ADJUST', ref_id: a.ref_id, note: `${ADJUST_REASON_ZH[s.reason] ?? s.reason}${s.note ? ` · ${s.note}` : ''}`.slice(0, 200) });
});

export async function approvalsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);
  const cx = (req: any) => ({ companyId: req.ctx.companyId, userId: req.ctx.userId, deviceId: req.ctx.deviceId });

  // ---------- 审批 ----------
  app.get('/approvals/pending', async (req) => withCompany(cx(req), async (tx) => {
    // 引擎的 listPending 会把「有代理但金额超单笔上限」的也列出来（as_delegate=false）；等我批的只留能批的
    const rows = (await listPending(tx, req.ctx)).filter((r: any) => r.as_self || r.as_delegate);
    const dels = rows.some((r: any) => r.as_delegate && !r.as_self) ? await myDelegations(tx, req.ctx) : [];
    return rows.map((r: any) => stripCost(req.ctx, { ...r, type_zh: TYPE_ZH[r.type as ApprovalType] ?? r.type, on_behalf_name: r.as_self ? null : behalfName(r, dels) }));
  }));
  app.get('/approvals', async (req) => {
    const q = z.object({ status: z.string().optional(), type: z.string().optional(), limit: z.coerce.number().max(500).default(100), offset: z.coerce.number().default(0) }).parse(req.query);
    const all = hasPerm(req.ctx, 'approval.decide') || req.ctx.isSuperAdmin;
    return withCompany(cx(req), async (tx) => (await tx.query(
      `SELECT a.*, u.name AS requested_by_name, ap.name AS approver_name, ob.name AS on_behalf_name FROM approval_request a JOIN app_user u ON u.id = a.requested_by LEFT JOIN app_user ap ON ap.id = a.approver_id LEFT JOIN app_user ob ON ob.id = a.on_behalf_of
       WHERE ($1::text IS NULL OR a.status = $1) AND ($2::text IS NULL OR a.type = $2) AND ($3::boolean OR a.requested_by = $4) ORDER BY a.created_at DESC LIMIT $5 OFFSET $6`, [q.status ?? null, q.type ?? null, all, req.ctx.userId, q.limit, q.offset])).rows.map((r: any) => stripCost(req.ctx, { ...r, type_zh: TYPE_ZH[r.type as ApprovalType] ?? r.type })));
  });
  app.get('/approvals/:id', async (req) => {
    const { id } = req.params as any;
    return withCompany(cx(req), async (tx) => {
      const a = (await tx.query(`SELECT a.*, u.name AS requested_by_name, ap.name AS approver_name, ob.name AS on_behalf_of_name FROM approval_request a JOIN app_user u ON u.id = a.requested_by LEFT JOIN app_user ap ON ap.id = a.approver_id LEFT JOIN app_user ob ON ob.id = a.on_behalf_of WHERE a.id = $1`, [id])).rows[0];
      if (!a) throw notFound();
      const dels = await myDelegations(tx, req.ctx);
      const as_self = req.ctx.isSuperAdmin || req.ctx.roles.includes(a.approver_role_code);
      const on_behalf_name = as_self ? null : behalfName(a, dels);
      const as_delegate = !!on_behalf_name;
      if (!as_self && !as_delegate && a.requested_by !== req.ctx.userId && !hasPerm(req.ctx, 'approval.decide')) throw notFound();
      const row = { ...a, as_self, as_delegate, on_behalf_name, can_decide: a.status === 'PENDING' && (as_self || as_delegate) && (a.requested_by !== req.ctx.userId || req.ctx.plan === 'A'), type_zh: TYPE_ZH[a.type as ApprovalType] ?? a.type };
      return stripCost(req.ctx, { ...row, detail: await approvalDetail(tx, req.ctx, row) });
    });
  });
  app.post('/approvals/:id/decide', async (req) => {
    const { id } = req.params as any;
    const b = z.object({ decision: z.enum(['approve', 'reject', 'return']), note: z.string().max(500).optional(), line_decisions: z.array(z.object({ id: z.string().uuid(), decision: z.enum(['ACCEPT', 'RECOUNT']) })).optional() }).parse(req.body);
    return withCompany(cx(req), async (tx) => {
      const a = (await tx.query(`SELECT id, type, ref_id, status FROM approval_request WHERE id = $1`, [id])).rows[0]; if (!a) throw notFound();
      if (a.type === 'IMPORT') throw new AppError(400, 'VALIDATION', 'IMPORT approvals are decided on the import page (/import/jobs/:id/apply)');
      if (a.type === 'COUNT_VARIANCE' && b.decision === 'approve' && a.status === 'PENDING') await applyLineDecisions(tx, a.ref_id, b.line_decisions);
      const r = await decideApproval(tx, req.ctx, id, b.decision, b.note);
      return stripCost(req.ctx, { ...r, type_zh: TYPE_ZH[r.type] ?? r.type });
    });
  });

  // ---------- 手动调整（M4） ----------
  app.post('/adjustments', { preHandler: requirePerm('movement.adjust') }, async (req, reply) => {
    const b = z.object({ client_id: z.string().uuid().optional(), product_id: z.string().uuid().optional(), barcode: z.string().optional(), location_id: z.string().uuid().optional(), location_code: z.string().optional(), new_qty: z.number().min(0), reason: z.enum(ADJUST_REASONS), photo_url: z.string().max(400000).optional().nullable(), note: z.string().max(300).optional().nullable() }).parse(req.body);
    const r = await withCompany(cx(req), async (tx) => {
      if (b.client_id) { const dup = (await tx.query(`SELECT * FROM approval_request WHERE ref_type = 'ADJUST' AND ref_id = $1`, [b.client_id])).rows[0]; if (dup) return { ...dup, duplicate: true }; }
      let productId = b.product_id;
      if (!productId && b.barcode) productId = (await tx.query(`SELECT product_id FROM barcode WHERE barcode = $1`, [b.barcode])).rows[0]?.product_id;
      if (!productId) throw notFound('BARCODE_NOT_FOUND');
      const p = (await tx.query(`SELECT id, sku, name_zh, name_ms, name_en, cost_price, unit FROM product WHERE id = $1 AND is_active`, [productId])).rows[0]; if (!p) throw notFound('PRODUCT_NOT_FOUND');
      let locId = b.location_id;
      if (!locId && b.location_code) locId = (await tx.query(`SELECT id FROM location WHERE code = $1`, [b.location_code.replace(/^LOC:[A-Z0-9]+:/i, '')])).rows[0]?.id;
      const loc = locId ? (await tx.query(`SELECT id, code, site_id, is_virtual FROM location WHERE id = $1 AND is_active`, [locId])).rows[0] : null;
      if (!loc || loc.is_virtual) throw notFound('LOCATION_NOT_FOUND');
      const cur = Number((await tx.query(`SELECT qty FROM stock WHERE product_id = $1 AND location_id = $2`, [p.id, loc.id])).rows[0]?.qty ?? 0);
      const diff = Math.round((b.new_qty - cur) * 1000) / 1000;
      if (diff === 0) throw new AppError(400, 'VALIDATION', 'no change');
      const amount = Math.round(Math.abs(diff) * Number(p.cost_price) * 100) / 100;
      let role = defaultApproverRole(req.ctx, 'ADJUST', amount);
      if (req.ctx.plan !== 'A' && !req.ctx.roles.includes('BOSS') && role !== 'BOSS') {
        const limit = Number(req.ctx.settings?.adjust_daily_limit ?? 500);
        const used = Number((await tx.query(`SELECT coalesce(sum(amount),0) v FROM approval_request WHERE type = 'ADJUST' AND requested_by = $1 AND status <> 'REJECTED' AND created_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Kuala_Lumpur') AT TIME ZONE 'Asia/Kuala_Lumpur'`, [req.ctx.userId])).rows[0].v);
        if (used + amount > limit) role = 'BOSS';
      }
      const refId = b.client_id ?? (await tx.query(`SELECT uuid_v7() id`)).rows[0].id;
      const name = p.name_zh ?? p.name_en ?? p.name_ms ?? p.sku;
      const summary = { title: `${name} @ ${loc.code}：${cur} → ${b.new_qty}（${diff > 0 ? '+' : ''}${diff}）${ADJUST_REASON_ZH[b.reason]}`, product_id: p.id, product_name: name, sku: p.sku, unit: p.unit, location_id: loc.id, location_code: loc.code, current_qty: cur, new_qty: b.new_qty, diff, reason: b.reason, photo_url: b.photo_url ?? null, note: b.note ?? null, unit_cost: Number(p.cost_price) };
      let a = await createApproval(tx, req.ctx, { type: 'ADJUST', ref_type: 'ADJUST', ref_id: refId, amount, site_id: loc.site_id, approver_role_code: role, summary, text: `<b>手动调整审批</b>\n发起人：${req.ctx.name}\n${summary.title}\n金额：RM ${amount.toFixed(2)}` });
      // A 模式老板自己发起 → 直接生效
      if (req.ctx.plan === 'A' && req.ctx.roles.includes('BOSS')) a = await decideApproval(tx, req.ctx, a.id, 'approve', '老板直接调整');
      return { ...a, duplicate: false };
    });
    reply.status(r.duplicate ? 200 : 201); return stripCost(req.ctx, r);
  });
  app.get('/adjustments', { preHandler: requirePerm('movement.adjust', 'approval.decide') }, async (req) => withCompany(cx(req), async (tx) => (await tx.query(
    `SELECT a.*, u.name AS requested_by_name, ap.name AS approver_name FROM approval_request a JOIN app_user u ON u.id = a.requested_by LEFT JOIN app_user ap ON ap.id = a.approver_id WHERE a.type = 'ADJUST' AND ($1::boolean OR a.requested_by = $2) ORDER BY a.created_at DESC LIMIT 100`, [hasPerm(req.ctx, 'approval.decide'), req.ctx.userId])).rows.map((r: any) => stripCost(req.ctx, { ...r, summary: stripCost(req.ctx, r.summary ?? {}) }))));

  // ---------- 代理（O5） ----------
  const DELEG_SQL = `SELECT d.*, a.name AS delegator_name, b.name AS delegate_name, (SELECT array_agg(DISTINCT r.code) FROM user_site_role usr JOIN role r ON r.id = usr.role_id WHERE usr.user_id = d.delegator_id) AS delegator_roles,
      (SELECT count(*) FROM approval_request ar WHERE ar.delegation_id = d.id) AS used_count,
      (SELECT coalesce(sum(ar.amount),0) FROM approval_request ar WHERE ar.delegation_id = d.id AND ar.decided_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Kuala_Lumpur') AT TIME ZONE 'Asia/Kuala_Lumpur') AS used_today
    FROM delegation d JOIN app_user a ON a.id = d.delegator_id JOIN app_user b ON b.id = d.delegate_id`;
  app.get('/delegations', async (req) => {
    const q = z.object({ status: z.string().optional() }).parse(req.query);
    const all = hasPerm(req.ctx, 'delegation.manage') && req.ctx.roles.includes('BOSS') || req.ctx.isSuperAdmin;
    return withCompany(cx(req), async (tx) => (await tx.query(`${DELEG_SQL} WHERE ($1::boolean OR d.delegator_id = $2 OR d.delegate_id = $2) AND ($3::text IS NULL OR d.status = $3) ORDER BY (d.status = 'ACTIVE') DESC, d.ends_at DESC`, [all, req.ctx.userId, q.status ?? null])).rows);
  });
  app.get('/me/delegations', async (req) => withCompany(cx(req), (tx) => myDelegations(tx, req.ctx)));
  app.post('/delegations', { preHandler: requirePerm('delegation.manage') }, async (req, reply) => {
    const b = z.object({ delegate_id: z.string().uuid(), delegator_id: z.string().uuid().optional(), scope_types: z.array(z.enum(APPROVAL_TYPES)).default([]), per_item_limit: z.number().positive().optional().nullable(), daily_limit: z.number().positive().optional().nullable(), starts_at: z.string().optional(), ends_at: z.string(), is_standby: z.boolean().default(false), standby_after_hours: z.number().int().min(1).max(168).optional().nullable(), note: z.string().max(200).optional().nullable() }).parse(req.body);
    const delegator = b.delegator_id ?? req.ctx.userId;
    if (delegator !== req.ctx.userId && !req.ctx.roles.includes('BOSS') && !req.ctx.isSuperAdmin) throw new AppError(403, 'FORBIDDEN', 'only boss can set delegation for others');
    if (delegator === b.delegate_id) throw new AppError(400, 'DELEGATION_INVALID', 'delegate = delegator');
    const starts = b.starts_at ? new Date(b.starts_at) : new Date(); const ends = new Date(b.ends_at);
    if (isNaN(ends.getTime()) || ends <= starts) throw new AppError(400, 'DELEGATION_INVALID', 'ends_at must be after starts_at');
    if (ends.getTime() - starts.getTime() > 30 * 86400_000) throw new AppError(400, 'DELEGATION_INVALID', 'max 30 days');
    const r = await withCompany(cx(req), async (tx) => {
      const del = (await tx.query(`SELECT id, name FROM app_user WHERE id = $1 AND is_active AND NOT is_super_admin`, [b.delegate_id])).rows[0]; if (!del) throw notFound('USER_NOT_FOUND');
      const d = (await tx.query(
        `INSERT INTO delegation (company_id, delegator_id, delegate_id, scope_types, per_item_limit, daily_limit, starts_at, ends_at, is_standby, standby_after_hours, note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [req.ctx.companyId, delegator, b.delegate_id, b.scope_types, b.per_item_limit ?? null, b.daily_limit ?? null, starts.toISOString(), ends.toISOString(), b.is_standby, b.standby_after_hours ?? null, b.note ?? null])).rows[0];
      const scope = b.scope_types.length ? b.scope_types.map((t) => TYPE_ZH[t]).join('、') : '全部审批';
      const until = ends.toLocaleString('zh-CN', { timeZone: 'Asia/Kuala_Lumpur' });
      const text = `<b>代理${b.is_standby ? '（常备）' : ''}</b>：${del.name} 代 ${req.ctx.name} 审批 ${scope}，到 ${until}${b.per_item_limit ? `，单笔 ≤ RM ${b.per_item_limit}` : ''}${b.daily_limit ? `，每日 ≤ RM ${b.daily_limit}` : ''}`;
      void tgSendToUser(req.ctx.companyId, b.delegate_id, text, undefined, 'DELEGATION');
      void tgSend(req.ctx.companyId, text, undefined, { type: 'DELEGATION', refType: 'delegation', refId: d.id });
      return (await tx.query(`${DELEG_SQL} WHERE d.id = $1`, [d.id])).rows[0];
    });
    reply.status(201); return r;
  });
  app.post('/delegations/:id/revoke', async (req) => {
    const { id } = req.params as any;
    return withCompany(cx(req), async (tx) => {
      const d = (await tx.query(`${DELEG_SQL} WHERE d.id = $1`, [id])).rows[0]; if (!d) throw notFound();
      if (d.delegator_id !== req.ctx.userId && !(req.ctx.roles.includes('BOSS') && hasPerm(req.ctx, 'delegation.manage')) && !req.ctx.isSuperAdmin) throw new AppError(403, 'FORBIDDEN');
      if (d.status !== 'ACTIVE') throw new AppError(400, 'DELEGATION_INVALID', d.status);
      const r = (await tx.query(`UPDATE delegation SET status = 'REVOKED', revoked_at = now() WHERE id = $1 RETURNING *`, [id])).rows[0];
      const text = `代理已撤销：${d.delegate_name} 不再代 ${d.delegator_name} 审批`;
      void tgSendToUser(req.ctx.companyId, d.delegate_id, text, undefined, 'DELEGATION');
      void tgSend(req.ctx.companyId, text, undefined, { type: 'DELEGATION', refType: 'delegation', refId: id });
      return r;
    });
  });

  // ---------- 通知（Telegram 未配置时的备用通道） ----------
  app.get('/notifications', async (req) => {
    const q = z.object({ unread: z.string().optional(), limit: z.coerce.number().max(500).default(100) }).parse(req.query);
    return withCompany(cx(req), async (tx) => (await tx.query(`SELECT * FROM notification WHERE user_id = $1 AND (NOT $2::boolean OR read_at IS NULL) ORDER BY sent_at DESC LIMIT $3`, [req.ctx.userId, q.unread === 'true', q.limit])).rows);
  });
  app.post('/notifications/:id/read', async (req) => {
    const { id } = req.params as any;
    return withCompany(cx(req), async (tx) => { await tx.query(`UPDATE notification SET read_at = coalesce(read_at, now()) WHERE id = $1 AND user_id = $2`, [id, req.ctx.userId]); return { ok: true }; });
  });
  app.post('/notifications/read-all', async (req) => withCompany(cx(req), async (tx) => { const r = await tx.query(`UPDATE notification SET read_at = now() WHERE user_id = $1 AND read_at IS NULL`, [req.ctx.userId]); return { ok: true, count: r.rowCount }; }));
}
