// 店地图（模块 E，G6）：草稿/发布版本、元素、A* 路线；促销 CRUD。
// 约定：每站点同时最多一个 DRAFT（PUT 时有草稿就改草稿，否则新建 version = max+1）；publish 把该草稿置 PUBLISHED，旧的发布版保留历史。
// 可走格子：元素 RACK/WALL/COUNTER/KIOSK 占格不可走，其余（ZONE/AISLE/ENTRANCE/LABEL）可走；walkable_grid 若非空则以它为准（1 可走）。
// 路线：起点大屏格，终点 = 目标货架元素周围任一可走格（目标元素按 location_id → zone_id+rack → zone_id 匹配）。
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withCompany, type Tx } from '../lib/db.js';
import { requireAuth, requirePerm } from '../lib/auth.js';
import { AppError, notFound } from '../lib/errors.js';
import { publishKioskEvent } from '../lib/kioskEvents.js';

export interface MapElement { id?: string; kind: string; zone_id?: string | null; location_id?: string | null; rack?: number | null; x: number; y: number; w: number; h: number; rotation?: number; label?: string | null; color?: string | null }
export interface MapLayout { id: string; site_id: string; version: number; width: number; height: number; kiosk_x: number; kiosk_y: number; entrance_x: number | null; entrance_y: number | null; walkable_grid: number[][] | null; status: string; published_at: string | null; elements: MapElement[] }
const BLOCKING = new Set(['RACK', 'WALL', 'COUNTER', 'KIOSK']);

export async function loadMap(tx: Tx, siteId: string, opts: { published?: boolean } = {}): Promise<MapLayout | null> {
  const l = (await tx.query(`SELECT * FROM map_layout WHERE site_id = $1 AND ($2::boolean IS NOT TRUE OR status = 'PUBLISHED') ORDER BY (status = 'DRAFT') DESC, version DESC LIMIT 1`, [siteId, opts.published === true])).rows[0];
  if (!l) return null;
  const elements = (await tx.query(`SELECT e.id, e.kind, e.zone_id, e.location_id, e.rack, e.x, e.y, e.w, e.h, e.rotation, e.label, e.color, l.code AS location_code, z.code AS zone_code FROM map_element e LEFT JOIN location l ON l.id = e.location_id LEFT JOIN zone z ON z.id = e.zone_id WHERE e.map_layout_id = $1 ORDER BY e.y, e.x`, [l.id])).rows;
  return { ...l, elements };
}

export function buildGrid(m: MapLayout): boolean[][] {
  const g: boolean[][] = Array.from({ length: m.height }, () => Array(m.width).fill(true));
  if (m.walkable_grid && m.walkable_grid.length) { for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) g[y][x] = (m.walkable_grid[y]?.[x] ?? 1) !== 0; }
  for (const e of m.elements) { if (!BLOCKING.has(e.kind)) continue; for (let y = e.y; y < e.y + e.h; y++) for (let x = e.x; x < e.x + e.w; x++) if (y >= 0 && y < m.height && x >= 0 && x < m.width) g[y][x] = false; }
  return g;
}

