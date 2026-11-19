// 模块 A：收货对单（GRN）+ 上架待办。
// 约定：
//  - 收货行数量一律换算成单件（传 barcode 时按 pack_qty 乘；damaged_qty 永远按单件）。
//  - 目标位置：传 to_location_id/code 用之；否则 settings.receive_direct_to_backroom（A 模式）→ 产品默认位置或类别默认后仓位；
//    否则站点 RECEIVING 区第一个货位；再否则站点任意启用货位。站点 = GRN.site_id（建 GRN 时取 PO 送货站点或我的站点）。
//  - 幂等：goods_receipt_line.client_id 唯一；好货移动 id = client_id。重复 → { duplicate: true }。
//  - received_qty 只记好货；complete 时 送达 = 好货 + 损坏；少货 = 订 − 送达，多货 = 送达 − 订。
//  - 差异工单：RECEIVE_VARIANCE 给 PURCHASER（A 模式 BOSS）3 天；RECEIVE_DAMAGE 带照片给 PURCHASER 3 天。PO 全部送达 → RECEIVED，否则 PARTIAL。
//  - 离线：sync 实体 grn_line（payload 同 /lines + grn_id）、grn_complete（payload { grn_id }）。
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Tx } from '../lib/db.js';
import { withCompany } from '../lib/db.js';
import type { RequestCtx } from '../lib/auth.js';
import { requireAuth, requirePerm, hasPerm } from '../lib/auth.js';
import { AppError, notFound } from '../lib/errors.js';
import { applyMovement, resolveLocation } from '../lib/movements.js';
import { nextDocNo } from '../lib/docno.js';
import { tgSend } from '../lib/telegram.js';
import { registerSyncHandler } from '../lib/syncHandlers.js';
import { openTicket } from '../lib/ordersJobs.js';

const uuid = z.string().uuid();
const pname = (r: any) => r.name_zh || r.name_en || r.name_ms || r.sku || '';
const lineSchema = z.object({
  client_id: uuid.optional(),
  product_id: uuid.optional(), barcode: z.string().optional(),
  qty: z.number().min(0), damaged_qty: z.number().min(0).default(0),
  expiry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  to_location_id: uuid.optional().nullable(), to_location_code: z.string().optional().nullable(),
  photo_url: z.string().max(500).optional().nullable(), note: z.string().max(200).optional().nullable(),
  performed_at: z.string().datetime({ offset: true }).optional(),
});
type LineInput = z.infer<typeof lineSchema>;

async function defaultLocation(tx: Tx, ctx: RequestCtx, siteId: string | null, product: any) {
  if (ctx.settings?.receive_direct_to_backroom) {
    if (product.default_location_id) { const l = (await tx.query(`SELECT * FROM location WHERE id = $1 AND is_active`, [product.default_location_id])).rows[0]; if (l) return l; }
    const c = (await tx.query(`SELECT default_backroom_code FROM category WHERE id = $1`, [product.category_id])).rows[0];
    if (c?.default_backroom_code) { const l = (await tx.query(`SELECT * FROM location WHERE code = $1 AND is_active AND ($2::uuid IS NULL OR site_id = $2)`, [c.default_backroom_code, siteId])).rows[0]; if (l) return l; }
  }
  const rcv = (await tx.query(`SELECT l.* FROM location l JOIN zone z ON z.id = l.zone_id WHERE z.zone_type = 'RECEIVING' AND l.is_active AND ($1::uuid IS NULL OR l.site_id = $1) ORDER BY l.code LIMIT 1`, [siteId])).rows[0];
  if (rcv) return rcv;
  const back = (await tx.query(`SELECT l.* FROM location l JOIN zone z ON z.id = l.zone_id WHERE z.zone_type IN ('BACKROOM','STORAGE') AND l.is_active AND ($1::uuid IS NULL OR l.site_id = $1) ORDER BY z.sort_order, l.code LIMIT 1`, [siteId])).rows[0];
  if (back) return back;
  return (await tx.query(`SELECT * FROM location WHERE NOT is_virtual AND is_active AND ($1::uuid IS NULL OR site_id = $1) ORDER BY code LIMIT 1`, [siteId])).rows[0];
}

