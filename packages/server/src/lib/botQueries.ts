// 机器人固定只读查询（模块 E）。LLM/规则只能选 code 和填参数，SQL 全在这里，每个查询检查权限（required_permission）和站点（ctx.siteId 为空 = 全公司）。
// 上限 50 行。成本只在 PRODUCT_COST 出现，由 product.view_cost 守着。
import type { Tx } from './db.js';
import type { RequestCtx } from './auth.js';
import { hasPerm } from './auth.js';

export type Lang = 'zh' | 'ms' | 'en';
export const L = (lang: Lang, zh: string, ms: string, en: string) => (lang === 'ms' ? ms : lang === 'en' ? en : zh);
export const nameOf = (lang: Lang, r: any) => (lang === 'ms' ? r.name_ms ?? r.name_zh ?? r.name_en : lang === 'en' ? r.name_en ?? r.name_zh ?? r.name_ms : r.name_zh ?? r.name_en ?? r.name_ms) ?? r.sku ?? '';
const LIMIT = 50;

export interface QueryResult { rows: any[]; text: string; screen_ref?: string }
export interface BotQueryDef { code: string; permission: string | null; params: string[]; run: (tx: Tx, ctx: RequestCtx, params: Record<string, any>, lang: Lang) => Promise<QueryResult> }

const siteCond = (col: string, i: number) => `($${i}::uuid IS NULL OR ${col} = $${i})`;
async function findProducts(tx: Tx, q: string | undefined) {
  if (!q) return [];
  const s = q.trim().toLowerCase();
  if (!s) return [];
  if (/^[0-9]{8,14}$/.test(s)) {
    const byBc = (await tx.query(`SELECT p.* FROM barcode b JOIN product p ON p.id = b.product_id WHERE b.barcode = $1 AND p.is_active`, [s])).rows;
    if (byBc.length) return byBc;
  }
  return (await tx.query(`SELECT * FROM product WHERE is_active AND (search_text ILIKE $1 OR name_zh ILIKE $1 OR name_ms ILIKE $1 OR name_en ILIKE $1 OR sku ILIKE $1) ORDER BY length(coalesce(name_zh, name_en, name_ms)) LIMIT 5`, [`%${s}%`])).rows;
}
const notFound = (lang: Lang, q: string) => ({ rows: [], text: L(lang, `没找到"${q}"这个产品`, `Produk "${q}" tidak dijumpai`, `Product "${q}" not found`) });