/** A*：从 (sx,sy) 到目标元素四周最近的可走格。返回格子坐标序列（含起点）。 */
export function computeRoute(m: MapLayout, target: MapElement, from?: { x: number; y: number }) {
  const grid = buildGrid(m); const W = m.width, H = m.height;
  const start = from ?? { x: m.kiosk_x, y: m.kiosk_y };
  const goals = new Set<string>();
  for (let y = target.y - 1; y <= target.y + target.h; y++) for (let x = target.x - 1; x <= target.x + target.w; x++) {
    const inside = x >= target.x && x < target.x + target.w && y >= target.y && y < target.y + target.h;
    if (inside || x < 0 || y < 0 || x >= W || y >= H || !grid[y][x]) continue; goals.add(`${x},${y}`);
  }
  if (!goals.size) return { found: false, path: [start] as { x: number; y: number }[] };
  const tc = { x: target.x + target.w / 2, y: target.y + target.h / 2 };
  const h = (x: number, y: number) => Math.abs(x - tc.x) + Math.abs(y - tc.y);
  const key = (x: number, y: number) => y * W + x;
  const gScore = new Map<number, number>(); const prev = new Map<number, number>(); const open: { k: number; f: number }[] = [];
  const sk = key(start.x, start.y); gScore.set(sk, 0); open.push({ k: sk, f: h(start.x, start.y) });
  const closed = new Set<number>(); let endK = -1;
  while (open.length) {
    open.sort((a, b) => a.f - b.f); const cur = open.shift()!; if (closed.has(cur.k)) continue; closed.add(cur.k);
    const cx = cur.k % W, cy = Math.floor(cur.k / W);
    if (goals.has(`${cx},${cy}`)) { endK = cur.k; break; }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H || !grid[ny][nx]) continue;
      const nk = key(nx, ny); const g = (gScore.get(cur.k) ?? 0) + 1;
      if (g < (gScore.get(nk) ?? Infinity)) { gScore.set(nk, g); prev.set(nk, cur.k); open.push({ k: nk, f: g + h(nx, ny) }); }
    }
  }
  if (endK < 0) return { found: false, path: [start] };
  const path: { x: number; y: number }[] = []; let k = endK;
  while (k !== undefined) { path.unshift({ x: k % W, y: Math.floor(k / W) }); if (k === sk) break; k = prev.get(k)!; }
  return { found: true, path };
}

export async function findTargetElement(tx: Tx, m: MapLayout, locationId: string) {
  const loc = (await tx.query(`SELECT id, zone_id, rack, code FROM location WHERE id = $1`, [locationId])).rows[0]; if (!loc) throw notFound('LOCATION_NOT_FOUND');
  return m.elements.find((e) => e.location_id === locationId) ?? m.elements.find((e) => e.kind === 'RACK' && e.zone_id === loc.zone_id && e.rack != null && Number(e.rack) === Number(loc.rack)) ?? m.elements.find((e) => e.zone_id === loc.zone_id && (e.kind === 'RACK' || e.kind === 'ZONE')) ?? null;
}
export async function routeTo(tx: Tx, m: MapLayout, locationId: string) {
  const target = await findTargetElement(tx, m, locationId);
  if (!target) return { found: false, path: [{ x: m.kiosk_x, y: m.kiosk_y }], target: null };
  return { ...computeRoute(m, target), target: { x: target.x, y: target.y, w: target.w, h: target.h, kind: target.kind, label: target.label } };
}

const elementSchema = z.object({ id: z.string().uuid().optional(), kind: z.enum(['ZONE', 'RACK', 'AISLE', 'ENTRANCE', 'KIOSK', 'COUNTER', 'WALL', 'LABEL']), zone_id: z.string().uuid().nullable().optional(), location_id: z.string().uuid().nullable().optional(), rack: z.number().int().nullable().optional(), x: z.number().int().min(0), y: z.number().int().min(0), w: z.number().int().min(1).default(1), h: z.number().int().min(1).default(1), rotation: z.number().int().default(0), label: z.string().max(40).nullable().optional(), color: z.string().max(9).nullable().optional() });

