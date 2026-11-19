// 报表（模块 D）：销售、损耗、周转、库龄、供应商准时率、日报汇总、会计导出。
// 每个报表 `&format=xlsx` 直接回 Excel（exceljs，写 export_log）。成本相关列按 product.view_cost 过滤（列定义带 perm，行用 stripCols）。
// 自定决定：
//  - 销售报表按 sale_line 汇总（COMPLETED；RETURN 为负）。gross = Σqty×unit_price，discount = Σ行折扣，tax = Σ行税，net = Σline_total，cost = Σqty×unit_cost，gross_profit = net − tax − cost。销售单级折扣/取整不在行里，不计。
//  - 损耗：COUNT/ADJUST 移动，到虚拟位置（DAMAGED 等）为损失（正），从虚拟位置回来为盘盈（负）。金额 = qty × coalesce(移动 unit_cost, 产品 cost_price)。
//  - 周转：N 天销量 / 平均库存，平均库存 = (当前 + N 天前)/2，N 天前 = 当前 − 期间净变动。"最差前 10"= 有库存且周转最低的 10 个（worst=true）。
//  - 库龄：按 stock.last_movement_at 距今天数分 0-30/31-60/61-90/90+，金额按 cost_price。
//  - 供应商准时率：PO（非草稿/取消）预计日 vs 首张完成 GRN 的完成日；少货率 = (订购 − GRN 实收)/订购。
//  - 会计导出：科目对照表 settings.accounting_accounts（会计在公司设定填一次），缺省用通用代码。库存金额用当前库存近似月末。
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { withCompany, type Tx } from '../lib/db.js';
import { requireAuth, requirePerm, hasPerm, type RequestCtx } from '../lib/auth.js';
import { AppError } from '../lib/errors.js';
import { config } from '../lib/config.js';
import { signedFileUrl } from './files.js';
import { monthStart, MONTH_RANGE_SQL } from '../lib/myinvois.js';

const cx = (req: any) => ({ companyId: req.ctx.companyId, userId: req.ctx.userId, deviceId: req.ctx.deviceId });
const KL = `'Asia/Kuala_Lumpur'`;
const r2 = (v: any) => Math.round((Number(v ?? 0) + Number.EPSILON) * 100) / 100;
export type Col = { key: string; title: string; perm?: string; num?: boolean };
export type ReportCtx = Pick<RequestCtx, 'companyId' | 'userId' | 'siteId' | 'isSuperAdmin' | 'permissions'>;
export type ReportResult = { columns: Col[]; rows: any[]; totals?: any; meta?: any };
const canCost = (ctx: ReportCtx) => ctx.isSuperAdmin || ctx.permissions.has('product.view_cost');
/** 按权限过滤列和行字段（成本列） */
function stripCols(ctx: ReportCtx, res: ReportResult): ReportResult {
  const drop = res.columns.filter((c) => c.perm && !(ctx.isSuperAdmin || ctx.permissions.has(c.perm))).map((c) => c.key);
  if (!drop.length) return res;
  const clean = (r: any) => { if (!r) return r; const o = { ...r }; for (const k of drop) delete o[k]; return o; };
  return { ...res, columns: res.columns.filter((c) => !drop.includes(c.key)), rows: res.rows.map(clean), totals: clean(res.totals) };
}
const dateRange = (q: any) => {
  const to = q.to ?? new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
  const from = q.from ?? (() => { const d = new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 29); return d.toISOString().slice(0, 10); })();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new AppError(400, 'VALIDATION', 'from/to must be YYYY-MM-DD');
  return { from, to };
};
const RANGE = (col: string, a: string, b: string) => `${col} >= ($${a}::date)::timestamp AT TIME ZONE ${KL} AND ${col} < ($${b}::date + 1)::timestamp AT TIME ZONE ${KL}`;

const COST: Col[] = [{ key: 'cost', title: '成本', perm: 'product.view_cost', num: true }, { key: 'gross_profit', title: '毛利', perm: 'product.view_cost', num: true }, { key: 'margin_pct', title: '毛利率%', perm: 'product.view_cost', num: true }];
const SALES_METRICS: Col[] = [{ key: 'count', title: '单数', num: true }, { key: 'qty', title: '数量', num: true }, { key: 'gross', title: '毛销售', num: true }, { key: 'discount', title: '折扣', num: true }, { key: 'tax', title: '税', num: true }, { key: 'net', title: '净销售', num: true }, ...COST];
const GROUPS: Record<string, { cols: Col[]; select: string; join: string; group: string; order: string }> = {
  day: { cols: [{ key: 'key', title: '日期' }], select: `L.day::text AS key`, join: '', group: 'L.day', order: 'L.day' },
  site: { cols: [{ key: 'key', title: '店代码' }, { key: 'label', title: '店名' }], select: `si.code AS key, si.name AS label`, join: 'JOIN site si ON si.id = L.site_id', group: 'si.code, si.name', order: 'si.code' },
  terminal: { cols: [{ key: 'key', title: '店' }, { key: 'label', title: '机号' }], select: `si.code AS key, coalesce(L.terminal_code, '-') AS label`, join: 'JOIN site si ON si.id = L.site_id', group: 'si.code, L.terminal_code', order: 'si.code, L.terminal_code' },
  cashier: { cols: [{ key: 'key', title: '收银员' }], select: `coalesce(u.name, '-') AS key`, join: 'LEFT JOIN app_user u ON u.id = L.cashier_id', group: 'u.name', order: 'u.name' },
  category: { cols: [{ key: 'key', title: '类别代码' }, { key: 'label', title: '类别' }], select: `c.code AS key, coalesce(c.name_zh, c.name_en) AS label`, join: 'JOIN category c ON c.id = L.category_id', group: 'c.code, c.name_zh, c.name_en', order: 'c.code' },
  product: { cols: [{ key: 'key', title: '货号' }, { key: 'label', title: '产品' }], select: `p.sku AS key, coalesce(p.name_zh, p.name_en, p.name_ms) AS label`, join: 'JOIN product p ON p.id = L.product_id', group: 'p.sku, p.name_zh, p.name_en, p.name_ms', order: '8 DESC' },
};