export const BOT_QUERIES: Record<string, BotQueryDef> = {
  STOCK_BY_BARCODE: {
    code: 'STOCK_BY_BARCODE', permission: 'stock.view', params: ['barcode_or_name'],
    async run(tx, ctx, p, lang) {
      const q = p.barcode_or_name ?? p.product ?? ''; const ps = await findProducts(tx, q); if (!ps.length) return notFound(lang, q);
      const prod = ps[0];
      const rows = (await tx.query(`SELECT l.code AS location_code, l.site_id, s.qty, s.earliest_expiry, z.zone_type FROM stock s JOIN location l ON l.id = s.location_id LEFT JOIN zone z ON z.id = l.zone_id WHERE s.product_id = $1 AND NOT l.is_virtual AND s.qty <> 0 AND ${siteCond('l.site_id', 2)} ORDER BY s.qty DESC LIMIT ${LIMIT}`, [prod.id, ctx.siteId])).rows;
      const total = rows.reduce((a, r) => a + Number(r.qty), 0);
      const text = rows.length ? L(lang, `${nameOf(lang, prod)} 共 ${total}：${rows.map((r) => `${r.location_code} ${Number(r.qty)}`).join('、')}`, `${nameOf(lang, prod)} jumlah ${total}: ${rows.map((r) => `${r.location_code} ${Number(r.qty)}`).join(', ')}`, `${nameOf(lang, prod)} total ${total}: ${rows.map((r) => `${r.location_code} ${Number(r.qty)}`).join(', ')}`) : L(lang, `${nameOf(lang, prod)} 现在没有库存`, `${nameOf(lang, prod)} tiada stok`, `${nameOf(lang, prod)} has no stock`);
      return { rows, text, screen_ref: 'C4' };
    },
  },
  PRODUCT_LOCATION_SHOP: {
    code: 'PRODUCT_LOCATION_SHOP', permission: null, params: ['product'],
    async run(tx, ctx, p, lang) {
      const q = p.product ?? ''; const ps = await findProducts(tx, q); if (!ps.length) return notFound(lang, q);
      const prod = ps[0];
      const rows = (await tx.query(`SELECT l.code AS location_code, sa.is_primary, z.code AS zone_code, st.name AS site_name, sa.site_id, sa.location_id FROM shelf_assignment sa JOIN location l ON l.id = sa.location_id JOIN zone z ON z.id = l.zone_id JOIN site st ON st.id = sa.site_id WHERE sa.is_active AND sa.product_id = $1 AND z.zone_type = 'SHELF' AND ${siteCond('sa.site_id', 2)} ORDER BY sa.is_primary DESC, l.code LIMIT ${LIMIT}`, [prod.id, ctx.siteId])).rows;
      if (!rows.length) return { rows, text: L(lang, `${nameOf(lang, prod)} 还没登记货架位置`, `${nameOf(lang, prod)} belum didaftar lokasi rak`, `${nameOf(lang, prod)} has no shelf location yet`), screen_ref: 'S3' };
      const text = L(lang, `${nameOf(lang, prod)} 在 ${rows.map((r) => r.location_code + (r.is_primary ? '（主）' : '')).join('、')}`, `${nameOf(lang, prod)} di ${rows.map((r) => r.location_code + (r.is_primary ? ' (utama)' : '')).join(', ')}`, `${nameOf(lang, prod)} is at ${rows.map((r) => r.location_code + (r.is_primary ? ' (primary)' : '')).join(', ')}`);
      return { rows, text, screen_ref: 'C4' };
    },
  },
  ZONE_CONTENTS: {
    code: 'ZONE_CONTENTS', permission: 'stock.view', params: ['zone_code'],
    async run(tx, ctx, p, lang) {
      const code = String(p.zone_code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const zone = (await tx.query(`SELECT * FROM zone WHERE upper(code) = $1 AND ${siteCond('site_id', 2)} LIMIT 1`, [code, ctx.siteId])).rows[0];
      if (!zone) return { rows: [], text: L(lang, `没有 ${code} 区`, `Tiada zon ${code}`, `No zone ${code}`) };
      const rows = (await tx.query(`SELECT p.id, p.name_zh, p.name_ms, p.name_en, p.sku, sum(s.qty) AS qty FROM stock s JOIN location l ON l.id = s.location_id JOIN product p ON p.id = s.product_id WHERE l.zone_id = $1 AND s.qty <> 0 GROUP BY p.id ORDER BY sum(s.qty) DESC LIMIT ${LIMIT}`, [zone.id])).rows;
      return { rows, text: L(lang, `${code} 区有 ${rows.length} 种：${rows.slice(0, 10).map((r) => `${nameOf(lang, r)} ${Number(r.qty)}`).join('、')}`, `Zon ${code} ada ${rows.length} produk: ${rows.slice(0, 10).map((r) => `${nameOf(lang, r)} ${Number(r.qty)}`).join(', ')}`, `Zone ${code} has ${rows.length} products: ${rows.slice(0, 10).map((r) => `${nameOf(lang, r)} ${Number(r.qty)}`).join(', ')}`), screen_ref: 'W' };
    },
  },
  LOW_STOCK: {
    code: 'LOW_STOCK', permission: 'order.view', params: [],
    async run(tx, ctx, _p, lang) {
      // 货架低于最低量（同 /stock/shelf-low 的规则：主货架数量 < max(min_level/4, 1)）+ 总量低于 min_level
      const rows = (await tx.query(
        `SELECT p.id, p.name_zh, p.name_ms, p.name_en, p.sku, l.code AS shelf_code, coalesce(st.qty,0) AS shelf_qty, greatest(p.min_level / 4, 1) AS shelf_min,
           (SELECT coalesce(sum(s2.qty),0) FROM stock s2 JOIN location l2 ON l2.id = s2.location_id WHERE s2.product_id = p.id AND NOT l2.is_virtual AND ${siteCond('l2.site_id', 1)}) AS total_qty, p.min_level
         FROM shelf_assignment sa JOIN product p ON p.id = sa.product_id JOIN location l ON l.id = sa.location_id LEFT JOIN stock st ON st.product_id = p.id AND st.location_id = l.id
         WHERE sa.is_active AND sa.is_primary AND p.is_active AND ${siteCond('sa.site_id', 1)} AND coalesce(st.qty,0) < greatest(p.min_level / 4, 1)
         UNION ALL
         SELECT p.id, p.name_zh, p.name_ms, p.name_en, p.sku, NULL, NULL, NULL, coalesce((SELECT sum(s.qty) FROM stock s JOIN location l ON l.id = s.location_id WHERE s.product_id = p.id AND NOT l.is_virtual AND ${siteCond('l.site_id', 1)}),0), p.min_level
         FROM product p WHERE p.is_active AND coalesce((SELECT sum(s.qty) FROM stock s JOIN location l ON l.id = s.location_id WHERE s.product_id = p.id AND NOT l.is_virtual AND ${siteCond('l.site_id', 1)}),0) < p.min_level
           AND NOT EXISTS (SELECT 1 FROM shelf_assignment sa WHERE sa.product_id = p.id AND sa.is_active AND sa.is_primary AND ${siteCond('sa.site_id', 1)})
         LIMIT ${LIMIT}`, [ctx.siteId])).rows;
      if (!rows.length) return { rows, text: L(lang, '今天不用补货', 'Tiada yang perlu diisi hari ini', 'Nothing to refill today'), screen_ref: 'S1' };
      return { rows, text: L(lang, `要补 ${rows.length} 项：${rows.slice(0, 10).map((r) => `${nameOf(lang, r)}${r.shelf_code ? `（${r.shelf_code} 剩 ${Number(r.shelf_qty)}）` : `（总量 ${Number(r.total_qty)} < ${Number(r.min_level)}）`}`).join('、')}`, `${rows.length} perlu diisi: ${rows.slice(0, 10).map((r) => `${nameOf(lang, r)}${r.shelf_code ? ` (${r.shelf_code} baki ${Number(r.shelf_qty)})` : ''}`).join(', ')}`, `${rows.length} to refill: ${rows.slice(0, 10).map((r) => `${nameOf(lang, r)}${r.shelf_code ? ` (${r.shelf_code} has ${Number(r.shelf_qty)})` : ''}`).join(', ')}`), screen_ref: 'S1' };
    },
  },
  EXPIRING: {
    code: 'EXPIRING', permission: 'stock.view', params: ['days'],
    async run(tx, ctx, p, lang) {
      const days = Math.min(Math.max(Number(p.days) || 7, 1), 365);
      const rows = (await tx.query(`SELECT p.id, p.name_zh, p.name_ms, p.name_en, p.sku, l.code AS location_code, s.qty, s.earliest_expiry FROM stock s JOIN product p ON p.id = s.product_id JOIN location l ON l.id = s.location_id WHERE s.qty > 0 AND s.earliest_expiry IS NOT NULL AND s.earliest_expiry <= current_date + $1::int AND ${siteCond('l.site_id', 2)} ORDER BY s.earliest_expiry LIMIT ${LIMIT}`, [days, ctx.siteId])).rows;
      if (!rows.length) return { rows, text: L(lang, `${days} 天内没有到期的`, `Tiada yang luput dalam ${days} hari`, `Nothing expiring within ${days} days`) };
      return { rows, text: L(lang, `${days} 天内到期 ${rows.length} 项：${rows.slice(0, 10).map((r) => `${nameOf(lang, r)} ${r.location_code} ${String(r.earliest_expiry).slice(0, 10)}`).join('、')}`, `${rows.length} luput dalam ${days} hari: ${rows.slice(0, 10).map((r) => `${nameOf(lang, r)} ${r.location_code} ${String(r.earliest_expiry).slice(0, 10)}`).join(', ')}`, `${rows.length} expiring within ${days} days: ${rows.slice(0, 10).map((r) => `${nameOf(lang, r)} ${r.location_code} ${String(r.earliest_expiry).slice(0, 10)}`).join(', ')}`), screen_ref: 'C4' };
    },
  },
  TODAY_SALES: {
    code: 'TODAY_SALES', permission: 'report.sales', params: [],
    async run(tx, ctx, _p, lang) {
      const r = (await tx.query(`SELECT count(*)::int AS receipts, coalesce(sum(total),0) AS total FROM sale WHERE status = 'COMPLETED' AND sale_type <> 'RETURN' AND created_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Kuala_Lumpur') AT TIME ZONE 'Asia/Kuala_Lumpur' AND ${siteCond('site_id', 1)}`, [ctx.siteId])).rows[0];
      const mv = (await tx.query(`SELECT coalesce(sum(m.qty),0) AS qty FROM movement m JOIN location l ON l.id = m.from_location_id WHERE m.reason = 'SALE' AND m.performed_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Kuala_Lumpur') AT TIME ZONE 'Asia/Kuala_Lumpur' AND ${siteCond('l.site_id', 1)}`, [ctx.siteId])).rows[0];
      const rows = [{ receipts: r.receipts, total: Number(r.total), units: Number(mv.qty) }];
      return { rows, text: L(lang, `今天 ${r.receipts} 单，RM ${Number(r.total).toFixed(2)}，${Number(mv.qty)} 件`, `Hari ini ${r.receipts} resit, RM ${Number(r.total).toFixed(2)}, ${Number(mv.qty)} unit`, `Today ${r.receipts} receipts, RM ${Number(r.total).toFixed(2)}, ${Number(mv.qty)} units`), screen_ref: 'G' };
    },
  },
  PRODUCT_SALES_30D: {
    code: 'PRODUCT_SALES_30D', permission: 'report.sales', params: ['product'],
    async run(tx, ctx, p, lang) {
      const q = p.product ?? ''; const ps = await findProducts(tx, q); if (!ps.length) return notFound(lang, q);
      const prod = ps[0];
      const r = (await tx.query(`SELECT coalesce(sum(m.qty),0) AS qty FROM movement m JOIN location l ON l.id = m.from_location_id WHERE m.reason = 'SALE' AND m.product_id = $1 AND m.performed_at > now() - interval '30 days' AND ${siteCond('l.site_id', 2)}`, [prod.id, ctx.siteId])).rows[0];
      return { rows: [{ product_id: prod.id, qty: Number(r.qty) }], text: L(lang, `${nameOf(lang, prod)} 最近 30 天卖了 ${Number(r.qty)} 件`, `${nameOf(lang, prod)} 30 hari jual ${Number(r.qty)} unit`, `${nameOf(lang, prod)} sold ${Number(r.qty)} units in 30 days`), screen_ref: 'G' };
    },
  },
  MY_TICKETS: {
    code: 'MY_TICKETS', permission: null, params: [],
    async run(tx, ctx, _p, lang) {
      const rows = (await tx.query(`SELECT id, ticket_no, type, title, status, deadline_at FROM ticket WHERE status NOT IN ('RESOLVED','CLOSED') AND (owner_id = $1 OR (owner_id IS NULL AND owner_role_code = ANY($2))) ORDER BY deadline_at LIMIT ${LIMIT}`, [ctx.userId, ctx.roles])).rows;
      if (!rows.length) return { rows, text: L(lang, '你没有待处理的工单', 'Anda tiada tiket tertunggak', 'You have no open tickets'), screen_ref: 'C6' };
      return { rows, text: L(lang, `你有 ${rows.length} 张工单：${rows.slice(0, 10).map((r) => `#${r.ticket_no} ${r.title}`).join('、')}`, `Anda ada ${rows.length} tiket: ${rows.slice(0, 10).map((r) => `#${r.ticket_no} ${r.title}`).join(', ')}`, `You have ${rows.length} tickets: ${rows.slice(0, 10).map((r) => `#${r.ticket_no} ${r.title}`).join(', ')}`), screen_ref: 'C6' };
    },
  },
  PENDING_APPROVALS: {
    code: 'PENDING_APPROVALS', permission: null, params: [],
    async run(tx, ctx, _p, lang) {
      const rows = (await tx.query(`SELECT a.id, a.type, a.summary, a.amount, a.created_at, u.name AS requested_by_name FROM approval_request a JOIN app_user u ON u.id = a.requested_by WHERE a.status = 'PENDING' AND (a.approver_role_code = ANY($1) OR a.approver_id = $2) ORDER BY a.created_at LIMIT ${LIMIT}`, [ctx.roles, ctx.userId])).rows;
      if (!rows.length) return { rows, text: L(lang, '没有等你批的', 'Tiada yang menunggu kelulusan anda', 'Nothing awaiting your approval'), screen_ref: 'C7' };
      return { rows, text: L(lang, `${rows.length} 项等你批：${rows.slice(0, 10).map((r) => `${r.type} ${r.requested_by_name}${r.amount != null ? ` RM ${Number(r.amount).toFixed(2)}` : ''}`).join('、')}`, `${rows.length} menunggu kelulusan: ${rows.slice(0, 10).map((r) => `${r.type} ${r.requested_by_name}`).join(', ')}`, `${rows.length} awaiting approval: ${rows.slice(0, 10).map((r) => `${r.type} ${r.requested_by_name}`).join(', ')}`), screen_ref: 'C7' };
    },
  },
  PO_STATUS: {
    code: 'PO_STATUS', permission: 'po.view', params: ['supplier_or_product'],
    async run(tx, ctx, p, lang) {
      const q = String(p.supplier_or_product ?? '').trim();
      const rows = (await tx.query(
        `SELECT DISTINCT po.id, po.po_no, po.status, po.expected_date, s.name AS supplier_name FROM purchase_order po JOIN supplier s ON s.id = po.supplier_id LEFT JOIN purchase_order_line pl ON pl.po_id = po.id LEFT JOIN product pr ON pr.id = pl.product_id
         WHERE po.status IN ('SENT','PARTIAL','PENDING_APPROVAL') AND ${siteCond('po.deliver_to_site_id', 2)} AND ($1 = '' OR s.name ILIKE '%' || $1 || '%' OR pr.search_text ILIKE '%' || $1 || '%' OR pr.name_zh ILIKE '%' || $1 || '%' OR po.po_no ILIKE '%' || $1 || '%')
         ORDER BY po.expected_date NULLS LAST LIMIT ${LIMIT}`, [q.toLowerCase(), ctx.siteId])).rows;
      if (!rows.length) return { rows, text: L(lang, '没有在途的采购单', 'Tiada PO dalam perjalanan', 'No open purchase orders'), screen_ref: 'G' };
      return { rows, text: L(lang, `${rows.length} 张在途：${rows.slice(0, 10).map((r) => `${r.po_no} ${r.supplier_name} ${r.status}${r.expected_date ? ` 预计 ${String(r.expected_date).slice(0, 10)}` : ''}`).join('、')}`, `${rows.length} PO: ${rows.slice(0, 10).map((r) => `${r.po_no} ${r.supplier_name} ${r.status}`).join(', ')}`, `${rows.length} open POs: ${rows.slice(0, 10).map((r) => `${r.po_no} ${r.supplier_name} ${r.status}${r.expected_date ? ` ETA ${String(r.expected_date).slice(0, 10)}` : ''}`).join(', ')}`), screen_ref: 'G' };
    },
  },
  TRANSFER_STATUS: {
    code: 'TRANSFER_STATUS', permission: 'transfer.view', params: [],
    async run(tx, ctx, _p, lang) {
      const rows = (await tx.query(`SELECT t.id, t.transfer_no, t.status, t.required_at, f.name AS from_site, s.name AS to_site FROM transfer t JOIN site f ON f.id = t.from_site_id JOIN site s ON s.id = t.to_site_id WHERE t.status NOT IN ('CLOSED','REJECTED','CANCELLED','RECEIVED') AND ($1::uuid IS NULL OR t.from_site_id = $1 OR t.to_site_id = $1) ORDER BY t.created_at DESC LIMIT ${LIMIT}`, [ctx.siteId])).rows;
      if (!rows.length) return { rows, text: L(lang, '没有在途的调拨', 'Tiada pindahan dalam perjalanan', 'No open transfers'), screen_ref: 'K' };
      return { rows, text: L(lang, `${rows.length} 张调拨：${rows.slice(0, 10).map((r) => `${r.transfer_no} ${r.from_site}→${r.to_site} ${r.status}`).join('、')}`, `${rows.length} pindahan: ${rows.slice(0, 10).map((r) => `${r.transfer_no} ${r.from_site}→${r.to_site} ${r.status}`).join(', ')}`, `${rows.length} transfers: ${rows.slice(0, 10).map((r) => `${r.transfer_no} ${r.from_site}→${r.to_site} ${r.status}`).join(', ')}`), screen_ref: 'K' };
    },
  },
  PRODUCT_COST: {
    code: 'PRODUCT_COST', permission: 'product.view_cost', params: ['product'],
    async run(tx, _ctx, p, lang) {
      const q = p.product ?? ''; const ps = await findProducts(tx, q); if (!ps.length) return notFound(lang, q);
      const prod = ps[0];
      return { rows: [{ product_id: prod.id, cost_price: Number(prod.cost_price), sell_price: Number(prod.sell_price) }], text: L(lang, `${nameOf(lang, prod)} 成本 RM ${Number(prod.cost_price).toFixed(2)}，售价 RM ${Number(prod.sell_price).toFixed(2)}`, `${nameOf(lang, prod)} kos RM ${Number(prod.cost_price).toFixed(2)}, harga RM ${Number(prod.sell_price).toFixed(2)}`, `${nameOf(lang, prod)} cost RM ${Number(prod.cost_price).toFixed(2)}, price RM ${Number(prod.sell_price).toFixed(2)}`), screen_ref: 'G2' };
    },
  },
  DEVICE_STATUS: {
    code: 'DEVICE_STATUS', permission: 'device.view', params: [],
    async run(tx, ctx, _p, lang) {
      const rows = (await tx.query(`SELECT id, name, type, status, last_seen_at FROM device WHERE (status = 'OFFLINE' OR (status = 'ACTIVE' AND last_seen_at < now() - interval '10 minutes')) AND ${siteCond('site_id', 1)} ORDER BY last_seen_at LIMIT ${LIMIT}`, [ctx.siteId])).rows;
      if (!rows.length) return { rows, text: L(lang, '设备都在线', 'Semua peranti dalam talian', 'All devices online'), screen_ref: 'G' };
      return { rows, text: L(lang, `${rows.length} 台掉线：${rows.map((r) => `${r.name}（${r.type}）`).join('、')}`, `${rows.length} peranti luar talian: ${rows.map((r) => r.name).join(', ')}`, `${rows.length} devices offline: ${rows.map((r) => r.name).join(', ')}`), screen_ref: 'G' };
    },
  },
};

export function canRunQuery(ctx: RequestCtx, code: string) { const q = BOT_QUERIES[code]; if (!q) return false; return !q.permission || hasPerm(ctx, q.permission); }
export async function runQuery(tx: Tx, ctx: RequestCtx, code: string, params: Record<string, any>, lang: Lang): Promise<QueryResult> {
  const q = BOT_QUERIES[code]; if (!q) throw new Error('unknown query ' + code);
  const r = await q.run(tx, ctx, params ?? {}, lang);
  return { ...r, rows: r.rows.slice(0, LIMIT) };
}
