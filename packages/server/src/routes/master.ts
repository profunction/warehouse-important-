import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withCompany } from '../lib/db.js';
import { requireAuth, requirePerm, stripCost, hasPerm, invalidatePermCache } from '../lib/auth.js';
import { AppError, badRequest, notFound } from '../lib/errors.js';
import { toPinyin } from '../lib/pinyin.js';
import { parseScaleBarcode } from '../lib/scale.js';
import { makeLabelsPdf } from '../lib/labels.js';

const productSchema = z.object({
  sku: z.string().optional(), name_zh: z.string().max(60).optional().nullable(), name_ms: z.string().max(60).optional().nullable(), name_en: z.string().max(60).optional().nullable(),
  category_id: z.string().uuid(), unit: z.enum(['PCS', 'KG']).default('PCS'), is_weighed: z.boolean().optional(), plu_code: z.string().regex(/^[0-9]{5}$/).optional().nullable(),
  cost_price: z.number().min(0).optional(), sell_price: z.number().positive(), tax_code_id: z.string().uuid().optional(),
  min_level: z.number().min(0), reorder_qty: z.number().positive(), reorder_days: z.number().int().optional(),
  default_supplier_id: z.string().uuid().optional().nullable(), default_location_id: z.string().uuid().optional().nullable(), shelf_life_days: z.number().int().optional().nullable(),
  photo_url: z.string().optional().nullable(), is_active: z.boolean().optional(),
  barcode: z.string().regex(/^[0-9]{8,14}$/).optional(), pack_qty: z.number().positive().optional(),
});

