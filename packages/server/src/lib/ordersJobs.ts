// 模块 A 共用逻辑 + 定时任务：每日订货建议、从建议生成 PO、PO 发出（文件 + Telegram）、工单助手。
// 约定（设计文档没写的）：
//  - 建议量 = max(reorder_qty, ceil(30 天日均销量 × reorder_days))，有 CASE 条码时向上取整到整箱；日均销量按 movement.reason='SALE' 近 30 天。
//  - 现有量 = 非虚拟位置库存总和（传 siteId 时只算该站点）；只对 is_active 产品、total_qty < min_level 的产品出建议。
//  - 同一天同一公司已有未结（PENDING_*）的 AUTO 建议时定时任务不重复生成；手动 POST /order-proposals/generate 不受此限。
//  - A 模式：建议直接 PENDING_APPROVAL 并建 ORDER 审批（Telegram 三个按钮）；B 模式：PENDING_REVIEW，Telegram 只通知。
//  - 批准后按供应商拆 PO：po_no = PO-<年>-NNNN，status SENT，sent_via TELEGRAM，PDF/Excel 存 uploadDir，没有供应商的行归入"未指定供应商"→ 跳过并写进 note。
import type PgBoss from 'pg-boss';
import type { Tx } from './db.js';
import { adminPool, withCompany } from './db.js';
import type { RequestCtx } from './auth.js';
import { createApproval } from './approvals.js';
import { tgSend, tgSendDocument } from './telegram.js';
import { nextDocNo } from './docno.js';
import { loadPoDoc, savePoFiles } from './poPdf.js';
import { AppError } from './errors.js';

export type JobCtx = Pick<RequestCtx, 'companyId' | 'userId' | 'plan' | 'settings' | 'name' | 'siteId' | 'roles' | 'permissions' | 'isSuperAdmin' | 'deviceId' | 'lang'>;
const pname = (r: any) => r.name_zh || r.name_en || r.name_ms || r.sku || '';
export const money = (v: any) => `RM ${Number(v ?? 0).toFixed(2)}`;

/** 向上取整到箱 */
export function roundToCase(qty: number, caseQty: number | null | undefined) {
  if (!caseQty || caseQty <= 1) return Math.ceil(qty);
  return Math.ceil(qty / caseQty) * caseQty;
}

/** 生成一张订货建议。没有低于最低量的产品时返回 null。 */
export async function generateProposal(tx: Tx, ctx: JobCtx, siteId?: string | null) {
  const rows = (await tx.query(
    `WITH tot AS (
       SELECT p.id, coalesce(sum(st.qty) FILTER (WHERE l.id IS NOT NULL AND NOT l.is_virtual AND ($1::uuid IS NULL OR l.site_id = $1)), 0) AS total
       FROM product p LEFT JOIN stock st ON st.product_id = p.id LEFT JOIN location l ON l.id = st.location_id WHERE p.is_active GROUP BY p.id),
     sales AS (SELECT product_id, sum(qty) AS q FROM movement WHERE reason = 'SALE' AND performed_at > now() - interval '30 days' GROUP BY product_id)
     SELECT p.id, p.sku, p.name_zh, p.name_ms, p.name_en, p.min_level, p.reorder_qty, p.reorder_days, p.default_supplier_id, p.cost_price, tot.total,
            coalesce(sales.q, 0) / 30.0 AS avg_daily,
            (SELECT max(pack_qty) FROM barcode b WHERE b.product_id = p.id AND b.barcode_type = 'CASE') AS case_qty
     FROM product p JOIN tot ON tot.id = p.id LEFT JOIN sales ON sales.product_id = p.id
     WHERE p.is_active AND tot.total < p.min_level ORDER BY p.default_supplier_id NULLS LAST, p.name_zh`, [siteId ?? null])).rows;
  if (!rows.length) return null;
  const status = ctx.plan === 'A' ? 'PENDING_APPROVAL' : 'PENDING_REVIEW';
  const prop = (await tx.query(`INSERT INTO order_proposal (company_id, site_id, status, source) VALUES ($1,$2,$3,'AUTO') RETURNING *`, [ctx.companyId, siteId ?? null, status])).rows[0];
  let total = 0;
  for (const r of rows) {
    const byDays = Math.ceil(Number(r.avg_daily) * Number(r.reorder_days || 7));
    const suggested = roundToCase(Math.max(Number(r.reorder_qty), byDays), r.case_qty ? Number(r.case_qty) : null);
    total += suggested * Number(r.cost_price);
    await tx.query(`INSERT INTO order_proposal_line (company_id, proposal_id, product_id, supplier_id, current_qty, avg_daily_sales, suggested_qty, final_qty, unit_cost) VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$8)`,
      [ctx.companyId, prop.id, r.id, r.default_supplier_id ?? null, r.total, Math.round(Number(r.avg_daily) * 1000) / 1000, suggested, r.cost_price]);
  }
  if (ctx.plan === 'A') {
    await submitProposal(tx, ctx, prop.id);
  } else {
    const text = `<b>今日订货建议</b>（待采购员预审）\n${rows.length} 个产品低于最低量 · 预估 ${money(total)}\n请采购员在网页"订货与采购"预审后送审。`;
    const mid = await tgSend(ctx.companyId, text, undefined, { type: 'ORDER_PROPOSAL', refType: 'order_proposal', refId: prop.id });
    if (mid) await tx.query(`UPDATE order_proposal SET telegram_message_id = $2 WHERE id = $1`, [prop.id, mid]);
  }
  return (await tx.query(`SELECT * FROM order_proposal WHERE id = $1`, [prop.id])).rows[0];
}

