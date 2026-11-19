// 供应商发票与应付（模块 D）。B7 三方匹配：PO 单价 × GRN 实收 对比 发票。
// 自定决定：
//  - 实收 = 该 PO 行所有未取消 GRN 的 goods_receipt_line.received_qty 之和（损坏不算实收）。
//  - 容差 settings.ap_match_tolerance（默认 1.00）：|Σ差异| ≤ 容差 → PAYABLE；否则 VARIANCE + 工单 AP_VARIANCE 给 PURCHASER（A 模式 BOSS）3 天。
//  - 不带 lines：把 PO 每行的实收 × PO 单价 作匹配额，与发票总额比。不带 po_id：无从匹配，直接 PAYABLE 并记 note。
//  - resolve 权限：ap.manage / ap.approve / receive.variance（采购员有 receive.variance 没有 ap.*）。
//  - 付款 > settings.approval_threshold_payment（0 = 不设限）→ 审批 PAYMENT 给 BOSS，批准后由 registerApprovalHandler('PAYMENT') 写 supplier_payment。
//  - PO_PRICE_CHANGE 审批批准后把 purchase_order_line.unit_cost 改成发票单价，匹配额按新价重算，发票 PAYABLE。
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withCompany, type Tx } from '../lib/db.js';
import { requireAuth, requirePerm, type RequestCtx } from '../lib/auth.js';
import { AppError, notFound } from '../lib/errors.js';
import { createApproval, registerApprovalHandler } from '../lib/approvals.js';
import { tgSend } from '../lib/telegram.js';

const cx = (req: any) => ({ companyId: req.ctx.companyId, userId: req.ctx.userId, deviceId: req.ctx.deviceId });
const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const LIST_SQL = `SELECT si.*, s.name AS supplier_name, po.po_no, (si.amount - si.paid_amount) AS outstanding,
  (SELECT string_agg(g.grn_no, ', ') FROM goods_receipt g WHERE g.po_id = si.po_id AND g.status <> 'CANCELLED') AS grn_nos,
  (SELECT t.id FROM ticket t WHERE t.type = 'AP_VARIANCE' AND t.ref_id = si.id AND t.status NOT IN ('RESOLVED','CLOSED') LIMIT 1) AS open_ticket_id,
  a.status AS approval_status
  FROM supplier_invoice si JOIN supplier s ON s.id = si.supplier_id LEFT JOIN purchase_order po ON po.id = si.po_id LEFT JOIN approval_request a ON a.id = si.approval_id`;

