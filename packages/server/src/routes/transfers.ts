// 模块 A：仓库到店调拨（feature_flags.transfers）。
// 约定：
//  - 功能开关关闭 → 403 FEATURE_DISABLED。开着时首次拣货/收货会自动启用 TRANSFER_OUT / TRANSFER_IN 移动原因（模板默认未启用）。
//  - 申请：to_site 默认我的站点；from_site 默认第一个 WAREHOUSE 站点（不等于 to）；requested_qty 空 = 按目的站点最低量补（min_level − 目的站库存，<=0 时用 reorder_qty）。
//  - 审批 TRANSFER（默认 MANAGER）。批准 → APPROVED，approved_qty 默认 = requested_qty，拣货位置 = from_site 库存最多的货位；拣货顺序按货位 code 排序。
//  - 拣货行 TRANSFER_OUT 货位 → TRANSIT（movement id = client_id），状态 PICKING；发运 → IN_TRANSIT，箱贴二维码 `TR:<short_code>:<transfer_no>`。
//  - 收货行 TRANSFER_IN TRANSIT → 目的站 RECEIVING 区（没有则 BACKROOM/STORAGE）；完成对比 picked / received，差异开 TRANSFER_VARIANCE 给 MANAGER 2 天，状态 RECEIVED。
//  - 权限：拣货 transfer.pick 或 movement.transfer_out；收货 transfer.receive 或 movement.transfer_in。
//  - 离线：sync 实体 transfer_line_pick { transfer_id, product_id, location_id|location_code, qty }、transfer_line_receive { transfer_id, product_id, qty, to_location_id? }。
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
import { createApproval, decideApproval, registerApprovalHandler } from '../lib/approvals.js';
import { registerSyncHandler } from '../lib/syncHandlers.js';
import { openTicket } from '../lib/ordersJobs.js';
import { makeLabelsPdf } from '../lib/labels.js';

const uuid = z.string().uuid();
const pname = (r: any) => r.name_zh || r.name_en || r.name_ms || r.sku || '';
const PICK_PERMS = ['transfer.pick', 'movement.transfer_out']; const RECV_PERMS = ['transfer.receive', 'movement.transfer_in'];
const anyPerm = (ctx: RequestCtx, codes: string[]) => ctx.isSuperAdmin || codes.some((c) => hasPerm(ctx, c));

