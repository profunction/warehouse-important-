// 统一审批引擎：建审批 → Telegram 通知 → 审批人或代理人决定 → 回调各模块。
// 规则（第四部分）：审批者不能批自己发起的（A 模式老板一人例外）；代理人在有效期、范围、金额上限内可代批，记 on_behalf_of。
import type { Tx } from './db.js';
import type { RequestCtx } from './auth.js';
import { hasPerm } from './auth.js';
import { AppError, fromDbError } from './errors.js';
import { tgSend, tgEdit } from './telegram.js';

export type ApprovalType = 'IMPORT' | 'ORDER' | 'COUNT_VARIANCE' | 'RETURN' | 'PO_PRICE_CHANGE' | 'ADJUST' | 'TRANSFER' | 'PAYMENT' | 'PRICE_CHANGE' | 'PO' | 'VOID_SALE' | 'SUPPLIER_INVOICE' | 'DISCOUNT';
export type Decision = 'approve' | 'reject' | 'return';
export interface ApprovalRow { id: string; company_id: string; type: ApprovalType; ref_type: string; ref_id: string; requested_by: string; approver_role_code: string; approver_id: string | null; on_behalf_of: string | null; delegation_id: string | null; status: string; summary: any; amount: number | null; site_id: string | null; telegram_message_id: string | null; decision_note: string | null }
type Handler = (tx: Tx, ctx: RequestCtx, a: ApprovalRow, decision: Decision, note?: string) => Promise<void>;
const handlers = new Map<string, Handler>();
/** 各模块注册：审批决定后要做什么（批准 → 生成 PO / 写 COUNT 移动 / 退款 …） */
export function registerApprovalHandler(type: ApprovalType, h: Handler) { handlers.set(type, h); }

export const TYPE_ZH: Record<ApprovalType, string> = { IMPORT: 'Excel 导入', ORDER: '订货', COUNT_VARIANCE: '盘点差异', RETURN: '退货', PO_PRICE_CHANGE: '采购价变更', ADJUST: '手动调整', TRANSFER: '调拨', PAYMENT: '付款', PRICE_CHANGE: '改价', PO: '采购单', VOID_SALE: '作废销售', SUPPLIER_INVOICE: '供应商发票', DISCOUNT: '折扣' };

/** 默认审批角色：A 模式全部老板；B 模式按类型，超门槛升级到老板 */
export function defaultApproverRole(ctx: Pick<RequestCtx, 'plan' | 'settings'>, type: ApprovalType, amount?: number | null): string {
  if (ctx.plan === 'A') return 'BOSS';
  const s = ctx.settings ?? {};
  const over = (key: string) => amount != null && Number(s[key] ?? 0) > 0 && Math.abs(amount) > Number(s[key]);
  switch (type) {
    case 'COUNT_VARIANCE': return over('approval_threshold_count_variance') ? 'BOSS' : 'MANAGER';
    case 'ADJUST': return over('approval_threshold_adjust') ? 'BOSS' : 'MANAGER';
    case 'TRANSFER': case 'RETURN': case 'DISCOUNT': return 'MANAGER';
    case 'PAYMENT': return 'BOSS';
    case 'IMPORT': case 'ORDER': case 'PO': case 'PO_PRICE_CHANGE': case 'PRICE_CHANGE': case 'VOID_SALE': case 'SUPPLIER_INVOICE': default: return 'BOSS';
  }
}

