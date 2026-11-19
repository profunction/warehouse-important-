// 顾客大屏只读接口（模块 E，第十一组）。全部 requireApiKey('KIOSK')，密钥绑站点（api_key.site_id）。
// 注意：KIOSK 密钥访问其他模块的登录接口（如 /products）时，这些接口的 requireAuth 先返回 401（没有 Bearer 令牌），同样被挡；
//   要统一回 403 KIOSK_ONLY 需在 app.ts 根级加 onRequest 钩子（本文件导出 kioskKeyGuard 可直接挂：app.addHook('onRequest', kioskKeyGuard)）。
// 安全：响应模型里没有成本、数量、仓库位置字段——SELECT 只取名字/拼音/照片/售价/类别，位置只给本店 SHELF 区的货架，库存只给 in_stock 布尔。
// KIOSK 密钥访问非 /kiosk 路径由 requireApiKey 的 scope 检查返回 403（KIOSK_ONLY）；登录接口不受影响。
// 功能开关：不检查 feature_flags.kiosk——密钥本身由老板在 /w/integrations 生成，视为开启（避免 e2e 示范公司 A 模式改设定）。
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { withCompany } from '../lib/db.js';
import { requireApiKey, lookupApiKey } from '../lib/apikey.js';
import { AppError, notFound } from '../lib/errors.js';
import { tgSendToUser } from '../lib/telegram.js';
import { sseHandler, startKioskListener, stopKioskListener } from '../lib/kioskEvents.js';
import { deadlineFor } from '../lib/ticketJobs.js';
import { loadMap, routeTo } from './map.js';

/** 根级守卫（可选挂在 app.ts）：带 KIOSK 密钥却访问非 /kiosk 路径 → 403 KIOSK_ONLY */
export async function kioskKeyGuard(req: FastifyRequest) {
  const h = (req.headers['x-api-key'] as string) || (req.headers.authorization?.startsWith('Bearer wh_') ? req.headers.authorization.slice(7) : '');
  if (!h || req.url.includes('/kiosk/') || req.url.includes('/auth/')) return;
  const k = await lookupApiKey(h); if (k?.scope === 'KIOSK') throw new AppError(403, 'KIOSK_ONLY');
}
const PRODUCT_COLS = `p.id, p.sku, p.name_zh, p.name_ms, p.name_en, p.name_pinyin, p.photo_url, p.sell_price, p.category_id, p.unit, p.is_weighed, p.is_active, p.updated_at,
  (SELECT b.barcode FROM barcode b WHERE b.product_id = p.id ORDER BY b.is_primary DESC, b.barcode LIMIT 1) AS barcode`;