/** 收一行：移动 + 行 + PO 行已收量。返回 { id, duplicate } */
export async function addGrnLine(tx: Tx, ctx: RequestCtx, grnId: string, clientId: string, input: LineInput) {
  const grn = (await tx.query(`SELECT * FROM goods_receipt WHERE id = $1 FOR UPDATE`, [grnId])).rows[0];
  if (!grn) throw notFound();
  const dup = (await tx.query(`SELECT id FROM goods_receipt_line WHERE client_id = $1`, [clientId])).rows[0];
  if (dup) return { id: dup.id, duplicate: true };
  if (grn.status !== 'IN_PROGRESS') throw new AppError(409, 'GRN_STATE');
  if (!hasPerm(ctx, 'movement.receive')) throw new AppError(403, 'PERMISSION_DENIED', 'movement.receive');
  let productId = input.product_id; let qty = input.qty;
  if (!productId && input.barcode) {
    const b = (await tx.query(`SELECT product_id, pack_qty FROM barcode WHERE barcode = $1`, [input.barcode])).rows[0];
    if (!b) throw new AppError(404, 'BARCODE_NOT_FOUND');
    productId = b.product_id; qty = qty * Number(b.pack_qty);
  }
  if (!productId) throw new AppError(400, 'VALIDATION', 'product_id or barcode required');
  const product = (await tx.query(`SELECT * FROM product WHERE id = $1`, [productId])).rows[0]; if (!product) throw notFound('PRODUCT_NOT_FOUND');
  const damaged = Number(input.damaged_qty ?? 0);
  if (qty <= 0 && damaged <= 0) throw new AppError(400, 'VALIDATION', 'qty or damaged_qty required');
  let to = (input.to_location_id || input.to_location_code) ? await resolveLocation(tx, input.to_location_id ?? undefined, input.to_location_code ?? undefined) : null;
  if ((input.to_location_id || input.to_location_code) && !to) throw notFound('LOCATION_NOT_FOUND');
  if (!to) to = await defaultLocation(tx, ctx, grn.site_id, product);
  if (!to) throw notFound('LOCATION_NOT_FOUND');
  // PO 行（同产品）
  let poLine: any = null;
  if (grn.po_id) poLine = (await tx.query(`SELECT * FROM purchase_order_line WHERE po_id = $1 AND product_id = $2 FOR UPDATE`, [grn.po_id, productId])).rows[0];
  const expected = poLine ? Math.max(0, Number(poLine.ordered_qty) - Number(poLine.received_qty)) : 0;
  const mctx = { companyId: ctx.companyId, userId: ctx.userId, deviceId: ctx.deviceId };
  let mvId: string | null = null; let dmgId: string | null = null;
  if (qty > 0) mvId = (await applyMovement(tx, mctx, { id: clientId, product_id: productId, from_location_code: 'SUPPLIER', to_location_id: to.id, qty, reason: 'RECEIVE', ref_type: 'GRN', ref_id: grnId, expiry_date: input.expiry_date ?? null, performed_at: input.performed_at, note: input.note ?? (grn.grn_no as string) })).id;
  if (damaged > 0) dmgId = (await applyMovement(tx, mctx, { product_id: productId, from_location_code: 'SUPPLIER', to_location_code: 'DAMAGED', qty: damaged, reason: 'RECEIVE', ref_type: 'GRN', ref_id: grnId, expiry_date: input.expiry_date ?? null, performed_at: input.performed_at, note: 'damaged' })).id;
  const line = (await tx.query(
    `INSERT INTO goods_receipt_line (company_id, grn_id, po_line_id, product_id, expected_qty, received_qty, damaged_qty, expiry_date, to_location_id, movement_id, damage_movement_id, photo_url, client_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [ctx.companyId, grnId, poLine?.id ?? null, productId, expected, qty, damaged, input.expiry_date ?? null, to.id, mvId, dmgId, input.photo_url ?? null, clientId])).rows[0];
  if (poLine && qty > 0) await tx.query(`UPDATE purchase_order_line SET received_qty = received_qty + $2 WHERE id = $1`, [poLine.id, qty]);
  return { id: line.id, duplicate: false, line: { ...line, location_code: to.code, name_zh: product.name_zh, name_ms: product.name_ms, name_en: product.name_en, sku: product.sku, unit: product.unit, expected_remaining: Math.max(0, expected - qty) } };
}

async function grnDetail(tx: Tx, id: string) {
  const g = (await tx.query(`SELECT g.*, po.po_no, s.name AS supplier_name, st.code AS site_code, u.name AS received_by_name FROM goods_receipt g LEFT JOIN purchase_order po ON po.id = g.po_id LEFT JOIN supplier s ON s.id = g.supplier_id LEFT JOIN site st ON st.id = g.site_id JOIN app_user u ON u.id = g.received_by WHERE g.id = $1`, [id])).rows[0];
  if (!g) throw notFound();
  const lines = (await tx.query(`SELECT l.*, p.sku, p.name_zh, p.name_ms, p.name_en, p.unit, p.photo_url, lo.code AS location_code FROM goods_receipt_line l JOIN product p ON p.id = l.product_id LEFT JOIN location lo ON lo.id = l.to_location_id WHERE l.grn_id = $1 ORDER BY l.created_at`, [id])).rows;
  const tickets = (await tx.query(`SELECT id, type, title, status, owner_role_code, deadline_at FROM ticket WHERE ref_type = 'goods_receipt' AND ref_id = $1 ORDER BY created_at`, [id])).rows;
  return { ...g, lines, tickets };
}

/** 完成：差异、工单、PO 状态、Telegram 摘要 */
export async function completeGrn(tx: Tx, ctx: RequestCtx, grnId: string) {
  const grn = (await tx.query(`SELECT * FROM goods_receipt WHERE id = $1 FOR UPDATE`, [grnId])).rows[0];
  if (!grn) throw notFound();
  if (grn.status === 'COMPLETED') return { ...(await grnDetail(tx, grnId)), duplicate: true };
  if (grn.status !== 'IN_PROGRESS') throw new AppError(409, 'GRN_STATE');
  const short: any[] = []; const over: any[] = []; const damaged: any[] = [];
  const dmgRows = (await tx.query(`SELECT l.product_id, sum(l.damaged_qty) AS q, max(l.photo_url) AS photo_url, p.sku, p.name_zh, p.name_ms, p.name_en FROM goods_receipt_line l JOIN product p ON p.id = l.product_id WHERE l.grn_id = $1 AND l.damaged_qty > 0 GROUP BY l.product_id, p.sku, p.name_zh, p.name_ms, p.name_en`, [grnId])).rows;
  for (const d of dmgRows) damaged.push({ product_id: d.product_id, name: pname(d), qty: Number(d.q), photo_url: d.photo_url });
  let poStatus: string | null = null; let poNo: string | null = null;
  if (grn.po_id) {
    const po = (await tx.query(`SELECT * FROM purchase_order WHERE id = $1 FOR UPDATE`, [grn.po_id])).rows[0]; poNo = po.po_no;
    const lines = (await tx.query(
      `SELECT l.*, p.sku, p.name_zh, p.name_ms, p.name_en,
              coalesce((SELECT sum(g.damaged_qty) FROM goods_receipt_line g JOIN goods_receipt gr ON gr.id = g.grn_id WHERE g.po_line_id = l.id AND gr.status <> 'CANCELLED'),0) AS damaged_total
       FROM purchase_order_line l JOIN product p ON p.id = l.product_id WHERE l.po_id = $1 ORDER BY l.line_no`, [grn.po_id])).rows;
    let allIn = true;
    for (const l of lines) {
      const delivered = Number(l.received_qty) + Number(l.damaged_total); const ordered = Number(l.ordered_qty);
      if (delivered < ordered) { allIn = false; short.push({ product_id: l.product_id, name: pname(l), ordered, delivered, diff: ordered - delivered }); }
      else if (delivered > ordered) over.push({ product_id: l.product_id, name: pname(l), ordered, delivered, diff: delivered - ordered });
    }
    // 没在 PO 上的产品也算多货
    const extra = (await tx.query(`SELECT l.product_id, sum(l.received_qty + l.damaged_qty) AS q, p.sku, p.name_zh, p.name_ms, p.name_en FROM goods_receipt_line l JOIN product p ON p.id = l.product_id WHERE l.grn_id = $1 AND l.po_line_id IS NULL GROUP BY l.product_id, p.sku, p.name_zh, p.name_ms, p.name_en`, [grnId])).rows;
    for (const e of extra) over.push({ product_id: e.product_id, name: pname(e), ordered: 0, delivered: Number(e.q), diff: Number(e.q), not_on_po: true });
    poStatus = allIn ? 'RECEIVED' : 'PARTIAL';
    await tx.query(`UPDATE purchase_order SET status = $2 WHERE id = $1 AND status IN ('SENT','PARTIAL')`, [grn.po_id, poStatus]);
  }
  const grnRow = (await tx.query(`UPDATE goods_receipt SET status = 'COMPLETED', completed_at = now(), short_count = $2, over_count = $3, damaged_count = $4 WHERE id = $1 RETURNING *`, [grnId, short.length, over.length, damaged.length])).rows[0];
  const tickets: any[] = [];
  const ref = { ref_type: 'goods_receipt', ref_id: grnId, site_id: grn.site_id };
  if (short.length) tickets.push(await openTicket(tx, ctx, { ...ref, type: 'RECEIVE_VARIANCE', owner_role: 'PURCHASER', days: 3, title: `收货少货 ${grnRow.grn_no}${poNo ? ` / ${poNo}` : ''}：${short.map((s) => `${s.name} 少 ${s.diff}`).join('、')}`, text: short.map((s) => `${s.name}：订 ${s.ordered} 到 ${s.delivered}`).join('\n') }));
  if (over.length) tickets.push(await openTicket(tx, ctx, { ...ref, type: 'RECEIVE_VARIANCE', owner_role: 'PURCHASER', days: 3, title: `收货多货 ${grnRow.grn_no}${poNo ? ` / ${poNo}` : ''}：${over.map((s) => `${s.name} 多 ${s.diff}`).join('、')}`, text: over.map((s) => `${s.name}：订 ${s.ordered} 到 ${s.delivered}${s.not_on_po ? '（不在 PO 上）' : ''}`).join('\n') }));
  for (const d of damaged) tickets.push(await openTicket(tx, ctx, { ...ref, type: 'RECEIVE_DAMAGE', owner_role: 'PURCHASER', days: 3, title: `收货损坏 ${grnRow.grn_no}：${d.name} ${d.qty}`, text: `${d.name} 损坏 ${d.qty}，已隔离到 DAMAGED`, photo_url: d.photo_url }));
  const totals = (await tx.query(`SELECT count(*) AS n, coalesce(sum(received_qty),0) AS q FROM goods_receipt_line WHERE grn_id = $1`, [grnId])).rows[0];
  const text = `<b>收货完成</b> ${grnRow.grn_no}${poNo ? ` · ${poNo}` : ' · 无单收货'}\n${ctx.name} · ${Number(totals.n)} 行 · ${Number(totals.q)} 件${poStatus ? `\nPO ${poStatus === 'RECEIVED' ? '已收齐' : '部分收货'}` : ''}` +
    (short.length ? `\n⚠ 少货：${short.map((s) => `${s.name} −${s.diff}`).join('、')}` : '') + (over.length ? `\n⚠ 多货：${over.map((s) => `${s.name} +${s.diff}`).join('、')}` : '') + (damaged.length ? `\n⚠ 损坏：${damaged.map((d) => `${d.name} ${d.qty}`).join('、')}` : '') +
    (tickets.length ? `\n已开 ${tickets.length} 张工单` : '');
  await tgSend(ctx.companyId, text, undefined, { type: 'GRN_COMPLETED', refType: 'goods_receipt', refId: grnId });
  return { ...(await grnDetail(tx, grnId)), po_status: poStatus, short, over, damaged, tickets_opened: tickets, duplicate: false };
}

export async function receivingRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);
  const cx = (req: any) => ({ companyId: req.ctx.companyId, userId: req.ctx.userId, deviceId: req.ctx.deviceId });
  registerSyncHandler('grn_line', async (tx, ctx, clientId, payload) => {
    const b = lineSchema.extend({ grn_id: uuid }).parse(payload);
    return (await addGrnLine(tx, ctx, b.grn_id, clientId, b)).id;
  });
  registerSyncHandler('grn_complete', async (tx, ctx, _clientId, payload) => {
    const b = z.object({ grn_id: uuid }).parse(payload);
    await completeGrn(tx, ctx, b.grn_id); return b.grn_id;
  });

  /** 我站点待收的 PO（SENT / PARTIAL），含进行中的 GRN */
  app.get('/goods-receipts/pending', { preHandler: requirePerm('movement.receive', 'po.view') }, async (req) => {
    const q = z.object({ site: uuid.optional() }).parse(req.query);
    const site = q.site ?? req.ctx.siteId ?? null;
    return withCompany(cx(req), async (tx) => (await tx.query(
      `SELECT po.id, po.po_no, po.status, po.expected_date, po.sent_at, po.deliver_to_site_id, s.name AS supplier_name, s.id AS supplier_id,
              (SELECT count(*) FROM purchase_order_line l WHERE l.po_id = po.id) AS line_count,
              (SELECT coalesce(sum(l.ordered_qty),0) FROM purchase_order_line l WHERE l.po_id = po.id) AS ordered_total,
              (SELECT coalesce(sum(l.received_qty),0) FROM purchase_order_line l WHERE l.po_id = po.id) AS received_total,
              (SELECT g.id FROM goods_receipt g WHERE g.po_id = po.id AND g.status = 'IN_PROGRESS' ORDER BY g.started_at DESC LIMIT 1) AS open_grn_id
       FROM purchase_order po JOIN supplier s ON s.id = po.supplier_id
       WHERE po.status IN ('SENT','PARTIAL') AND ($1::uuid IS NULL OR po.deliver_to_site_id IS NULL OR po.deliver_to_site_id = $1)
       ORDER BY po.expected_date NULLS LAST, po.created_at`, [site])).rows);
  });
  app.get('/goods-receipts', { preHandler: requirePerm('movement.receive', 'po.view', 'receive.variance') }, async (req) => {
    const q = z.object({ status: z.string().optional(), po: uuid.optional(), limit: z.coerce.number().max(500).default(100) }).parse(req.query);
    return withCompany(cx(req), async (tx) => (await tx.query(`SELECT g.*, po.po_no, s.name AS supplier_name, u.name AS received_by_name, (SELECT count(*) FROM goods_receipt_line l WHERE l.grn_id = g.id) AS line_count FROM goods_receipt g LEFT JOIN purchase_order po ON po.id = g.po_id LEFT JOIN supplier s ON s.id = g.supplier_id JOIN app_user u ON u.id = g.received_by WHERE ($1::text IS NULL OR g.status = $1) AND ($2::uuid IS NULL OR g.po_id = $2) ORDER BY g.started_at DESC LIMIT $3`, [q.status ?? null, q.po ?? null, q.limit])).rows);
  });
  /** 开始收货：po_id 可空 = 无单收货。同一 PO 同一人已有进行中的 GRN 则复用。 */
  app.post('/goods-receipts', { preHandler: requirePerm('movement.receive') }, async (req, reply) => {
    const b = z.object({ client_id: uuid.optional(), po_id: uuid.optional().nullable(), site_id: uuid.optional().nullable(), supplier_id: uuid.optional().nullable() }).parse(req.body ?? {});
    const r = await withCompany(cx(req), async (tx) => {
      if (b.client_id) { const dup = (await tx.query(`SELECT id FROM goods_receipt WHERE id = $1`, [b.client_id])).rows[0]; if (dup) return { ...(await grnDetail(tx, dup.id)), duplicate: true }; }
      let po: any = null;
      if (b.po_id) {
        po = (await tx.query(`SELECT * FROM purchase_order WHERE id = $1 FOR UPDATE`, [b.po_id])).rows[0]; if (!po) throw notFound();
        if (!['SENT', 'PARTIAL'].includes(po.status)) throw new AppError(409, 'PO_STATE', po.status);
        const open = (await tx.query(`SELECT id FROM goods_receipt WHERE po_id = $1 AND status = 'IN_PROGRESS' AND received_by = $2 ORDER BY started_at DESC LIMIT 1`, [b.po_id, req.ctx.userId])).rows[0];
        if (open) return { ...(await grnDetail(tx, open.id)), duplicate: true };
      }
      const siteId = b.site_id ?? po?.deliver_to_site_id ?? req.ctx.siteId ?? null;
      const grnNo = await nextDocNo(tx, req.ctx.companyId, 'GRN', `GRN-${new Date().getFullYear()}-`);
      const g = (await tx.query(`INSERT INTO goods_receipt (id, company_id, grn_no, po_id, site_id, supplier_id, received_by) VALUES (COALESCE($7::uuid, uuid_v7()), $1,$2,$3,$4,$5,$6) RETURNING id`, [req.ctx.companyId, grnNo, b.po_id ?? null, siteId, b.supplier_id ?? po?.supplier_id ?? null, req.ctx.userId, b.client_id ?? null])).rows[0];
      return { ...(await grnDetail(tx, g.id)), duplicate: false };
    });
    reply.status(r.duplicate ? 200 : 201); return r;
  });
  app.get('/goods-receipts/:id', { preHandler: requirePerm('movement.receive', 'po.view', 'receive.variance') }, async (req) => withCompany(cx(req), (tx) => grnDetail(tx, (req.params as any).id)));
  app.post('/goods-receipts/:id/lines', { preHandler: requirePerm('movement.receive') }, async (req, reply) => {
    const { id } = req.params as any;
    const b = lineSchema.parse(req.body);
    const r = await withCompany(cx(req), async (tx) => {
      const clientId = b.client_id ?? (await tx.query(`SELECT uuid_v7() id`)).rows[0].id;
      return addGrnLine(tx, req.ctx, id, clientId, b);
    });
    reply.status(r.duplicate ? 200 : 201);
    return { id: r.id, status: r.duplicate ? 'duplicate' : 'applied', line: (r as any).line };
  });
  app.post('/goods-receipts/:id/complete', { preHandler: requirePerm('movement.receive') }, async (req) => withCompany(cx(req), (tx) => completeGrn(tx, req.ctx, (req.params as any).id)));
  app.post('/goods-receipts/:id/cancel', { preHandler: requirePerm('movement.receive', 'receive.variance') }, async (req) => {
    const { id } = req.params as any;
    return withCompany(cx(req), async (tx) => {
      const g = (await tx.query(`SELECT * FROM goods_receipt WHERE id = $1 FOR UPDATE`, [id])).rows[0]; if (!g) throw notFound();
      if (g.status !== 'IN_PROGRESS') throw new AppError(409, 'GRN_STATE');
      const n = (await tx.query(`SELECT count(*) FROM goods_receipt_line WHERE grn_id = $1`, [id])).rows[0].count;
      if (Number(n) > 0) throw new AppError(409, 'GRN_STATE', 'has lines');   // 已有移动不能撤，只能完成
      await tx.query(`UPDATE goods_receipt SET status = 'CANCELLED', completed_at = now() WHERE id = $1`, [id]);
      return grnDetail(tx, id);
    });
  });

  /** 上架待办：收货区（RECEIVING）有库存的产品，按最近收货时间，带最近 GRN 号 */
  app.get('/putaway/pending', { preHandler: requirePerm('movement.putaway', 'movement.receive') }, async (req) => {
    const q = z.object({ site: uuid.optional() }).parse(req.query);
    const site = q.site ?? req.ctx.siteId ?? null;
    return withCompany(cx(req), async (tx) => (await tx.query(
      `SELECT st.product_id, st.location_id, st.qty, st.earliest_expiry, st.last_movement_at, l.code AS location_code, z.code AS zone_code, z.color AS zone_color,
              p.sku, p.name_zh, p.name_ms, p.name_en, p.photo_url, p.unit, p.category_id, p.default_location_id,
              (SELECT barcode FROM barcode b WHERE b.product_id = p.id AND b.is_primary LIMIT 1) AS barcode,
              g.grn_no, g.id AS grn_id, g.started_at AS received_at
       FROM stock st JOIN location l ON l.id = st.location_id JOIN zone z ON z.id = l.zone_id JOIN product p ON p.id = st.product_id
       LEFT JOIN LATERAL (SELECT gr.grn_no, gr.id, gr.started_at FROM movement m JOIN goods_receipt gr ON gr.id = m.ref_id WHERE m.product_id = st.product_id AND m.to_location_id = st.location_id AND m.ref_type = 'GRN' ORDER BY m.performed_at DESC LIMIT 1) g ON true
       WHERE st.qty > 0 AND z.zone_type = 'RECEIVING' AND l.is_active AND ($1::uuid IS NULL OR l.site_id = $1)
       ORDER BY g.started_at NULLS LAST, st.last_movement_at, p.name_zh`, [site])).rows);
  });
}