/** 重算匹配：写 supplier_invoice_line.received_qty/po_unit_cost/variance，更新 matched_amount/variance_amount，返回 {matched, variance, lines} */
async function rematch(tx: Tx, invoiceId: string) {
  const inv = (await tx.query(`SELECT * FROM supplier_invoice WHERE id = $1`, [invoiceId])).rows[0];
  const lines = (await tx.query(`SELECT l.*, pl.unit_cost AS po_cost_now, pl.ordered_qty,
      coalesce((SELECT sum(gl.received_qty) FROM goods_receipt_line gl JOIN goods_receipt g ON g.id = gl.grn_id WHERE gl.po_line_id = l.po_line_id AND g.status <> 'CANCELLED'), 0) AS grn_received
    FROM supplier_invoice_line l LEFT JOIN purchase_order_line pl ON pl.id = l.po_line_id WHERE l.supplier_invoice_id = $1 ORDER BY l.id`, [invoiceId])).rows;
  let matched = 0; let variance = 0;
  for (const l of lines) {
    const received = Number(l.grn_received); const poCost = Number(l.po_cost_now ?? l.po_unit_cost);
    const expected = r2(received * poCost);
    const invoiced = l.invoiced_qty > 0 ? r2(Number(l.invoiced_qty) * Number(l.invoiced_unit_cost)) : null;
    const v = invoiced == null ? 0 : r2(invoiced - expected);
    matched += expected; variance += v;
    await tx.query(`UPDATE supplier_invoice_line SET received_qty = $2, po_unit_cost = $3, variance_amount = $4 WHERE id = $1`, [l.id, received, poCost, v]);
  }
  matched = r2(matched);
  // 没有逐行发票额（只给总额）时，差异 = 发票总额 − 匹配额
  const hasLineAmounts = lines.some((l) => Number(l.invoiced_qty) > 0);
  if (!hasLineAmounts) variance = r2(Number(inv.amount) - matched);
  await tx.query(`UPDATE supplier_invoice SET matched_amount = $2, variance_amount = $3 WHERE id = $1`, [invoiceId, matched, r2(variance)]);
  return { matched, variance: r2(variance), hasLineAmounts };
}
async function closeVarianceTicket(tx: Tx, invoiceId: string, resolution: string) {
  await tx.query(`UPDATE ticket SET status = 'RESOLVED', resolved_at = now(), resolution = $2 WHERE type = 'AP_VARIANCE' AND ref_id = $1 AND status NOT IN ('RESOLVED','CLOSED')`, [invoiceId, resolution]);
}
async function recordPayment(tx: Tx, ctx: Pick<RequestCtx, 'companyId' | 'userId'>, invoiceId: string, p: { amount: number; method: string; reference?: string | null; approval_id?: string | null }) {
  const inv = (await tx.query(`SELECT * FROM supplier_invoice WHERE id = $1 FOR UPDATE`, [invoiceId])).rows[0]; if (!inv) throw notFound();
  if (!['PAYABLE', 'PARTIAL'].includes(inv.status)) throw new AppError(409, 'AP_STATE', inv.status);
  const outstanding = r2(Number(inv.amount) - Number(inv.paid_amount));
  if (p.amount > outstanding + 0.005) throw new AppError(400, 'PAYMENT_EXCEEDS', { outstanding });
  const pay = (await tx.query(`INSERT INTO supplier_payment (company_id, supplier_invoice_id, amount, method, reference, paid_by, approval_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [ctx.companyId, invoiceId, p.amount, p.method, p.reference ?? null, ctx.userId, p.approval_id ?? null])).rows[0];
  const paid = r2(Number(inv.paid_amount) + p.amount);
  const status = paid >= Number(inv.amount) - 0.005 ? 'PAID' : 'PARTIAL';
  const upd = (await tx.query(`UPDATE supplier_invoice SET paid_amount = $2, status = $3 WHERE id = $1 RETURNING *`, [invoiceId, paid, status])).rows[0];
  return { payment: pay, invoice: upd };
}

// 审批回调：付款、PO 改价
registerApprovalHandler('PAYMENT', async (tx, ctx, a, decision) => {
  if (a.ref_type !== 'supplier_invoice') return;
  if (decision !== 'approve') { await tx.query(`UPDATE supplier_invoice SET approval_id = NULL WHERE id = $1 AND approval_id = $2`, [a.ref_id, a.id]); return; }
  const s = a.summary ?? {};
  await recordPayment(tx, { companyId: a.company_id, userId: a.requested_by }, a.ref_id, { amount: Number(a.amount ?? s.amount), method: s.method ?? 'BANK_TRANSFER', reference: s.reference ?? null, approval_id: a.id });
  await tx.query(`UPDATE supplier_invoice SET approval_id = NULL WHERE id = $1 AND approval_id = $2`, [a.ref_id, a.id]);
});
registerApprovalHandler('PO_PRICE_CHANGE', async (tx, ctx, a, decision) => {
  if (a.ref_type !== 'supplier_invoice') return;
  if (decision !== 'approve') { await tx.query(`UPDATE supplier_invoice SET approval_id = NULL, resolution = coalesce(resolution,'') || ' | PO 改价被拒' WHERE id = $1`, [a.ref_id]); return; }
  const lines = (await tx.query(`SELECT * FROM supplier_invoice_line WHERE supplier_invoice_id = $1 AND po_line_id IS NOT NULL AND invoiced_qty > 0`, [a.ref_id])).rows;
  for (const l of lines) await tx.query(`UPDATE purchase_order_line SET unit_cost = $2 WHERE id = $1`, [l.po_line_id, l.invoiced_unit_cost]);
  const po = (await tx.query(`SELECT po_id FROM supplier_invoice WHERE id = $1`, [a.ref_id])).rows[0];
  if (po?.po_id) await tx.query(`UPDATE purchase_order SET total_amount = (SELECT coalesce(sum(ordered_qty * unit_cost),0) FROM purchase_order_line WHERE po_id = $1) WHERE id = $1`, [po.po_id]);
  const m = await rematch(tx, a.ref_id);
  // 无逐行金额时无法改价，按总额接受
  await tx.query(`UPDATE supplier_invoice SET status = 'PAYABLE', approval_id = NULL, matched_amount = $2, variance_amount = 0, resolution = 'PO_PRICE_CHANGE' WHERE id = $1`, [a.ref_id, m.hasLineAmounts ? m.matched : Number((await tx.query(`SELECT amount FROM supplier_invoice WHERE id = $1`, [a.ref_id])).rows[0].amount)]);
  await closeVarianceTicket(tx, a.ref_id, 'PO 改价已批准');
});

export async function apRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);
  const VIEW = ['ap.manage', 'ap.pay', 'ap.approve', 'receive.variance', 'po.view'];
  app.get('/supplier-invoices', { preHandler: requirePerm(...VIEW) }, async (req) => {
    const q = z.object({ status: z.string().optional(), supplier: z.string().uuid().optional() }).parse(req.query);
    return withCompany(cx(req), async (tx) => (await tx.query(`${LIST_SQL} WHERE ($1::text IS NULL OR si.status = $1) AND ($2::uuid IS NULL OR si.supplier_id = $2) ORDER BY si.created_at DESC LIMIT 500`, [q.status ?? null, q.supplier ?? null])).rows);
  });
  const createSchema = z.object({
    supplier_id: z.string().uuid(), po_id: z.string().uuid().optional().nullable(), invoice_no: z.string().min(1).max(50), invoice_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
    amount: z.number().positive(), photo_url: z.string().optional().nullable(), myinvois_uuid: z.string().optional().nullable(), note: z.string().max(500).optional().nullable(),
    lines: z.array(z.object({ po_line_id: z.string().uuid(), invoiced_qty: z.number().min(0), invoiced_unit_cost: z.number().min(0) })).optional(),
  });
  app.post('/supplier-invoices', { preHandler: requirePerm('ap.manage') }, async (req, reply) => {
    const b = createSchema.parse(req.body);
    return withCompany(cx(req), async (tx) => {
      const sup = (await tx.query(`SELECT * FROM supplier WHERE id = $1`, [b.supplier_id])).rows[0]; if (!sup) throw new AppError(404, 'NOT_FOUND', 'supplier');
      let po: any = null;
      if (b.po_id) { po = (await tx.query(`SELECT * FROM purchase_order WHERE id = $1`, [b.po_id])).rows[0]; if (!po) throw new AppError(404, 'NOT_FOUND', 'po'); if (po.supplier_id !== b.supplier_id) throw new AppError(400, 'VALIDATION', 'PO belongs to another supplier'); }
      const invDate = b.invoice_date ?? new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
      const due = b.due_date ?? (() => { const d = new Date(`${invDate}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + Number(sup.payment_terms_days ?? 30)); return d.toISOString().slice(0, 10); })();
      const inv = (await tx.query(`INSERT INTO supplier_invoice (company_id, supplier_id, po_id, invoice_no, invoice_date, due_date, amount, photo_url, myinvois_uuid, note, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'PENDING_MATCH') RETURNING *`,
        [req.ctx.companyId, b.supplier_id, b.po_id ?? null, b.invoice_no, invDate, due, b.amount, b.photo_url ?? null, b.myinvois_uuid ?? null, b.note ?? null])).rows[0];
      if (!po) {
        const r = (await tx.query(`UPDATE supplier_invoice SET status = 'PAYABLE', matched_amount = amount, note = coalesce(note || ' | ', '') || '无采购单，未匹配' WHERE id = $1 RETURNING *`, [inv.id])).rows[0];
        reply.status(201); return { ...r, match: null };
      }
      const poLines = (await tx.query(`SELECT * FROM purchase_order_line WHERE po_id = $1 ORDER BY line_no`, [po.id])).rows;
      const given = new Map((b.lines ?? []).map((l) => [l.po_line_id, l]));
      for (const pl of poLines) {
        const g = given.get(pl.id);
        await tx.query(`INSERT INTO supplier_invoice_line (company_id, supplier_invoice_id, po_line_id, product_id, invoiced_qty, invoiced_unit_cost, po_unit_cost) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [req.ctx.companyId, inv.id, pl.id, pl.product_id, g?.invoiced_qty ?? 0, g?.invoiced_unit_cost ?? 0, pl.unit_cost]);
      }
      for (const l of b.lines ?? []) if (!poLines.some((pl) => pl.id === l.po_line_id)) throw new AppError(400, 'VALIDATION', `po_line ${l.po_line_id} not in PO`);
      const m = await rematch(tx, inv.id);
      const tol = Number(req.ctx.settings?.ap_match_tolerance ?? 1);
      const ok = Math.abs(m.variance) <= tol;
      const status = ok ? 'PAYABLE' : 'VARIANCE';
      const r = (await tx.query(`UPDATE supplier_invoice SET status = $2 WHERE id = $1 RETURNING *`, [inv.id, status])).rows[0];
      let ticket: any = null;
      if (!ok) {
        ticket = (await tx.query(`INSERT INTO ticket (company_id, site_id, type, title, ref_type, ref_id, owner_role_code, priority, deadline_at) VALUES ($1,$2,'AP_VARIANCE',$3,'supplier_invoice',$4,$5,'HIGH', now() + interval '3 days') RETURNING *`,
          [req.ctx.companyId, po.deliver_to_site_id ?? req.ctx.siteId ?? null, `供应商发票差异 ${sup.name} ${b.invoice_no}：发票 RM ${Number(b.amount).toFixed(2)} vs 匹配 RM ${m.matched.toFixed(2)}（差 ${m.variance.toFixed(2)}）`, inv.id, req.ctx.plan === 'A' ? 'BOSS' : 'PURCHASER'])).rows[0];
        await tx.query(`INSERT INTO ticket_event (company_id, ticket_id, user_id, event, text) VALUES ($1,$2,$3,'CREATED',$4)`, [req.ctx.companyId, ticket.id, req.ctx.userId, `PO ${po.po_no}`]);
        void tgSend(req.ctx.companyId, `<b>供应商发票差异</b>\n${sup.name} ${b.invoice_no}\n发票 RM ${Number(b.amount).toFixed(2)} · 匹配 RM ${m.matched.toFixed(2)} · 差 RM ${m.variance.toFixed(2)}\n请采购员到网页端处理`, undefined, { type: 'TICKET', refType: 'ticket', refId: ticket.id });
      }
      reply.status(201);
      return { ...r, match: { matched_amount: m.matched, variance_amount: m.variance, tolerance: tol, ok }, ticket_id: ticket?.id ?? null };
    });
  });
  app.get('/supplier-invoices/:id', { preHandler: requirePerm(...VIEW) }, async (req) => {
    const { id } = req.params as any;
    return withCompany(cx(req), async (tx) => {
      const r = (await tx.query(`${LIST_SQL} WHERE si.id = $1`, [id])).rows[0]; if (!r) throw notFound();
      const payments = (await tx.query(`SELECT sp.*, u.name AS paid_by_name FROM supplier_payment sp LEFT JOIN app_user u ON u.id = sp.paid_by WHERE sp.supplier_invoice_id = $1 ORDER BY sp.paid_at`, [id])).rows;
      return { ...r, payments };
    });
  });
  app.get('/supplier-invoices/:id/match', { preHandler: requirePerm(...VIEW) }, async (req) => {
    const { id } = req.params as any;
    return withCompany(cx(req), async (tx) => {
      const inv = (await tx.query(`${LIST_SQL} WHERE si.id = $1`, [id])).rows[0]; if (!inv) throw notFound();
      const lines = (await tx.query(`SELECT l.*, p.sku, coalesce(p.name_zh, p.name_en) AS product_name, pl.ordered_qty, pl.line_no, pl.unit_cost AS po_cost_now,
          (l.received_qty * l.po_unit_cost) AS expected_amount, (l.invoiced_qty * l.invoiced_unit_cost) AS invoiced_amount,
          (SELECT json_agg(json_build_object('grn_no', g.grn_no, 'received_qty', gl.received_qty, 'damaged_qty', gl.damaged_qty, 'completed_at', g.completed_at)) FROM goods_receipt_line gl JOIN goods_receipt g ON g.id = gl.grn_id WHERE gl.po_line_id = l.po_line_id AND g.status <> 'CANCELLED') AS grns
        FROM supplier_invoice_line l LEFT JOIN product p ON p.id = l.product_id LEFT JOIN purchase_order_line pl ON pl.id = l.po_line_id WHERE l.supplier_invoice_id = $1 ORDER BY pl.line_no`, [id])).rows;
      const tol = Number(req.ctx.settings?.ap_match_tolerance ?? 1);
      return { invoice: inv, lines, tolerance: tol, matched_amount: Number(inv.matched_amount), variance_amount: Number(inv.variance_amount), ok: Math.abs(Number(inv.variance_amount)) <= tol };
    });
  });
  app.post('/supplier-invoices/:id/resolve', { preHandler: requirePerm('ap.manage', 'ap.approve', 'receive.variance') }, async (req) => {
    const { id } = req.params as any;
    const b = z.object({ action: z.enum(['ACCEPT', 'CREDIT_NOTE', 'PO_PRICE_CHANGE']), note: z.string().max(500).optional().nullable() }).parse(req.body);
    return withCompany(cx(req), async (tx) => {
      const inv = (await tx.query(`SELECT si.*, s.name AS supplier_name FROM supplier_invoice si JOIN supplier s ON s.id = si.supplier_id WHERE si.id = $1 FOR UPDATE OF si`, [id])).rows[0]; if (!inv) throw notFound();
      if (inv.status !== 'VARIANCE') throw new AppError(409, 'AP_STATE', inv.status);
      const note = b.note ? ` · ${b.note}` : '';
      if (b.action === 'ACCEPT') {
        await closeVarianceTicket(tx, id, `接受差异${note}`);
        return (await tx.query(`UPDATE supplier_invoice SET status = 'PAYABLE', resolution = $2 WHERE id = $1 RETURNING *`, [id, `ACCEPT${note}`])).rows[0];
      }
      if (b.action === 'CREDIT_NOTE') {
        await closeVarianceTicket(tx, id, `要求 Credit Note，按匹配额付${note}`);
        return (await tx.query(`UPDATE supplier_invoice SET status = 'PAYABLE', amount = matched_amount, variance_amount = 0, resolution = $2 WHERE id = $1 RETURNING *`, [id, `CREDIT_NOTE 原额 ${Number(inv.amount).toFixed(2)}${note}`])).rows[0];
      }
      const a = await createApproval(tx, req.ctx, { type: 'PO_PRICE_CHANGE', ref_type: 'supplier_invoice', ref_id: id, amount: Number(inv.variance_amount), approver_role_code: 'BOSS', summary: { title: `${inv.supplier_name} ${inv.invoice_no}：按发票单价改 PO 价，差 RM ${Number(inv.variance_amount).toFixed(2)}`, note: b.note ?? null } });
      await tx.query(`UPDATE ticket SET status = 'WAITING' WHERE type = 'AP_VARIANCE' AND ref_id = $1 AND status NOT IN ('RESOLVED','CLOSED')`, [id]);
      return (await tx.query(`UPDATE supplier_invoice SET approval_id = $2, resolution = $3 WHERE id = $1 RETURNING *`, [id, a.id, `PO_PRICE_CHANGE 待老板批${note}`])).rows[0];
    });
  });
  app.post('/supplier-invoices/:id/payments', { preHandler: requirePerm('ap.pay') }, async (req, reply) => {
    const { id } = req.params as any;
    const b = z.object({ amount: z.number().positive(), method: z.enum(['CASH', 'BANK_TRANSFER', 'CHEQUE', 'CARD', 'EWALLET']).default('BANK_TRANSFER'), reference: z.string().max(100).optional().nullable() }).parse(req.body);
    return withCompany(cx(req), async (tx) => {
      const inv = (await tx.query(`SELECT si.*, s.name AS supplier_name FROM supplier_invoice si JOIN supplier s ON s.id = si.supplier_id WHERE si.id = $1`, [id])).rows[0]; if (!inv) throw notFound();
      if (!['PAYABLE', 'PARTIAL'].includes(inv.status)) throw new AppError(409, 'AP_STATE', inv.status);
      if (inv.approval_id) throw new AppError(409, 'AP_STATE', 'pending approval');
      const threshold = Number(req.ctx.settings?.approval_threshold_payment ?? 0);
      if (threshold > 0 && b.amount > threshold) {
        const a = await createApproval(tx, req.ctx, { type: 'PAYMENT', ref_type: 'supplier_invoice', ref_id: id, amount: b.amount, approver_role_code: 'BOSS', summary: { title: `付 ${inv.supplier_name} 发票 ${inv.invoice_no}`, amount: b.amount, method: b.method, reference: b.reference ?? null } });
        await tx.query(`UPDATE supplier_invoice SET approval_id = $2 WHERE id = $1`, [id, a.id]);
        reply.status(202); return { status: 'PENDING_APPROVAL', approval_id: a.id, threshold };
      }
      const r = await recordPayment(tx, req.ctx, id, b);
      reply.status(201); return r;
    });
  });
  app.get('/ap/due', { preHandler: requirePerm(...VIEW) }, async (req) => {
    const q = z.object({ days: z.coerce.number().int().min(0).max(365).default(30) }).parse(req.query);
    return withCompany(cx(req), async (tx) => {
      const rows = (await tx.query(`${LIST_SQL} WHERE si.status IN ('PAYABLE','PARTIAL') AND (si.due_date IS NULL OR si.due_date <= (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date + $1) ORDER BY si.due_date NULLS LAST`, [q.days])).rows;
      return { days: q.days, rows, total: r2(rows.reduce((s, r) => s + Number(r.outstanding), 0)), overdue: r2(rows.filter((r) => r.due_date && new Date(r.due_date) < new Date()).reduce((s, r) => s + Number(r.outstanding), 0)) };
    });
  });
}