export async function mapRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);
  const cx = (req: any) => ({ companyId: req.ctx.companyId, userId: req.ctx.userId, deviceId: req.ctx.deviceId });

  app.get('/sites/:id/map', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params); const q = z.object({ published: z.string().optional() }).parse(req.query);
    return withCompany(cx(req), async (tx) => (await loadMap(tx, id, { published: q.published === 'true' })) ?? { site_id: id, version: 0, width: 40, height: 30, kiosk_x: 0, kiosk_y: 0, entrance_x: null, entrance_y: null, status: 'NONE', elements: [] });
  });
  app.put('/sites/:id/map', { preHandler: requirePerm('map.edit') }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const b = z.object({ width: z.number().int().min(5).max(200).default(40), height: z.number().int().min(5).max(200).default(30), kiosk: z.object({ x: z.number().int(), y: z.number().int() }).default({ x: 0, y: 0 }), entrance: z.object({ x: z.number().int(), y: z.number().int() }).nullable().optional(), walkable_grid: z.array(z.array(z.number())).nullable().optional(), elements: z.array(elementSchema).max(2000).default([]) }).parse(req.body);
    return withCompany(cx(req), async (tx) => {
      const site = (await tx.query(`SELECT id FROM site WHERE id = $1`, [id])).rows[0]; if (!site) throw notFound();
      let draft = (await tx.query(`SELECT * FROM map_layout WHERE site_id = $1 AND status = 'DRAFT' ORDER BY version DESC LIMIT 1`, [id])).rows[0];
      if (draft) {
        draft = (await tx.query(`UPDATE map_layout SET width = $2, height = $3, kiosk_x = $4, kiosk_y = $5, entrance_x = $6, entrance_y = $7, walkable_grid = $8 WHERE id = $1 RETURNING *`, [draft.id, b.width, b.height, b.kiosk.x, b.kiosk.y, b.entrance?.x ?? null, b.entrance?.y ?? null, b.walkable_grid ? JSON.stringify(b.walkable_grid) : null])).rows[0];
        await tx.query(`DELETE FROM map_element WHERE map_layout_id = $1`, [draft.id]);
      } else {
        const v = (await tx.query(`SELECT coalesce(max(version),0) + 1 AS v FROM map_layout WHERE site_id = $1`, [id])).rows[0].v;
        draft = (await tx.query(`INSERT INTO map_layout (company_id, site_id, version, width, height, kiosk_x, kiosk_y, entrance_x, entrance_y, walkable_grid, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'DRAFT') RETURNING *`, [req.ctx.companyId, id, v, b.width, b.height, b.kiosk.x, b.kiosk.y, b.entrance?.x ?? null, b.entrance?.y ?? null, b.walkable_grid ? JSON.stringify(b.walkable_grid) : null])).rows[0];
      }
      for (const e of b.elements) await tx.query(`INSERT INTO map_element (company_id, map_layout_id, kind, zone_id, location_id, rack, x, y, w, h, rotation, label, color) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [req.ctx.companyId, draft.id, e.kind, e.zone_id ?? null, e.location_id ?? null, e.rack ?? null, e.x, e.y, e.w, e.h, e.rotation ?? 0, e.label ?? null, e.color ?? null]);
      return loadMap(tx, id);
    });
  });
  app.post('/sites/:id/map/publish', { preHandler: requirePerm('map.edit') }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const m = await withCompany(cx(req), async (tx) => {
      const draft = (await tx.query(`SELECT * FROM map_layout WHERE site_id = $1 AND status = 'DRAFT' ORDER BY version DESC LIMIT 1`, [id])).rows[0];
      if (!draft) { const cur = await loadMap(tx, id, { published: true }); if (!cur) throw new AppError(400, 'VALIDATION', 'no draft to publish'); return cur; }
      await tx.query(`UPDATE map_layout SET status = 'PUBLISHED', published_at = now() WHERE id = $1`, [draft.id]);
      return (await loadMap(tx, id, { published: true }))!;
    });
    void publishKioskEvent({ event: 'map.published', company_id: req.ctx.companyId, site_id: id, version: m.version });
    return m;
  });
  app.get('/sites/:id/map/route', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params); const q = z.object({ to: z.string().uuid(), published: z.string().optional() }).parse(req.query);
    return withCompany(cx(req), async (tx) => { const m = await loadMap(tx, id, { published: q.published === 'true' }); if (!m) throw notFound(); return routeTo(tx, m, q.to); });
  });

  // ---------- 促销（大屏待机轮播） ----------
  const promoSchema = z.object({ site_id: z.string().uuid().nullable().optional(), product_id: z.string().uuid().nullable().optional(), title_zh: z.string().max(60).nullable().optional(), title_ms: z.string().max(60).nullable().optional(), title_en: z.string().max(60).nullable().optional(), promo_price: z.number().nonnegative().nullable().optional(), image_url: z.string().max(500).nullable().optional(), starts_on: z.string().optional(), ends_on: z.string().nullable().optional(), sort_order: z.number().int().default(0), is_active: z.boolean().default(true) });
  app.get('/promotions', async (req) => {
    const q = z.object({ site: z.string().uuid().optional(), all: z.string().optional() }).parse(req.query);
    return withCompany(cx(req), async (tx) => (await tx.query(`SELECT pr.*, p.name_zh AS product_name_zh, p.name_ms AS product_name_ms, p.name_en AS product_name_en, p.photo_url AS product_photo_url, p.sell_price FROM promotion pr LEFT JOIN product p ON p.id = pr.product_id WHERE ($1::uuid IS NULL OR pr.site_id IS NULL OR pr.site_id = $1) AND ($2::boolean OR (pr.is_active AND pr.starts_on <= current_date AND (pr.ends_on IS NULL OR pr.ends_on >= current_date))) ORDER BY pr.sort_order, pr.created_at DESC`, [q.site ?? null, q.all === 'true'])).rows);
  });
  app.post('/promotions', { preHandler: requirePerm('map.edit', 'price.edit') }, async (req, reply) => {
    const b = promoSchema.parse(req.body);
    return withCompany(cx(req), async (tx) => { reply.status(201); return (await tx.query(`INSERT INTO promotion (company_id, site_id, product_id, title_zh, title_ms, title_en, promo_price, image_url, starts_on, ends_on, sort_order, is_active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9::date, current_date),$10,$11,$12) RETURNING *`, [req.ctx.companyId, b.site_id ?? null, b.product_id ?? null, b.title_zh ?? null, b.title_ms ?? null, b.title_en ?? null, b.promo_price ?? null, b.image_url ?? null, b.starts_on ?? null, b.ends_on ?? null, b.sort_order, b.is_active])).rows[0]; });
  });
  app.put('/promotions/:id', { preHandler: requirePerm('map.edit', 'price.edit') }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params); const b = promoSchema.partial().parse(req.body);
    return withCompany(cx(req), async (tx) => { const r = (await tx.query(`UPDATE promotion SET site_id = CASE WHEN $2::boolean THEN $3::uuid ELSE site_id END, product_id = CASE WHEN $4::boolean THEN $5::uuid ELSE product_id END, title_zh = COALESCE($6, title_zh), title_ms = COALESCE($7, title_ms), title_en = COALESCE($8, title_en), promo_price = CASE WHEN $9::boolean THEN $10 ELSE promo_price END, image_url = COALESCE($11, image_url), starts_on = COALESCE($12::date, starts_on), ends_on = CASE WHEN $13::boolean THEN $14::date ELSE ends_on END, sort_order = COALESCE($15, sort_order), is_active = COALESCE($16, is_active) WHERE id = $1 RETURNING *`, [id, 'site_id' in b, b.site_id ?? null, 'product_id' in b, b.product_id ?? null, b.title_zh ?? null, b.title_ms ?? null, b.title_en ?? null, 'promo_price' in b, b.promo_price ?? null, b.image_url ?? null, b.starts_on ?? null, 'ends_on' in b, b.ends_on ?? null, b.sort_order ?? null, b.is_active ?? null])).rows[0]; if (!r) throw notFound(); return r; });
  });
  app.delete('/promotions/:id', { preHandler: requirePerm('map.edit', 'price.edit') }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return withCompany(cx(req), async (tx) => { await tx.query(`DELETE FROM promotion WHERE id = $1`, [id]); return { ok: true }; });
  });
}
