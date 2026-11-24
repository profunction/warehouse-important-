// 自有 POS（第六组）：开班/日结、瘦目录、销售、挂单、收据查询、退货审批、作废、称重码解析。
// 设计文档没写、这里定下的约定：
// - 价格含税：line_total 含税，tax_amount = line_total − line_total/(1+rate)。取整 settings.cash_rounding（默认 0.05）只在有现金付款时对合计做，差额记 sale.rounding。
// - 折扣上限 settings.cashier_discount_max_pct（默认 5）按"相对标价的有效折扣率"算（含改价），超限需 supervisor_pin（站点内 BOSS/MANAGER 的 PIN），记 sale_line.approved_by。
// - 扣库存位置：主货架（shelf_assignment is_primary）→ 类别默认后仓 → 产品默认位置 → 任一有库存的非虚拟位置 → 任一后仓位置。可为负（SALE 原因不受 allow_negative_stock 限制，负库存由触发器开工单）。
// - 退货销售（sale_type RETURN）金额为正数，靠 sale_type 区分；original_sale_id 指向原单。退款方式同原单主要付款方式：现金记 session.refund_total，卡/电子钱包直接从对应合计扣。
// - 退货/作废的 RETURN 移动 performed_by 用原收银员（或申请人），因为经理角色没有 movement.return 权限而触发器按 performed_by 查权；voided_by/approval 记录真正决定的人。
// - 离线同步（entity 'sale'）同一逻辑；找不到 OPEN 班次时挂到该机最近一个班次（不拒收真实销售）。
// - B2B 记账：不检查 b2b_invoice 功能开关（由 pos.b2b 权限把关）；写 invoice UNPAID，payment 行 method CREDIT。
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withCompany, type Tx } from '../lib/db.js';
import { requireAuth, requirePerm, hasPerm, stripCost, verifyPin, type RequestCtx } from '../lib/auth.js';
import { AppError, notFound } from '../lib/errors.js';
import { applyMovement } from '../lib/movements.js';
import { nextDocNo } from '../lib/docno.js';
import { parseScaleBarcode } from '../lib/scale.js';
import { createApproval, registerApprovalHandler } from '../lib/approvals.js';
import { registerSyncHandler } from '../lib/syncHandlers.js';
import { tgSend, tgSendToUser } from '../lib/telegram.js';
import { buildReceiptText, buildReceiptEscPos, buildZReport, buildZReportEscPos, type ReceiptData } from '../lib/receipt.js';
import { publicBase, receiptUrl } from '../lib/receiptLink.js';
import { adminPool } from '../lib/db.js';
import { config } from '../lib/config.js';
import { signedFileUrl } from './files.js';

export const r2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const roundTo = (n: number, step: number) => (step > 0 ? r2(Math.round(n / step) * step) : r2(n));

const lineSchema = z.object({
  product_id: z.string().uuid().optional().nullable(), barcode: z.string().optional().nullable(),
  qty: z.number().positive().default(1), weight_kg: z.number().positive().optional().nullable(),
  unit_price: z.number().min(0).optional().nullable(), discount_pct: z.number().min(0).max(100).optional().nullable(), discount: z.number().min(0).optional().nullable(),
  supervisor_pin: z.string().optional().nullable(), approved_by_pin: z.string().optional().nullable(), note: z.string().max(200).optional().nullable(),
});
const paymentSchema = z.object({ method: z.enum(['CASH', 'CARD', 'EWALLET', 'BANK_TRANSFER', 'CREDIT', 'CHEQUE']), amount: z.number().min(0).optional().nullable(), tendered: z.number().min(0).optional().nullable(), reference: z.string().max(100).optional().nullable() });
export const saleSchema = z.object({
  client_id: z.string().uuid().optional().nullable(), terminal_code: z.string().min(1).max(10).default('P1'), session_id: z.string().uuid().optional().nullable(),
  receipt_no: z.string().max(40).optional().nullable(), device_id: z.string().uuid().optional().nullable(),
  lines: z.array(lineSchema).min(1), payments: z.array(paymentSchema).default([]),
  customer_id: z.string().uuid().optional().nullable(), sale_type: z.enum(['RETAIL', 'B2B']).default('RETAIL'),
  einvoice_required: z.boolean().optional(), einvoice_buyer: z.any().optional().nullable(), sold_at: z.string().datetime({ offset: true }).optional().nullable(), note: z.string().max(200).optional().nullable(),
  hold_id: z.string().uuid().optional().nullable(),
});
export type SaleInput = z.infer<typeof saleSchema>;
export interface SaleCtx { companyId: string; userId: string; deviceId?: string | null; siteId: string | null; plan: 'A' | 'B'; settings: Record<string, any>; name?: string }
export interface CreateSaleOpts { source: 'OWN_POS' | 'PANDAL' | 'WEB'; site_id?: string | null; external_ref?: string | null; skip_unknown?: boolean; require_session?: boolean; cashier_id?: string | null }

const cx = (req: any) => ({ companyId: req.ctx.companyId, userId: req.ctx.userId, deviceId: req.ctx.deviceId });
const saleCtx = (ctx: RequestCtx, deviceId?: string | null): SaleCtx => ({ companyId: ctx.companyId, userId: ctx.userId, deviceId: deviceId ?? ctx.deviceId, siteId: ctx.siteId, plan: ctx.plan, settings: ctx.settings ?? {}, name: ctx.name });

/** 站点：ctx 的站点，否则公司唯一/第一个站点 */
export async function resolveSite(tx: Tx, siteId?: string | null, siteCode?: string | null) {
  const r = siteId ? (await tx.query(`SELECT * FROM site WHERE id = $1`, [siteId])).rows[0]
    : siteCode ? (await tx.query(`SELECT * FROM site WHERE code = $1`, [siteCode])).rows[0]
      : (await tx.query(`SELECT * FROM site WHERE is_active ORDER BY type = 'SHOP' DESC, created_at LIMIT 1`)).rows[0];
  if (!r) throw notFound('NOT_FOUND');
  return r;
}
/** 扣库存位置 */
export async function resolveSaleLocation(tx: Tx, product: { id: string; category_id: string; default_location_id?: string | null }, siteId: string): Promise<string> {
  const q = async (sql: string, params: any[]) => (await tx.query(sql, params)).rows[0]?.id as string | undefined;
  return (await q(`SELECT l.id FROM shelf_assignment sa JOIN location l ON l.id = sa.location_id WHERE sa.product_id = $1 AND sa.site_id = $2 AND sa.is_active AND l.is_active ORDER BY sa.is_primary DESC, sa.assigned_at DESC LIMIT 1`, [product.id, siteId]))
    ?? (await q(`SELECT l.id FROM category c JOIN location l ON l.code = c.default_backroom_code AND l.site_id = $2 AND l.is_active WHERE c.id = $1`, [product.category_id, siteId]))
    ?? (product.default_location_id ? await q(`SELECT id FROM location WHERE id = $1 AND site_id = $2 AND is_active`, [product.default_location_id, siteId]) : undefined)
    ?? (await q(`SELECT s.location_id AS id FROM stock s JOIN location l ON l.id = s.location_id WHERE s.product_id = $1 AND l.site_id = $2 AND NOT l.is_virtual AND l.is_active AND s.qty > 0 ORDER BY s.qty DESC LIMIT 1`, [product.id, siteId]))
    ?? (await q(`SELECT l.id FROM location l JOIN zone z ON z.id = l.zone_id WHERE l.site_id = $1 AND l.is_active AND NOT l.is_virtual ORDER BY z.zone_type = 'BACKROOM' DESC, z.zone_type = 'SHELF' DESC, l.code LIMIT 1`, [siteId]))
    ?? (() => { throw new AppError(400, 'LOCATION_NOT_FOUND', 'no stock location at site'); })();
}
/** 第三阶段原因 SALE/RETURN 在建公司时默认未启用（种子只开第一阶段），首次用到时启用（同 transfers 模块做法） */
const reasonsReady = new Set<string>();
export async function ensureSaleReasons(tx: Tx, companyId: string) {
  if (reasonsReady.has(companyId)) return;
  await tx.query(`INSERT INTO movement_reason_enabled (company_id, reason, enabled) VALUES ($1,'SALE',true),($1,'RETURN',true) ON CONFLICT (company_id, reason) DO UPDATE SET enabled = true`, [companyId]);
  reasonsReady.add(companyId);
}
async function virtualLoc(tx: Tx, type: string) { const r = (await tx.query(`SELECT id FROM location WHERE is_virtual AND virtual_type = $1`, [type])).rows[0]; if (!r) throw new AppError(400, 'LOCATION_NOT_FOUND', type); return r.id as string; }
async function findSupervisor(tx: Tx, companyId: string, siteId: string, pin: string) {
  const rows = (await tx.query(`SELECT DISTINCT u.id, u.name, u.pin_hash FROM app_user u JOIN user_site_role usr ON usr.user_id = u.id JOIN role r ON r.id = usr.role_id
    WHERE u.company_id = $1 AND u.is_active AND r.code IN ('BOSS','MANAGER') AND (usr.site_id IS NULL OR usr.site_id = $2)`, [companyId, siteId])).rows;
  for (const u of rows) if (await verifyPin(u.pin_hash, pin)) return { id: u.id as string, name: u.name as string };
  return null;
}
async function currentSession(tx: Tx, siteId: string, terminal: string, onlyOpen = true) {
  return (await tx.query(`SELECT * FROM cash_drawer_session WHERE site_id = $1 AND terminal_code = $2 ${onlyOpen ? `AND status = 'OPEN'` : ''} ORDER BY opened_at DESC LIMIT 1`, [siteId, terminal])).rows[0];
}

