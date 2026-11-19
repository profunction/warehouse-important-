// 模块 A：订货建议 + 采购单（第四组 API）。
// 约定：
//  - GET /purchase-orders/:id 允许 po.view 或 movement.receive（仓库员对单收货要看行），没有 product.view_cost 的看不到 unit_cost / total_amount。
//  - 老板（order.approve）手动开 PO 直接 SENT 并生成文件；采购员（po.create）开 PO 进 PENDING_APPROVAL 并建 PO 审批。
//  - POST /order-proposals/:id/approve 与 /purchase-orders/:id/approve 是老板/经理在 App 里的直接决定，内部走 decideApproval（Telegram 按钮走 /approvals/:id/decide）。
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withCompany } from '../lib/db.js';
import { requireAuth, requirePerm, hasPerm, canSeeCost } from '../lib/auth.js';
import { AppError, notFound } from '../lib/errors.js';
import { createApproval, decideApproval, registerApprovalHandler } from '../lib/approvals.js';
import { nextDocNo } from '../lib/docno.js';
import { tgSend, tgSendDocument } from '../lib/telegram.js';
import { generateProposal, proposalLines, proposalText, submitProposal, createPosFromProposal, finalizePo, money } from '../lib/ordersJobs.js';
import { loadPoDoc, buildPoPdf, buildPoXlsx } from '../lib/poPdf.js';

const uuid = z.string().uuid();
const PO_LIST_SQL = `SELECT po.*, s.name AS supplier_name, st.code AS site_code,
  (SELECT count(*) FROM purchase_order_line l WHERE l.po_id = po.id) AS line_count,
  (SELECT coalesce(sum(l.ordered_qty),0) FROM purchase_order_line l WHERE l.po_id = po.id) AS ordered_total,
  (SELECT coalesce(sum(l.received_qty),0) FROM purchase_order_line l WHERE l.po_id = po.id) AS received_total
  FROM purchase_order po JOIN supplier s ON s.id = po.supplier_id LEFT JOIN site st ON st.id = po.deliver_to_site_id`;