async function requireTransfers(tx: Tx, ctx: RequestCtx) {
  const c = (await tx.query(`SELECT feature_flags, short_code FROM company WHERE id = $1`, [ctx.companyId])).rows[0];
  if (!c?.feature_flags?.transfers) throw new AppError(403, 'FEATURE_DISABLED', 'transfers');
  return c;
}
async function ensureReasons(tx: Tx, ctx: RequestCtx) {
  await tx.query(`INSERT INTO movement_reason_enabled (company_id, reason, enabled) VALUES ($1,'TRANSFER_OUT',true),($1,'TRANSFER_IN',true) ON CONFLICT (company_id, reason) DO UPDATE SET enabled = true`, [ctx.companyId]);
}
async function detail(tx: Tx, id: string) {
  const t = (await tx.query(`SELECT t.*, fs.code AS from_site_code, fs.name AS from_site_name, ts.code AS to_site_code, ts.name AS to_site_name, ru.name AS requested_by_name, au.name AS approved_by_name, du.name AS dispatched_by_name, cu.name AS received_by_name, a.status AS approval_status, a.approver_role_code
    FROM transfer t JOIN site fs ON fs.id = t.from_site_id JOIN site ts ON ts.id = t.to_site_id JOIN app_user ru ON ru.id = t.requested_by LEFT JOIN app_user au ON au.id = t.approved_by LEFT JOIN app_user du ON du.id = t.dispatched_by LEFT JOIN app_user cu ON cu.id = t.received_by LEFT JOIN approval_request a ON a.id = t.approval_id WHERE t.id = $1`, [id])).rows[0];
  if (!t) throw notFound();
  const lines = (await tx.query(
    `SELECT l.*, p.sku, p.name_zh, p.name_ms, p.name_en, p.unit, p.photo_url, p.min_level, p.reorder_qty,
            (SELECT barcode FROM barcode b WHERE b.product_id = p.id AND b.is_primary LIMIT 1) AS barcode,
            (SELECT max(pack_qty) FROM barcode b WHERE b.product_id = p.id AND b.barcode_type = 'CASE') AS case_qty,
            lo.code AS pick_location_code, z.color AS pick_zone_color,
            coalesce((SELECT s.qty FROM stock s WHERE s.product_id = l.product_id AND s.location_id = l.pick_location_id),0) AS pick_location_qty,
            coalesce((SELECT sum(s.qty) FROM stock s JOIN location x ON x.id = s.location_id WHERE s.product_id = l.product_id AND x.site_id = t.from_site_id AND NOT x.is_virtual),0) AS from_site_qty,
            coalesce((SELECT sum(s.qty) FROM stock s JOIN location x ON x.id = s.location_id WHERE s.product_id = l.product_id AND x.site_id = t.to_site_id AND NOT x.is_virtual),0) AS to_site_qty
     FROM transfer_line l JOIN transfer t ON t.id = l.transfer_id JOIN product p ON p.id = l.product_id LEFT JOIN location lo ON lo.id = l.pick_location_id LEFT JOIN zone z ON z.id = lo.zone_id
     WHERE l.transfer_id = $1 ORDER BY lo.code NULLS LAST, p.name_zh`, [id])).rows;
  const tickets = (await tx.query(`SELECT id, type, title, status, owner_role_code, deadline_at FROM ticket WHERE ref_type = 'transfer' AND ref_id = $1 ORDER BY created_at`, [id])).rows;
  const sc = (await tx.query(`SELECT short_code FROM company WHERE id = $1`, [t.company_id])).rows[0]?.short_code;
  return { ...t, lines, tickets, qr: `TR:${sc}:${t.transfer_no}` };
}
async function defaultInLocation(tx: Tx, siteId: string) {
  return (await tx.query(`SELECT l.* FROM location l JOIN zone z ON z.id = l.zone_id WHERE l.site_id = $1 AND l.is_active AND z.zone_type IN ('RECEIVING','BACKROOM','STORAGE') ORDER BY CASE z.zone_type WHEN 'RECEIVING' THEN 0 WHEN 'BACKROOM' THEN 1 ELSE 2 END, z.sort_order, l.code LIMIT 1`, [siteId])).rows[0]
    ?? (await tx.query(`SELECT * FROM location WHERE site_id = $1 AND is_active AND NOT is_virtual ORDER BY code LIMIT 1`, [siteId])).rows[0];
}

const pickLine = z.object({ client_id: uuid.optional(), product_id: uuid.optional(), barcode: z.string().optional(), location_id: uuid.optional(), location_code: z.string().optional(), qty: z.number().positive(), performed_at: z.string().datetime({ offset: true }).optional() });
const recvLine = z.object({ client_id: uuid.optional(), product_id: uuid.optional(), barcode: z.string().optional(), to_location_id: uuid.optional().nullable(), to_location_code: z.string().optional().nullable(), qty: z.number().positive(), performed_at: z.string().datetime({ offset: true }).optional() });

async function resolveProduct(tx: Tx, productId?: string, barcode?: string, qty = 1) {
  if (productId) return { productId, qty };
  if (!barcode) throw new AppError(400, 'VALIDATION', 'product_id or barcode required');
  const b = (await tx.query(`SELECT product_id, pack_qty FROM barcode WHERE barcode = $1`, [barcode])).rows[0]; if (!b) throw new AppError(404, 'BARCODE_NOT_FOUND');
  return { productId: b.product_id as string, qty: qty * Number(b.pack_qty) };
}