export async function masterRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);
  const cx = (req: any) => ({ companyId: req.ctx.companyId, userId: req.ctx.userId, deviceId: req.ctx.deviceId });

  // ---------- 产品 ----------
  app.get('/products', async (req) => {
    const q = z.object({ search: z.string().optional(), category: z.string().uuid().optional(), active: z.string().optional(), limit: z.coerce.number().max(500).default(50), offset: z.coerce.number().default(0) }).parse(req.query);
    return withCompany(cx(req), async (tx) => {
      const where: string[] = ['1=1']; const params: any[] = [];
      if (q.search) { params.push(`%${q.search.toLowerCase()}%`); where.push(`search_text LIKE $${params.length}`); }
      if (q.category) { params.push(q.category); where.push(`category_id = $${params.length}`); }
      if (q.active !== 'all') where.push('is_active');
      params.push(q.limit, q.offset);
      const rows = (await tx.query(`SELECT p.*, (SELECT barcode FROM barcode b WHERE b.product_id = p.id AND b.is_primary) AS barcode,
          (SELECT coalesce(sum(qty),0) FROM stock s JOIN location l ON l.id = s.location_id WHERE s.product_id = p.id AND NOT l.is_virtual) AS total_qty
        FROM product p WHERE ${where.join(' AND ')} ORDER BY p.updated_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params)).rows;
      return rows.map((r) => stripCost(req.ctx, r));
    });
  });

  app.get('/products/by-barcode/:barcode', async (req) => {
    const { barcode } = req.params as any;
    return withCompany(cx(req), async (tx) => {
      let r = (await tx.query(`SELECT p.*, b.barcode AS scanned_barcode, b.pack_qty, b.barcode_type FROM barcode b JOIN product p ON p.id = b.product_id WHERE b.barcode = $1`, [barcode])).rows[0];
      let weight_kg: number | null = null;
      if (!r) {
        const fmt = req.ctx.settings?.scale_barcode_format;
        const parsed = parseScaleBarcode(barcode, fmt);
        if (parsed) {
          r = (await tx.query(`SELECT p.*, $1::text AS scanned_barcode, 1 AS pack_qty, 'SCALE_PLU' AS barcode_type FROM product p WHERE p.plu_code = $2 AND p.is_weighed`, [barcode, parsed.plu])).rows[0];
          weight_kg = parsed.weight_kg;
        }
      }
      if (!r) throw notFound('BARCODE_NOT_FOUND');
      return { ...stripCost(req.ctx, r), weight_kg };
    });
  });

  app.get('/products/:id', async (req) => {
    const { id } = req.params as any;
    return withCompany(cx(req), async (tx) => {
      const r = (await tx.query(`SELECT * FROM product WHERE id = $1`, [id])).rows[0];
      if (!r) throw notFound('PRODUCT_NOT_FOUND');
      const barcodes = (await tx.query(`SELECT id, barcode, pack_qty, barcode_type, is_primary FROM barcode WHERE product_id = $1 ORDER BY is_primary DESC`, [id])).rows;
      const history = hasPerm(req.ctx, 'product.view_cost') ? (await tx.query(`SELECT cost_price, sell_price, effective_from, source FROM price_history WHERE product_id = $1 ORDER BY effective_from DESC LIMIT 20`, [id])).rows : (await tx.query(`SELECT sell_price, effective_from, source FROM price_history WHERE product_id = $1 ORDER BY effective_from DESC LIMIT 20`, [id])).rows;
      return { ...stripCost(req.ctx, r), barcodes, price_history: history };
    });
  });

  app.post('/products', { preHandler: requirePerm('product.edit') }, async (req, reply) => {
    const b = productSchema.parse(req.body);
    if (b.cost_price !== undefined && !hasPerm(req.ctx, 'cost.edit') && !req.ctx.isSuperAdmin) throw new AppError(403, 'FORBIDDEN', { need: ['cost.edit'] });
    return withCompany(cx(req), async (tx) => {
      const tax = b.tax_code_id ?? (await tx.query(`SELECT id FROM tax_code WHERE is_default`)).rows[0]?.id;
      const sku = b.sku ?? (await tx.query(`SELECT 'P' || lpad((count(*) + 1)::text, 6, '0') AS s FROM product`)).rows[0].s;
      const r = (await tx.query(
        `INSERT INTO product (company_id, sku, name_zh, name_ms, name_en, name_pinyin, category_id, unit, is_weighed, plu_code, cost_price, sell_price, tax_code_id, min_level, reorder_qty, reorder_days, default_supplier_id, default_location_id, shelf_life_days, photo_url)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING *`,
        [req.ctx.companyId, sku, b.name_zh ?? null, b.name_ms ?? null, b.name_en ?? null, toPinyin(b.name_zh), b.category_id, b.unit, b.is_weighed ?? b.unit === 'KG', b.plu_code ?? null,
         b.cost_price ?? 0, b.sell_price, tax, b.min_level, b.reorder_qty, b.reorder_days ?? 7, b.default_supplier_id ?? null, b.default_location_id ?? null, b.shelf_life_days ?? null, b.photo_url ?? null])).rows[0];
      if (b.barcode) await tx.query(`INSERT INTO barcode (company_id, product_id, barcode, pack_qty, barcode_type, is_primary) VALUES ($1,$2,$3,1,'UNIT',true)`, [req.ctx.companyId, r.id, b.barcode]);
      reply.status(201);
      return stripCost(req.ctx, r);
    });
  });

  app.put('/products/:id', { preHandler: requirePerm('product.edit') }, async (req) => {
    const { id } = req.params as any;
    const b = productSchema.partial().parse(req.body);
    if (b.cost_price !== undefined && !hasPerm(req.ctx, 'cost.edit') && !req.ctx.isSuperAdmin) throw new AppError(403, 'FORBIDDEN', { need: ['cost.edit'] });
    if (b.sell_price !== undefined && !hasPerm(req.ctx, 'price.edit') && !req.ctx.isSuperAdmin) throw new AppError(403, 'FORBIDDEN', { need: ['price.edit'] });
    if ((b.min_level !== undefined || b.reorder_qty !== undefined) && !hasPerm(req.ctx, 'minlevel.edit') && !req.ctx.isSuperAdmin) throw new AppError(403, 'FORBIDDEN', { need: ['minlevel.edit'] });
    return withCompany(cx(req), async (tx) => {
      const fields = ['name_zh', 'name_ms', 'name_en', 'category_id', 'unit', 'is_weighed', 'plu_code', 'cost_price', 'sell_price', 'tax_code_id', 'min_level', 'reorder_qty', 'reorder_days', 'default_supplier_id', 'default_location_id', 'shelf_life_days', 'photo_url', 'is_active'];
      const sets: string[] = []; const params: any[] = [id];
      for (const f of fields) if ((b as any)[f] !== undefined) { params.push((b as any)[f]); sets.push(`${f} = $${params.length}`); }
      if (b.name_zh !== undefined) { params.push(toPinyin(b.name_zh)); sets.push(`name_pinyin = $${params.length}`); }
      if (!sets.length) throw badRequest();
      const r = (await tx.query(`UPDATE product SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, params)).rows[0];
      if (!r) throw notFound('PRODUCT_NOT_FOUND');
      return stripCost(req.ctx, r);
    });
  });

  app.post('/products/:id/barcodes', { preHandler: requirePerm('barcode.add') }, async (req, reply) => {
    const { id } = req.params as any;
    const b = z.object({ barcode: z.string().regex(/^[0-9]{8,14}$/), pack_qty: z.number().positive().default(1), barcode_type: z.enum(['UNIT', 'CASE', 'SCALE_PLU']).default('UNIT') }).parse(req.body);
    return withCompany(cx(req), async (tx) => {
      const r = (await tx.query(`INSERT INTO barcode (company_id, product_id, barcode, pack_qty, barcode_type) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [req.ctx.companyId, id, b.barcode, b.barcode_type === 'UNIT' ? 1 : b.pack_qty, b.barcode_type])).rows[0];
      reply.status(201); return r;
    });
  });
  app.delete('/products/:id/barcodes/:bid', { preHandler: requirePerm('product.edit') }, async (req) => {
    const { bid } = req.params as any;
    return withCompany(cx(req), async (tx) => { await tx.query(`DELETE FROM barcode WHERE id = $1 AND NOT is_primary`, [bid]); return { ok: true }; });
  });

  // ---------- 类别 / 税码 / 供应商 ----------
  app.get('/categories', async (req) => withCompany(cx(req), async (tx) => (await tx.query(`SELECT * FROM category WHERE is_active ORDER BY sort_order, code`)).rows));
  app.post('/categories', { preHandler: requirePerm('product.edit') }, async (req, reply) => {
    const b = z.object({ code: z.string().regex(/^[A-Z0-9_]{2,10}$/), name_zh: z.string().optional(), name_ms: z.string().optional(), name_en: z.string().optional(), icon: z.string().default('tag'), color: z.string().default('#9E9E9E'), parent_id: z.string().uuid().optional().nullable(), sort_order: z.number().int().default(0) }).parse(req.body);
    return withCompany(cx(req), async (tx) => { reply.status(201); return (await tx.query(`INSERT INTO category (company_id, code, name_zh, name_ms, name_en, icon, color, parent_id, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [req.ctx.companyId, b.code, b.name_zh ?? null, b.name_ms ?? null, b.name_en ?? null, b.icon, b.color, b.parent_id ?? null, b.sort_order])).rows[0]; });
  });
  app.get('/tax-codes', async (req) => withCompany(cx(req), async (tx) => (await tx.query(`SELECT * FROM tax_code ORDER BY code`)).rows));
  app.get('/suppliers', { preHandler: requirePerm('supplier.manage', 'product.view') }, async (req) => withCompany(cx(req), async (tx) => (await tx.query(`SELECT * FROM supplier WHERE is_active ORDER BY name`)).rows));
  app.post('/suppliers', { preHandler: requirePerm('supplier.manage') }, async (req, reply) => {
    const b = z.object({ name: z.string().min(1), tin: z.string().optional().nullable(), email: z.string().email().optional().nullable(), phone: z.string().optional().nullable(), whatsapp: z.string().optional().nullable(), payment_terms_days: z.number().int().default(30), lead_time_days: z.number().int().default(3), min_order_amount: z.number().default(0) }).parse(req.body);
    return withCompany(cx(req), async (tx) => { reply.status(201); return (await tx.query(`INSERT INTO supplier (company_id, name, tin, email, phone, whatsapp, payment_terms_days, lead_time_days, min_order_amount) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [req.ctx.companyId, b.name, b.tin ?? null, b.email ?? null, b.phone ?? null, b.whatsapp ?? null, b.payment_terms_days, b.lead_time_days, b.min_order_amount])).rows[0]; });
  });
  app.put('/suppliers/:id', { preHandler: requirePerm('supplier.manage') }, async (req) => {
    const { id } = req.params as any;
    const b = z.object({ name: z.string().optional(), tin: z.string().optional().nullable(), email: z.string().email().optional().nullable(), phone: z.string().optional().nullable(), whatsapp: z.string().optional().nullable(), payment_terms_days: z.number().int().optional(), lead_time_days: z.number().int().optional(), min_order_amount: z.number().optional(), is_active: z.boolean().optional() }).parse(req.body);
    return withCompany(cx(req), async (tx) => {
      const sets: string[] = []; const params: any[] = [id];
      for (const [k, v] of Object.entries(b)) if (v !== undefined) { params.push(v); sets.push(`${k} = $${params.length}`); }
      if (!sets.length) throw badRequest();
      const r = (await tx.query(`UPDATE supplier SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, params)).rows[0]; if (!r) throw notFound(); return r;
    });
  });

  // ---------- 站点 / 区 / 位置 ----------
  app.get('/sites', async (req) => withCompany(cx(req), async (tx) => (await tx.query(`SELECT * FROM site WHERE is_active ORDER BY code`)).rows));
  app.post('/sites', { preHandler: requirePerm('location.manage') }, async (req, reply) => {
    const b = z.object({ code: z.string().regex(/^[A-Z0-9]{2,10}$/), name: z.string(), type: z.enum(['WAREHOUSE', 'SHOP']), address: z.any().optional() }).parse(req.body);
    return withCompany(cx(req), async (tx) => {
      const s = (await tx.query(`INSERT INTO site (company_id, code, name, type, address) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [req.ctx.companyId, b.code, b.name, b.type, b.address ?? null])).rows[0];
      const z1 = (await tx.query(`INSERT INTO zone (company_id, site_id, code, name_zh, name_ms, name_en, zone_type, color) VALUES ($1,$2,'RCV','收货区','Zon Terima','Receiving','RECEIVING','#9E9E9E') RETURNING id`, [req.ctx.companyId, s.id])).rows[0];
      await tx.query(`INSERT INTO location (company_id, site_id, zone_id, code, rack, level) VALUES ($1,$2,$3,'RCV-01-1',1,1)`, [req.ctx.companyId, s.id, z1.id]);
      reply.status(201); return s;
    });
  });
  app.get('/zones', async (req) => {
    const q = z.object({ site: z.string().uuid().optional() }).parse(req.query);
    return withCompany(cx(req), async (tx) => (await tx.query(
      `SELECT z.*, (SELECT array_agg(category_id) FROM zone_category zc WHERE zc.zone_id = z.id) AS allowed_category_ids,
              (SELECT count(*) FROM location l WHERE l.zone_id = z.id AND l.is_active) AS location_count
       FROM zone z WHERE z.is_active AND ($1::uuid IS NULL OR z.site_id = $1) ORDER BY z.site_id, z.sort_order, z.code`, [q.site ?? req.ctx.siteId ?? null])).rows);
  });
  app.post('/zones', { preHandler: requirePerm('location.manage') }, async (req, reply) => {
    const b = z.object({ site_id: z.string().uuid(), code: z.string().regex(/^[A-Z0-9]{1,3}$/), name_zh: z.string().optional(), name_ms: z.string().optional(), name_en: z.string().optional(), zone_type: z.enum(['RECEIVING', 'STORAGE', 'SHELF', 'BACKROOM']), color: z.string().default('#9E9E9E'), capacity_boxes: z.number().int().optional().nullable(), allowed_is_hard: z.boolean().default(false), allowed_category_ids: z.array(z.string().uuid()).default([]), racks: z.number().int().min(0).max(99).default(0), levels: z.number().int().min(0).max(9).default(0), sort_order: z.number().int().default(0) }).parse(req.body);
    return withCompany(cx(req), async (tx) => {
      const zn = (await tx.query(`INSERT INTO zone (company_id, site_id, code, name_zh, name_ms, name_en, zone_type, color, capacity_boxes, allowed_is_hard, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [req.ctx.companyId, b.site_id, b.code, b.name_zh ?? null, b.name_ms ?? null, b.name_en ?? null, b.zone_type, b.color, b.capacity_boxes ?? null, b.allowed_is_hard, b.sort_order])).rows[0];
      for (const c of b.allowed_category_ids) await tx.query(`INSERT INTO zone_category VALUES ($1,$2)`, [zn.id, c]);
      for (let i = 1; i <= b.racks; i++) for (let j = 1; j <= b.levels; j++) await tx.query(`INSERT INTO location (company_id, site_id, zone_id, code, rack, level) VALUES ($1,$2,$3,$4,$5,$6)`, [req.ctx.companyId, b.site_id, zn.id, `${b.code}-${String(i).padStart(2, '0')}-${j}`, i, j]);
      reply.status(201); return zn;
    });
  });
  app.put('/zones/:id', { preHandler: requirePerm('location.manage') }, async (req) => {
    const { id } = req.params as any;
    const b = z.object({ name_zh: z.string().optional(), name_ms: z.string().optional(), name_en: z.string().optional(), color: z.string().optional(), capacity_boxes: z.number().int().optional().nullable(), allowed_is_hard: z.boolean().optional(), allowed_category_ids: z.array(z.string().uuid()).optional(), racks: z.number().int().min(1).max(99).optional(), levels: z.number().int().min(1).max(9).optional(), is_active: z.boolean().optional() }).parse(req.body);
    return withCompany(cx(req), async (tx) => {
      const zn = (await tx.query(`SELECT * FROM zone WHERE id = $1`, [id])).rows[0]; if (!zn) throw notFound();
      const sets: string[] = []; const params: any[] = [id];
      for (const k of ['name_zh', 'name_ms', 'name_en', 'color', 'capacity_boxes', 'allowed_is_hard', 'is_active']) if ((b as any)[k] !== undefined) { params.push((b as any)[k]); sets.push(`${k} = $${params.length}`); }
      if (sets.length) await tx.query(`UPDATE zone SET ${sets.join(', ')} WHERE id = $1`, params);
      if (b.allowed_category_ids) { await tx.query(`DELETE FROM zone_category WHERE zone_id = $1`, [id]); for (const c of b.allowed_category_ids) await tx.query(`INSERT INTO zone_category VALUES ($1,$2)`, [id, c]); }
      if (b.racks || b.levels) {
        // 重排货位：有库存的货位不能删
        const cur = (await tx.query(`SELECT l.id, l.rack, l.level, coalesce((SELECT sum(qty) FROM stock s WHERE s.location_id = l.id),0) AS qty FROM location l WHERE l.zone_id = $1 AND l.is_active`, [id])).rows;
        const racks = b.racks ?? Math.max(...cur.map((c) => c.rack), 1); const levels = b.levels ?? Math.max(...cur.map((c) => c.level), 1);
        for (const c of cur) if (c.rack > racks || c.level > levels) { if (c.qty !== 0) throw new AppError(400, 'LOCATION_HAS_STOCK', { rack: c.rack, level: c.level }); await tx.query(`UPDATE location SET is_active = false WHERE id = $1`, [c.id]); }
        for (let i = 1; i <= racks; i++) for (let j = 1; j <= levels; j++) if (!cur.some((c) => c.rack === i && c.level === j))
          await tx.query(`INSERT INTO location (company_id, site_id, zone_id, code, rack, level) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (company_id, code) DO UPDATE SET is_active = true`, [req.ctx.companyId, zn.site_id, id, `${zn.code}-${String(i).padStart(2, '0')}-${j}`, i, j]);
      }
      return (await tx.query(`SELECT * FROM zone WHERE id = $1`, [id])).rows[0];
    });
  });
  app.get('/zones/:id/contents', { preHandler: requirePerm('stock.view') }, async (req) => {
    const { id } = req.params as any;
    return withCompany(cx(req), async (tx) => {
      const zn = (await tx.query(`SELECT * FROM zone WHERE id = $1`, [id])).rows[0]; if (!zn) throw notFound();
      const rows = (await tx.query(`SELECT l.code AS location_code, l.id AS location_id, p.id AS product_id, p.sku, p.name_zh, p.name_ms, p.name_en, p.photo_url, p.unit, s.qty, s.earliest_expiry
        FROM stock s JOIN location l ON l.id = s.location_id JOIN product p ON p.id = s.product_id WHERE l.zone_id = $1 AND s.qty <> 0 ORDER BY l.code, p.sku`, [id])).rows;
      const total_qty = rows.reduce((a, r) => a + Number(r.qty), 0);
      const boxes = (await tx.query(`SELECT coalesce(sum(s.qty / coalesce((SELECT max(pack_qty) FROM barcode b WHERE b.product_id = s.product_id AND b.barcode_type='CASE'), 1)),0) AS boxes FROM stock s JOIN location l ON l.id = s.location_id WHERE l.zone_id = $1 AND s.qty > 0`, [id])).rows[0].boxes;
      const capacity = zn.capacity_boxes ?? (await tx.query(`SELECT coalesce(sum(capacity_boxes),0) c FROM location WHERE zone_id = $1`, [id])).rows[0].c;
      return { zone: zn, rows, total_qty, boxes: Number(boxes), capacity_boxes: Number(capacity) || null, fill_pct: capacity ? Math.round((Number(boxes) / Number(capacity)) * 100) : null, earliest_expiry: rows.map((r) => r.earliest_expiry).filter(Boolean).sort()[0] ?? null };
    });
  });
  app.get('/locations', async (req) => {
    const q = z.object({ site: z.string().uuid().optional(), zone: z.string().uuid().optional(), include_virtual: z.string().optional() }).parse(req.query);
    return withCompany(cx(req), async (tx) => (await tx.query(`SELECT l.*, z.code AS zone_code, z.color AS zone_color, z.zone_type, z.allowed_is_hard FROM location l LEFT JOIN zone z ON z.id = l.zone_id
      WHERE l.is_active AND ($1::uuid IS NULL OR l.site_id = $1 OR l.is_virtual) AND ($2::uuid IS NULL OR l.zone_id = $2) AND ($3::boolean OR NOT l.is_virtual) ORDER BY l.is_virtual, l.code`, [q.site ?? req.ctx.siteId ?? null, q.zone ?? null, q.include_virtual === 'true'])).rows);
  });
  app.get('/locations/by-code/:code', async (req) => {
    const code = decodeURIComponent((req.params as any).code).replace(/^LOC:[A-Z0-9]+:/i, '');
    return withCompany(cx(req), async (tx) => {
      const r = (await tx.query(`SELECT l.*, z.code AS zone_code, z.color AS zone_color, z.zone_type, z.allowed_is_hard, z.name_zh AS zone_name_zh, z.name_ms AS zone_name_ms, z.name_en AS zone_name_en,
        (SELECT array_agg(category_id) FROM zone_category zc WHERE zc.zone_id = z.id) AS allowed_category_ids FROM location l LEFT JOIN zone z ON z.id = l.zone_id WHERE l.code = $1`, [code])).rows[0];
      if (!r) throw notFound('LOCATION_NOT_FOUND');
      if (!r.is_active) throw new AppError(400, 'LOCATION_INACTIVE');
      return r;
    });
  });
  app.post('/locations/labels', { preHandler: requirePerm('label.print') }, async (req, reply) => {
    const b = z.object({ zone_id: z.string().uuid().optional(), location_ids: z.array(z.string().uuid()).optional(), size: z.enum(['70x40', '100x50']).default('70x40') }).parse(req.body);
    const pdf = await withCompany(cx(req), async (tx) => {
      const short = (await tx.query(`SELECT short_code FROM company WHERE id = $1`, [req.ctx.companyId])).rows[0].short_code;
      const rows = (await tx.query(`SELECT l.id, l.code, z.code AS zone_code, z.color, z.name_zh, z.name_ms, z.name_en FROM location l JOIN zone z ON z.id = l.zone_id
        WHERE l.is_active AND ($1::uuid IS NULL OR l.zone_id = $1) AND ($2::uuid[] IS NULL OR l.id = ANY($2)) ORDER BY z.sort_order, l.rack, l.level`, [b.zone_id ?? null, b.location_ids ?? null])).rows;
      await tx.query(`UPDATE location SET qr_printed_at = now() WHERE id = ANY($1)`, [rows.map((r) => r.id)]);
      return makeLabelsPdf(rows.map((r) => ({ qr: `LOC:${short}:${r.code}`, code: r.code, color: r.color, names: [r.name_zh, r.name_ms, r.name_en] })), b.size);
    });
    reply.header('Content-Type', 'application/pdf').header('Content-Disposition', 'attachment; filename="labels.pdf"');
    return reply.send(pdf);
  });
  app.post('/users/:id/badge', { preHandler: requirePerm('user.manage') }, async (req, reply) => {
    const { id } = req.params as any;
    const pdf = await withCompany(cx(req), async (tx) => {
      const u = (await tx.query(`SELECT u.name, u.badge_code, c.short_code, (SELECT string_agg(r.name_zh, '/') FROM user_site_role usr JOIN role r ON r.id = usr.role_id WHERE usr.user_id = u.id) AS roles FROM app_user u JOIN company c ON c.id = u.company_id WHERE u.id = $1`, [id])).rows[0];
      if (!u) throw notFound('USER_NOT_FOUND');
      return makeLabelsPdf([{ qr: `USR:${u.short_code}:${u.badge_code}`, code: u.name, color: '#1565C0', names: [u.roles ?? '', '', ''] }], 'badge');
    });
    invalidatePermCache();
    reply.header('Content-Type', 'application/pdf'); return reply.send(pdf);
  });
}