async function salesReport(tx: Tx, ctx: ReportCtx, q: any): Promise<ReportResult> {
  const { from, to } = dateRange(q); const g = GROUPS[q.group ?? 'day']; if (!g) throw new AppError(400, 'VALIDATION', 'group');
  const site = q.site ?? (hasPerm(ctx as RequestCtx, 'stock.view_other_sites') || ctx.isSuperAdmin ? null : ctx.siteId);
  const rows = (await tx.query(`WITH L AS (
      SELECT s.id AS sale_id, s.site_id, s.terminal_code, s.cashier_id, (s.sold_at AT TIME ZONE ${KL})::date AS day, CASE WHEN s.sale_type = 'RETURN' THEN -1 ELSE 1 END AS sg, l.product_id, p.category_id, l.qty, l.unit_price, l.discount, l.tax_amount, l.line_total, l.unit_cost
      FROM sale s JOIN sale_line l ON l.sale_id = s.id JOIN product p ON p.id = l.product_id
      WHERE s.status = 'COMPLETED' AND ${RANGE('s.sold_at', '1', '2')} AND ($3::uuid IS NULL OR s.site_id = $3))
    SELECT ${g.select}, count(DISTINCT L.sale_id)::int AS count, sum(L.sg * L.qty) AS qty, sum(L.sg * L.qty * L.unit_price) AS gross, sum(L.sg * L.discount) AS discount, sum(L.sg * L.tax_amount) AS tax, sum(L.sg * L.line_total) AS net,
      sum(L.sg * L.qty * L.unit_cost) AS cost, sum(L.sg * (L.line_total - L.tax_amount - L.qty * L.unit_cost)) AS gross_profit
    FROM L ${g.join} GROUP BY ${g.group} ORDER BY ${g.order}`, [from, to, site])).rows.map((r) => ({ ...r, qty: Number(r.qty), gross: r2(r.gross), discount: r2(r.discount), tax: r2(r.tax), net: r2(r.net), cost: r2(r.cost), gross_profit: r2(r.gross_profit), margin_pct: Number(r.net) - Number(r.tax) > 0 ? r2(Number(r.gross_profit) / (Number(r.net) - Number(r.tax)) * 100) : 0 }));
  const sum = (k: string) => r2(rows.reduce((s, r) => s + Number(r[k] ?? 0), 0));
  const totals = { count: rows.reduce((s, r) => s + r.count, 0), qty: sum('qty'), gross: sum('gross'), discount: sum('discount'), tax: sum('tax'), net: sum('net'), cost: sum('cost'), gross_profit: sum('gross_profit'), margin_pct: sum('net') - sum('tax') > 0 ? r2(sum('gross_profit') / (sum('net') - sum('tax')) * 100) : 0 };
  return { columns: [...g.cols, ...SALES_METRICS], rows, totals, meta: { from, to, group: q.group ?? 'day', site } };
}
async function shrinkageReport(tx: Tx, _ctx: ReportCtx, q: any): Promise<ReportResult> {
  const { from, to } = dateRange(q);
  const rows = (await tx.query(`SELECT p.sku, coalesce(p.name_zh, p.name_en) AS name, c.code AS category_code, coalesce(c.name_zh, c.name_en) AS category, m.reason,
      sum(CASE WHEN tl.is_virtual THEN m.qty ELSE -m.qty END) AS qty, sum(CASE WHEN tl.is_virtual THEN 1 ELSE -1 END * m.qty * coalesce(nullif(m.unit_cost, 0), p.cost_price)) AS amount, count(*)::int AS movements, max(m.performed_at) AS last_at
    FROM movement m JOIN product p ON p.id = m.product_id JOIN category c ON c.id = p.category_id JOIN location tl ON tl.id = m.to_location_id JOIN location fl ON fl.id = m.from_location_id
    WHERE m.reason IN ('COUNT','ADJUST') AND (tl.is_virtual OR fl.is_virtual) AND ${RANGE('m.performed_at', '1', '2')}
    GROUP BY p.sku, p.name_zh, p.name_en, c.code, c.name_zh, c.name_en, m.reason ORDER BY amount DESC`, [from, to])).rows.map((r) => ({ ...r, qty: Number(r.qty), amount: r2(r.amount) }));
  const byCat = new Map<string, { category: string; qty: number; amount: number }>();
  for (const r of rows) { const e = byCat.get(r.category_code) ?? { category: r.category, qty: 0, amount: 0 }; e.qty += r.qty; e.amount = r2(e.amount + r.amount); byCat.set(r.category_code, e); }
  return { columns: [{ key: 'sku', title: '货号' }, { key: 'name', title: '产品' }, { key: 'category', title: '类别' }, { key: 'reason', title: '原因' }, { key: 'qty', title: '损耗数量', num: true }, { key: 'amount', title: '损耗金额', perm: 'product.view_cost', num: true }, { key: 'movements', title: '次数', num: true }, { key: 'last_at', title: '最后时间' }],
    rows, totals: { qty: r2(rows.reduce((s, r) => s + r.qty, 0)), amount: r2(rows.reduce((s, r) => s + r.amount, 0)) }, meta: { from, to, by_category: [...byCat.entries()].map(([code, v]) => ({ category_code: code, ...v })) } };
}
async function turnoverReport(tx: Tx, _ctx: ReportCtx, q: any): Promise<ReportResult> {
  const days = Math.min(365, Math.max(1, Number(q.days ?? 30)));
  const rows = (await tx.query(`WITH sold AS (SELECT l.product_id, sum(CASE WHEN s.sale_type = 'RETURN' THEN -l.qty ELSE l.qty END) AS sold FROM sale s JOIN sale_line l ON l.sale_id = s.id WHERE s.status = 'COMPLETED' AND s.sold_at >= now() - make_interval(days => $1) GROUP BY 1),
      stk AS (SELECT st.product_id, sum(st.qty) AS qty FROM stock st JOIN location l ON l.id = st.location_id WHERE NOT l.is_virtual GROUP BY 1),
      chg AS (SELECT m.product_id, sum(CASE WHEN NOT tl.is_virtual THEN m.qty ELSE 0 END) - sum(CASE WHEN NOT fl.is_virtual THEN m.qty ELSE 0 END) AS net FROM movement m JOIN location fl ON fl.id = m.from_location_id JOIN location tl ON tl.id = m.to_location_id WHERE m.performed_at >= now() - make_interval(days => $1) GROUP BY 1)
    SELECT p.sku, coalesce(p.name_zh, p.name_en) AS name, coalesce(c.name_zh, c.name_en) AS category, coalesce(sold.sold, 0) AS sold_qty, coalesce(stk.qty, 0) AS stock_qty, greatest(coalesce(stk.qty, 0) - coalesce(chg.net, 0) / 2, 0) AS avg_stock, p.cost_price, coalesce(stk.qty, 0) * p.cost_price AS stock_value
    FROM product p JOIN category c ON c.id = p.category_id LEFT JOIN sold ON sold.product_id = p.id LEFT JOIN stk ON stk.product_id = p.id LEFT JOIN chg ON chg.product_id = p.id
    WHERE p.is_active AND (coalesce(stk.qty, 0) <> 0 OR coalesce(sold.sold, 0) <> 0)`, [days])).rows.map((r) => {
    const avg = Number(r.avg_stock); const sold = Number(r.sold_qty);
    const turnover = avg > 0 ? r2(sold / avg) : null; const days_of_stock = sold > 0 ? Math.round(Number(r.stock_qty) / (sold / days)) : null;
    return { ...r, sold_qty: sold, stock_qty: Number(r.stock_qty), avg_stock: r2(avg), stock_value: r2(r.stock_value), turnover, days_of_stock, worst: false };
  }).sort((a, b) => (a.turnover ?? -1) - (b.turnover ?? -1) || Number(b.stock_value) - Number(a.stock_value));
  let n = 0; for (const r of rows) if (r.stock_qty > 0 && n < 10) { r.worst = true; n++; }
  return { columns: [{ key: 'sku', title: '货号' }, { key: 'name', title: '产品' }, { key: 'category', title: '类别' }, { key: 'sold_qty', title: `${days} 天销量`, num: true }, { key: 'stock_qty', title: '当前库存', num: true }, { key: 'avg_stock', title: '平均库存', num: true }, { key: 'turnover', title: '周转次数', num: true }, { key: 'days_of_stock', title: '可卖天数', num: true }, { key: 'cost_price', title: '成本价', perm: 'product.view_cost', num: true }, { key: 'stock_value', title: '库存金额', perm: 'product.view_cost', num: true }, { key: 'worst', title: '最差前10' }],
    rows, meta: { days, worst: rows.filter((r) => r.worst).map((r) => r.sku) } };
}
async function stockAgingReport(tx: Tx, _ctx: ReportCtx, _q: any): Promise<ReportResult> {
  const rows = (await tx.query(`SELECT p.sku, coalesce(p.name_zh, p.name_en) AS name, coalesce(c.name_zh, c.name_en) AS category, si.code AS site, sum(st.qty) AS qty, sum(st.qty * p.cost_price) AS value,
      sum(CASE WHEN a.age <= 30 THEN st.qty * p.cost_price ELSE 0 END) AS v0_30, sum(CASE WHEN a.age BETWEEN 31 AND 60 THEN st.qty * p.cost_price ELSE 0 END) AS v31_60, sum(CASE WHEN a.age BETWEEN 61 AND 90 THEN st.qty * p.cost_price ELSE 0 END) AS v61_90, sum(CASE WHEN a.age > 90 THEN st.qty * p.cost_price ELSE 0 END) AS v90p,
      min(st.last_movement_at) AS oldest, max(a.age)::int AS max_age_days
    FROM stock st JOIN location l ON l.id = st.location_id JOIN site si ON si.id = l.site_id JOIN product p ON p.id = st.product_id JOIN category c ON c.id = p.category_id CROSS JOIN LATERAL (SELECT floor(extract(epoch FROM now() - st.last_movement_at) / 86400) AS age) a
    WHERE NOT l.is_virtual AND st.qty > 0 GROUP BY p.sku, p.name_zh, p.name_en, c.name_zh, c.name_en, si.code ORDER BY v90p DESC, value DESC`)).rows.map((r) => ({ ...r, qty: Number(r.qty), value: r2(r.value), v0_30: r2(r.v0_30), v31_60: r2(r.v31_60), v61_90: r2(r.v61_90), v90p: r2(r.v90p) }));
  const sum = (k: string) => r2(rows.reduce((s, r) => s + Number(r[k]), 0));
  return { columns: [{ key: 'sku', title: '货号' }, { key: 'name', title: '产品' }, { key: 'category', title: '类别' }, { key: 'site', title: '站点' }, { key: 'qty', title: '库存', num: true }, { key: 'max_age_days', title: '最久天数', num: true }, { key: 'value', title: '库存金额', perm: 'product.view_cost', num: true }, { key: 'v0_30', title: '0-30 天', perm: 'product.view_cost', num: true }, { key: 'v31_60', title: '31-60 天', perm: 'product.view_cost', num: true }, { key: 'v61_90', title: '61-90 天', perm: 'product.view_cost', num: true }, { key: 'v90p', title: '90+ 天', perm: 'product.view_cost', num: true }],
    rows, totals: { qty: sum('qty'), value: sum('value'), v0_30: sum('v0_30'), v31_60: sum('v31_60'), v61_90: sum('v61_90'), v90p: sum('v90p') } };
}
async function supplierOtifReport(tx: Tx, _ctx: ReportCtx, q: any): Promise<ReportResult> {
  const { from, to } = dateRange({ ...q, from: q.from ?? (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() - 89); return d.toISOString().slice(0, 10); })() });
  const rows = (await tx.query(`SELECT s.id AS supplier_id, s.name AS supplier, s.lead_time_days, count(po.id)::int AS po_count,
      count(po.id) FILTER (WHERE g.first_done IS NOT NULL)::int AS received_pos,
      count(po.id) FILTER (WHERE g.first_done IS NOT NULL AND (po.expected_date IS NULL OR (g.first_done AT TIME ZONE ${KL})::date <= po.expected_date))::int AS on_time,
      count(po.id) FILTER (WHERE g.first_done IS NULL AND po.expected_date < (now() AT TIME ZONE ${KL})::date)::int AS late_open,
      coalesce(avg(greatest(0, (g.first_done AT TIME ZONE ${KL})::date - po.expected_date)) FILTER (WHERE g.first_done IS NOT NULL AND po.expected_date IS NOT NULL), 0) AS avg_days_late,
      coalesce(sum(pl.ordered), 0) AS ordered_qty, coalesce(sum(pl.received), 0) AS received_qty
    FROM supplier s JOIN purchase_order po ON po.supplier_id = s.id AND po.status NOT IN ('DRAFT','PENDING_APPROVAL','CANCELLED') AND ${RANGE('po.created_at', '1', '2')}
    LEFT JOIN LATERAL (SELECT min(gr.completed_at) AS first_done FROM goods_receipt gr WHERE gr.po_id = po.id AND gr.status = 'COMPLETED') g ON true
    LEFT JOIN LATERAL (SELECT sum(pl.ordered_qty) AS ordered, coalesce(sum((SELECT sum(gl.received_qty) FROM goods_receipt_line gl JOIN goods_receipt gr ON gr.id = gl.grn_id WHERE gl.po_line_id = pl.id AND gr.status <> 'CANCELLED')), 0) AS received FROM purchase_order_line pl WHERE pl.po_id = po.id) pl ON true
    GROUP BY s.id, s.name, s.lead_time_days ORDER BY s.name`, [from, to])).rows.map((r) => ({ ...r, avg_days_late: r2(r.avg_days_late), ordered_qty: Number(r.ordered_qty), received_qty: Number(r.received_qty), on_time_pct: r.received_pos > 0 ? r2(r.on_time / r.received_pos * 100) : null, short_pct: Number(r.ordered_qty) > 0 ? r2(Math.max(0, Number(r.ordered_qty) - Number(r.received_qty)) / Number(r.ordered_qty) * 100) : null }));
  return { columns: [{ key: 'supplier', title: '供应商' }, { key: 'po_count', title: '采购单', num: true }, { key: 'received_pos', title: '已收货', num: true }, { key: 'on_time', title: '准时', num: true }, { key: 'on_time_pct', title: '准时率%', num: true }, { key: 'late_open', title: '逾期未到', num: true }, { key: 'avg_days_late', title: '平均迟到天', num: true }, { key: 'ordered_qty', title: '订购量', num: true }, { key: 'received_qty', title: '实收量', num: true }, { key: 'short_pct', title: '少货率%', num: true }], rows, meta: { from, to } };
}
/** 日报汇总（Telegram 日报复用） */
export async function dailySummary(tx: Tx, date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new AppError(400, 'VALIDATION', 'date');
  const one = async (sql: string, p: any[] = [date]) => (await tx.query(sql, p)).rows[0];
  const by_site = (await tx.query(`SELECT si.code AS site, si.name AS site_name, count(*)::int AS count, coalesce(sum(s.total),0) AS total, coalesce(sum(s.total) FILTER (WHERE s.sale_type = 'RETURN'),0) AS returns, coalesce(sum(s.total) FILTER (WHERE s.sale_type = 'B2B'),0) AS b2b
    FROM sale s JOIN site si ON si.id = s.site_id WHERE s.status = 'COMPLETED' AND ${RANGE('s.sold_at', '1', '1')} GROUP BY si.code, si.name ORDER BY si.code`, [date])).rows.map((r) => ({ ...r, total: r2(r.total), returns: r2(r.returns), b2b: r2(r.b2b) }));
  const by_method = (await tx.query(`SELECT p.method, coalesce(sum(p.amount),0) AS amount, count(*)::int AS count FROM payment p JOIN sale s ON s.id = p.sale_id WHERE s.status = 'COMPLETED' AND ${RANGE('s.sold_at', '1', '1')} GROUP BY p.method ORDER BY amount DESC`, [date])).rows.map((r) => ({ ...r, amount: r2(r.amount) }));
  const cash = await one(`SELECT count(*)::int AS sessions, count(*) FILTER (WHERE status = 'CLOSED')::int AS closed, coalesce(sum(variance),0) AS variance, coalesce(sum(counted_cash),0) AS counted FROM cash_drawer_session WHERE ${RANGE('opened_at', '1', '1')}`);
  const low = await one(`SELECT count(*)::int AS n FROM (SELECT p.id FROM product p LEFT JOIN stock st ON st.product_id = p.id LEFT JOIN location l ON l.id = st.location_id AND NOT l.is_virtual WHERE p.is_active GROUP BY p.id, p.min_level HAVING coalesce(sum(CASE WHEN l.id IS NOT NULL THEN st.qty END),0) < p.min_level) x`, []);
  const tickets = await one(`SELECT count(*) FILTER (WHERE status NOT IN ('RESOLVED','CLOSED'))::int AS open, count(*) FILTER (WHERE ${RANGE('created_at', '1', '1')})::int AS new_today, count(*) FILTER (WHERE status NOT IN ('RESOLVED','CLOSED') AND deadline_at < now())::int AS overdue FROM ticket`);
  const einv = await one(`SELECT count(*) FILTER (WHERE status = 'QUEUED')::int AS queued, count(*) FILTER (WHERE status IN ('FAILED','INVALID'))::int AS failed, count(*) FILTER (WHERE status = 'VALID' AND ${RANGE('validated_at', '1', '1')})::int AS valid_today FROM einvoice_submission`);
  const ar = await one(`SELECT coalesce(sum(total - paid_amount),0) AS overdue FROM invoice WHERE status NOT IN ('PAID','CANCELLED') AND due_date < (now() AT TIME ZONE ${KL})::date`, []);
  const ap = await one(`SELECT coalesce(sum(amount - paid_amount),0) AS due_7d, count(*)::int AS n FROM supplier_invoice WHERE status IN ('PAYABLE','PARTIAL') AND due_date <= (now() AT TIME ZONE ${KL})::date + 7`, []);
  const total = r2(by_site.reduce((s, r) => s + r.total, 0)); const count = by_site.reduce((s, r) => s + r.count, 0);
  return { date, sales: { count, total, by_site, by_method }, cash: { sessions: cash.sessions, closed: cash.closed, variance: r2(cash.variance), counted: r2(cash.counted) }, low_stock: low.n, tickets, einvoice: einv, ar_overdue: r2(ar.overdue), ap_due_7d: { amount: r2(ap.due_7d), count: ap.n } };
}
async function dailySummaryReport(tx: Tx, _ctx: ReportCtx, q: any): Promise<ReportResult> {
  const d = await dailySummary(tx, q.date ?? new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10));
  return { columns: [{ key: 'site', title: '店' }, { key: 'site_name', title: '店名' }, { key: 'count', title: '单数', num: true }, { key: 'total', title: '销售额', num: true }, { key: 'returns', title: '退货', num: true }, { key: 'b2b', title: '企业', num: true }], rows: d.sales.by_site, meta: d };
}