/** 建议明细（含产品、供应商名） */
export async function proposalLines(tx: Tx, proposalId: string) {
  return (await tx.query(
    `SELECT l.*, p.sku, p.name_zh, p.name_ms, p.name_en, p.unit, p.photo_url, p.min_level, p.reorder_qty, s.name AS supplier_name, s.min_order_amount,
            (SELECT max(pack_qty) FROM barcode b WHERE b.product_id = p.id AND b.barcode_type = 'CASE') AS case_qty,
            round(l.final_qty * l.unit_cost, 2) AS amount
     FROM order_proposal_line l JOIN product p ON p.id = l.product_id LEFT JOIN supplier s ON s.id = l.supplier_id
     WHERE l.proposal_id = $1 ORDER BY s.name NULLS LAST, p.name_zh`, [proposalId])).rows;
}

/** 按供应商分组的 Telegram 清单文本 */
export function proposalText(prop: any, lines: any[], who: string) {
  const live = lines.filter((l) => !l.is_removed && Number(l.final_qty) > 0);
  const groups = new Map<string, any[]>();
  for (const l of live) { const k = l.supplier_name ?? '未指定供应商'; if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(l); }
  let total = 0; const parts: string[] = [];
  for (const [sup, ls] of groups) {
    const sub = ls.reduce((a, l) => a + Number(l.amount), 0); total += sub;
    parts.push(`<b>${sup}</b> · ${money(sub)}\n` + ls.map((l) => `  • ${pname(l)} × ${Number(l.final_qty)}${l.case_qty && Number(l.case_qty) > 1 ? `（${Math.round(Number(l.final_qty) / Number(l.case_qty) * 10) / 10} 箱）` : ''}（现有 ${Number(l.current_qty)}）`).join('\n'));
  }
  return { text: `<b>订货审批</b> ${prop.proposal_date ? new Date(prop.proposal_date).toISOString().slice(0, 10) : ''}\n发起人：${who}\n${live.length} 个产品 · 合计 ${money(total)}\n\n${parts.join('\n\n')}`, total, count: live.length };
}

/** 送审：建 ORDER 审批（三个按钮），状态 PENDING_APPROVAL */
export async function submitProposal(tx: Tx, ctx: JobCtx, proposalId: string) {
  const prop = (await tx.query(`SELECT * FROM order_proposal WHERE id = $1 FOR UPDATE`, [proposalId])).rows[0];
  if (!prop) throw new AppError(404, 'NOT_FOUND');
  if (!['PENDING_REVIEW', 'RETURNED', 'PENDING_APPROVAL'].includes(prop.status)) throw new AppError(409, 'VALIDATION', `proposal status ${prop.status}`);
  if (prop.approval_id) { const a = (await tx.query(`SELECT status FROM approval_request WHERE id = $1`, [prop.approval_id])).rows[0]; if (a?.status === 'PENDING') throw new AppError(409, 'DUPLICATE', 'already submitted'); }
  const lines = await proposalLines(tx, proposalId);
  const { text, total, count } = proposalText(prop, lines, ctx.name);
  if (!count) throw new AppError(400, 'VALIDATION', 'no lines');
  const a = await createApproval(tx, ctx as RequestCtx, { type: 'ORDER', ref_type: 'order_proposal', ref_id: proposalId, summary: { title: `订货建议 ${count} 项`, total }, amount: Math.round(total * 100) / 100, notify: false });
  const mid = await tgSend(ctx.companyId, text, [[{ text: '✅ 全部批准', callback_data: `apr:${a.id}:approve` }], [{ text: '✏️ 逐项修改', callback_data: `apr:${a.id}:detail` }, { text: '❌ 拒绝', callback_data: `apr:${a.id}:reject` }]], { type: 'APPROVAL', refType: 'approval_request', refId: a.id });
  if (mid) await tx.query(`UPDATE approval_request SET telegram_message_id = $2 WHERE id = $1`, [a.id, mid]);
  await tx.query(`UPDATE order_proposal SET status = 'PENDING_APPROVAL', approval_id = $2, reviewed_by = $3, telegram_message_id = COALESCE($4, telegram_message_id) WHERE id = $1`, [proposalId, a.id, ctx.userId, mid]);
  return a;
}

