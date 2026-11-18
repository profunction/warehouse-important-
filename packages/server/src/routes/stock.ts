import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withCompany } from '../lib/db.js';
import { requireAuth, requirePerm, stripCost, hasPerm, permCondition } from '../lib/auth.js';
import { notFound, AppError } from '../lib/errors.js';
import { applyMovement, movementSchema, upsertShelf } from '../lib/movements.js';
import { REASON_PERMISSION } from '@wh/shared';

export async function stockRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);
  const cx = (req: any) => ({ companyId: req.ctx.companyId, userId: req.ctx.userId, deviceId: req.ctx.deviceId });
  const siteFilter = (req: any) => (hasPerm(req.ctx, 'stock.view_other_sites') ? null : req.ctx.siteId);

  app.get('/stock/lookup/:barcode', async (req) => {
    const barcode = decodeURIComponent((req.params as any).barcode);
    return withCompany(cx(req), async (tx) => {
      const p = (await tx.query(`SELECT p.*, b.pack_qty, b.barcode_type FROM barcode b JOIN product p ON p.id = b.product_id WHERE b.barcode = $1`, [barcode])).rows[0]
        ?? (await tx.query(`SELECT p.*, 1 AS pack_qty, 'SCALE_PLU' AS barcode_type FROM product p WHERE p.plu_code = $1`, [barcode.length === 13 && barcode.startsWith('2') ? barcode.slice(1, 6) : '']) ).rows[0];
      if (!p) throw notFound('BARCODE_NOT_FOUND');
      const sf = siteFilter(req);
      const locations = (await tx.query(`SELECT l.id AS location_id, l.code, l.site_id, s.code AS site_code, z.code AS zone_code, z.color AS zone_color, z.zone_type, st.qty, st.earliest_expiry
        FROM stock st JOIN location l ON l.id = st.location_id LEFT JOIN zone z ON z.id = l.zone_id LEFT JOIN site s ON s.id = l.site_id
        WHERE st.product_id = $1 AND NOT l.is_virtual AND st.qty <> 0 AND ($2::uuid IS NULL OR l.site_id = $2) ORDER BY s.code, l.code`, [p.id, sf])).rows;
      const total = locations.reduce((a, r) => a + Number(r.qty), 0);
      const canAll = hasPerm(req.ctx, 'movement.view_all');
      const recent = (await tx.query(`SELECT m.id, m.qty, m.reason, m.performed_at, fl.code AS from_code, tl.code AS to_code, u.name AS by_name FROM movement m JOIN location fl ON fl.id = m.from_location_id JOIN location tl ON tl.id = m.to_location_id JOIN app_user u ON u.id = m.performed_by
        WHERE m.product_id = $1 AND ($2::boolean OR m.performed_by = $3) ORDER BY m.performed_at DESC LIMIT 5`, [p.id, canAll, req.ctx.userId])).rows;
      const shelves = (await tx.query(`SELECT l.code, sa.is_primary FROM shelf_assignment sa JOIN location l ON l.id = sa.location_id WHERE sa.product_id = $1 AND sa.is_active AND ($2::uuid IS NULL OR sa.site_id = $2)`, [p.id, sf])).rows;
      let sales_30d: number | null = null;
      if (hasPerm(req.ctx, 'report.sales') || req.ctx.roles.includes('BOSS')) sales_30d = Number((await tx.query(`SELECT coalesce(sum(qty),0) q FROM movement WHERE product_id = $1 AND reason = 'SALE' AND performed_at > now() - interval '30 days'`, [p.id])).rows[0].q);
      return { product: stripCost(req.ctx, p), total_qty: total, locations, shelves, recent_movements: recent, sales_30d };
    });
  });

  app.get('/stock/by-product/:id', { preHandler: requirePerm('stock.view') }, async (req) => {
    const { id } = req.params as any;
    return withCompany(cx(req), async (tx) => (await tx.query(`SELECT l.id AS location_id, l.code, l.site_id, z.code AS zone_code, st.qty, st.earliest_expiry FROM stock st JOIN location l ON l.id = st.location_id LEFT JOIN zone z ON z.id = l.zone_id WHERE st.product_id = $1 AND NOT l.is_virtual AND ($2::uuid IS NULL OR l.site_id = $2) ORDER BY l.code`, [id, siteFilter(req)])).rows);
  });
  app.get('/stock/by-location/:id', { preHandler: requirePerm('stock.view') }, async (req) => {
    const { id } = req.params as any;
    return withCompany(cx(req), async (tx) => (await tx.query(`SELECT p.id AS product_id, p.sku, p.name_zh, p.name_ms, p.name_en, p.photo_url, p.unit, st.qty, st.earliest_expiry, (SELECT barcode FROM barcode b WHERE b.product_id = p.id AND b.is_primary) AS barcode FROM stock st JOIN product p ON p.id = st.product_id WHERE st.location_id = $1 AND st.qty <> 0 ORDER BY p.sku`, [id])).rows);
  });
  app.get('/stock/low', { preHandler: requirePerm('stock.view') }, async (req) => withCompany(cx(req), async (tx) => (await tx.query(
    `SELECT p.id, p.sku, p.name_zh, p.name_ms, p.name_en, p.photo_url, p.unit, p.min_level, p.reorder_qty, coalesce(sum(st.qty),0) AS total_qty
     FROM product p LEFT JOIN stock st ON st.product_id = p.id LEFT JOIN location l ON l.id = st.location_id AND NOT l.is_virtual
     WHERE p.is_active GROUP BY p.id HAVING coalesce(sum(st.qty) FILTER (WHERE NOT l.is_virtual),0) < p.min_level ORDER BY p.name_zh`)).rows));
  app.get('/stock/negative', { preHandler: requirePerm('stock.view') }, async (req) => withCompany(cx(req), async (tx) => (await tx.query(`SELECT p.sku, p.name_zh, p.name_ms, p.name_en, l.code, st.qty FROM stock st JOIN location l ON l.id = st.location_id JOIN product p ON p.id = st.product_id WHERE st.qty < 0 AND NOT l.is_virtual ORDER BY st.qty`)).rows));
  app.get('/stock/expiring', { preHandler: requirePerm('stock.view') }, async (req) => {
    const days = Number((req.query as any).days ?? 14);
    return withCompany(cx(req), async (tx) => (await tx.query(`SELECT p.sku, p.name_zh, p.name_ms, p.name_en, l.code, e.expiry_date, e.qty FROM expiry_lot e JOIN location l ON l.id = e.location_id JOIN product p ON p.id = e.product_id WHERE e.qty > 0 AND e.expiry_date <= current_date + $1::int ORDER BY e.expiry_date`, [days])).rows);
  });
  /** 货架缺货清单：登记了货架且货架库存低于 shelf_min_level（默认 = min_level/4，最少 1） */
  app.get('/stock/shelf-low', { preHandler: requirePerm('stock.view') }, async (req) => withCompany(cx(req), async (tx) => (await tx.query(
    `SELECT p.id AS product_id, p.sku, p.name_zh, p.name_ms, p.name_en, p.photo_url, p.unit, l.id AS shelf_location_id, l.code AS shelf_code, coalesce(st.qty,0) AS shelf_qty,
            greatest(coalesce(pss.shelf_min_level, p.min_level / 4), 1) AS shelf_min,
            (SELECT coalesce(sum(s2.qty),0) FROM stock s2 JOIN location l2 ON l2.id = s2.location_id JOIN zone z2 ON z2.id = l2.zone_id WHERE s2.product_id = p.id AND l2.site_id = sa.site_id AND z2.zone_type IN ('BACKROOM','STORAGE','RECEIVING')) AS backroom_qty,
            (SELECT l3.code FROM stock s3 JOIN location l3 ON l3.id = s3.location_id JOIN zone z3 ON z3.id = l3.zone_id WHERE s3.product_id = p.id AND l3.site_id = sa.site_id AND z3.zone_type IN ('BACKROOM','STORAGE') AND s3.qty > 0 ORDER BY s3.qty DESC LIMIT 1) AS backroom_code
     FROM shelf_assignment sa JOIN product p ON p.id = sa.product_id JOIN location l ON l.id = sa.location_id
     LEFT JOIN stock st ON st.product_id = p.id AND st.location_id = l.id LEFT JOIN product_site_setting pss ON pss.product_id = p.id AND pss.site_id = sa.site_id
     WHERE sa.is_active AND sa.is_primary AND p.is_active AND ($1::uuid IS NULL OR sa.site_id = $1)
       AND coalesce(st.qty,0) < greatest(coalesce(pss.shelf_min_level, p.min_level / 4), 1)
     ORDER BY coalesce(st.qty,0) / greatest(coalesce(pss.shelf_min_level, p.min_level / 4), 1), p.name_zh`, [req.ctx.siteId])).rows));

  /** 3D 仓库视图数据：每个站点的区、货位（架/层）、每个货位的数量汇总和前三个产品 */
  app.get('/stock/zone-map', { preHandler: requirePerm('stock.view') }, async (req) => {
    const q = z.object({ site: z.string().uuid().optional() }).parse(req.query);
    const site = q.site ?? req.ctx.siteId;
    return withCompany(cx(req), async (tx) => {
      const zones = (await tx.query(`SELECT z.id, z.code, z.name_zh, z.name_ms, z.name_en, z.zone_type, z.color, z.capacity_boxes, z.sort_order FROM zone z WHERE z.is_active AND ($1::uuid IS NULL OR z.site_id = $1) ORDER BY z.sort_order, z.code`, [site])).rows;
      const locs = (await tx.query(`
        SELECT l.id, l.zone_id, l.code, l.rack, l.level, l.capacity_boxes,
               coalesce(sum(s.qty) FILTER (WHERE s.qty > 0), 0) AS qty,
               count(s.product_id) FILTER (WHERE s.qty > 0) AS items,
               min(s.earliest_expiry) AS earliest_expiry,
               (SELECT json_agg(json_build_object('name_zh', p.name_zh, 'name_ms', p.name_ms, 'name_en', p.name_en, 'qty', s2.qty) ORDER BY s2.qty DESC) FROM (SELECT * FROM stock s2 WHERE s2.location_id = l.id AND s2.qty > 0 ORDER BY s2.qty DESC LIMIT 3) s2 JOIN product p ON p.id = s2.product_id) AS top
        FROM location l LEFT JOIN stock s ON s.location_id = l.id
        WHERE l.is_active AND NOT l.is_virtual AND ($1::uuid IS NULL OR l.site_id = $1)
        GROUP BY l.id ORDER BY l.zone_id, l.rack, l.level`, [site])).rows;
      const sites = (await tx.query(`SELECT id, code, name, type FROM site WHERE is_active ORDER BY code`)).rows;
      return { site, sites, zones, locations: locs };
    });
  });

  // ---------- 移动 ----------
  app.post('/movements', async (req, reply) => {
    const b = movementSchema.parse(req.body);
    const perm = REASON_PERMISSION[b.reason];
    if (!hasPerm(req.ctx, perm)) throw new AppError(403, 'PERMISSION_DENIED', { need: perm });
    const r = await withCompany(cx(req), (tx) => applyMovement(tx, req.ctx, b));
    reply.status(r.duplicate ? 200 : 201);
    return { id: r.id, status: r.duplicate ? 'duplicate' : 'applied' };
  });
  app.get('/movements', { preHandler: requirePerm('movement.view', 'movement.view_all') }, async (req) => {
    const q = z.object({ product: z.string().uuid().optional(), location: z.string().uuid().optional(), user: z.string().uuid().optional(), reason: z.string().optional(), from: z.string().optional(), to: z.string().optional(), limit: z.coerce.number().max(500).default(100), offset: z.coerce.number().default(0) }).parse(req.query);
    const ownOnly = !hasPerm(req.ctx, 'movement.view_all') || permCondition(req.ctx, 'movement.view')?.own_only === true && !hasPerm(req.ctx, 'movement.view_all');
    return withCompany(cx(req), async (tx) => (await tx.query(
      `SELECT m.*, p.sku, p.name_zh, p.name_ms, p.name_en, fl.code AS from_code, tl.code AS to_code, u.name AS by_name
       FROM movement m JOIN product p ON p.id = m.product_id JOIN location fl ON fl.id = m.from_location_id JOIN location tl ON tl.id = m.to_location_id JOIN app_user u ON u.id = m.performed_by
       WHERE ($1::uuid IS NULL OR m.product_id = $1) AND ($2::uuid IS NULL OR m.from_location_id = $2 OR m.to_location_id = $2) AND ($3::uuid IS NULL OR m.performed_by = $3)
         AND ($4::text IS NULL OR m.reason = $4) AND ($5::timestamptz IS NULL OR m.performed_at >= $5) AND ($6::timestamptz IS NULL OR m.performed_at < $6) AND (NOT $7::boolean OR m.performed_by = $8)
       ORDER BY m.performed_at DESC LIMIT $9 OFFSET $10`, [q.product ?? null, q.location ?? null, q.user ?? null, q.reason ?? null, q.from ?? null, q.to ?? null, ownOnly, req.ctx.userId, q.limit, q.offset])).rows.map((r: any) => stripCost(req.ctx, r)));
  });

  // ---------- 货架登记 ----------
  app.post('/shelf-assignments', { preHandler: requirePerm('shelf.assign') }, async (req, reply) => {
    const b = z.object({ id: z.string().uuid().optional(), product_id: z.string().uuid().optional(), barcode: z.string().optional(), location_id: z.string().uuid().optional(), location_code: z.string().optional(), is_primary: z.boolean().default(true) }).parse(req.body);
    const r = await withCompany(cx(req), async (tx) => {
      let pid = b.product_id;
      if (!pid && b.barcode) pid = (await tx.query(`SELECT product_id FROM barcode WHERE barcode = $1`, [b.barcode])).rows[0]?.product_id;
      if (!pid) throw notFound('BARCODE_NOT_FOUND');
      let lid = b.location_id;
      if (!lid && b.location_code) lid = (await tx.query(`SELECT id FROM location WHERE code = $1`, [b.location_code.replace(/^LOC:[A-Z0-9]+:/i, '')])).rows[0]?.id;
      if (!lid) throw notFound('LOCATION_NOT_FOUND');
      return upsertShelf(tx, req.ctx, { id: b.id, product_id: pid, location_id: lid, is_primary: b.is_primary });
    });
    reply.status(r.inserted ? 201 : 200); return r;
  });
  app.get('/shelf-assignments', async (req) => {
    const q = z.object({ product: z.string().uuid().optional(), site: z.string().uuid().optional() }).parse(req.query);
    return withCompany(cx(req), async (tx) => (await tx.query(`SELECT sa.*, l.code AS location_code FROM shelf_assignment sa JOIN location l ON l.id = sa.location_id WHERE sa.is_active AND ($1::uuid IS NULL OR sa.product_id = $1) AND ($2::uuid IS NULL OR sa.site_id = $2)`, [q.product ?? null, q.site ?? req.ctx.siteId ?? null])).rows);
  });
  app.delete('/shelf-assignments/:id', { preHandler: requirePerm('shelf.assign') }, async (req) => {
    const { id } = req.params as any;
    return withCompany(cx(req), async (tx) => { await tx.query(`UPDATE shelf_assignment SET is_active = false, is_primary = false WHERE id = $1`, [id]); return { ok: true }; });
  });
  /** 上架建议货位：按允许类别 + 现有同品货位 + 剩余容量 */
  app.get('/putaway/suggest', { preHandler: requirePerm('movement.putaway', 'movement.receive') }, async (req) => {
    const q = z.object({ product: z.string().uuid(), site: z.string().uuid().optional() }).parse(req.query);
    return withCompany(cx(req), async (tx) => {
      const site = q.site ?? req.ctx.siteId;
      const p = (await tx.query(`SELECT category_id, default_location_id FROM product WHERE id = $1`, [q.product])).rows[0]; if (!p) throw notFound('PRODUCT_NOT_FOUND');
      // 1 已有同品的后仓/存储货位  2 类别允许的区里最空的货位  3 产品默认位置
      const same = (await tx.query(`SELECT l.id, l.code, z.code AS zone_code, z.color FROM stock s JOIN location l ON l.id = s.location_id JOIN zone z ON z.id = l.zone_id WHERE s.product_id = $1 AND s.qty > 0 AND l.site_id = $2 AND z.zone_type IN ('BACKROOM','STORAGE') ORDER BY s.qty DESC LIMIT 1`, [q.product, site])).rows[0];
      if (same) return { ...same, why: 'same_product' };
      const allowed = (await tx.query(`SELECT l.id, l.code, z.code AS zone_code, z.color, coalesce((SELECT count(*) FROM stock s WHERE s.location_id = l.id AND s.qty > 0),0) AS items FROM location l JOIN zone z ON z.id = l.zone_id JOIN zone_category zc ON zc.zone_id = z.id
        WHERE zc.category_id = $1 AND l.site_id = $2 AND l.is_active AND z.zone_type IN ('BACKROOM','STORAGE') ORDER BY items ASC, l.code LIMIT 1`, [p.category_id, site])).rows[0];
      if (allowed) return { ...allowed, why: 'category_zone' };
      if (p.default_location_id) { const d = (await tx.query(`SELECT l.id, l.code, z.code AS zone_code, z.color FROM location l JOIN zone z ON z.id = l.zone_id WHERE l.id = $1`, [p.default_location_id])).rows[0]; if (d) return { ...d, why: 'default' }; }
      return null;
    });
  });
}