/** 拣一行（幂等按 client_id = movement id） */
export async function pickOne(tx: Tx, ctx: RequestCtx, transferId: string, clientId: string, input: z.infer<typeof pickLine>) {
  if (!anyPerm(ctx, PICK_PERMS)) throw new AppError(403, 'PERMISSION_DENIED', 'transfer.pick');
  const t = (await tx.query(`SELECT * FROM transfer WHERE id = $1 FOR UPDATE`, [transferId])).rows[0]; if (!t) throw notFound();
  const dup = (await tx.query(`SELECT id FROM movement WHERE id = $1`, [clientId])).rows[0]; if (dup) return { id: clientId, duplicate: true };
  if (!['APPROVED', 'PICKING'].includes(t.status)) throw new AppError(409, 'TRANSFER_STATE', t.status);
  await ensureReasons(tx, ctx);
  const { productId, qty } = await resolveProduct(tx, input.product_id, input.barcode, input.qty);
  const loc = await resolveLocation(tx, input.location_id, input.location_code); if (!loc) throw notFound('LOCATION_NOT_FOUND');
  if (loc.site_id !== t.from_site_id) throw new AppError(400, 'CROSS_SITE_NOT_ALLOWED', 'location not in from_site');
  const line = (await tx.query(`SELECT * FROM transfer_line WHERE transfer_id = $1 AND product_id = $2 FOR UPDATE`, [transferId, productId])).rows[0];
  if (!line) throw new AppError(400, 'VALIDATION', 'product not on transfer');
  const m = await applyMovement(tx, ctx, { id: clientId, product_id: productId, from_location_id: loc.id, to_location_code: 'TRANSIT', qty, reason: 'TRANSFER_OUT', ref_type: 'TRANSFER', ref_id: transferId, performed_at: input.performed_at, note: t.transfer_no });
  await tx.query(`UPDATE transfer_line SET picked_qty = picked_qty + $2, out_movement_id = COALESCE(out_movement_id, $3), pick_location_id = COALESCE(pick_location_id, $4) WHERE id = $1`, [line.id, qty, m.id, loc.id]);
  if (t.status === 'APPROVED') await tx.query(`UPDATE transfer SET status = 'PICKING' WHERE id = $1`, [transferId]);
  return { id: m.id, duplicate: false, picked_qty: Number(line.picked_qty) + qty, approved_qty: Number(line.approved_qty ?? line.requested_qty) };
}
/** 店收一行 */
export async function receiveOne(tx: Tx, ctx: RequestCtx, transferId: string, clientId: string, input: z.infer<typeof recvLine>) {
  if (!anyPerm(ctx, RECV_PERMS)) throw new AppError(403, 'PERMISSION_DENIED', 'transfer.receive');
  const t = (await tx.query(`SELECT * FROM transfer WHERE id = $1 FOR UPDATE`, [transferId])).rows[0]; if (!t) throw notFound();
  const dup = (await tx.query(`SELECT id FROM movement WHERE id = $1`, [clientId])).rows[0]; if (dup) return { id: clientId, duplicate: true };
  if (!['IN_TRANSIT', 'PICKING'].includes(t.status)) throw new AppError(409, 'TRANSFER_STATE', t.status);
  await ensureReasons(tx, ctx);
  const { productId, qty } = await resolveProduct(tx, input.product_id, input.barcode, input.qty);
  let loc = (input.to_location_id || input.to_location_code) ? await resolveLocation(tx, input.to_location_id ?? undefined, input.to_location_code ?? undefined) : null;
  if ((input.to_location_id || input.to_location_code) && !loc) throw notFound('LOCATION_NOT_FOUND');
  if (!loc) loc = await defaultInLocation(tx, t.to_site_id);
  if (!loc) throw notFound('LOCATION_NOT_FOUND');
  if (loc.site_id !== t.to_site_id) throw new AppError(400, 'CROSS_SITE_NOT_ALLOWED', 'location not in to_site');
  const line = (await tx.query(`SELECT * FROM transfer_line WHERE transfer_id = $1 AND product_id = $2 FOR UPDATE`, [transferId, productId])).rows[0];
  if (!line) throw new AppError(400, 'VALIDATION', 'product not on transfer');
  const m = await applyMovement(tx, ctx, { id: clientId, product_id: productId, from_location_code: 'TRANSIT', to_location_id: loc.id, qty, reason: 'TRANSFER_IN', ref_type: 'TRANSFER', ref_id: transferId, performed_at: input.performed_at, note: t.transfer_no });
  await tx.query(`UPDATE transfer_line SET received_qty = received_qty + $2, in_movement_id = COALESCE(in_movement_id, $3) WHERE id = $1`, [line.id, qty, m.id]);
  return { id: m.id, duplicate: false, received_qty: Number(line.received_qty) + qty, picked_qty: Number(line.picked_qty), location_code: loc.code };
}