export async function kioskRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireApiKey('KIOSK'));
  app.addHook('onClose', async () => { await stopKioskListener(); });
  const cx = (req: any) => ({ companyId: req.apiKey.companyId as string, userId: null, deviceId: null });
  const siteOf = (req: any): string => { const s = req.apiKey.siteId; if (!s) throw new AppError(403, 'FORBIDDEN', 'kiosk key must be bound to a site'); return s; };

  app.get('/kiosk/catalog', async (req) => {
    const q = z.object({ since: z.string().optional(), limit: z.coerce.number().int().min(1).max(5000).default(5000) }).parse(req.query);
    return withCompany(cx(req), async (tx) => {
      const rows = (await tx.query(`SELECT ${PRODUCT_COLS} FROM product p WHERE ($1::timestamptz IS NULL OR p.updated_at > $1) AND ($1::timestamptz IS NOT NULL OR p.is_active) ORDER BY p.updated_at LIMIT $2`, [q.since ?? null, q.limit])).rows;
      return { items: rows, server_time: new Date().toISOString(), has_more: rows.length >= q.limit };
    });
  });
  app.get('/kiosk/search', async (req) => {
    const q = z.object({ q: z.string().min(1).max(60) }).parse(req.query); const s = q.q.trim().toLowerCase();
    return withCompany(cx(req), async (tx) => (await tx.query(`SELECT ${PRODUCT_COLS} FROM product p WHERE p.is_active AND (p.search_text ILIKE $1 OR p.name_zh ILIKE $1 OR p.name_ms ILIKE $1 OR p.name_en ILIKE $1 OR EXISTS (SELECT 1 FROM barcode b WHERE b.product_id = p.id AND b.barcode = $2)) ORDER BY (p.name_zh ILIKE $3 OR p.name_en ILIKE $3 OR p.name_ms ILIKE $3) DESC, length(coalesce(p.name_zh, p.name_en, p.name_ms)) LIMIT 20`, [`%${s}%`, s, `${s}%`])).rows);
  });
  app.get('/kiosk/categories', async (req) => withCompany(cx(req), async (tx) => (await tx.query(`SELECT c.id, c.code, c.name_zh, c.name_ms, c.name_en, c.icon, c.color, c.parent_id, c.sort_order, (SELECT count(*) FROM product p WHERE p.category_id = c.id AND p.is_active)::int AS product_count FROM category c WHERE c.is_active ORDER BY c.sort_order, c.code`)).rows));
  app.get('/kiosk/products/:barcode', async (req) => {
    const { barcode } = z.object({ barcode: z.string().min(1).max(40) }).parse(req.params);
    return withCompany(cx(req), async (tx) => {
      const r = (await tx.query(`SELECT ${PRODUCT_COLS} FROM product p WHERE p.is_active AND (EXISTS (SELECT 1 FROM barcode b WHERE b.product_id = p.id AND b.barcode = $1) OR p.id::text = $1 OR p.plu_code = $1) LIMIT 1`, [barcode])).rows[0];
      if (!r) throw notFound('PRODUCT_NOT_FOUND'); return r;
    });
  });
  /** 本店货架位置 + in_stock 布尔（货架或后仓任一处 >0）+ 主货架。没有数量字段。 */
  app.get('/kiosk/products/:id/where', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params); const site = siteOf(req);
    return withCompany(cx(req), async (tx) => {
      const p = (await tx.query(`SELECT ${PRODUCT_COLS} FROM product p WHERE p.id = $1`, [id])).rows[0]; if (!p) throw notFound('PRODUCT_NOT_FOUND');
      const locations = (await tx.query(`SELECT l.id AS location_id, l.code, l.rack, l.level, z.code AS zone_code, z.color AS zone_color, z.id AS zone_id, sa.is_primary FROM shelf_assignment sa JOIN location l ON l.id = sa.location_id JOIN zone z ON z.id = l.zone_id WHERE sa.is_active AND sa.product_id = $1 AND sa.site_id = $2 AND z.zone_type = 'SHELF' ORDER BY sa.is_primary DESC, l.code`, [id, site])).rows;
      const inStock = (await tx.query(`SELECT EXISTS (SELECT 1 FROM stock s JOIN location l ON l.id = s.location_id WHERE s.product_id = $1 AND l.site_id = $2 AND NOT l.is_virtual AND s.qty > 0) AS v`, [id, site])).rows[0].v as boolean;
      return { product: p, locations, in_stock: inStock, primary_location_id: locations.find((l: any) => l.is_primary)?.location_id ?? locations[0]?.location_id ?? null };
    });
  });
  app.get('/kiosk/map', async (req) => { const site = siteOf(req); return withCompany(cx(req), async (tx) => (await loadMap(tx, site, { published: true })) ?? { site_id: site, version: 0, status: 'NONE', width: 40, height: 30, kiosk_x: 0, kiosk_y: 0, entrance_x: null, entrance_y: null, elements: [] }); });
  app.get('/kiosk/route', async (req) => {
    const q = z.object({ to: z.string().uuid() }).parse(req.query); const site = siteOf(req);
    return withCompany(cx(req), async (tx) => { const m = await loadMap(tx, site, { published: true }); if (!m) return { found: false, path: [], target: null }; return routeTo(tx, m, q.to); });
  });
  app.get('/kiosk/promotions', async (req) => {
    const site = siteOf(req);
    return withCompany(cx(req), async (tx) => (await tx.query(`SELECT pr.id, pr.title_zh, pr.title_ms, pr.title_en, pr.promo_price, pr.image_url, pr.product_id, pr.sort_order, p.name_zh AS product_name_zh, p.name_ms AS product_name_ms, p.name_en AS product_name_en, p.photo_url AS product_photo_url, p.sell_price FROM promotion pr LEFT JOIN product p ON p.id = pr.product_id WHERE pr.is_active AND (pr.site_id IS NULL OR pr.site_id = $1) AND pr.starts_on <= current_date AND (pr.ends_on IS NULL OR pr.ends_on >= current_date) ORDER BY pr.sort_order, pr.created_at DESC LIMIT 30`, [site])).rows);
  });
  /** 叫员工：开 CUSTOMER_HELP 工单给在班上架员（无则收银员、再无则经理；A 模式 库存员→收银员→老板），10 分钟，HIGH。 */
  app.post('/kiosk/help', async (req, reply) => {
    const b = z.object({ client_id: z.string().uuid().optional(), product_id: z.string().uuid().optional(), location_id: z.string().uuid().optional(), note: z.string().max(200).optional() }).parse(req.body ?? {});
    const site = siteOf(req); const key = req.apiKey!;
    const t = await withCompany(cx(req), async (tx) => {
      if (b.client_id) { const dup = (await tx.query(`SELECT id, ticket_no, status, owner_id FROM ticket WHERE id = $1`, [b.client_id])).rows[0]; if (dup) { reply.status(200); return { ...dup, duplicate: true }; } }
      const plan = (await tx.query(`SELECT plan FROM company WHERE id = $1`, [key.companyId])).rows[0]?.plan ?? 'B';
      const order = plan === 'A' ? ['WAREHOUSE', 'CASHIER', 'BOSS'] : ['STOCKER', 'CASHIER', 'MANAGER', 'BOSS'];
      const cands = (await tx.query(`SELECT DISTINCT u.id, r.code FROM app_user u JOIN user_site_role usr ON usr.user_id = u.id JOIN role r ON r.id = usr.role_id WHERE u.is_active AND r.code = ANY($1) AND (usr.site_id IS NULL OR usr.site_id = $2)`, [order, site])).rows;
      let owner: any = null; for (const role of order) { const c = cands.filter((x: any) => x.code === role); if (c.length) { owner = c[Math.floor(Math.random() * c.length)]; break; } }
      const prod = b.product_id ? (await tx.query(`SELECT name_zh, name_ms, name_en FROM product WHERE id = $1`, [b.product_id])).rows[0] : null;
      const loc = b.location_id ? (await tx.query(`SELECT code FROM location WHERE id = $1`, [b.location_id])).rows[0] : null;
      const title = prod ? `顾客找 ${prod.name_zh ?? prod.name_en ?? prod.name_ms}${loc ? ` @ ${loc.code}` : ''}` : `顾客叫员工 @ 大屏 ${key.name}`;
      const t = (await tx.query(`INSERT INTO ticket (id, company_id, site_id, type, title, ref_type, ref_id, owner_id, owner_role_code, priority, deadline_at) VALUES (COALESCE($1::uuid, uuid_v7()),$2,$3,'CUSTOMER_HELP',$4,'kiosk',$5,$6,$7,'HIGH',$8) RETURNING id, ticket_no, status, owner_id, title, deadline_at`, [b.client_id ?? null, key.companyId, site, title, b.product_id ?? null, owner?.id ?? null, owner?.code ?? (plan === 'A' ? 'BOSS' : 'STOCKER'), deadlineFor('CUSTOMER_HELP')])).rows[0];
      await tx.query(`INSERT INTO ticket_event (company_id, ticket_id, user_id, event, text) VALUES ($1,$2,NULL,'CREATED',$3)`, [key.companyId, t.id, [`大屏 ${key.name}`, b.note, loc ? `走道/货架 ${loc.code}` : null].filter(Boolean).join(' · ')]);
      reply.status(201); return { ...t, product: prod, location_code: loc?.code ?? null };
    });
    if (!t.duplicate && t.owner_id) await tgSendToUser(key.companyId, t.owner_id, `<b>顾客呼叫 #${t.ticket_no}</b> ${t.title}`, undefined, 'CUSTOMER_HELP');
    return { ticket_id: t.id, ticket_no: t.ticket_no, status: t.status, deadline_at: t.deadline_at ?? null };
  });
  app.get('/kiosk/help/:ticket_id', async (req) => {
    const { ticket_id } = z.object({ ticket_id: z.string().uuid() }).parse(req.params);
    return withCompany(cx(req), async (tx) => {
      const t = (await tx.query(`SELECT t.id, t.status, t.owner_id, u.name AS owner_name, u.photo_url AS owner_photo_url FROM ticket t LEFT JOIN app_user u ON u.id = t.owner_id WHERE t.id = $1 AND t.type = 'CUSTOMER_HELP'`, [ticket_id])).rows[0]; if (!t) throw notFound();
      const accepted = t.status !== 'NEW';
      return { ticket_id: t.id, status: t.status, accepted, by_name: accepted ? t.owner_name : null, by_photo_url: accepted ? t.owner_photo_url : null };
    });
  });
  app.get('/kiosk/events', sseHandler);
  app.post('/kiosk/heartbeat', async (req) => {
    const b = z.object({ app_version: z.string().optional(), serial: z.string().optional() }).parse(req.body ?? {});
    const key = req.apiKey!; const site = key.siteId;
    void startKioskListener().catch(() => {});
    return withCompany(cx(req), async (tx) => {
      let d = (await tx.query(`SELECT id FROM device WHERE type = 'KIOSK' AND name = $1 AND ($2::uuid IS NULL OR site_id = $2) LIMIT 1`, [key.name, site])).rows[0];
      if (!d) d = (await tx.query(`INSERT INTO device (company_id, site_id, type, name, serial, status, last_seen_at, app_version) VALUES ($1,$2,'KIOSK',$3,$4,'ACTIVE', now(), $5) RETURNING id`, [key.companyId, site, key.name, b.serial ?? null, b.app_version ?? null])).rows[0];
      else await tx.query(`UPDATE device SET last_seen_at = now(), status = CASE WHEN status = 'DISABLED' THEN status ELSE 'ACTIVE' END, app_version = COALESCE($2, app_version) WHERE id = $1`, [d.id, b.app_version ?? null]);
      return { ok: true, device_id: d.id, server_time: new Date().toISOString() };
    });
  });
}