const REPORTS: Record<string, { perm: string[]; run: (tx: Tx, ctx: ReportCtx, q: any) => Promise<ReportResult> }> = {
  sales: { perm: ['report.sales'], run: salesReport },
  shrinkage: { perm: ['report.shrinkage', 'report.stock'], run: shrinkageReport },
  turnover: { perm: ['report.stock', 'report.sales'], run: turnoverReport },
  'stock-aging': { perm: ['report.stock'], run: stockAgingReport },
  'supplier-otif': { perm: ['report.stock', 'po.view'], run: supplierOtifReport },
  'daily-summary': { perm: ['report.sales', 'pos.close'], run: dailySummaryReport },
};
/** 供定时任务和路由共用：跑报表并按权限过滤 */
export async function runReport(tx: Tx, ctx: ReportCtx, name: string, params: any): Promise<ReportResult> {
  const def = REPORTS[name]; if (!def) throw new AppError(404, 'NOT_FOUND', name);
  return stripCols(ctx, await def.run(tx, ctx, params ?? {}));
}
/** 行 → Excel */
export async function reportXlsxBuffer(name: string, columns: Col[], rows: any[], totals?: any): Promise<Buffer> {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet(name.slice(0, 30));
  ws.addRow(columns.map((c) => c.title)); ws.getRow(1).font = { bold: true };
  const cell = (v: any) => (v == null ? '' : v instanceof Date ? v : typeof v === 'object' ? JSON.stringify(v) : typeof v === 'boolean' ? (v ? '是' : '') : v);
  for (const r of rows) ws.addRow(columns.map((c) => cell(r[c.key])));
  if (totals) { const tr = ws.addRow(columns.map((c, i) => (i === 0 ? '合计' : cell(totals[c.key])))); tr.font = { bold: true }; }
  columns.forEach((c, i) => { ws.getColumn(i + 1).width = Math.max(12, c.title.length * 2 + 4); if (c.num) ws.getColumn(i + 1).numFmt = '#,##0.00'; });
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}
async function sendXlsx(req: FastifyRequest, reply: FastifyReply, tx: Tx, type: string, filters: any, buf: Buffer, columns: string[], rowCount: number) {
  await mkdir(config.uploadDir, { recursive: true });
  const name = `export-${type}-${Date.now()}.xlsx`;
  await writeFile(join(config.uploadDir, name), buf);
  await tx.query(`INSERT INTO export_log (company_id, user_id, export_type, filters_json, columns_json, row_count, file_url) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [req.ctx.companyId, req.ctx.userId, type, JSON.stringify(filters), JSON.stringify(columns), rowCount, signedFileUrl(name)]);
  await tx.query(`INSERT INTO audit_log (company_id, user_id, action, table_name, after_json) VALUES ($1,$2,'EXPORT',$3,$4)`, [req.ctx.companyId, req.ctx.userId, type, JSON.stringify({ rows: rowCount, columns })]);
  reply.header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').header('content-disposition', `attachment; filename="${name}"`);
  return reply.send(buf);
}

// ---------- 会计导出 ----------
const DEFAULT_ACCOUNTS: Record<string, string> = { cash_sales: '310-000', bank: '320-000', ar: '300-000', ap: '400-000', sales: '500-000', sales_tax: '450-000', purchases: '600-000', inventory: '200-000', shrinkage: '900-000', rounding: '905-000' };
async function accountingData(tx: Tx, month: string, settings: any) {
  const m = monthStart(month); const acc = { ...DEFAULT_ACCOUNTS, ...(settings?.accounting_accounts ?? {}) };
  const retail = (await tx.query(`SELECT (s.sold_at AT TIME ZONE ${KL})::date::text AS date, si.code AS site, p.method, count(DISTINCT s.id)::int AS count, sum(p.amount) AS amount,
      sum(s.tax_amount * p.amount / nullif(s.paid_total, 0)) AS tax, sum(s.rounding * p.amount / nullif(s.paid_total, 0)) AS rounding
    FROM sale s JOIN site si ON si.id = s.site_id JOIN payment p ON p.sale_id = s.id WHERE s.status = 'COMPLETED' AND s.sale_type IN ('RETAIL','RETURN') AND ${MONTH_RANGE_SQL('s.sold_at', '1')} GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`, [m])).rows.map((r) => ({ ...r, amount: r2(r.amount), tax: r2(r.tax), rounding: r2(r.rounding) }));
  const invoices = (await tx.query(`SELECT i.invoice_no, i.issue_date::text AS date, i.due_date::text AS due_date, c.code AS customer_code, c.name AS customer, c.tin, i.subtotal, i.tax_amount, i.total, i.status FROM invoice i JOIN customer c ON c.id = i.customer_id WHERE i.status <> 'CANCELLED' AND i.issue_date >= $1::date AND i.issue_date < $1::date + interval '1 month' ORDER BY i.issue_date, i.invoice_no`, [m])).rows;
  const receipts = (await tx.query(`SELECT (p.received_at AT TIME ZONE ${KL})::date::text AS date, i.invoice_no, c.code AS customer_code, c.name AS customer, p.method, p.reference, p.amount FROM payment p JOIN invoice i ON i.id = p.invoice_id JOIN customer c ON c.id = p.customer_id WHERE ${MONTH_RANGE_SQL('p.received_at', '1')} ORDER BY p.received_at`, [m])).rows;
  const purchases = (await tx.query(`SELECT si.invoice_no, si.invoice_date::text AS date, si.due_date::text AS due_date, s.name AS supplier, s.tin AS supplier_tin, po.po_no, (SELECT string_agg(g.grn_no, ' ') FROM goods_receipt g WHERE g.po_id = si.po_id AND g.status <> 'CANCELLED') AS grn_nos, si.amount, si.status
    FROM supplier_invoice si JOIN supplier s ON s.id = si.supplier_id LEFT JOIN purchase_order po ON po.id = si.po_id WHERE si.status NOT IN ('CANCELLED') AND si.invoice_date >= $1::date AND si.invoice_date < $1::date + interval '1 month' ORDER BY si.invoice_date, si.invoice_no`, [m])).rows;
  const payments = (await tx.query(`SELECT (sp.paid_at AT TIME ZONE ${KL})::date::text AS date, si.invoice_no, s.name AS supplier, sp.method, sp.reference, sp.amount FROM supplier_payment sp JOIN supplier_invoice si ON si.id = sp.supplier_invoice_id JOIN supplier s ON s.id = si.supplier_id WHERE ${MONTH_RANGE_SQL('sp.paid_at', '1')} ORDER BY sp.paid_at`, [m])).rows;
  const stock = (await tx.query(`SELECT si.code AS site, sum(st.qty * p.cost_price) AS value, count(DISTINCT st.product_id)::int AS products FROM stock st JOIN location l ON l.id = st.location_id JOIN site si ON si.id = l.site_id JOIN product p ON p.id = st.product_id WHERE NOT l.is_virtual GROUP BY si.code ORDER BY si.code`)).rows.map((r) => ({ ...r, value: r2(r.value) }));
  return { month, acc, retail, invoices, receipts, purchases, payments, stock };
}
const CSV_COLS = ['journal', 'date', 'doc_no', 'party_code', 'party_name', 'account_code', 'description', 'debit', 'credit', 'tax_code', 'tax_amount', 'reference'];
function accountingCsv(d: Awaited<ReturnType<typeof accountingData>>): { text: string; rows: number } {
  const out: any[][] = [];
  const row = (j: string, date: string, doc: string, pcode: string, pname: string, account: string, desc: string, debit: number, credit: number, tax = '', taxAmt = 0, ref = '') => out.push([j, date, doc, pcode, pname, account, desc, debit ? debit.toFixed(2) : '', credit ? credit.toFixed(2) : '', tax, taxAmt ? taxAmt.toFixed(2) : '', ref]);
  const acc = d.acc;
  for (const r of d.retail) {
    const doc = `POS-${r.site}-${r.date.replace(/-/g, '')}-${r.method}`; const sales = r2(r.amount - r.tax - r.rounding);
    row('SALES', r.date, doc, r.site, `POS ${r.site}`, r.method === 'CASH' ? acc.cash_sales : acc.bank, `POS sales ${r.method} (${r.count} receipts)`, r.amount, 0);
    row('SALES', r.date, doc, r.site, `POS ${r.site}`, acc.sales, 'POS sales revenue', 0, sales);
    if (r.tax) row('SALES', r.date, doc, r.site, `POS ${r.site}`, acc.sales_tax, 'SST output tax', 0, r.tax, 'SST', r.tax);
    if (r.rounding) row('SALES', r.date, doc, r.site, `POS ${r.site}`, acc.rounding, 'Cash rounding', r.rounding < 0 ? -r.rounding : 0, r.rounding > 0 ? r.rounding : 0);
  }
  for (const i of d.invoices) {
    row('SALES', i.date, i.invoice_no, i.customer_code ?? '', i.customer, acc.ar, `Invoice ${i.invoice_no}`, Number(i.total), 0, '', 0, i.tin ?? '');
    row('SALES', i.date, i.invoice_no, i.customer_code ?? '', i.customer, acc.sales, 'B2B sales revenue', 0, Number(i.subtotal));
    if (Number(i.tax_amount)) row('SALES', i.date, i.invoice_no, i.customer_code ?? '', i.customer, acc.sales_tax, 'SST output tax', 0, Number(i.tax_amount), 'SST', Number(i.tax_amount));
  }
  for (const p of d.receipts) {
    row('RECEIPT', p.date, `RCPT-${p.invoice_no}`, p.customer_code ?? '', p.customer, p.method === 'CASH' ? acc.cash_sales : acc.bank, `Receipt for ${p.invoice_no} (${p.method})`, Number(p.amount), 0, '', 0, p.reference ?? '');
    row('RECEIPT', p.date, `RCPT-${p.invoice_no}`, p.customer_code ?? '', p.customer, acc.ar, `Knock off ${p.invoice_no}`, 0, Number(p.amount));
  }
  for (const s of d.purchases) {
    row('PURCHASE', s.date, s.invoice_no, '', s.supplier, acc.purchases, `Supplier invoice ${s.invoice_no} PO ${s.po_no ?? '-'} GRN ${s.grn_nos ?? '-'}`, Number(s.amount), 0, '', 0, s.supplier_tin ?? '');
    row('PURCHASE', s.date, s.invoice_no, '', s.supplier, acc.ap, `AP ${s.supplier}`, 0, Number(s.amount));
  }
  for (const p of d.payments) {
    row('PAYMENT', p.date, `PAY-${p.invoice_no}`, '', p.supplier, acc.ap, `Pay ${p.invoice_no} (${p.method})`, Number(p.amount), 0, '', 0, p.reference ?? '');
    row('PAYMENT', p.date, `PAY-${p.invoice_no}`, '', p.supplier, p.method === 'CASH' ? acc.cash_sales : acc.bank, `Payment ${p.method}`, 0, Number(p.amount));
  }
  for (const s of d.stock) row('STOCK', `${d.month}-01`, `STK-${s.site}-${d.month}`, s.site, `Stock ${s.site}`, acc.inventory, `Stock value ${s.products} products (current snapshot)`, s.value, 0);
  const esc = (v: any) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return { text: '﻿' + [CSV_COLS, ...out].map((r) => r.map(esc).join(',')).join('\r\n'), rows: out.length };
}
async function accountingXlsx(d: Awaited<ReturnType<typeof accountingData>>, fmt: 'sqlaccount' | 'autocount'): Promise<{ buf: Buffer; rows: number; sheets: string[] }> {
  const wb = new ExcelJS.Workbook(); const acc = d.acc; let n = 0;
  const sheet = (name: string, cols: string[], rows: any[][]) => { const ws = wb.addWorksheet(name); ws.addRow(cols); ws.getRow(1).font = { bold: true }; for (const r of rows) ws.addRow(r); cols.forEach((c, i) => (ws.getColumn(i + 1).width = Math.max(12, c.length + 4))); n += rows.length; };
  const sq = fmt === 'sqlaccount';
  // 销售日记账：POS 汇总（现金销售科目）+ 企业发票逐张
  sheet(sq ? 'Sales' : 'Invoice', sq ? ['DocNo', 'DocDate', 'Code', 'CompanyName', 'Description', 'Account', 'Qty', 'UnitPrice', 'Amount', 'TaxType', 'TaxAmount', 'Rounding', 'PaymentMethod'] : ['DocNo', 'DocDate', 'DebtorCode', 'DebtorName', 'Description', 'AccNo', 'Qty', 'UnitPrice', 'Amount', 'TaxCode', 'TaxAmount', 'Rounding', 'PaymentMethod'],
    [...d.retail.map((r) => [`POS-${r.site}-${r.date.replace(/-/g, '')}-${r.method}`, r.date, r.site, `POS ${r.site}`, `POS sales ${r.method} ${r.count} receipts`, acc.sales, 1, r2(r.amount - r.tax - r.rounding), r2(r.amount - r.tax - r.rounding), r.tax ? 'SST' : '', r.tax, r.rounding, r.method]),
      ...d.invoices.map((i) => [i.invoice_no, i.date, i.customer_code ?? '', i.customer, `Invoice ${i.invoice_no}`, acc.sales, 1, Number(i.subtotal), Number(i.subtotal), Number(i.tax_amount) ? 'SST' : '', Number(i.tax_amount), 0, 'CREDIT'])]);
  sheet(sq ? 'ARPayment' : 'ARPayment', sq ? ['DocNo', 'DocDate', 'Code', 'CompanyName', 'PaymentMethod', 'ChequeNo', 'Amount', 'KnockOffDocNo', 'Account'] : ['DocNo', 'DocDate', 'DebtorCode', 'DebtorName', 'PaymentMethod', 'ChequeNo', 'PaymentAmount', 'KnockOffDocNo', 'BankAccNo'],
    d.receipts.map((p) => [`RCPT-${p.invoice_no}`, p.date, p.customer_code ?? '', p.customer, p.method, p.reference ?? '', Number(p.amount), p.invoice_no, p.method === 'CASH' ? acc.cash_sales : acc.bank]));
  sheet(sq ? 'Purchase' : 'PurchaseInvoice', sq ? ['DocNo', 'DocDate', 'Code', 'CompanyName', 'SupplierInvNo', 'PONo', 'GRNNo', 'Description', 'Account', 'Amount', 'DueDate'] : ['DocNo', 'DocDate', 'CreditorCode', 'CreditorName', 'SupplierInvNo', 'PONo', 'GRNNo', 'Description', 'AccNo', 'Amount', 'DueDate'],
    d.purchases.map((s) => [s.invoice_no, s.date, '', s.supplier, s.invoice_no, s.po_no ?? '', s.grn_nos ?? '', `Supplier invoice ${s.invoice_no}`, acc.purchases, Number(s.amount), s.due_date ?? '']));
  sheet('APPayment', sq ? ['DocNo', 'DocDate', 'Code', 'CompanyName', 'PaymentMethod', 'ChequeNo', 'Amount', 'KnockOffDocNo', 'Account'] : ['DocNo', 'DocDate', 'CreditorCode', 'CreditorName', 'PaymentMethod', 'ChequeNo', 'PaymentAmount', 'KnockOffDocNo', 'BankAccNo'],
    d.payments.map((p) => [`PAY-${p.invoice_no}`, p.date, '', p.supplier, p.method, p.reference ?? '', Number(p.amount), p.invoice_no, p.method === 'CASH' ? acc.cash_sales : acc.bank]));
  sheet('StockValue', ['Site', 'Products', 'StockValue', 'Account', 'AsOf'], d.stock.map((s) => [s.site, s.products, s.value, acc.inventory, new Date().toISOString().slice(0, 10)]));
  sheet('Accounts', ['Key', 'AccountCode'], Object.entries(acc));
  return { buf: Buffer.from(await wb.xlsx.writeBuffer()), rows: n, sheets: wb.worksheets.map((w) => w.name) };
}

export async function reportsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);
  for (const [name, def] of Object.entries(REPORTS)) {
    app.get(`/reports/${name}`, { preHandler: requirePerm(...def.perm) }, async (req, reply) => {
      const q = (req.query ?? {}) as any; const fmt = q.format === 'xlsx' ? 'xlsx' : 'json';
      return withCompany(cx(req), async (tx) => {
        const res = await runReport(tx, req.ctx, name, q);
        if (fmt === 'json') return { ...res, can_see_cost: canCost(req.ctx) };
        const buf = await reportXlsxBuffer(name, res.columns, res.rows, res.totals);
        return sendXlsx(req, reply, tx, `report-${name}`, { ...q, format: undefined }, buf, res.columns.map((c) => c.key), res.rows.length);
      });
    });
  }
  app.get('/reports', { preHandler: requirePerm('report.sales', 'report.shrinkage', 'report.stock') }, async (req) => Object.entries(REPORTS).filter(([, d]) => d.perm.some((p) => hasPerm(req.ctx, p))).map(([name]) => name));
  app.get('/reports/accounting-export', { preHandler: requirePerm('report.sales', 'export.sales', 'period.lock') }, async (req, reply) => {
    const q = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), format: z.enum(['sqlaccount', 'autocount', 'csv']).default('csv') }).parse(req.query);
    return withCompany(cx(req), async (tx) => {
      const d = await accountingData(tx, q.month, req.ctx.settings);
      if (q.format === 'csv') {
        const { text, rows } = accountingCsv(d);
        await mkdir(config.uploadDir, { recursive: true }); const name = `export-accounting-${q.month}-${Date.now()}.csv`; await writeFile(join(config.uploadDir, name), text);
        await tx.query(`INSERT INTO export_log (company_id, user_id, export_type, filters_json, columns_json, row_count, file_url) VALUES ($1,$2,'accounting-csv',$3,$4,$5,$6)`, [req.ctx.companyId, req.ctx.userId, JSON.stringify(q), JSON.stringify(CSV_COLS), rows, signedFileUrl(name)]);
        reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="${name}"`);
        return reply.send(text);
      }
      const { buf, rows, sheets } = await accountingXlsx(d, q.format);
      return sendXlsx(req, reply, tx, `accounting-${q.format}`, q, buf, sheets, rows);
    });
  });
}