export async function transfersRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);
  const cx = (req: any) => ({ companyId: req.ctx.companyId, userId: req.ctx.userId, deviceId: req.ctx.deviceId });
  registerApprovalHandler('TRANSFER', async (tx, ctx, a, decision, note) => {
    const t = (await tx.query(`SELECT * FROM transfer WHERE id = $1 FOR UPDATE`, [a.ref_id])).rows[0]; if (!t) return;
    if (decision === 'approve') {
      await tx.query(`UPDATE transfer_line SET approved_qty = COALESCE(approved_qty, requested_qty) WHERE transfer_id = $1`, [t.id]);
      await tx.query(`DELETE FROM transfer_line WHERE transfer_id = $1 AND approved_qty <= 0`, [t.id]);
      // 拣货位置：from_site 库存最多的非虚拟货位
      await tx.query(`UPDATE transfer_line l SET pick_location_id = (SELECT s.location_id FROM stock s JOIN location x ON x.id = s.location_id WHERE s.product_id = l.product_id AND x.site_id = $2 AND NOT x.is_virtual AND x.is_active AND s.qty > 0 ORDER BY s.qty DESC, x.code LIMIT 1) WHERE l.transfer_id = $1`, [t.id, t.from_site_id]);
      await tx.query(`UPDATE transfer SET status = 'APPROVED', approved_by = $2, approved_at = now(), note = COALESCE($3, note) WHERE id = $1`, [t.id, ctx.userId, note ?? null]);
    } else if (decision === 'reject') {
      await tx.query(`UPDATE transfer SET status = 'REJECTED', approved_by = $2, approved_at = now(), note = COALESCE($3, note) WHERE id = $1`, [t.id, ctx.userId, note ?? null]);
    } else await tx.query(`UPDATE transfer SET note = COALESCE($2, note) WHERE id = $1`, [t.id, note ?? null]);
  });
  registerSyncHandler('transfer_line_pick', async (tx, ctx, clientId, payload) => { const b = pickLine.extend({ transfer_id: uuid }).parse(payload); await requireTransfers(tx, ctx); return (await pickOne(tx, ctx, b.transfer_id, clientId, b)).id; });
  registerSyncHandler('transfer_line_receive', async (tx, ctx, clientId, payload) => { const b = recvLine.extend({ transfer_id: uuid }).parse(payload); await requireTransfers(tx, ctx); return (await receiveOne(tx, ctx, b.transfer_id, clientId, b)).id; });

  const VIEW = ['transfer.view', 'transfer.request', 'transfer.approve', 'transfer.pick', 'transfer.receive', 'movement.transfer_out', 'movement.transfer_in'];
  app.get('/transfers', { preHandler: requirePerm(...VIEW) }, async (req) => {
    const q = z.object({ status: z.string().optional(), from_site: uuid.optional(), to_site: uuid.optional(), mine: z.string().optional(), limit: z.coerce.number().max(500).default(100) }).parse(req.query);
    return withCompany(cx(req), async (tx) => {
      await requireTransfers(tx, req.ctx);
      return (await tx.query(
        `SELECT t.*, fs.code AS from_site_code, ts.code AS to_site_code, ts.name AS to_site_name, fs.name AS from_site_name, ru.name AS requested_by_name,
                (SELECT count(*) FROM transfer_line l WHERE l.transfer_id = t.id) AS line_count,
                (SELECT coalesce(sum(coalesce(l.approved_qty, l.requested_qty)),0) FROM transfer_line l WHERE l.transfer_id = t.id) AS qty_total,
                (SELECT coalesce(sum(l.picked_qty),0) FROM transfer_line l WHERE l.transfer_id = t.id) AS picked_total,
                (SELECT coalesce(sum(l.received_qty),0) FROM transfer_line l WHERE l.transfer_id = t.id) AS received_total
         FROM transfer t JOIN site fs ON fs.id = t.from_site_id JOIN site ts ON ts.id = t.to_site_id JOIN app_user ru ON ru.id = t.requested_by
         WHERE ($1::text IS NULL OR t.status = ANY(string_to_array($1, ','))) AND ($2::uuid IS NULL OR t.from_site_id = $2) AND ($3::uuid IS NULL OR t.to_site_id = $3)
           AND ($4::uuid IS NULL OR t.from_site_id = $4 OR t.to_site_id = $4)
         ORDER BY t.created_at DESC LIMIT $5`, [q.status ?? null, q.from_site ?? null, q.to_site ?? null, q.mine ? req.ctx.siteId : null, q.limit])).rows;
    });
  });
  app.get('/transfers/by-no/:no', { preHandler: requirePerm(...VIEW) }, async (req) => {
    const raw = decodeURIComponent((req.params as any).no); const no = raw.includes(':') ? raw.split(':').pop()! : raw;
    return withCompany(cx(req), async (tx) => { await requireTransfers(tx, req.ctx); const t = (await tx.query(`SELECT id FROM transfer WHERE transfer_no = $1`, [no])).rows[0]; if (!t) throw notFound(); return detail(tx, t.id); });
  });
  app.get('/transfers/:id', { preHandler: requirePerm(...VIEW) }, async (req) => withCompany(cx(req), async (tx) => { await requireTransfers(tx, req.ctx); return detail(tx, (req.params as any).id); }));
  /** 箱贴 PDF（100x50，二维码 TR:<short>:<no>） */
  app.get('/transfers/:id/labels', { preHandler: requirePerm(...VIEW) }, async (req, reply) => {
    const { id } = req.params as any; const n = Math.min(20, Math.max(1, Number((req.query as any).n ?? 1)));
    const t = await withCompany(cx(req), async (tx) => { await requireTransfers(tx, req.ctx); return detail(tx, id); });
    const buf = await makeLabelsPdf(Array.from({ length: n }, (_, i) => ({ qr: t.qr, code: t.transfer_no, color: '#EF6C00', names: [`${t.from_site_code} → ${t.to_site_code}`, `${i + 1}/${n}`] })), '100x50');
    reply.header('Content-Type', 'application/pdf').header('Content-Disposition', `inline; filename="${t.transfer_no}-labels.pdf"`); return reply.send(buf);
  });
  /** 申请 */
  app.post('/transfers', { preHandler: requirePerm('transfer.request', 'transfer.approve') }, async (req, reply) => {
    const b = z.object({ client_id: uuid.optional(), from_site_id: uuid.optional().nullable(), to_site_id: uuid.optional().nullable(), required_at: z.string().optional().nullable(), note: z.string().max(300).optional().nullable(),
      lines: z.array(z.object({ product_id: uuid.optional(), barcode: z.string().optional(), requested_qty: z.number().positive().optional().nullable() })).min(1) }).parse(req.body);
    const r = await withCompany(cx(req), async (tx) => {
      await requireTransfers(tx, req.ctx);
      if (b.client_id) { const dup = (await tx.query(`SELECT id FROM transfer WHERE id = $1`, [b.client_id])).rows[0]; if (dup) return { ...(await detail(tx, dup.id)), duplicate: true }; }
      const toSite = b.to_site_id ?? req.ctx.siteId; if (!toSite) throw new AppError(400, 'VALIDATION', 'to_site_id required');
      const fromSite = b.from_site_id ?? (await tx.query(`SELECT id FROM site WHERE type = 'WAREHOUSE' AND is_active AND id <> $1 ORDER BY code LIMIT 1`, [toSite])).rows[0]?.id;
      if (!fromSite) throw new AppError(400, 'VALIDATION', 'no warehouse site');
      if (fromSite === toSite) throw new AppError(400, 'VALIDATION', 'from = to');
      const no = await nextDocNo(tx, req.ctx.companyId, 'TR', 'TR-');
      const t = (await tx.query(`INSERT INTO transfer (id, company_id, transfer_no, from_site_id, to_site_id, status, requested_by, required_at, note) VALUES (COALESCE($8::uuid, uuid_v7()), $1,$2,$3,$4,'REQUESTED',$5,$6,$7) RETURNING *`, [req.ctx.companyId, no, fromSite, toSite, req.ctx.userId, b.required_at ?? null, b.note ?? null, b.client_id ?? null])).rows[0];
      const items = new Map<string, number>();
      for (const l of b.lines) {
        const { productId, qty } = await resolveProduct(tx, l.product_id, l.barcode, l.requested_qty ?? 1);
        let want = l.requested_qty != null ? qty : null;
        if (want == null) {
          const p = (await tx.query(`SELECT p.min_level, p.reorder_qty, coalesce((SELECT sum(s.qty) FROM stock s JOIN location x ON x.id = s.location_id WHERE s.product_id = p.id AND x.site_id = $2 AND NOT x.is_virtual),0) AS have FROM product p WHERE p.id = $1`, [productId, toSite])).rows[0];
          if (!p) throw notFound('PRODUCT_NOT_FOUND');
          const need = Number(p.min_level) - Number(p.have); want = need > 0 ? Math.ceil(need) : Number(p.reorder_qty);
        }
        items.set(productId, (items.get(productId) ?? 0) + want);
      }
      for (const [pid, q] of items) await tx.query(`INSERT INTO transfer_line (company_id, transfer_id, product_id, requested_qty) VALUES ($1,$2,$3,$4)`, [req.ctx.companyId, t.id, pid, q]);
      const sites = (await tx.query(`SELECT (SELECT code FROM site WHERE id = $1) AS f, (SELECT code FROM site WHERE id = $2) AS t`, [fromSite, toSite])).rows[0];
      const a = await createApproval(tx, req.ctx, { type: 'TRANSFER', ref_type: 'transfer', ref_id: t.id, summary: { title: `调拨 ${no} ${sites.f} → ${sites.t} · ${items.size} 项` }, site_id: toSite });
      await tx.query(`UPDATE transfer SET approval_id = $2 WHERE id = $1`, [t.id, a.id]);
      return { ...(await detail(tx, t.id)), duplicate: false };
    });
    reply.status(r.duplicate ? 200 : 201); return r;
  });
  /** 经理批准 / 改数量 / 拒绝（内部走审批引擎） */
  app.post('/transfers/:id/decide', { preHandler: requirePerm('transfer.approve') }, async (req) => {
    const { id } = req.params as any;
    const b = z.object({ decision: z.enum(['approve', 'reject', 'return']).default('approve'), note: z.string().max(300).optional(), lines: z.array(z.object({ id: uuid, approved_qty: z.number().min(0) })).optional() }).parse(req.body ?? {});
    return withCompany(cx(req), async (tx) => {
      await requireTransfers(tx, req.ctx);
      const t = (await tx.query(`SELECT * FROM transfer WHERE id = $1 FOR UPDATE`, [id])).rows[0]; if (!t) throw notFound();
      if (t.status !== 'REQUESTED' || !t.approval_id) throw new AppError(409, 'TRANSFER_STATE', t.status);
      for (const l of b.lines ?? []) await tx.query(`UPDATE transfer_line SET approved_qty = $3 WHERE id = $1 AND transfer_id = $2`, [l.id, id, l.approved_qty]);
      const a = await decideApproval(tx, req.ctx, t.approval_id, b.decision, b.note);
      return { ...(await detail(tx, id)), approval: a };
    });
  });
  app.post('/transfers/:id/pick-lines', { preHandler: requirePerm(...PICK_PERMS) }, async (req) => {
    const { id } = req.params as any;
    const b = z.object({ lines: z.array(pickLine).min(1) }).parse(req.body);
    return withCompany(cx(req), async (tx) => {
      await requireTransfers(tx, req.ctx);
      const results: any[] = [];
      for (const l of b.lines) { const cid = l.client_id ?? (await tx.query(`SELECT uuid_v7() id`)).rows[0].id; const r = await pickOne(tx, req.ctx, id, cid, l); results.push({ client_id: cid, status: r.duplicate ? 'duplicate' : 'applied', ...r }); }
      return { results, transfer: await detail(tx, id) };
    });
  });
  app.post('/transfers/:id/dispatch', { preHandler: requirePerm(...PICK_PERMS) }, async (req) => {
    const { id } = req.params as any;
    return withCompany(cx(req), async (tx) => {
      const c = await requireTransfers(tx, req.ctx);
      const t = (await tx.query(`SELECT * FROM transfer WHERE id = $1 FOR UPDATE`, [id])).rows[0]; if (!t) throw notFound();
      if (t.status === 'IN_TRANSIT') return { ...(await detail(tx, id)), qr: `TR:${c.short_code}:${t.transfer_no}` };
      if (t.status !== 'PICKING') throw new AppError(409, 'TRANSFER_STATE', t.status);
      const picked = Number((await tx.query(`SELECT coalesce(sum(picked_qty),0) q FROM transfer_line WHERE transfer_id = $1`, [id])).rows[0].q);
      if (picked <= 0) throw new AppError(409, 'TRANSFER_STATE', 'nothing picked');
      await tx.query(`UPDATE transfer SET status = 'IN_TRANSIT', dispatched_at = now(), dispatched_by = $2 WHERE id = $1`, [id, req.ctx.userId]);
      const d = await detail(tx, id);
      await tgSend(req.ctx.companyId, `<b>调拨已发运</b> ${t.transfer_no} ${d.from_site_code} → ${d.to_site_code} · ${picked} 件 · ${req.ctx.name}`, undefined, { type: 'TRANSFER_DISPATCHED', refType: 'transfer', refId: id });
      return d;
    });
  });
  app.post('/transfers/:id/receive-lines', { preHandler: requirePerm(...RECV_PERMS) }, async (req) => {
    const { id } = req.params as any;
    const b = z.object({ lines: z.array(recvLine).min(1) }).parse(req.body);
    return withCompany(cx(req), async (tx) => {
      await requireTransfers(tx, req.ctx);
      const results: any[] = [];
      for (const l of b.lines) { const cid = l.client_id ?? (await tx.query(`SELECT uuid_v7() id`)).rows[0].id; const r = await receiveOne(tx, req.ctx, id, cid, l); results.push({ client_id: cid, status: r.duplicate ? 'duplicate' : 'applied', ...r }); }
      return { results, transfer: await detail(tx, id) };
    });
  });
  /** 店完成：对比发出和收到，差异开工单，RECEIVED */
  app.post('/transfers/:id/complete', { preHandler: requirePerm(...RECV_PERMS) }, async (req) => {
    const { id } = req.params as any;
    return withCompany(cx(req), async (tx) => {
      await requireTransfers(tx, req.ctx);
      const t = (await tx.query(`SELECT * FROM transfer WHERE id = $1 FOR UPDATE`, [id])).rows[0]; if (!t) throw notFound();
      if (t.status === 'RECEIVED') return { ...(await detail(tx, id)), duplicate: true };
      if (t.status !== 'IN_TRANSIT') throw new AppError(409, 'TRANSFER_STATE', t.status);
      const lines = (await tx.query(`SELECT l.*, p.sku, p.name_zh, p.name_ms, p.name_en FROM transfer_line l JOIN product p ON p.id = l.product_id WHERE l.transfer_id = $1`, [id])).rows;
      const variance = lines.filter((l) => Number(l.picked_qty) !== Number(l.received_qty)).map((l) => ({ product_id: l.product_id, name: pname(l), picked: Number(l.picked_qty), received: Number(l.received_qty), diff: Number(l.received_qty) - Number(l.picked_qty) }));
      await tx.query(`UPDATE transfer SET status = 'RECEIVED', received_at = now(), received_by = $2 WHERE id = $1`, [id, req.ctx.userId]);
      const tickets: any[] = [];
      if (variance.length) tickets.push(await openTicket(tx, req.ctx, { type: 'TRANSFER_VARIANCE', owner_role: 'MANAGER', days: 2, ref_type: 'transfer', ref_id: id, site_id: t.to_site_id, title: `调拨差异 ${t.transfer_no}：${variance.map((v) => `${v.name} ${v.diff > 0 ? '+' : ''}${v.diff}`).join('、')}`, text: variance.map((v) => `${v.name}：发 ${v.picked} 收 ${v.received}`).join('\n') + '\nTRANSIT 余量待跟进', priority: 'HIGH' }));
      const d = await detail(tx, id);
      await tgSend(req.ctx.companyId, `<b>调拨已收货</b> ${t.transfer_no} ${d.from_site_code} → ${d.to_site_code} · ${req.ctx.name}${variance.length ? `\n⚠ 差异：${variance.map((v) => `${v.name} ${v.diff > 0 ? '+' : ''}${v.diff}`).join('、')}（已开工单）` : '\n无差异'}`, undefined, { type: 'TRANSFER_RECEIVED', refType: 'transfer', refId: id });
      return { ...d, variance, tickets_opened: tickets, duplicate: false };
    });
  });
  app.post('/transfers/:id/cancel', { preHandler: requirePerm('transfer.approve', 'transfer.request') }, async (req) => {
    const { id } = req.params as any;
    return withCompany(cx(req), async (tx) => {
      await requireTransfers(tx, req.ctx);
      const t = (await tx.query(`SELECT * FROM transfer WHERE id = $1 FOR UPDATE`, [id])).rows[0]; if (!t) throw notFound();
      if (!['REQUESTED', 'APPROVED'].includes(t.status)) throw new AppError(409, 'TRANSFER_STATE', t.status);
      if (t.status === 'REQUESTED' && t.requested_by !== req.ctx.userId && !hasPerm(req.ctx, 'transfer.approve')) throw new AppError(403, 'FORBIDDEN');
      await tx.query(`UPDATE transfer SET status = 'CANCELLED' WHERE id = $1`, [id]);
      if (t.approval_id) await tx.query(`UPDATE approval_request SET status = 'REJECTED', decided_at = now(), decision_note = 'cancelled' WHERE id = $1 AND status = 'PENDING'`, [t.approval_id]);
      return detail(tx, id);
    });
  });
}