/** 完整销售（含行、付款、收据文本、ESC/POS） */
export async function loadSaleFull(tx: Tx, id: string, opts: { cost?: boolean } = {}) {
  const s = (await tx.query(`SELECT s.*, c.name AS customer_name, u.name AS cashier_name, st.code AS site_code, st.name AS site_name,
      (SELECT invoice_no FROM invoice i WHERE i.sale_id = s.id LIMIT 1) AS invoice_no
    FROM sale s LEFT JOIN customer c ON c.id = s.customer_id LEFT JOIN app_user u ON u.id = s.cashier_id JOIN site st ON st.id = s.site_id WHERE s.id = $1`, [id])).rows[0];
  if (!s) return null;
  const lines = (await tx.query(`SELECT l.id, l.line_no, l.product_id, l.barcode_scanned, l.qty, l.weight_kg, l.unit_price, l.discount, l.discount_pct, l.tax_rate, l.tax_amount, l.line_total, ${opts.cost ? 'l.unit_cost,' : ''} l.from_location_id, l.movement_id, l.approved_by,
      p.name_zh, p.name_ms, p.name_en, p.sku, p.unit, p.is_weighed, p.photo_url, loc.code AS from_location_code,
      coalesce((SELECT sum(rl.qty) FROM sale_line rl JOIN sale rs ON rs.id = rl.sale_id WHERE rs.original_sale_id = l.sale_id AND rs.sale_type = 'RETURN' AND rs.status = 'COMPLETED' AND rl.product_id = l.product_id AND rl.line_no = l.line_no), 0) AS returned_qty
    FROM sale_line l JOIN product p ON p.id = l.product_id LEFT JOIN location loc ON loc.id = l.from_location_id WHERE l.sale_id = $1 ORDER BY l.line_no`, [id])).rows;
  const payments = (await tx.query(`SELECT id, method, amount, tendered, reference, received_at, drawer_session_id, invoice_id FROM payment WHERE sale_id = $1 ORDER BY received_at, id`, [id])).rows;
  const company = (await tx.query(`SELECT name, address, tin, sst_no, short_code, settings FROM company WHERE id = $1`, [s.company_id])).rows[0];
  const qr_url = s.sale_type === 'RETURN' ? null : receiptUrl(publicBase(company.settings), company.short_code, s.company_id, s.receipt_no);
  const rd: ReceiptData = {
    company, site: { code: s.site_code, name: s.site_name }, terminal_code: s.terminal_code, cashier_name: s.cashier_name, receipt_no: s.receipt_no, sold_at: s.sold_at, sale_type: s.sale_type, customer_name: s.customer_name,
    lines: lines.map((l: any) => ({ name: l.name_zh || l.name_en || l.name_ms || l.sku, qty: l.qty, unit_price: l.unit_price, line_total: l.line_total, weight_kg: l.weight_kg, discount: l.discount, unit: l.unit })),
    subtotal: s.subtotal, discount_total: s.discount_total, tax_amount: s.tax_amount, rounding: s.rounding, total: s.total, paid_total: s.paid_total, change_amount: s.change_amount, payments, qr_url,
  };
  const receipt_text = buildReceiptText(rd, 32);
  return { ...s, lines, payments, receipt_text, receipt_text_80: buildReceiptText(rd, 48), escpos_base64: buildReceiptEscPos(rd, { openDrawer: payments.some((p: any) => p.method === 'CASH') }).toString('base64'), qr_content: qr_url ?? `RCPT:${s.receipt_no}`, einvoice_url: qr_url };
}