export interface CreateApprovalInput { type: ApprovalType; ref_type: string; ref_id: string; summary?: any; amount?: number | null; site_id?: string | null; approver_role_code?: string; text?: string; notify?: boolean }
/** 建审批并通知。返回审批行。 */
export async function createApproval(tx: Tx, ctx: RequestCtx, input: CreateApprovalInput): Promise<ApprovalRow> {
  const role = input.approver_role_code ?? defaultApproverRole(ctx, input.type, input.amount);
  let a: ApprovalRow;
  try {
    a = (await tx.query(
      `INSERT INTO approval_request (company_id, type, ref_type, ref_id, requested_by, approver_role_code, summary, amount, site_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [ctx.companyId, input.type, input.ref_type, input.ref_id, ctx.userId, role, input.summary ? JSON.stringify(input.summary) : null, input.amount ?? null, input.site_id ?? ctx.siteId ?? null])).rows[0];
  } catch (e) { throw fromDbError(e); }
  if (input.notify !== false) {
    const text = input.text ?? `<b>${TYPE_ZH[input.type]}审批</b>\n发起人：${ctx.name}${input.amount != null ? `\n金额：RM ${Number(input.amount).toFixed(2)}` : ''}${input.summary?.title ? `\n${input.summary.title}` : ''}`;
    const mid = await tgSend(ctx.companyId, text, [[{ text: '✅ 批准', callback_data: `apr:${a.id}:approve` }, { text: '❌ 拒绝', callback_data: `apr:${a.id}:reject` }], [{ text: '查看明细', callback_data: `apr:${a.id}:detail` }]], { type: 'APPROVAL', refType: 'approval_request', refId: a.id });
    if (mid) { await tx.query(`UPDATE approval_request SET telegram_message_id = $2 WHERE id = $1`, [a.id, mid]); a.telegram_message_id = mid; }
  }
  return a;
}

/** 找出当前用户可用的代理：被指定人 = 我，指定人拥有 approverRole，范围含 type，金额在上限内，今日累计未超 */
export async function findDelegationFor(tx: Tx, ctx: RequestCtx, approverRole: string, type: ApprovalType, amount?: number | null) {
  const rows = (await tx.query(
    `SELECT d.*, (SELECT coalesce(sum(a.amount),0) FROM approval_request a WHERE a.delegation_id = d.id AND a.decided_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Kuala_Lumpur') AT TIME ZONE 'Asia/Kuala_Lumpur') AS used_today
     FROM delegation d
     WHERE d.delegate_id = $1 AND d.status = 'ACTIVE' AND now() BETWEEN d.starts_at AND d.ends_at
       AND EXISTS (SELECT 1 FROM user_site_role usr JOIN role r ON r.id = usr.role_id WHERE usr.user_id = d.delegator_id AND r.code = $2)
       AND (cardinality(d.scope_types) = 0 OR $3 = ANY(d.scope_types))
     ORDER BY d.ends_at`, [ctx.userId, approverRole, type])).rows;
  for (const d of rows) {
    const amt = Math.abs(Number(amount ?? 0));
    if (d.per_item_limit != null && amt > Number(d.per_item_limit)) continue;
    if (d.daily_limit != null && Number(d.used_today) + amt > Number(d.daily_limit)) continue;
    return d;
  }
  // 有代理但超限 → 明确告诉用户
  if (rows.length) throw new AppError(403, 'DELEGATION_LIMIT');
  return null;
}

/** 当前用户能否批这个审批：自己有该角色，或作为代理人 */
export async function resolveApprover(tx: Tx, ctx: RequestCtx, a: ApprovalRow): Promise<{ onBehalfOf: string | null; delegationId: string | null }> {
  if (ctx.isSuperAdmin) return { onBehalfOf: null, delegationId: null };
  if (!hasPerm(ctx, 'approval.decide') && !ctx.roles.includes(a.approver_role_code)) {
    const d = await findDelegationFor(tx, ctx, a.approver_role_code, a.type, a.amount);
    if (!d) throw new AppError(403, 'APPROVAL_NOT_ALLOWED');
    return { onBehalfOf: d.delegator_id, delegationId: d.id };
  }
  if (ctx.roles.includes(a.approver_role_code)) return { onBehalfOf: null, delegationId: null };
  // 有 approval.decide 但角色不符（例如经理批老板级别）→ 看代理
  const d = await findDelegationFor(tx, ctx, a.approver_role_code, a.type, a.amount);
  if (!d) throw new AppError(403, 'APPROVAL_NOT_ALLOWED');
  return { onBehalfOf: d.delegator_id, delegationId: d.id };
}

/** 决定：approve / reject / return。调用模块回调。 */
export async function decideApproval(tx: Tx, ctx: RequestCtx, id: string, decision: Decision, note?: string): Promise<ApprovalRow> {
  const a: ApprovalRow = (await tx.query(`SELECT * FROM approval_request WHERE id = $1 FOR UPDATE`, [id])).rows[0];
  if (!a) throw new AppError(404, 'NOT_FOUND');
  if (a.status !== 'PENDING') throw new AppError(409, 'APPROVAL_NOT_PENDING');
  const who = await resolveApprover(tx, ctx, a);
  if (a.requested_by === ctx.userId && ctx.plan !== 'A' && !ctx.isSuperAdmin) throw new AppError(400, 'APPROVAL_SELF');
  const status = decision === 'approve' ? 'APPROVED' : decision === 'reject' ? 'REJECTED' : 'RETURNED';
  let row: ApprovalRow;
  try {
    row = (await tx.query(`UPDATE approval_request SET status = $2, approver_id = $3, on_behalf_of = $4, delegation_id = $5, decided_at = now(), decision_note = $6 WHERE id = $1 RETURNING *`, [id, status, ctx.userId, who.onBehalfOf, who.delegationId, note ?? null])).rows[0];
  } catch (e) { throw fromDbError(e); }
  const h = handlers.get(a.type);
  if (h) await h(tx, ctx, row, decision, note);
  if (row.telegram_message_id) {
    const label = status === 'APPROVED' ? '已批准' : status === 'REJECTED' ? '已拒绝' : '已退回';
    void tgEdit(ctx.companyId, row.telegram_message_id, `<b>${TYPE_ZH[row.type]}</b> ${label} · ${ctx.name}${who.onBehalfOf ? '（代理）' : ''}${note ? `\n${note}` : ''}`);
  }
  return row;
}

/** 等我批的：角色匹配 + 作为代理人可批的 */
export async function listPending(tx: Tx, ctx: RequestCtx) {
  return (await tx.query(
    `SELECT a.*, u.name AS requested_by_name,
       (a.approver_role_code = ANY($2) OR $3) AS as_self,
       EXISTS (SELECT 1 FROM delegation d JOIN user_site_role usr ON usr.user_id = d.delegator_id JOIN role r ON r.id = usr.role_id
               WHERE d.delegate_id = $1 AND d.status = 'ACTIVE' AND now() BETWEEN d.starts_at AND d.ends_at AND r.code = a.approver_role_code
                 AND (cardinality(d.scope_types) = 0 OR a.type = ANY(d.scope_types)) AND (d.per_item_limit IS NULL OR coalesce(abs(a.amount),0) <= d.per_item_limit)) AS as_delegate
     FROM approval_request a JOIN app_user u ON u.id = a.requested_by
     WHERE a.status = 'PENDING' AND (a.approver_role_code = ANY($2) OR $3
       OR EXISTS (SELECT 1 FROM delegation d JOIN user_site_role usr ON usr.user_id = d.delegator_id JOIN role r ON r.id = usr.role_id
                  WHERE d.delegate_id = $1 AND d.status = 'ACTIVE' AND now() BETWEEN d.starts_at AND d.ends_at AND r.code = a.approver_role_code
                    AND (cardinality(d.scope_types) = 0 OR a.type = ANY(d.scope_types))))
     ORDER BY a.created_at`, [ctx.userId, ctx.roles, ctx.isSuperAdmin])).rows;
}