/** 把一张 PO 定为 SENT：生成 PDF/Excel、记录 URL、Telegram 发文档。返回更新后的 PO。 */
export async function finalizePo(tx: Tx, ctx: JobCtx, poId: string, via = 'TELEGRAM') {
  const d = await loadPoDoc(tx, poId);
  let files: { pdf_url: string; xlsx_url: string; pdfPath: string } | null = null;
  try { files = await savePoFiles(d); } catch (e: any) { console.error('po files failed', e?.message); }
  const po = (await tx.query(`UPDATE purchase_order SET status = 'SENT', sent_at = now(), sent_via = $2, pdf_url = COALESCE($3, pdf_url), xlsx_url = COALESCE($4, xlsx_url) WHERE id = $1 RETURNING *`, [poId, via, files?.pdf_url ?? null, files?.xlsx_url ?? null])).rows[0];
  if (files && via === 'TELEGRAM') void tgSendDocument(ctx.companyId, files.pdfPath, `采购单 ${po.po_no} · ${d.supplier?.name ?? ''} · ${money(po.total_amount)}`, `${po.po_no}.pdf`);
  return po;
}

/** 审批通过：按供应商拆成多张 PO，全部 SENT，回传老板 */
export async function createPosFromProposal(tx: Tx, ctx: JobCtx, a: { id: string | null; ref_id: string }) {
  const prop = (await tx.query(`SELECT * FROM order_proposal WHERE id = $1 FOR UPDATE`, [a.ref_id])).rows[0];
  if (!prop) throw new AppError(404, 'NOT_FOUND');
  const lines = (await proposalLines(tx, prop.id)).filter((l) => !l.is_removed && Number(l.final_qty) > 0);
  const groups = new Map<string, any[]>(); const noSupplier: any[] = [];
  for (const l of lines) { if (!l.supplier_id) { noSupplier.push(l); continue; } if (!groups.has(l.supplier_id)) groups.set(l.supplier_id, []); groups.get(l.supplier_id)!.push(l); }
  const pos: any[] = [];
  for (const [supplierId, ls] of groups) {
    const poNo = await nextDocNo(tx, ctx.companyId, 'PO', `PO-${new Date().getFullYear()}-`);
    const total = ls.reduce((s, l) => s + Number(l.final_qty) * Number(l.unit_cost), 0);
    const lead = (await tx.query(`SELECT lead_time_days FROM supplier WHERE id = $1`, [supplierId])).rows[0]?.lead_time_days ?? 3;
    const po = (await tx.query(`INSERT INTO purchase_order (company_id, po_no, supplier_id, deliver_to_site_id, status, proposal_id, approval_id, total_amount, expected_date, created_by) VALUES ($1,$2,$3,$4,'DRAFT',$5,$6,$7, current_date + $8::int, $9) RETURNING *`,
      [ctx.companyId, poNo, supplierId, prop.site_id ?? ctx.siteId ?? null, prop.id, a.id, Math.round(total * 100) / 100, lead, ctx.userId])).rows[0];
    let n = 0;
    for (const l of ls) await tx.query(`INSERT INTO purchase_order_line (company_id, po_id, line_no, product_id, ordered_qty, unit_cost) VALUES ($1,$2,$3,$4,$5,$6)`, [ctx.companyId, po.id, ++n, l.product_id, l.final_qty, l.unit_cost]);
    pos.push(await finalizePo(tx, ctx, po.id, 'TELEGRAM'));
  }
  const note = noSupplier.length ? `${noSupplier.length} 行没有供应商未生成 PO：${noSupplier.map(pname).join('、')}` : null;
  await tx.query(`UPDATE order_proposal SET status = 'APPROVED', approved_by = $2, approved_at = now(), note = COALESCE($3, note) WHERE id = $1`, [prop.id, ctx.userId, note]);
  const summary = pos.length ? pos.map((p) => `• ${p.po_no} ${money(p.total_amount)}`).join('\n') : '（没有可生成的 PO）';
  await tgSend(ctx.companyId, `<b>订货已批准</b>，生成 ${pos.length} 张采购单：\n${summary}${note ? `\n⚠ ${note}` : ''}\nPDF 已随后发出，请转发给供应商。`, undefined, { type: 'PO_CREATED', refType: 'order_proposal', refId: prop.id });
  return pos;
}