/** 建销售：服务器重算金额、扣库存、付款、班次合计、B2B 记账。幂等 client_id / external_ref。 */
export async function createSale(tx: Tx, ctx: SaleCtx, input: SaleInput, opts: CreateSaleOpts) {
  if (input.client_id) { const ex = (await tx.query(`SELECT id FROM sale WHERE client_id = $1`, [input.client_id])).rows[0]; if (ex) return { ...(await loadSaleFull(tx, ex.id))!, duplicate: true, skipped: [] as string[] }; }
  if (opts.external_ref) { const ex = (await tx.query(`SELECT id FROM sale WHERE external_ref = $1`, [opts.external_ref])).rows[0]; if (ex) return { ...(await loadSaleFull(tx, ex.id))!, duplicate: true, skipped: [] as string[] }; }
  await ensureSaleReasons(tx, ctx.companyId);
  const site = await resolveSite(tx, opts.site_id ?? ctx.siteId);
  const terminal = input.terminal_code;
  const settings = ctx.settings ?? {};
  const cashRounding = Number(settings.cash_rounding ?? 0.05);
  const maxDisc = Number(settings.cashier_discount_max_pct ?? 5);
  const soldAt = input.sold_at ? new Date(input.sold_at) : new Date();
  const own = opts.source === 'OWN_POS';
  // 班次
  let session: any = null;
  if (own) {
    session = input.session_id ? (await tx.query(`SELECT * FROM cash_drawer_session WHERE id = $1`, [input.session_id])).rows[0] : await currentSession(tx, site.id, terminal);
    if (!session && opts.require_session !== false) throw new AppError(400, 'NO_OPEN_SESSION');
    if (!session) session = await currentSession(tx, site.id, terminal, false);
  }
  // 行
  const customerLoc = await virtualLoc(tx, 'CUSTOMER');
  const skipped: string[] = [];
  type L = { product: any; qty: number; weight_kg: number | null; unit_price: number; gross: number; discount: number; discount_pct: number; line_total: number; tax_rate: number; tax_amount: number; approved_by: string | null; barcode: string | null; from_location_id: string; note: string | null };
  const lines: L[] = [];
  for (const li of input.lines) {
    let product: any = null; let pack = 1; let weight: number | null = li.weight_kg ?? null;
    if (li.product_id) product = (await tx.query(`SELECT p.*, t.rate AS tax_rate FROM product p JOIN tax_code t ON t.id = p.tax_code_id WHERE p.id = $1`, [li.product_id])).rows[0];
    else if (li.barcode) {
      const b = (await tx.query(`SELECT p.*, t.rate AS tax_rate, b.pack_qty FROM barcode b JOIN product p ON p.id = b.product_id JOIN tax_code t ON t.id = p.tax_code_id WHERE b.barcode = $1`, [li.barcode])).rows[0];
      if (b) { product = b; pack = Number(b.pack_qty); }
      else {
        const parsed = parseScaleBarcode(li.barcode, settings.scale_barcode_format);
        if (parsed) { product = (await tx.query(`SELECT p.*, t.rate AS tax_rate FROM product p JOIN tax_code t ON t.id = p.tax_code_id WHERE p.plu_code = $1 AND p.is_weighed`, [parsed.plu])).rows[0]; if (product && weight == null) weight = parsed.weight_kg; }
      }
    }
    if (!product) { if (opts.skip_unknown) { skipped.push(li.barcode ?? li.product_id ?? '?'); continue; } throw new AppError(404, 'BARCODE_NOT_FOUND', li.barcode ?? li.product_id); }
    if (!product.is_active) throw new AppError(400, 'PRODUCT_INACTIVE', product.sku);
    const weighed = !!product.is_weighed;
    const qty = weighed ? Number(weight ?? li.qty) : Number(li.qty) * pack;
    if (!(qty > 0)) throw new AppError(400, 'VALIDATION', 'qty must be > 0');
    const sell = Number(product.sell_price);
    const unit_price = li.unit_price != null ? Number(li.unit_price) : sell;
    const gross = r2(qty * unit_price);
    const discount_pct = Number(li.discount_pct ?? 0);
    const discount = li.discount != null ? r2(li.discount) : discount_pct ? r2(gross * discount_pct / 100) : 0;
    const line_total = r2(gross - discount);
    if (line_total < 0) throw new AppError(400, 'VALIDATION', 'discount > line');
    let approved_by: string | null = null;
    if (own) {
      // 有效折扣率：明确给了 discount_pct 就用它（避免 1.99×5% 四舍五入成 5.03%），加上改价部分；否则按金额反算
      const listGross = r2(qty * sell);
      const overridePct = sell > 0 && unit_price < sell ? ((sell - unit_price) / sell) * 100 : 0;
      const effPct = li.discount == null && li.discount_pct != null ? discount_pct + overridePct : listGross > 0 ? ((listGross - line_total) / listGross) * 100 : 0;
      if (effPct > maxDisc + 1e-6) {
        const pin = li.supervisor_pin ?? li.approved_by_pin;
        if (!pin) throw new AppError(400, 'DISCOUNT_LIMIT', { max_pct: maxDisc, pct: r2(effPct), product_id: product.id });
        const sup = await findSupervisor(tx, ctx.companyId, site.id, pin);
        if (!sup) throw new AppError(400, 'DISCOUNT_LIMIT', { max_pct: maxDisc, pct: r2(effPct), reason: 'PIN_WRONG' });
        approved_by = sup.id;
      }
    }
    const tax_rate = Number(product.tax_rate ?? 0);
    const tax_amount = r2(line_total - line_total / (1 + tax_rate / 100));
    const from_location_id = await resolveSaleLocation(tx, product, site.id);
    lines.push({ product, qty, weight_kg: weighed ? qty : null, unit_price, gross, discount, discount_pct: discount_pct || (gross ? r2(discount / gross * 100) : 0), line_total, tax_rate, tax_amount, approved_by, barcode: li.barcode ?? null, from_location_id, note: li.note ?? null });
  }
  if (!lines.length) throw new AppError(400, 'VALIDATION', { skipped, message: 'no known lines' });
  const subtotal = r2(lines.reduce((a, l) => a + l.gross, 0));
  const discount_total = r2(lines.reduce((a, l) => a + l.discount, 0));
  const tax_amount = r2(lines.reduce((a, l) => a + l.tax_amount, 0));
  const net = r2(lines.reduce((a, l) => a + l.line_total, 0));
  // B2B
  let customer: any = null;
  if (input.customer_id) { customer = (await tx.query(`SELECT * FROM customer WHERE id = $1 AND is_active`, [input.customer_id])).rows[0]; if (!customer) throw new AppError(404, 'CUSTOMER_NOT_FOUND'); }
  let payments = input.payments.map((p) => ({ method: p.method, amount: p.amount != null ? r2(p.amount) : p.tendered != null ? r2(p.tendered) : 0, tendered: p.tendered != null ? r2(p.tendered) : null, reference: p.reference ?? null }));
  if (input.sale_type === 'B2B') {
    if (!customer) throw new AppError(404, 'CUSTOMER_NOT_FOUND');
    if (Number(customer.balance) + net > Number(customer.credit_limit) + 1e-9) throw new AppError(400, 'CREDIT_LIMIT_EXCEEDED', { balance: customer.balance, credit_limit: customer.credit_limit, total: net });
    payments = [{ method: 'CREDIT', amount: net, tendered: null, reference: null }];
  } else if (!payments.length && !own) payments = [{ method: 'CASH', amount: net, tendered: null, reference: null }];
  // 取整（有现金时）与找零
  const hasCash = payments.some((p) => p.method === 'CASH');
  const total = hasCash ? roundTo(net, cashRounding) : net;
  const rounding = r2(total - net);
  const paid_total = r2(payments.reduce((a, p) => a + (p.method === 'CASH' ? Math.max(p.tendered ?? 0, p.amount) : p.amount), 0));
  if (paid_total + 1e-9 < total) throw new AppError(400, 'PAYMENT_SHORT', { total, paid: paid_total });
  const change_amount = hasCash ? r2(paid_total - total) : 0;
  const cashIn = r2(payments.filter((p) => p.method === 'CASH').reduce((a, p) => a + Math.max(p.tendered ?? 0, p.amount), 0) - change_amount);
  // 收据号
  let receipt_no = input.receipt_no ?? null;
  if (receipt_no && (await tx.query(`SELECT 1 FROM sale WHERE receipt_no = $1`, [receipt_no])).rowCount) receipt_no = null;
  if (!receipt_no) receipt_no = await nextDocNo(tx, ctx.companyId, 'RCPT', `${site.code}-${terminal}-`, `${site.id}:${terminal}`, 6);
  const saleId = (await tx.query(`SELECT uuid_v7() id`)).rows[0].id as string;
  const cashierId = opts.cashier_id === undefined ? (own ? ctx.userId : null) : opts.cashier_id;
  await tx.query(
    `INSERT INTO sale (id, company_id, site_id, receipt_no, sale_type, source, external_ref, customer_id, cashier_id, device_id, terminal_code, drawer_session_id, subtotal, discount_total, tax_amount, rounding, total, paid_total, change_amount, status, sold_at, einvoice_required, einvoice_buyer, client_id, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'COMPLETED',$20,$21,$22,$23,$24)`,
    [saleId, ctx.companyId, site.id, receipt_no, input.sale_type, opts.source, opts.external_ref ?? null, customer?.id ?? null, cashierId, input.device_id ?? ctx.deviceId ?? null, terminal, session?.id ?? null,
      subtotal, discount_total, tax_amount, rounding, total, paid_total, change_amount, soldAt.toISOString(), !!input.einvoice_required, input.einvoice_buyer ? JSON.stringify(input.einvoice_buyer) : null, input.client_id ?? null, input.note ?? null]);
  let lineNo = 0;
  for (const l of lines) {
    lineNo++;
    const mv = await applyMovement(tx, { companyId: ctx.companyId, userId: ctx.userId, deviceId: input.device_id ?? ctx.deviceId ?? null }, { product_id: l.product.id, from_location_id: l.from_location_id, to_location_id: customerLoc, qty: l.qty, reason: 'SALE', ref_type: 'SALE', ref_id: saleId, performed_at: soldAt.toISOString(), note: l.note });
    await tx.query(
      `INSERT INTO sale_line (company_id, sale_id, line_no, product_id, barcode_scanned, qty, weight_kg, unit_price, discount, discount_pct, tax_code_id, tax_rate, tax_amount, line_total, unit_cost, from_location_id, movement_id, approved_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [ctx.companyId, saleId, lineNo, l.product.id, l.barcode, l.qty, l.weight_kg, l.unit_price, l.discount, l.discount_pct, l.product.tax_code_id, l.tax_rate, l.tax_amount, l.line_total, l.product.cost_price ?? 0, l.from_location_id, mv.id, l.approved_by]);
  }
  // B2B：客户余额 + 发票
  let invoiceId: string | null = null;
  if (input.sale_type === 'B2B') {
    const invNo = await nextDocNo(tx, ctx.companyId, 'INV', `INV-${new Date().getFullYear()}-`);
    invoiceId = (await tx.query(`INSERT INTO invoice (company_id, invoice_no, customer_id, sale_id, issue_date, due_date, subtotal, tax_amount, total, status) VALUES ($1,$2,$3,$4,current_date, current_date + ($5::int) * interval '1 day', $6,$7,$8,'UNPAID') RETURNING id`,
      [ctx.companyId, invNo, customer.id, saleId, Number(customer.credit_terms_days ?? 30), r2(net - tax_amount), tax_amount, total])).rows[0].id;
    await tx.query(`UPDATE customer SET balance = balance + $2 WHERE id = $1`, [customer.id, total]);
  }
  for (const p of payments) {
    await tx.query(`INSERT INTO payment (company_id, sale_id, invoice_id, customer_id, method, amount, tendered, reference, received_by, received_at, drawer_session_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [ctx.companyId, saleId, invoiceId, customer?.id ?? null, p.method, p.method === 'CASH' ? r2(Math.max(p.tendered ?? 0, p.amount) - change_amount) : p.amount, p.tendered, p.reference, cashierId, soldAt.toISOString(), session?.id ?? null]);
  }
  if (session) {
    const card = r2(payments.filter((p) => p.method === 'CARD').reduce((a, p) => a + p.amount, 0));
    const ew = r2(payments.filter((p) => p.method === 'EWALLET').reduce((a, p) => a + p.amount, 0));
    await tx.query(`UPDATE cash_drawer_session SET sales_total = sales_total + $2, sales_count = sales_count + 1, cash_total = cash_total + $3, card_total = card_total + $4, ewallet_total = ewallet_total + $5 WHERE id = $1`, [session.id, total, cashIn, card, ew]);
  }
  if (input.hold_id) await tx.query(`UPDATE sale SET status = 'VOIDED', void_reason = 'RECALLED', voided_at = now() WHERE id = $1 AND status = 'HELD'`, [input.hold_id]);
  return { ...(await loadSaleFull(tx, saleId))!, duplicate: false, skipped };
}

/** 退货销售（审批通过或外部系统）：正金额 + sale_type RETURN；RETURN 移动 CUSTOMER → 原位置。 */
export async function createReturnSale(tx: Tx, cxx: { companyId: string; userId: string; deviceId?: string | null }, input: { original_sale_id: string; lines: { sale_line_id?: string; line_no?: number; product_id?: string; qty: number }[]; reason?: string | null; approval_id?: string | null; method?: string | null; external_ref?: string | null; source?: 'OWN_POS' | 'PANDAL' | 'WEB'; performed_by?: string | null; client_id?: string | null }) {
  if (input.external_ref) { const ex = (await tx.query(`SELECT id FROM sale WHERE external_ref = $1`, [input.external_ref])).rows[0]; if (ex) return { ...(await loadSaleFull(tx, ex.id))!, duplicate: true }; }
  if (input.client_id) { const ex = (await tx.query(`SELECT id FROM sale WHERE client_id = $1`, [input.client_id])).rows[0]; if (ex) return { ...(await loadSaleFull(tx, ex.id))!, duplicate: true }; }
  await ensureSaleReasons(tx, cxx.companyId);
  const orig = await loadSaleFull(tx, input.original_sale_id);
  if (!orig) throw notFound('RECEIPT_NOT_FOUND');
  if (orig.sale_type === 'RETURN' || orig.status === 'VOIDED' || orig.status === 'HELD') throw new AppError(400, 'VALIDATION', 'cannot return this sale');
  const site = await resolveSite(tx, orig.site_id);
  const performer = input.performed_by ?? orig.cashier_id ?? cxx.userId;
  const customerLoc = await virtualLoc(tx, 'CUSTOMER');
  const picked: { ol: any; qty: number; refund: number; tax: number }[] = [];
  for (const li of input.lines) {
    const ol = orig.lines.find((l: any) => (li.sale_line_id && l.id === li.sale_line_id) || (li.line_no && l.line_no === li.line_no) || (!li.sale_line_id && !li.line_no && li.product_id && l.product_id === li.product_id));
    if (!ol) throw new AppError(400, 'VALIDATION', `line not in sale`);
    const avail = Number(ol.qty) - Number(ol.returned_qty);
    const qty = Number(li.qty);
    if (!(qty > 0) || qty > avail + 1e-9) throw new AppError(400, 'VALIDATION', { message: 'return qty exceeds sold', line: ol.line_no, available: avail });
    const refund = r2(Number(ol.line_total) / Number(ol.qty) * qty);
    picked.push({ ol, qty, refund, tax: r2(refund - refund / (1 + Number(ol.tax_rate) / 100)) });
  }
  if (!picked.length) throw new AppError(400, 'VALIDATION', 'no lines');
  const total = r2(picked.reduce((a, p) => a + p.refund, 0));
  const tax = r2(picked.reduce((a, p) => a + p.tax, 0));
  const method = input.method ?? (orig.payments.find((p: any) => p.method === 'CASH') ?? orig.payments[0])?.method ?? 'CASH';
  const terminal = orig.terminal_code ?? 'RET';
  const session = await currentSession(tx, site.id, terminal);
  const receipt_no = await nextDocNo(tx, cxx.companyId, 'RCPT', `${site.code}-${terminal}-`, `${site.id}:${terminal}`, 6);
  const id = (await tx.query(`SELECT uuid_v7() id`)).rows[0].id as string;
  await tx.query(
    `INSERT INTO sale (id, company_id, site_id, receipt_no, sale_type, source, external_ref, customer_id, cashier_id, terminal_code, drawer_session_id, subtotal, discount_total, tax_amount, rounding, total, paid_total, change_amount, status, sold_at, original_sale_id, approval_id, client_id, note)
     VALUES ($1,$2,$3,$4,'RETURN',$5,$6,$7,$8,$9,$10,$11,0,$12,0,$11,$11,0,'COMPLETED',now(),$13,$14,$15,$16)`,
    [id, cxx.companyId, site.id, receipt_no, input.source ?? orig.source, input.external_ref ?? null, orig.customer_id, performer, terminal, session?.id ?? null, total, tax, orig.id, input.approval_id ?? null, input.client_id ?? null, input.reason ?? null]);
  let n = 0;
  for (const p of picked) {
    const toLoc = p.ol.from_location_id ?? await resolveSaleLocation(tx, { id: p.ol.product_id, category_id: (await tx.query(`SELECT category_id FROM product WHERE id = $1`, [p.ol.product_id])).rows[0].category_id }, site.id);
    const mv = await applyMovement(tx, { companyId: cxx.companyId, userId: performer, deviceId: cxx.deviceId ?? null }, { product_id: p.ol.product_id, from_location_id: customerLoc, to_location_id: toLoc, qty: p.qty, reason: 'RETURN', ref_type: 'RETURN', ref_id: id, note: input.reason ? input.reason.slice(0, 200) : null });
    await tx.query(`INSERT INTO sale_line (company_id, sale_id, line_no, product_id, barcode_scanned, qty, weight_kg, unit_price, discount, discount_pct, tax_code_id, tax_rate, tax_amount, line_total, unit_cost, from_location_id, movement_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,0,$9,$10,$11,$12,$13,$14,$15)`,
      [cxx.companyId, id, p.ol.line_no, p.ol.product_id, p.ol.barcode_scanned, p.qty, p.ol.is_weighed ? p.qty : null, p.ol.unit_price, (await tx.query(`SELECT tax_code_id FROM product WHERE id = $1`, [p.ol.product_id])).rows[0].tax_code_id, p.ol.tax_rate, p.tax, p.refund, p.ol.unit_cost ?? 0, toLoc, mv.id]);
    n++;
  }
  await tx.query(`INSERT INTO payment (company_id, sale_id, customer_id, method, amount, received_by, drawer_session_id) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [cxx.companyId, id, orig.customer_id, method, -total, cxx.userId, session?.id ?? null]);
  if (session) {
    if (method === 'CASH') await tx.query(`UPDATE cash_drawer_session SET refund_total = refund_total + $2 WHERE id = $1`, [session.id, total]);
    else if (method === 'CARD') await tx.query(`UPDATE cash_drawer_session SET card_total = card_total - $2 WHERE id = $1`, [session.id, total]);
    else if (method === 'EWALLET') await tx.query(`UPDATE cash_drawer_session SET ewallet_total = ewallet_total - $2 WHERE id = $1`, [session.id, total]);
  }
  if (method === 'CREDIT' && orig.customer_id) {
    await tx.query(`UPDATE customer SET balance = balance - $2 WHERE id = $1`, [orig.customer_id, total]);
    await tx.query(`UPDATE invoice SET paid_amount = paid_amount + $2, status = CASE WHEN paid_amount + $2 >= total THEN 'PAID' ELSE 'PARTIAL' END WHERE sale_id = $1 AND status IN ('UNPAID','PARTIAL','OVERDUE')`, [orig.id, total]);
  }
  await tx.query(`UPDATE sale SET status = 'COMPLETED' WHERE id = $1 AND status = 'PENDING_RETURN'`, [orig.id]);
  return { ...(await loadSaleFull(tx, id))!, duplicate: false, lines_count: n };
}

/** 作废已完成销售：反向 RETURN 移动、班次合计回退、B2B 余额回退 */
export async function voidSale(tx: Tx, cxx: { companyId: string; userId: string; deviceId?: string | null }, saleId: string, reason: string, approvalId?: string | null) {
  const s = await loadSaleFull(tx, saleId);
  if (!s) throw notFound('NOT_FOUND');
  if (s.status === 'VOIDED') return { ...s, duplicate: true };
  if (s.status === 'HELD') { await tx.query(`UPDATE sale SET status = 'VOIDED', void_reason = $2, voided_at = now(), voided_by = $3 WHERE id = $1`, [saleId, reason, cxx.userId]); return { ...(await loadSaleFull(tx, saleId))!, duplicate: false }; }
  if (s.sale_type === 'RETURN') throw new AppError(400, 'VALIDATION', 'cannot void a return');
  await ensureSaleReasons(tx, cxx.companyId);
  const performer = s.cashier_id ?? cxx.userId;
  const customerLoc = await virtualLoc(tx, 'CUSTOMER');
  for (const l of s.lines) {
    if (!l.movement_id || !l.from_location_id) continue;
    await applyMovement(tx, { companyId: cxx.companyId, userId: performer, deviceId: cxx.deviceId ?? null }, { product_id: l.product_id, from_location_id: customerLoc, to_location_id: l.from_location_id, qty: Number(l.qty), reason: 'RETURN', ref_type: 'SALE', ref_id: saleId, note: `VOID ${reason}`.slice(0, 200) });
  }
  await tx.query(`UPDATE sale SET status = 'VOIDED', void_reason = $2, voided_at = now(), voided_by = $3, approval_id = COALESCE($4, approval_id) WHERE id = $1`, [saleId, reason, cxx.userId, approvalId ?? null]);
  if (s.drawer_session_id) {
    const cash = r2(s.payments.filter((p: any) => p.method === 'CASH').reduce((a: number, p: any) => a + Number(p.amount), 0));
    const card = r2(s.payments.filter((p: any) => p.method === 'CARD').reduce((a: number, p: any) => a + Number(p.amount), 0));
    const ew = r2(s.payments.filter((p: any) => p.method === 'EWALLET').reduce((a: number, p: any) => a + Number(p.amount), 0));
    await tx.query(`UPDATE cash_drawer_session SET sales_total = sales_total - $2, sales_count = sales_count - 1, cash_total = cash_total - $3, card_total = card_total - $4, ewallet_total = ewallet_total - $5 WHERE id = $1`, [s.drawer_session_id, s.total, cash, card, ew]);
  }
  if (s.sale_type === 'B2B' && s.customer_id) {
    await tx.query(`UPDATE customer SET balance = balance - $2 WHERE id = $1`, [s.customer_id, s.total]);
    await tx.query(`UPDATE invoice SET status = 'CANCELLED' WHERE sale_id = $1`, [saleId]);
  }
  return { ...(await loadSaleFull(tx, saleId))!, duplicate: false };
}

async function sessionWithTotals(tx: Tx, id: string) {
  return (await tx.query(`SELECT s.*, u.name AS cashier_name, st.code AS site_code, (s.opening_cash + s.cash_total - s.refund_total) AS expected_now FROM cash_drawer_session s JOIN app_user u ON u.id = s.cashier_id JOIN site st ON st.id = s.site_id WHERE s.id = $1`, [id])).rows[0];
}

export async function posRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  // ---------- 开班 / 日结 ----------
  app.post('/pos/sessions/open', { preHandler: requirePerm('pos.sell') }, async (req, reply) => {
    const b = z.object({ terminal_code: z.string().min(1).max(10), opening_cash: z.number().min(0).default(0), device_id: z.string().uuid().optional().nullable(), client_id: z.string().uuid().optional().nullable() }).parse(req.body);
    return withCompany(cx(req), async (tx) => {
      const site = await resolveSite(tx, req.ctx.siteId);
      const open = await currentSession(tx, site.id, b.terminal_code);
      if (open) { if (b.client_id && open.created_by === req.ctx.userId && Math.abs(new Date(open.opened_at).getTime() - Date.now()) < 60_000) return sessionWithTotals(tx, open.id); throw new AppError(409, 'SESSION_ALREADY_OPEN', { session_id: open.id, cashier_id: open.cashier_id }); }
      const r = (await tx.query(`INSERT INTO cash_drawer_session (company_id, site_id, device_id, terminal_code, cashier_id, opening_cash) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [req.ctx.companyId, site.id, b.device_id ?? req.ctx.deviceId ?? null, b.terminal_code, req.ctx.userId, b.opening_cash])).rows[0];
      reply.status(201);
      return sessionWithTotals(tx, r.id);
    });
  });
  app.get('/pos/sessions/current', { preHandler: requirePerm('pos.sell', 'pos.close') }, async (req) => {
    const q = z.object({ terminal_code: z.string().optional() }).parse(req.query);
    return withCompany(cx(req), async (tx) => {
      const site = await resolveSite(tx, req.ctx.siteId);
      const s = q.terminal_code ? await currentSession(tx, site.id, q.terminal_code) : (await tx.query(`SELECT * FROM cash_drawer_session WHERE site_id = $1 AND cashier_id = $2 AND status = 'OPEN' ORDER BY opened_at DESC LIMIT 1`, [site.id, req.ctx.userId])).rows[0];
      return { session: s ? await sessionWithTotals(tx, s.id) : null, site: { id: site.id, code: site.code, name: site.name } };
    });
  });
  app.post('/pos/sessions/:id/close', { preHandler: requirePerm('pos.close') }, async (req) => {
    const { id } = req.params as any;
    const b = z.object({ counted_cash: z.number().min(0), note: z.string().max(200).optional().nullable() }).parse(req.body);
    const res = await withCompany(cx(req), async (tx) => {
      const s = (await tx.query(`SELECT * FROM cash_drawer_session WHERE id = $1 FOR UPDATE`, [id])).rows[0];
      if (!s) throw notFound('NOT_FOUND');
      if (s.status !== 'OPEN') throw new AppError(409, 'NO_OPEN_SESSION');
      const expected = r2(Number(s.opening_cash) + Number(s.cash_total) - Number(s.refund_total));
      const variance = r2(b.counted_cash - expected);
      await tx.query(`UPDATE cash_drawer_session SET status = 'CLOSED', closed_at = now(), expected_cash = $2, counted_cash = $3, variance = $4 WHERE id = $1`, [id, expected, b.counted_cash, variance]);
      const full = await sessionWithTotals(tx, id);
      const agg = (await tx.query(`SELECT coalesce(sum(tax_amount),0) tax, coalesce(sum(discount_total),0) disc, coalesce(sum(rounding),0) rnd, count(*) FILTER (WHERE status = 'VOIDED') voided, count(*) FILTER (WHERE sale_type = 'RETURN') returns FROM sale WHERE drawer_session_id = $1`, [id])).rows[0];
      const byHour = (await tx.query(`SELECT to_char(sold_at AT TIME ZONE 'Asia/Kuala_Lumpur', 'HH24') AS hour, count(*) AS count, coalesce(sum(total),0) AS total FROM sale WHERE drawer_session_id = $1 AND status = 'COMPLETED' AND sale_type <> 'RETURN' GROUP BY 1 ORDER BY 1`, [id])).rows;
      const company = (await tx.query(`SELECT name FROM company WHERE id = $1`, [req.ctx.companyId])).rows[0];
      const zd = { company, site: { code: full.site_code }, terminal_code: s.terminal_code, cashier_name: full.cashier_name, opened_at: s.opened_at, closed_at: new Date(), opening_cash: s.opening_cash, sales_count: s.sales_count, sales_total: s.sales_total, cash_total: s.cash_total, card_total: s.card_total, ewallet_total: s.ewallet_total, refund_total: s.refund_total, expected_cash: expected, counted_cash: b.counted_cash, variance, tax_total: agg.tax, discount_total: agg.disc, rounding_total: agg.rnd, voided_count: Number(agg.voided), return_count: Number(agg.returns), by_hour: byHour.map((h: any) => ({ hour: h.hour, count: Number(h.count), total: Number(h.total) })) };
      const z_report = buildZReport(zd);
      const { writeFile, mkdir } = await import('node:fs/promises'); const { join } = await import('node:path');
      const name = `z-${full.site_code}-${s.terminal_code}-${new Date().toISOString().slice(0, 10)}-${String(id).slice(0, 8)}.txt`;
      await mkdir(config.uploadDir, { recursive: true }); await writeFile(join(config.uploadDir, name), z_report);
      const url = signedFileUrl(name);
      await tx.query(`UPDATE cash_drawer_session SET z_report_url = $2 WHERE id = $1`, [id, url]);
      const threshold = Number(req.ctx.settings?.cash_variance_ticket ?? 20);
      let ticket_id: string | null = null;
      if (Math.abs(variance) > threshold) {
        ticket_id = (await tx.query(`INSERT INTO ticket (company_id, site_id, type, title, ref_type, ref_id, owner_role_code, priority, deadline_at) VALUES ($1,$2,'MANUAL',$3,'cash_drawer_session',$4,$5,'HIGH', now() + interval '1 day') RETURNING id`,
          [req.ctx.companyId, s.site_id, `现金差额 ${variance > 0 ? '+' : ''}${variance.toFixed(2)}（${full.site_code}-${s.terminal_code} ${full.cashier_name}）`, id, req.ctx.plan === 'A' ? 'BOSS' : 'MANAGER'])).rows[0].id;
      }
      return { ...full, z_report_url: url, z_report, z_report_escpos_base64: buildZReportEscPos(zd).toString('base64'), ticket_id, variance_threshold: threshold };
    });
    void tgSend(req.ctx.companyId, `<b>日结</b> ${res.site_code}-${res.terminal_code} · ${res.cashier_name}\n销售 RM ${Number(res.sales_total).toFixed(2)} · ${res.sales_count} 笔 · 退款 RM ${Number(res.refund_total).toFixed(2)}\n现金 预期 ${Number(res.expected_cash).toFixed(2)} 实数 ${Number(res.counted_cash).toFixed(2)} 差额 ${Number(res.variance) > 0 ? '+' : ''}${Number(res.variance).toFixed(2)}${res.ticket_id ? '\n⚠️ 差额超限，已开工单' : ''}`, undefined, { type: 'Z_REPORT', refType: 'cash_drawer_session', refId: res.id });
    return res;
  });
  app.get('/pos/sessions', { preHandler: requirePerm('pos.close', 'report.sales') }, async (req) => {
    const q = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), site: z.string().uuid().optional(), status: z.enum(['OPEN', 'CLOSED']).optional() }).parse(req.query);
    return withCompany(cx(req), async (tx) => {
      const date = q.date ?? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date());
      const siteId = q.site ?? req.ctx.siteId;
      const rows = (await tx.query(`SELECT s.*, u.name AS cashier_name, st.code AS site_code FROM cash_drawer_session s JOIN app_user u ON u.id = s.cashier_id JOIN site st ON st.id = s.site_id
        WHERE (s.opened_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date = $1::date AND ($2::uuid IS NULL OR s.site_id = $2) AND ($3::text IS NULL OR s.status = $3) ORDER BY st.code, s.terminal_code, s.opened_at`, [date, siteId, q.status ?? null])).rows;
      const sum = (k: string) => r2(rows.reduce((a: number, r: any) => a + Number(r[k] ?? 0), 0));
      return { date, sessions: rows, totals: { sales_total: sum('sales_total'), sales_count: rows.reduce((a: number, r: any) => a + Number(r.sales_count), 0), cash_total: sum('cash_total'), card_total: sum('card_total'), ewallet_total: sum('ewallet_total'), refund_total: sum('refund_total'), variance: sum('variance') } };
    });
  });

  // ---------- 瘦目录 ----------
  app.get('/pos/catalog', { preHandler: requirePerm('pos.sell', 'product.view') }, async (req) => {
    const q = z.object({ since: z.string().optional(), limit: z.coerce.number().min(1).max(5000).default(2000) }).parse(req.query);
    return withCompany(cx(req), async (tx) => {
      const rows = (await tx.query(`SELECT p.id, p.sku, p.name_zh, p.name_ms, p.name_en, p.name_pinyin, p.search_text, p.photo_url, p.category_id, p.unit, p.is_weighed, p.plu_code, p.sell_price, p.tax_code_id, t.rate AS tax_rate, p.is_active, p.updated_at,
          coalesce((SELECT json_agg(json_build_object('barcode', b.barcode, 'pack_qty', b.pack_qty, 'barcode_type', b.barcode_type, 'is_primary', b.is_primary) ORDER BY b.is_primary DESC) FROM barcode b WHERE b.product_id = p.id), '[]'::json) AS barcodes,
          (SELECT sa.location_id FROM shelf_assignment sa WHERE sa.product_id = p.id AND sa.is_primary AND sa.is_active AND ($2::uuid IS NULL OR sa.site_id = $2) LIMIT 1) AS shelf_location_id
        FROM product p JOIN tax_code t ON t.id = p.tax_code_id WHERE ($1::timestamptz IS NULL OR p.updated_at > $1) ORDER BY p.updated_at, p.id LIMIT $3`, [q.since ?? null, req.ctx.siteId, q.limit + 1])).rows;
      const has_more = rows.length > q.limit; if (has_more) rows.pop();
      return { data: rows, has_more, next_since: rows.length ? rows[rows.length - 1].updated_at : q.since ?? null, server_time: new Date().toISOString(), settings: { cash_rounding: req.ctx.settings?.cash_rounding ?? 0.05, cashier_discount_max_pct: req.ctx.settings?.cashier_discount_max_pct ?? 5, scale_barcode_format: req.ctx.settings?.scale_barcode_format ?? null } };
    });
  });
  app.get('/pos/customers', { preHandler: requirePerm('pos.sell', 'pos.b2b') }, async (req) => {
    const q = z.object({ search: z.string().optional(), limit: z.coerce.number().max(100).default(30) }).parse(req.query);
    return withCompany(cx(req), async (tx) => (await tx.query(`SELECT id, code, name, tin, phone, email, credit_terms_days, credit_limit, balance, (credit_limit - balance) AS credit_available, is_member, credit_status, einvoice_profile FROM customer WHERE is_active AND ($1::text IS NULL OR name ILIKE '%' || $1 || '%' OR code ILIKE '%' || $1 || '%' OR phone ILIKE '%' || $1 || '%') ORDER BY name LIMIT $2`, [q.search || null, q.limit])).rows);
  });

  // ---------- 销售 ----------
  app.post('/pos/sales', { preHandler: requirePerm('pos.sell') }, async (req, reply) => {
    const b = saleSchema.parse(req.body);
    if (b.sale_type === 'B2B' && !hasPerm(req.ctx, 'pos.b2b')) throw new AppError(403, 'FORBIDDEN', { need: ['pos.b2b'] });
    // 记下收银机用的公网地址，收据二维码要用（localhost 不记）
    const origin = String(req.headers.origin ?? '');
    if (origin && !/\/\/(localhost|127\.)/.test(origin) && req.ctx.settings?.public_url !== origin) { await adminPool.query(`UPDATE company SET settings = settings || jsonb_build_object('public_url', $2::text) WHERE id = $1`, [req.ctx.companyId, origin]); req.ctx.settings = { ...(req.ctx.settings ?? {}), public_url: origin }; }
    const r = await withCompany(cx(req), (tx) => createSale(tx, saleCtx(req.ctx, b.device_id), b, { source: 'OWN_POS' }));
    reply.status(r.duplicate ? 200 : 201);
    return stripCost(req.ctx, r);
  });
  app.get('/pos/sales', { preHandler: requirePerm('pos.sell', 'report.sales') }, async (req) => {
    const q = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), terminal_code: z.string().optional(), session_id: z.string().uuid().optional(), limit: z.coerce.number().max(500).default(100) }).parse(req.query);
    return withCompany(cx(req), async (tx) => {
      const date = q.date ?? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date());
      return (await tx.query(`SELECT s.id, s.receipt_no, s.sale_type, s.source, s.status, s.total, s.paid_total, s.change_amount, s.sold_at, s.terminal_code, s.customer_id, s.einvoice_required, (SELECT count(*) FROM sale_line l WHERE l.sale_id = s.id) AS line_count
        FROM sale s WHERE (s.sold_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date = $1::date AND ($2::uuid IS NULL OR s.site_id = $2) AND ($3::text IS NULL OR s.terminal_code = $3) AND ($4::uuid IS NULL OR s.drawer_session_id = $4) AND s.status <> 'HELD' ORDER BY s.sold_at DESC LIMIT $5`, [date, req.ctx.siteId, q.terminal_code ?? null, q.session_id ?? null, q.limit])).rows;
    });
  });

  // ---------- 挂单 ----------
  app.post('/pos/sales/hold', { preHandler: requirePerm('pos.sell') }, async (req, reply) => {
    const b = z.object({ client_id: z.string().uuid().optional().nullable(), terminal_code: z.string().default('P1'), customer_id: z.string().uuid().optional().nullable(), note: z.string().max(200).optional().nullable(),
      lines: z.array(z.object({ product_id: z.string().uuid(), qty: z.number().positive(), weight_kg: z.number().positive().optional().nullable(), unit_price: z.number().min(0).optional().nullable(), discount_pct: z.number().min(0).max(100).optional().nullable(), discount: z.number().min(0).optional().nullable(), barcode: z.string().optional().nullable() })).min(1) }).parse(req.body);
    return withCompany(cx(req), async (tx) => {
      if (b.client_id) { const ex = (await tx.query(`SELECT id FROM sale WHERE client_id = $1`, [b.client_id])).rows[0]; if (ex) return loadSaleFull(tx, ex.id); }
      const site = await resolveSite(tx, req.ctx.siteId);
      const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date());
      const hold_code = await nextDocNo(tx, req.ctx.companyId, 'HOLD', 'H-', `${site.id}:${day}`, 2);
      const receipt_no = `HOLD-${site.code}-${b.terminal_code}-${day.replace(/-/g, '')}-${hold_code}`;
      let total = 0;
      const prods: any[] = [];
      for (const l of b.lines) {
        const p = (await tx.query(`SELECT p.*, t.rate AS tax_rate FROM product p JOIN tax_code t ON t.id = p.tax_code_id WHERE p.id = $1`, [l.product_id])).rows[0];
        if (!p) throw notFound('PRODUCT_NOT_FOUND');
        const qty = p.is_weighed ? Number(l.weight_kg ?? l.qty) : Number(l.qty);
        const unit = l.unit_price ?? Number(p.sell_price); const gross = r2(qty * unit);
        const disc = l.discount != null ? r2(l.discount) : l.discount_pct ? r2(gross * l.discount_pct / 100) : 0;
        const lt = r2(gross - disc); total += lt;
        prods.push({ p, qty, unit, disc, pct: l.discount_pct ?? 0, lt, tax: r2(lt - lt / (1 + Number(p.tax_rate) / 100)), barcode: l.barcode ?? null, weight: p.is_weighed ? qty : null });
      }
      const s = (await tx.query(`INSERT INTO sale (company_id, site_id, receipt_no, sale_type, source, customer_id, cashier_id, terminal_code, subtotal, total, status, hold_code, client_id, note) VALUES ($1,$2,$3,'RETAIL','OWN_POS',$4,$5,$6,$7,$7,'HELD',$8,$9,$10) RETURNING id`,
        [req.ctx.companyId, site.id, receipt_no, b.customer_id ?? null, req.ctx.userId, b.terminal_code, r2(total), hold_code, b.client_id ?? null, b.note ?? null])).rows[0];
      let n = 0;
      for (const x of prods) { n++; await tx.query(`INSERT INTO sale_line (company_id, sale_id, line_no, product_id, barcode_scanned, qty, weight_kg, unit_price, discount, discount_pct, tax_code_id, tax_rate, tax_amount, line_total, unit_cost) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`, [req.ctx.companyId, s.id, n, x.p.id, x.barcode, x.qty, x.weight, x.unit, x.disc, x.pct, x.p.tax_code_id, x.p.tax_rate, x.tax, x.lt, x.p.cost_price]); }
      reply.status(201);
      return stripCost(req.ctx, (await loadSaleFull(tx, s.id))!);
    });
  });
  app.get('/pos/sales/held', { preHandler: requirePerm('pos.sell') }, async (req) => {
    const q = z.object({ site: z.string().uuid().optional() }).parse(req.query);
    return withCompany(cx(req), async (tx) => (await tx.query(`SELECT s.id, s.hold_code, s.terminal_code, s.total, s.created_at, s.customer_id, c.name AS customer_name, u.name AS cashier_name, (SELECT count(*) FROM sale_line l WHERE l.sale_id = s.id) AS line_count,
      (SELECT json_agg(json_build_object('product_id', l.product_id, 'qty', l.qty, 'name_zh', p.name_zh, 'name_ms', p.name_ms, 'name_en', p.name_en) ORDER BY l.line_no) FROM sale_line l JOIN product p ON p.id = l.product_id WHERE l.sale_id = s.id) AS lines
      FROM sale s LEFT JOIN customer c ON c.id = s.customer_id LEFT JOIN app_user u ON u.id = s.cashier_id WHERE s.status = 'HELD' AND ($1::uuid IS NULL OR s.site_id = $1) ORDER BY s.created_at`, [q.site ?? req.ctx.siteId ?? null])).rows);
  });
  const recall = async (tx: Tx, req: any, where: string, param: string) => {
    const s = (await tx.query(`SELECT id FROM sale WHERE status = 'HELD' AND ${where}`, [param])).rows[0];
    if (!s) throw notFound('HOLD_NOT_FOUND');
    const full = (await loadSaleFull(tx, s.id))!;
    await tx.query(`UPDATE sale SET status = 'VOIDED', void_reason = 'RECALLED', voided_at = now(), voided_by = $2 WHERE id = $1`, [s.id, req.ctx.userId]);
    return stripCost(req.ctx, { ...full, status: 'RECALLED' });
  };
  app.post('/pos/sales/held/:id/recall', { preHandler: requirePerm('pos.sell') }, async (req) => withCompany(cx(req), (tx) => recall(tx, req, 'id = $1', (req.params as any).id)));
  app.get('/pos/sales/hold/:code', { preHandler: requirePerm('pos.sell') }, async (req) => withCompany(cx(req), (tx) => recall(tx, req, 'hold_code = $1', (req.params as any).code)));

  // ---------- 收据 / 退货 / 作废 ----------
  app.get('/pos/sales/by-receipt/:receipt_no', { preHandler: requirePerm('pos.sell', 'report.sales') }, async (req) => {
    const no = String((req.params as any).receipt_no).replace(/^RCPT:/i, '');
    return withCompany(cx(req), async (tx) => {
      const s = (await tx.query(`SELECT id FROM sale WHERE receipt_no = $1`, [no])).rows[0];
      if (!s) throw notFound('RECEIPT_NOT_FOUND');
      const full = (await loadSaleFull(tx, s.id))!;
      const returns = (await tx.query(`SELECT id, receipt_no, total, sold_at, status FROM sale WHERE original_sale_id = $1 AND sale_type = 'RETURN' ORDER BY sold_at`, [s.id])).rows;
      const pending = (await tx.query(`SELECT id, status, created_at FROM approval_request WHERE type = 'RETURN' AND ref_type = 'sale' AND ref_id = $1 AND status = 'PENDING'`, [s.id])).rows;
      return stripCost(req.ctx, { ...full, returns, pending_return_approvals: pending });
    });
  });
  app.get('/pos/sales/:id', { preHandler: requirePerm('pos.sell', 'report.sales') }, async (req) => withCompany(cx(req), async (tx) => { const f = await loadSaleFull(tx, (req.params as any).id); if (!f) throw notFound('NOT_FOUND'); return stripCost(req.ctx, f); }));

  app.post('/pos/returns', { preHandler: requirePerm('pos.sell', 'movement.return') }, async (req, reply) => {
    const b = z.object({ sale_id: z.string().uuid().optional(), receipt_no: z.string().optional(), lines: z.array(z.object({ sale_line_id: z.string().uuid().optional(), line_no: z.number().int().optional(), qty: z.number().positive() })).min(1), reason: z.string().min(1).max(200), terminal_code: z.string().optional(), client_id: z.string().uuid().optional().nullable() }).parse(req.body);
    return withCompany(cx(req), async (tx) => {
      const saleId = b.sale_id ?? (await tx.query(`SELECT id FROM sale WHERE receipt_no = $1`, [String(b.receipt_no ?? '').replace(/^RCPT:/i, '')])).rows[0]?.id;
      if (!saleId) throw notFound('RECEIPT_NOT_FOUND');
      const orig = await loadSaleFull(tx, saleId);
      if (!orig || orig.status === 'HELD' || orig.status === 'VOIDED' || orig.sale_type === 'RETURN') throw new AppError(400, 'VALIDATION', 'sale not returnable');
      const dup = (await tx.query(`SELECT id, status FROM approval_request WHERE type = 'RETURN' AND ref_type = 'sale' AND ref_id = $1 AND status = 'PENDING'`, [saleId])).rows[0];
      if (dup) return { approval: dup, duplicate: true, sale_id: saleId };
      let refund = 0; const items: any[] = [];
      for (const li of b.lines) {
        const ol = orig.lines.find((l: any) => (li.sale_line_id && l.id === li.sale_line_id) || (li.line_no && l.line_no === li.line_no));
        if (!ol) throw new AppError(400, 'VALIDATION', 'line not in sale');
        const avail = Number(ol.qty) - Number(ol.returned_qty); if (li.qty > avail + 1e-9) throw new AppError(400, 'VALIDATION', { message: 'qty exceeds', available: avail });
        const amt = r2(Number(ol.line_total) / Number(ol.qty) * li.qty); refund += amt;
        items.push({ sale_line_id: ol.id, line_no: ol.line_no, product_id: ol.product_id, name: ol.name_zh || ol.name_en || ol.name_ms, qty: li.qty, amount: amt });
      }
      refund = r2(refund);
      const method = (orig.payments.find((p: any) => p.method === 'CASH') ?? orig.payments[0])?.method ?? 'CASH';
      const a = await createApproval(tx, req.ctx, { type: 'RETURN', ref_type: 'sale', ref_id: saleId, amount: refund, site_id: orig.site_id,
        summary: { title: `退货 ${orig.receipt_no} RM ${refund.toFixed(2)}`, receipt_no: orig.receipt_no, sale_id: saleId, lines: items, reason: b.reason, method, terminal_code: b.terminal_code ?? orig.terminal_code, cashier_id: req.ctx.userId, cashier_name: req.ctx.name },
        text: `<b>退货审批</b>\n收据 ${orig.receipt_no}\n${items.map((i) => `${i.name} × ${i.qty}  RM ${i.amount.toFixed(2)}`).join('\n')}\n退款 RM ${refund.toFixed(2)}（${method}）\n原因：${b.reason}\n收银员：${req.ctx.name}` });
      await tx.query(`UPDATE sale SET status = 'PENDING_RETURN' WHERE id = $1 AND status = 'COMPLETED'`, [saleId]);
      reply.status(201);
      return { approval: a, refund, method, sale_id: saleId, duplicate: false };
    });
  });
  registerApprovalHandler('RETURN', async (tx, ctx, a, decision) => {
    if (a.ref_type !== 'sale') return;
    const s = a.summary ?? {};
    if (decision === 'approve') {
      await createReturnSale(tx, { companyId: ctx.companyId, userId: ctx.userId, deviceId: ctx.deviceId }, { original_sale_id: a.ref_id, lines: (s.lines ?? []).map((l: any) => ({ sale_line_id: l.sale_line_id, line_no: l.line_no, qty: Number(l.qty) })), reason: s.reason, approval_id: a.id, method: s.method, performed_by: a.requested_by });
      void tgSendToUser(ctx.companyId, a.requested_by, `✅ 退货已批准：收据 ${s.receipt_no} 退款 RM ${Number(a.amount).toFixed(2)}`, undefined, 'RETURN');
    } else {
      await tx.query(`UPDATE sale SET status = 'COMPLETED' WHERE id = $1 AND status = 'PENDING_RETURN'`, [a.ref_id]);
      void tgSendToUser(ctx.companyId, a.requested_by, `❌ 退货被${decision === 'reject' ? '拒绝' : '退回'}：收据 ${s.receipt_no}${a.decision_note ? `\n${a.decision_note}` : ''}`, undefined, 'RETURN');
    }
  });

  app.post('/pos/sales/:id/void', { preHandler: requirePerm('pos.sell', 'pos.void_open', 'pos.void_closed') }, async (req) => {
    const { id } = req.params as any;
    const b = z.object({ reason: z.string().min(1).max(200) }).parse(req.body);
    return withCompany(cx(req), async (tx) => {
      const s = (await tx.query(`SELECT * FROM sale WHERE id = $1`, [id])).rows[0];
      if (!s) throw notFound('NOT_FOUND');
      if (s.status === 'VOIDED') return { ...(await loadSaleFull(tx, id))!, duplicate: true };
      if (s.status === 'HELD') {
        if (!(s.cashier_id === req.ctx.userId || hasPerm(req.ctx, 'pos.void_open'))) throw new AppError(403, 'FORBIDDEN', { need: ['pos.void_open'] });
        return stripCost(req.ctx, await voidSale(tx, cx(req), id, b.reason));
      }
      if (!hasPerm(req.ctx, 'pos.void_closed')) throw new AppError(403, 'FORBIDDEN', { need: ['pos.void_closed'] });
      if (req.ctx.plan === 'B' && !req.ctx.roles.includes('BOSS') && !req.ctx.isSuperAdmin) {
        const dup = (await tx.query(`SELECT * FROM approval_request WHERE type = 'VOID_SALE' AND ref_id = $1 AND status = 'PENDING'`, [id])).rows[0];
        const a = dup ?? await createApproval(tx, req.ctx, { type: 'VOID_SALE', ref_type: 'sale', ref_id: id, amount: s.total, site_id: s.site_id, summary: { title: `作废 ${s.receipt_no} RM ${Number(s.total).toFixed(2)}`, receipt_no: s.receipt_no, reason: b.reason, requested_name: req.ctx.name } });
        return { approval: a, pending: true, sale_id: id };
      }
      return stripCost(req.ctx, await voidSale(tx, cx(req), id, b.reason));
    });
  });
  registerApprovalHandler('VOID_SALE', async (tx, ctx, a, decision) => {
    if (a.ref_type !== 'sale') return;
    if (decision === 'approve') await voidSale(tx, { companyId: ctx.companyId, userId: ctx.userId, deviceId: ctx.deviceId }, a.ref_id, a.summary?.reason ?? 'VOID', a.id);
    void tgSendToUser(ctx.companyId, a.requested_by, `${decision === 'approve' ? '✅ 作废已批准' : '❌ 作废被拒绝'}：收据 ${a.summary?.receipt_no ?? ''}`, undefined, 'VOID_SALE');
  });

  // ---------- 称重码 ----------
  app.post('/pos/scale-barcode/parse', { preHandler: requirePerm('pos.sell', 'product.view') }, async (req) => {
    const b = z.object({ barcode: z.string().min(8).max(20) }).parse(req.body);
    const fmt = req.ctx.settings?.scale_barcode_format;
    const parsed = parseScaleBarcode(b.barcode, fmt);
    if (!parsed) throw new AppError(400, 'VALIDATION', 'not a scale barcode');
    return withCompany(cx(req), async (tx) => {
      const p = (await tx.query(`SELECT p.*, t.rate AS tax_rate FROM product p JOIN tax_code t ON t.id = p.tax_code_id WHERE p.plu_code = $1 AND p.is_weighed`, [parsed.plu])).rows[0];
      if (!p) throw notFound('PRODUCT_NOT_FOUND');
      const weight_kg = parsed.weight_kg ?? (parsed.price != null ? r2(parsed.price / Number(p.sell_price)) : null);
      return { product: stripCost(req.ctx, p), plu: parsed.plu, weight_kg, price: parsed.price ?? (weight_kg != null ? r2(weight_kg * Number(p.sell_price)) : null), format: fmt ?? { prefix: '2', plu_len: 5, weight_len: 5, unit: 'g' } };
    });
  });

  // ---------- 离线同步：entity 'sale' ----------
  registerSyncHandler('sale', async (tx, ctx, clientId, payload, deviceId) => {
    if (!hasPerm(ctx, 'pos.sell')) throw new AppError(403, 'PERMISSION_DENIED', 'pos.sell');
    const b = saleSchema.parse({ ...payload, client_id: clientId });
    const r = await createSale(tx, saleCtx(ctx, deviceId), b, { source: 'OWN_POS', require_session: false });
    return r.id;
  });
}