export async function ordersRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);
  const cx = (req: any) => ({ companyId: req.ctx.companyId, userId: req.ctx.userId, deviceId: req.ctx.deviceId });
  const stripPo = (ctx: any, po: any) => { if (canSeeCost(ctx)) return po; const { total_amount, ...rest } = po; return rest; };
  const stripLine = (ctx: any, l: any) => { if (canSeeCost(ctx)) return l; const { unit_cost, amount, ...rest } = l; return rest; };

  // ---------- 审批回调 ----------
  registerApprovalHandler('ORDER', async (tx, ctx, a, decision) => {
    if (decision === 'approve') { await createPosFromProposal(tx, ctx, a); return; }
    await tx.query(`UPDATE order_proposal SET status = $2, approved_by = $3 WHERE id = $1`, [a.ref_id, decision === 'reject' ? 'REJECTED' : 'RETURNED', ctx.userId]);
  });
  registerApprovalHandler('PO', async (tx, ctx, a, decision) => {
    if (decision === 'approve') { await finalizePo(tx, ctx, a.ref_id, 'TELEGRAM'); return; }
    await tx.query(`UPDATE purchase_order SET status = $2 WHERE id = $1`, [a.ref_id, decision === 'reject' ? 'CANCELLED' : 'DRAFT']);
  });

  // ---------- 订货建议 ----------
  app.get('/order-proposals', { preHandler: requirePerm('order.view', 'order.review', 'order.approve') }, async (req) => {
    const q = z.object({ status: z.string().optional(), limit: z.coerce.number().max(200).default(50) }).parse(req.query);
    return withCompany(cx(req), async (tx) => (await tx.query(
      `SELECT op.*, (SELECT count(*) FROM order_proposal_line l WHERE l.proposal_id = op.id AND NOT l.is_removed) AS line_count,
              (SELECT coalesce(sum(l.final_qty * l.unit_cost),0) FROM order_proposal_line l WHERE l.proposal_id = op.id AND NOT l.is_removed) AS total_amount,
              (SELECT count(*) FROM purchase_order po WHERE po.proposal_id = op.id) AS po_count, u.name AS reviewed_by_name
       FROM order_proposal op LEFT JOIN app_user u ON u.id = op.reviewed_by
       WHERE ($1::text IS NULL OR op.status = ANY(string_to_array($1, ','))) ORDER BY op.created_at DESC LIMIT $2`, [q.status ?? null, q.limit])).rows.map((r: any) => stripPo(req.ctx, r)));
  });
  const proposalDetail = async (tx: any, ctx: any, id: string) => {
    const p = (await tx.query(`SELECT op.*, u.name AS reviewed_by_name, a.status AS approval_status FROM order_proposal op LEFT JOIN app_user u ON u.id = op.reviewed_by LEFT JOIN approval_request a ON a.id = op.approval_id WHERE op.id = $1`, [id])).rows[0];
    if (!p) throw notFound();
    const lines = (await proposalLines(tx, id)).map((l) => stripLine(ctx, l));
    const live = lines.filter((l: any) => !l.is_removed);
    const pos = (await tx.query(`SELECT id, po_no, status, supplier_id, total_amount, pdf_url, xlsx_url FROM purchase_order WHERE proposal_id = $1 ORDER BY po_no`, [id])).rows.map((r: any) => stripPo(ctx, r));
    const total = canSeeCost(ctx) ? live.reduce((s: number, l: any) => s + Number(l.amount), 0) : undefined;
    return { ...stripPo(ctx, p), lines, purchase_orders: pos, total_amount: total, line_count: live.length };
  };
  app.get('/order-proposals/today', { preHandler: requirePerm('order.view', 'order.review', 'order.approve') }, async (req) => withCompany(cx(req), async (tx) => {
    const p = (await tx.query(`SELECT id FROM order_proposal WHERE proposal_date = (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date ORDER BY status IN ('PENDING_REVIEW','PENDING_APPROVAL') DESC, created_at DESC LIMIT 1`)).rows[0];
    return p ? proposalDetail(tx, req.ctx, p.id) : null;
  }));
  /** 手动触发生成（老板 / 采购员；测试用）。body.site_id 可选。 */
  app.post('/order-proposals/generate', { preHandler: requirePerm('order.review', 'order.approve') }, async (req, reply) => {
    const b = z.object({ site_id: uuid.optional().nullable() }).parse(req.body ?? {});
    const p = await withCompany(cx(req), (tx) => generateProposal(tx, req.ctx, b.site_id ?? null));
    if (!p) return { proposal: null, message: 'nothing below min level' };
    reply.status(201); return { proposal: p };
  });
  /** 手动建议（老板手机"新订单"也可走这里：先建 MANUAL 建议再批） */
  app.post('/order-proposals', { preHandler: requirePerm('order.review', 'order.approve') }, async (req, reply) => {
    const b = z.object({ site_id: uuid.optional().nullable(), note: z.string().max(300).optional(), lines: z.array(z.object({ product_id: uuid.optional(), barcode: z.string().optional(), qty: z.number().positive(), supplier_id: uuid.optional().nullable() })).min(1) }).parse(req.body);
    const r = await withCompany(cx(req), async (tx) => {
      const prop = (await tx.query(`INSERT INTO order_proposal (company_id, site_id, status, source, note) VALUES ($1,$2,'PENDING_REVIEW','MANUAL',$3) RETURNING *`, [req.ctx.companyId, b.site_id ?? req.ctx.siteId ?? null, b.note ?? null])).rows[0];
      for (const l of b.lines) {
        let pid = l.product_id; let qty = l.qty;
        if (!pid && l.barcode) { const bc = (await tx.query(`SELECT product_id, pack_qty FROM barcode WHERE barcode = $1`, [l.barcode])).rows[0]; if (!bc) throw notFound('BARCODE_NOT_FOUND'); pid = bc.product_id; qty = qty * Number(bc.pack_qty); }
        const p = (await tx.query(`SELECT p.*, coalesce((SELECT sum(st.qty) FROM stock st JOIN location lo ON lo.id = st.location_id WHERE st.product_id = p.id AND NOT lo.is_virtual),0) AS total FROM product p WHERE p.id = $1`, [pid])).rows[0]; if (!p) throw notFound('PRODUCT_NOT_FOUND');
        await tx.query(`INSERT INTO order_proposal_line (company_id, proposal_id, product_id, supplier_id, current_qty, suggested_qty, final_qty, unit_cost) VALUES ($1,$2,$3,$4,$5,$6,$6,$7)`, [req.ctx.companyId, prop.id, pid, l.supplier_id ?? p.default_supplier_id ?? null, p.total, qty, p.cost_price]);
      }
      return proposalDetail(tx, req.ctx, prop.id);
    });
    reply.status(201); return r;
  });
  app.get('/order-proposals/:id', { preHandler: requirePerm('order.view', 'order.review', 'order.approve') }, async (req) => withCompany(cx(req), (tx) => proposalDetail(tx, req.ctx, (req.params as any).id)));
  /** 预审：改数量、删行、换供应商、备注 */
  app.put('/order-proposals/:id/lines', { preHandler: requirePerm('order.review', 'order.approve') }, async (req) => {
    const { id } = req.params as any;
    const b = z.object({ note: z.string().max(300).optional(), lines: z.array(z.object({ id: uuid, final_qty: z.number().min(0).optional(), is_removed: z.boolean().optional(), supplier_id: uuid.nullable().optional(), note: z.string().max(200).nullable().optional() })) }).parse(req.body);
    return withCompany(cx(req), async (tx) => {
      const p = (await tx.query(`SELECT status FROM order_proposal WHERE id = $1 FOR UPDATE`, [id])).rows[0]; if (!p) throw notFound();
      if (!['PENDING_REVIEW', 'RETURNED', 'PENDING_APPROVAL'].includes(p.status)) throw new AppError(409, 'VALIDATION', `proposal status ${p.status}`);
      if (p.status === 'PENDING_APPROVAL' && !hasPerm(req.ctx, 'order.approve')) throw new AppError(409, 'VALIDATION', 'already submitted');
      for (const l of b.lines) {
        await tx.query(`UPDATE order_proposal_line SET final_qty = COALESCE($3, final_qty), is_removed = COALESCE($4, is_removed), supplier_id = CASE WHEN $5::boolean THEN $6::uuid ELSE supplier_id END, note = COALESCE($7, note) WHERE id = $1 AND proposal_id = $2`,
          [l.id, id, l.final_qty ?? null, l.is_removed ?? null, l.supplier_id !== undefined, l.supplier_id ?? null, l.note ?? null]);
      }
      await tx.query(`UPDATE order_proposal SET reviewed_by = $2, note = COALESCE($3, note) WHERE id = $1`, [id, req.ctx.userId, b.note ?? null]);
      return proposalDetail(tx, req.ctx, id);
    });
  });
  /** 送审（采购员 → 老板） */
  app.post('/order-proposals/:id/submit', { preHandler: requirePerm('order.review', 'order.approve') }, async (req) => {
    const { id } = req.params as any;
    return withCompany(cx(req), async (tx) => { const a = await submitProposal(tx, req.ctx, id); return { ...(await proposalDetail(tx, req.ctx, id)), approval: a }; });
  });
  /** 老板直接决定（approve / reject / return）。没有审批记录时先建再批（A 模式手动建议）。 */
  app.post('/order-proposals/:id/approve', { preHandler: requirePerm('order.approve') }, async (req) => {
    const { id } = req.params as any;
    const b = z.object({ decision: z.enum(['approve', 'reject', 'return']).default('approve'), note: z.string().max(300).optional() }).parse(req.body ?? {});
    return withCompany(cx(req), async (tx) => {
      let p = (await tx.query(`SELECT * FROM order_proposal WHERE id = $1 FOR UPDATE`, [id])).rows[0]; if (!p) throw notFound();
      if (!['PENDING_REVIEW', 'PENDING_APPROVAL', 'RETURNED'].includes(p.status)) throw new AppError(409, 'VALIDATION', `proposal status ${p.status}`);
      let approvalId = p.approval_id;
      if (approvalId) { const a = (await tx.query(`SELECT status FROM approval_request WHERE id = $1`, [approvalId])).rows[0]; if (a?.status !== 'PENDING') approvalId = null; }
      if (!approvalId) {
        // 还没送审（A 模式定时建议 / 老板手机"新订单"）：老板自己就是最终审批人，直接记决定（B 模式数据库不允许自批，所以不建审批记录）
        const lines = await proposalLines(tx, id); const { count } = proposalText(p, lines, req.ctx.name);
        if (!count) throw new AppError(400, 'VALIDATION', 'no lines');
        const status = b.decision === 'approve' ? 'APPROVED' : b.decision === 'reject' ? 'REJECTED' : 'RETURNED';
        if (b.decision === 'approve') await createPosFromProposal(tx, req.ctx, { id: null, ref_id: id });
        else await tx.query(`UPDATE order_proposal SET status = $2, approved_by = $3, note = COALESCE($4, note) WHERE id = $1`, [id, status, req.ctx.userId, b.note ?? null]);
        return { ...(await proposalDetail(tx, req.ctx, id)), approval: null, direct: true };
      }
      const a = await decideApproval(tx, req.ctx, approvalId, b.decision, b.note);
      p = await proposalDetail(tx, req.ctx, id);
      return { ...p, approval: a };
    });
  });

  // ---------- 采购单 ----------
  app.get('/purchase-orders', { preHandler: requirePerm('po.view', 'po.create', 'movement.receive') }, async (req) => {
    const q = z.object({ status: z.string().optional(), supplier: uuid.optional(), site: uuid.optional(), limit: z.coerce.number().max(500).default(100) }).parse(req.query);
    return withCompany(cx(req), async (tx) => (await tx.query(`${PO_LIST_SQL} WHERE ($1::text IS NULL OR po.status = ANY(string_to_array($1, ','))) AND ($2::uuid IS NULL OR po.supplier_id = $2) AND ($3::uuid IS NULL OR po.deliver_to_site_id = $3) ORDER BY po.created_at DESC LIMIT $4`, [q.status ?? null, q.supplier ?? null, q.site ?? null, q.limit])).rows.map((r: any) => stripPo(req.ctx, r)));
  });
  const poDetail = async (tx: any, ctx: any, id: string) => {
    const po = (await tx.query(`${PO_LIST_SQL} WHERE po.id = $1`, [id])).rows[0]; if (!po) throw notFound();
    const lines = (await tx.query(
      `SELECT l.*, p.sku, p.name_zh, p.name_ms, p.name_en, p.unit, p.photo_url, p.shelf_life_days, p.category_id, p.default_location_id,
              (SELECT barcode FROM barcode b WHERE b.product_id = p.id AND b.is_primary LIMIT 1) AS barcode,
              (SELECT max(pack_qty) FROM barcode b WHERE b.product_id = p.id AND b.barcode_type = 'CASE') AS case_qty,
              round(l.ordered_qty * l.unit_cost, 2) AS amount,
              (SELECT coalesce(sum(g.damaged_qty),0) FROM goods_receipt_line g WHERE g.po_line_id = l.id) AS damaged_qty
       FROM purchase_order_line l JOIN product p ON p.id = l.product_id WHERE l.po_id = $1 ORDER BY l.line_no`, [id])).rows.map((l: any) => stripLine(ctx, l));
    const receipts = (await tx.query(`SELECT g.id, g.grn_no, g.status, g.started_at, g.completed_at, g.short_count, g.over_count, g.damaged_count, u.name AS received_by_name FROM goods_receipt g JOIN app_user u ON u.id = g.received_by WHERE g.po_id = $1 ORDER BY g.started_at`, [id])).rows;
    const approval = po.approval_id ? (await tx.query(`SELECT id, status, approver_role_code FROM approval_request WHERE id = $1`, [po.approval_id])).rows[0] : null;
    return { ...stripPo(ctx, po), lines, receipts, approval };
  };
  app.get('/purchase-orders/:id', { preHandler: requirePerm('po.view', 'po.create', 'movement.receive') }, async (req) => withCompany(cx(req), (tx) => poDetail(tx, req.ctx, (req.params as any).id)));
  /** 手动开 PO */
  app.post('/purchase-orders', { preHandler: requirePerm('po.create', 'order.approve') }, async (req, reply) => {
    const b = z.object({ client_id: uuid.optional(), supplier_id: uuid, deliver_to_site_id: uuid.optional().nullable(), expected_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(), note: z.string().max(300).optional().nullable(),
      lines: z.array(z.object({ product_id: uuid.optional(), barcode: z.string().optional(), qty: z.number().positive(), unit_cost: z.number().min(0).optional() })).min(1) }).parse(req.body);
    const r = await withCompany(cx(req), async (tx) => {
      if (b.client_id) { const dup = (await tx.query(`SELECT id FROM purchase_order WHERE id = $1`, [b.client_id])).rows[0]; if (dup) return { ...(await poDetail(tx, req.ctx, dup.id)), duplicate: true }; }
      const sup = (await tx.query(`SELECT * FROM supplier WHERE id = $1 AND is_active`, [b.supplier_id])).rows[0]; if (!sup) throw notFound();
      const direct = hasPerm(req.ctx, 'order.approve') || req.ctx.isSuperAdmin;
      const poNo = await nextDocNo(tx, req.ctx.companyId, 'PO', `PO-${new Date().getFullYear()}-`);
      const items: { product_id: string; qty: number; unit_cost: number }[] = [];
      for (const l of b.lines) {
        let pid = l.product_id; let qty = l.qty;
        if (!pid && l.barcode) { const bc = (await tx.query(`SELECT product_id, pack_qty FROM barcode WHERE barcode = $1`, [l.barcode])).rows[0]; if (!bc) throw notFound('BARCODE_NOT_FOUND'); pid = bc.product_id; qty = qty * Number(bc.pack_qty); }
        const p = (await tx.query(`SELECT id, cost_price FROM product WHERE id = $1 AND is_active`, [pid])).rows[0]; if (!p) throw notFound('PRODUCT_NOT_FOUND');
        const ex = items.find((i) => i.product_id === p.id); if (ex) { ex.qty += qty; continue; }
        items.push({ product_id: p.id, qty, unit_cost: l.unit_cost ?? Number(p.cost_price) });
      }
      const total = Math.round(items.reduce((s, i) => s + i.qty * i.unit_cost, 0) * 100) / 100;
      const po = (await tx.query(`INSERT INTO purchase_order (id, company_id, po_no, supplier_id, deliver_to_site_id, status, total_amount, expected_date, note, created_by) VALUES (COALESCE($11::uuid, uuid_v7()),$1,$2,$3,$4,$5,$6, COALESCE($7::date, current_date + $8::int), $9, $10) RETURNING *`,
        [req.ctx.companyId, poNo, b.supplier_id, b.deliver_to_site_id ?? req.ctx.siteId ?? null, direct ? 'DRAFT' : 'PENDING_APPROVAL', total, b.expected_date ?? null, sup.lead_time_days ?? 3, b.note ?? null, req.ctx.userId, b.client_id ?? null])).rows[0];
      let n = 0; for (const i of items) await tx.query(`INSERT INTO purchase_order_line (company_id, po_id, line_no, product_id, ordered_qty, unit_cost) VALUES ($1,$2,$3,$4,$5,$6)`, [req.ctx.companyId, po.id, ++n, i.product_id, i.qty, i.unit_cost]);
      if (direct) await finalizePo(tx, req.ctx, po.id, 'MANUAL');
      else { const a = await createApproval(tx, req.ctx, { type: 'PO', ref_type: 'purchase_order', ref_id: po.id, summary: { title: `采购单 ${poNo} · ${sup.name} · ${items.length} 项` }, amount: total }); await tx.query(`UPDATE purchase_order SET approval_id = $2 WHERE id = $1`, [po.id, a.id]); }
      return poDetail(tx, req.ctx, po.id);
    });
    reply.status((r as any).duplicate ? 200 : 201); return r;
  });
  /** 老板在 App 里直接批 PENDING_APPROVAL 的 PO */
  app.post('/purchase-orders/:id/approve', { preHandler: requirePerm('order.approve') }, async (req) => {
    const { id } = req.params as any;
    const b = z.object({ decision: z.enum(['approve', 'reject', 'return']).default('approve'), note: z.string().max(300).optional() }).parse(req.body ?? {});
    return withCompany(cx(req), async (tx) => {
      const po = (await tx.query(`SELECT * FROM purchase_order WHERE id = $1 FOR UPDATE`, [id])).rows[0]; if (!po) throw notFound();
      if (po.status !== 'PENDING_APPROVAL' || !po.approval_id) throw new AppError(409, 'PO_STATE', po.status);
      const a = await decideApproval(tx, req.ctx, po.approval_id, b.decision, b.note);
      return { ...(await poDetail(tx, req.ctx, id)), approval: a };
    });
  });
  app.get('/purchase-orders/:id/pdf', { preHandler: requirePerm('po.view') }, async (req, reply) => {
    const { id } = req.params as any;
    const d = await withCompany(cx(req), (tx) => loadPoDoc(tx, id).catch(() => { throw notFound(); }));
    const buf = await buildPoPdf(d);
    reply.header('Content-Type', 'application/pdf').header('Content-Disposition', `inline; filename="${d.po.po_no}.pdf"`); return reply.send(buf);
  });
  app.get('/purchase-orders/:id/xlsx', { preHandler: requirePerm('po.view') }, async (req, reply) => {
    const { id } = req.params as any;
    const d = await withCompany(cx(req), (tx) => loadPoDoc(tx, id).catch(() => { throw notFound(); }));
    const buf = await buildPoXlsx(d);
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').header('Content-Disposition', `attachment; filename="${d.po.po_no}.xlsx"`); return reply.send(buf);
  });
  /** 发送：记 sent_at / sent_via；Telegram 发 PDF 文档；EMAIL/WHATSAPP 只记录（电邮网关不在本阶段） */
  app.post('/purchase-orders/:id/send', { preHandler: requirePerm('po.send', 'order.approve') }, async (req) => {
    const { id } = req.params as any;
    const b = z.object({ via: z.enum(['EMAIL', 'TELEGRAM', 'WHATSAPP']).default('TELEGRAM'), to: z.string().max(200).optional() }).parse(req.body ?? {});
    return withCompany(cx(req), async (tx) => {
      const po = (await tx.query(`SELECT * FROM purchase_order WHERE id = $1 FOR UPDATE`, [id])).rows[0]; if (!po) throw notFound();
      if (['CANCELLED', 'PENDING_APPROVAL'].includes(po.status)) throw new AppError(409, 'PO_STATE', po.status);
      let row = po;
      if (po.status === 'DRAFT' || !po.pdf_url) row = await finalizePo(tx, req.ctx, id, b.via);
      else {
        row = (await tx.query(`UPDATE purchase_order SET sent_at = now(), sent_via = $2 WHERE id = $1 RETURNING *`, [id, b.via])).rows[0];
        if (b.via === 'TELEGRAM') { const d = await loadPoDoc(tx, id); const { savePoFiles } = await import('../lib/poPdf.js'); const f = await savePoFiles(d); void tgSendDocument(req.ctx.companyId, f.pdfPath, `采购单 ${po.po_no} · ${d.supplier?.name ?? ''} · ${money(po.total_amount)}`, `${po.po_no}.pdf`); }
      }
      await tgSend(req.ctx.companyId, `<b>采购单已发送</b> ${row.po_no} · ${b.via}${b.to ? ` → ${b.to}` : ''} · ${req.ctx.name}`, undefined, { type: 'PO_SENT', refType: 'purchase_order', refId: id });
      return poDetail(tx, req.ctx, id);
    });
  });
  /** 取消：只允许还没收过货的 */
  app.post('/purchase-orders/:id/cancel', { preHandler: requirePerm('po.cancel', 'order.approve') }, async (req) => {
    const { id } = req.params as any;
    const b = z.object({ note: z.string().max(300).optional() }).parse(req.body ?? {});
    return withCompany(cx(req), async (tx) => {
      const po = (await tx.query(`SELECT po.*, (SELECT coalesce(sum(received_qty),0) FROM purchase_order_line l WHERE l.po_id = po.id) AS received FROM purchase_order po WHERE po.id = $1 FOR UPDATE OF po`, [id])).rows[0]; if (!po) throw notFound();
      if (Number(po.received) > 0 || ['PARTIAL', 'RECEIVED', 'CLOSED'].includes(po.status)) throw new AppError(409, 'PO_STATE', 'already received');
      if (po.status === 'CANCELLED') return poDetail(tx, req.ctx, id);
      await tx.query(`UPDATE purchase_order SET status = 'CANCELLED', note = COALESCE($2, note) WHERE id = $1`, [id, b.note ?? null]);
      if (po.approval_id) await tx.query(`UPDATE approval_request SET status = 'REJECTED', decided_at = now(), decision_note = 'PO cancelled' WHERE id = $1 AND status = 'PENDING'`, [po.approval_id]);
      return poDetail(tx, req.ctx, id);
    });
  });
}