/** 开工单（收货差异、调拨差异等）。owner 为角色；A 模式一律老板。 */
export async function openTicket(tx: Tx, ctx: JobCtx, t: { type: string; title: string; ref_type: string; ref_id: string; owner_role: string; days: number; site_id?: string | null; text?: string | null; photo_url?: string | null; priority?: string }) {
  const role = ctx.plan === 'A' ? 'BOSS' : t.owner_role;
  const row = (await tx.query(`INSERT INTO ticket (company_id, site_id, type, title, ref_type, ref_id, owner_role_code, priority, deadline_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now() + ($9::int || ' days')::interval) RETURNING *`,
    [ctx.companyId, t.site_id ?? ctx.siteId ?? null, t.type, t.title.slice(0, 200), t.ref_type, t.ref_id, role, t.priority ?? 'NORMAL', t.days])).rows[0];
  await tx.query(`INSERT INTO ticket_event (company_id, ticket_id, user_id, event, text, photo_url) VALUES ($1,$2,$3,$4,$5,$6)`, [ctx.companyId, row.id, ctx.userId, t.photo_url ? 'PHOTO' : 'CREATED', t.text ?? null, t.photo_url ?? null]);
  return row;
}

/** 定时任务用的伪请求上下文：以公司第一位老板的身份 */
export async function bossCtx(companyId: string): Promise<JobCtx | null> {
  const c = (await adminPool.query(`SELECT c.plan, c.settings, u.id AS uid, u.name FROM company c JOIN app_user u ON u.company_id = c.id AND u.is_active JOIN user_site_role usr ON usr.user_id = u.id JOIN role r ON r.id = usr.role_id AND r.code = 'BOSS' WHERE c.id = $1 ORDER BY u.created_at LIMIT 1`, [companyId])).rows[0];
  if (!c) return null;
  return { companyId, userId: c.uid, plan: c.plan, settings: c.settings ?? {}, name: c.name, siteId: null, roles: ['BOSS'], permissions: new Map(), isSuperAdmin: false, deviceId: null, lang: 'zh' };
}

/** 每天 08:00（或 settings.order_proposal_time）跑一次：到点的公司生成建议 */
export async function runDailyProposals(nowHHMM?: string) {
  const hhmm = nowHHMM ?? new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kuala_Lumpur' }).format(new Date());
  const companies = (await adminPool.query(`SELECT id, settings FROM company WHERE is_active`)).rows;
  let made = 0;
  for (const c of companies) {
    const at = String(c.settings?.order_proposal_time ?? '08:00');
    if (at.slice(0, 5) !== hhmm.slice(0, 5)) continue;
    const ctx = await bossCtx(c.id); if (!ctx) continue;
    try {
      await withCompany({ companyId: c.id, userId: ctx.userId }, async (tx) => {
        const dup = (await tx.query(`SELECT 1 FROM order_proposal WHERE source = 'AUTO' AND proposal_date = (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date AND status IN ('PENDING_REVIEW','PENDING_APPROVAL')`)).rowCount;
        if (dup) return;
        if (await generateProposal(tx, ctx, null)) made++;
      });
    } catch (e: any) { console.error('order proposal failed', c.id, e?.message); }
  }
  return made;
}

export async function registerOrdersJobs(boss: PgBoss) {
  // 每分钟检查一次哪家公司到了它设定的订货时间（各公司时间可不同）
  await boss.createQueue('order-proposal-daily');
  await boss.schedule('order-proposal-daily', '* 6-11 * * *', {}, { tz: 'Asia/Kuala_Lumpur' });
  await boss.work('order-proposal-daily', async () => { await runDailyProposals(); });
  console.log('jobs started: order-proposal-daily');
}
