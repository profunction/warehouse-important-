// 客户与应收（模块 D）。B6 企业客户发票：客户 CRUD、手动开票、收款（允许部分）、对账单（JSON/PDF/发送）、账龄。
// 自定决定：
//  - 不按 feature_flags.b2b_invoice 门控（A 模式小店也有记账客户；POS 的 B2B 销售由模块 C 自己门控）。
//  - 手动开票的 unit_price 为不含税价，tax 按税码税率加在上面：line_total = qty×unit_price + tax；invoice.total = subtotal + tax。
//  - 开票超过信用额（credit_limit > 0 时）返回 400 CREDIT_LIMIT_EXCEEDED；传 force=true 且有 approval.decide 权限可越过。
//  - 手动开票默认不动库存。带 deduct_stock=true 且行有 product_id 时，同时建 sale（B2B / WEB，receipt_no = 发票号）并 applyMovement SALE（货位 → CUSTOMER）。
//  - 收款只针对发票（payment.invoice_id 非空）；POS 现付的 B2B 销售不进应收。
//  - 逾期状态 OVERDUE 由每日任务（lib/einvoiceJobs.ts runOverdueArCheck）更新；收款后变 PARTIAL/PAID。
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { withCompany, type Tx } from '../lib/db.js';
import { requireAuth, requirePerm, hasPerm, stripCost } from '../lib/auth.js';
import { AppError, notFound } from '../lib/errors.js';
import { nextDocNo } from '../lib/docno.js';
import { applyMovement } from '../lib/movements.js';
import { tgSend, tgSendDocument } from '../lib/telegram.js';
import { makeInvoicePdf, makeStatementPdf } from '../lib/invoicePdf.js';
import { config } from '../lib/config.js';
import { signedFileUrl } from './files.js';
import { verifyUrl } from '../lib/myinvois.js';

const cx = (req: any) => ({ companyId: req.ctx.companyId, userId: req.ctx.userId, deviceId: req.ctx.deviceId });
const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const customerSchema = z.object({
  code: z.string().max(20).optional().nullable(), name: z.string().min(1).max(120),
  tin: z.string().max(20).optional().nullable(), brn: z.string().max(30).optional().nullable(), sst_no: z.string().max(30).optional().nullable(),
  id_type: z.enum(['NRIC', 'BRN', 'PASSPORT', 'ARMY']).optional().nullable(), id_no: z.string().max(30).optional().nullable(),
  email: z.string().email().optional().nullable(), phone: z.string().max(30).optional().nullable(), address: z.any().optional().nullable(),
  credit_terms_days: z.number().int().min(0).max(365).optional(), credit_limit: z.number().min(0).optional(), is_active: z.boolean().optional(),
});
const CUSTOMER_SELECT = `SELECT c.*,
  coalesce((SELECT sum(i.total - i.paid_amount) FROM invoice i WHERE i.customer_id = c.id AND i.status NOT IN ('PAID','CANCELLED') AND i.due_date < (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date), 0) AS overdue_amount,
  (SELECT count(*)::int FROM invoice i WHERE i.customer_id = c.id AND i.status NOT IN ('PAID','CANCELLED')) AS open_invoices
  FROM customer c`;

/** 对账单数据：期初、本期发票（借）和收款（贷）、期末、账龄 */
export async function computeStatement(tx: Tx, customerId: string, month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new AppError(400, 'VALIDATION', 'month must be YYYY-MM');
  const start = `${month}-01`;
  const customer = (await tx.query(`SELECT * FROM customer WHERE id = $1`, [customerId])).rows[0];
  if (!customer) throw new AppError(404, 'CUSTOMER_NOT_FOUND');
  const ob = (await tx.query(`SELECT coalesce((SELECT sum(total) FROM invoice WHERE customer_id = $1 AND status <> 'CANCELLED' AND issue_date < $2::date), 0)
    - coalesce((SELECT sum(amount) FROM payment WHERE customer_id = $1 AND invoice_id IS NOT NULL AND (received_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date < $2::date), 0) AS ob`, [customerId, start])).rows[0].ob;
  const rows = (await tx.query(`
    SELECT issue_date::text AS date, invoice_no AS doc_no, 'Invoice 发票' AS description, total AS debit, 0 AS credit, created_at AS ts FROM invoice WHERE customer_id = $1 AND status <> 'CANCELLED' AND issue_date >= $2::date AND issue_date < $2::date + interval '1 month'
    UNION ALL
    SELECT (p.received_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date::text, coalesce(p.reference, i.invoice_no), format('Payment 收款 %s · %s', p.method, i.invoice_no), 0, p.amount, p.received_at FROM payment p JOIN invoice i ON i.id = p.invoice_id WHERE p.customer_id = $1 AND (p.received_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date >= $2::date AND (p.received_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date < $2::date + interval '1 month'
    ORDER BY 1, ts`, [customerId, start])).rows;
  let bal = Number(ob);
  const lines = rows.map((r) => { bal = r2(bal + Number(r.debit) - Number(r.credit)); return { date: r.date, doc_no: r.doc_no, description: r.description, debit: Number(r.debit), credit: Number(r.credit), balance: bal }; });
  const ag = (await tx.query(`SELECT
      coalesce(sum(CASE WHEN d <= 30 THEN o END),0) AS current, coalesce(sum(CASE WHEN d BETWEEN 31 AND 60 THEN o END),0) AS d30, coalesce(sum(CASE WHEN d BETWEEN 61 AND 90 THEN o END),0) AS d60, coalesce(sum(CASE WHEN d > 90 THEN o END),0) AS d90
    FROM (SELECT (total - paid_amount) AS o, ((now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date - due_date) AS d FROM invoice WHERE customer_id = $1 AND status NOT IN ('PAID','CANCELLED')) x`, [customerId])).rows[0];
  return { customer, month, period_start: start, opening_balance: r2(Number(ob)), closing_balance: bal, lines, aging: { current: Number(ag.current), d30: Number(ag.d30), d60: Number(ag.d60), d90: Number(ag.d90) } };
}
/** 生成对账单记录 + PDF 文件；send=true 时 Telegram 发文档（没配置时写通知）。 */
export async function issueStatement(tx: Tx, companyId: string, customerId: string, month: string, opts: { send: boolean }) {
  const st = await computeStatement(tx, customerId, month);
  const company = (await tx.query(`SELECT name, tin, sst_no, address FROM company WHERE id = $1`, [companyId])).rows[0];
  const pdf = await makeStatementPdf({ customer: st.customer, company, month, opening_balance: st.opening_balance, closing_balance: st.closing_balance, lines: st.lines, aging: st.aging });
  await mkdir(config.uploadDir, { recursive: true });
  const fname = `statement-${st.customer.code ?? customerId.slice(0, 8)}-${month}.pdf`;
  await writeFile(join(config.uploadDir, fname), pdf);
  const url = signedFileUrl(fname);
  const end = new Date(`${st.period_start}T00:00:00Z`); end.setUTCMonth(end.getUTCMonth() + 1); end.setUTCDate(0);
  const row = (await tx.query(`INSERT INTO statement (company_id, customer_id, period_start, period_end, opening_balance, closing_balance, pdf_url, sent_at) VALUES ($1,$2,$3,$4,$5,$6,$7, CASE WHEN $8 THEN now() END)
    ON CONFLICT (customer_id, period_start) DO UPDATE SET opening_balance = EXCLUDED.opening_balance, closing_balance = EXCLUDED.closing_balance, pdf_url = EXCLUDED.pdf_url, sent_at = CASE WHEN $8 THEN now() ELSE statement.sent_at END RETURNING *`,
    [companyId, customerId, st.period_start, end.toISOString().slice(0, 10), st.opening_balance, st.closing_balance, url, opts.send])).rows[0];
  if (opts.send) {
    const caption = `对账单 ${month} · ${st.customer.name} · 期末 RM ${st.closing_balance.toFixed(2)}`;
    const mid = await tgSendDocument(companyId, join(config.uploadDir, fname), caption, fname);
    if (!mid) await tgSend(companyId, `<b>客户对账单</b> ${month}\n${st.customer.name}${st.customer.email ? ` (${st.customer.email})` : ''}\n期初 RM ${st.opening_balance.toFixed(2)} → 期末 RM ${st.closing_balance.toFixed(2)}\n下载：${url}`, undefined, { type: 'STATEMENT', refType: 'statement', refId: row.id });
  }
  return { ...row, lines: st.lines, aging: st.aging, pdf_file: fname };
}

export async function arRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);
  const VIEW = ['customer.manage', 'invoice.manage', 'pos.b2b', 'pos.sell', 'report.sales'];

  // ---------- 客户 ----------
  app.get('/customers', { preHandler: requirePerm(...VIEW) }, async (req) => {
    const q = z.object({ search: z.string().optional(), include_inactive: z.coerce.boolean().optional() }).parse(req.query);
    return withCompany(cx(req), async (tx) => (await tx.query(`${CUSTOMER_SELECT} WHERE ($1::text IS NULL OR c.name ILIKE '%' || $1 || '%' OR c.code ILIKE '%' || $1 || '%' OR c.phone ILIKE '%' || $1 || '%' OR c.tin ILIKE '%' || $1 || '%') AND ($2 OR c.is_active) ORDER BY c.name LIMIT 500`, [q.search?.trim() || null, q.include_inactive ?? false])).rows);
  });
  app.post('/customers', { preHandler: requirePerm('customer.manage') }, async (req, reply) => {
    const b = customerSchema.parse(req.body);
    return withCompany(cx(req), async (tx) => {
      const code = b.code ?? await nextDocNo(tx, req.ctx.companyId, 'CUST', 'C', '', 4);
      const r = (await tx.query(`INSERT INTO customer (company_id, code, name, tin, brn, sst_no, id_type, id_no, email, phone, address, credit_terms_days, credit_limit) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
        [req.ctx.companyId, code, b.name, b.tin ?? null, b.brn ?? null, b.sst_no ?? null, b.id_type ?? null, b.id_no ?? null, b.email ?? null, b.phone ?? null, b.address ? JSON.stringify(b.address) : null, b.credit_terms_days ?? 30, b.credit_limit ?? 0])).rows[0];
      reply.status(201); return r;
    });
  });
  app.put('/customers/:id', { preHandler: requirePerm('customer.manage') }, async (req) => {
    const { id } = req.params as any; const b = customerSchema.partial().parse(req.body);
    return withCompany(cx(req), async (tx) => {
      const r = (await tx.query(`UPDATE customer SET code = coalesce($2, code), name = coalesce($3, name), tin = coalesce($4, tin), brn = coalesce($5, brn), sst_no = coalesce($6, sst_no), id_type = coalesce($7, id_type), id_no = coalesce($8, id_no), email = coalesce($9, email), phone = coalesce($10, phone), address = coalesce($11, address), credit_terms_days = coalesce($12, credit_terms_days), credit_limit = coalesce($13, credit_limit), is_active = coalesce($14, is_active) WHERE id = $1 RETURNING *`,
        [id, b.code ?? null, b.name ?? null, b.tin ?? null, b.brn ?? null, b.sst_no ?? null, b.id_type ?? null, b.id_no ?? null, b.email ?? null, b.phone ?? null, b.address ? JSON.stringify(b.address) : null, b.credit_terms_days ?? null, b.credit_limit ?? null, b.is_active ?? null])).rows[0];
      if (!r) throw new AppError(404, 'CUSTOMER_NOT_FOUND'); return r;
    });
  });
  app.get('/customers/:id', { preHandler: requirePerm(...VIEW) }, async (req) => {
    const { id } = req.params as any;
    return withCompany(cx(req), async (tx) => {
      const c = (await tx.query(`${CUSTOMER_SELECT} WHERE c.id = $1`, [id])).rows[0]; if (!c) throw new AppError(404, 'CUSTOMER_NOT_FOUND');
      const invoices = (await tx.query(`SELECT i.*, (i.total - i.paid_amount) AS outstanding, e.status AS einvoice_status FROM invoice i LEFT JOIN einvoice_submission e ON e.id = i.einvoice_submission_id WHERE i.customer_id = $1 ORDER BY i.issue_date DESC, i.created_at DESC LIMIT 200`, [id])).rows;
      const payments = (await tx.query(`SELECT p.*, i.invoice_no, u.name AS received_by_name FROM payment p LEFT JOIN invoice i ON i.id = p.invoice_id LEFT JOIN app_user u ON u.id = p.received_by WHERE p.customer_id = $1 AND p.invoice_id IS NOT NULL ORDER BY p.received_at DESC LIMIT 200`, [id])).rows;
      const statements = (await tx.query(`SELECT * FROM statement WHERE customer_id = $1 ORDER BY period_start DESC LIMIT 24`, [id])).rows;
      return { ...c, invoices, payments, statements };
    });
  });

  // ---------- 发票 ----------
  app.get('/invoices', { preHandler: requirePerm('invoice.manage', 'pos.b2b', 'report.sales') }, async (req) => {
    const q = z.object({ status: z.string().optional(), customer: z.string().uuid().optional(), from: z.string().optional(), to: z.string().optional() }).parse(req.query);
    return withCompany(cx(req), async (tx) => (await tx.query(`SELECT i.*, c.name AS customer_name, c.code AS customer_code, (i.total - i.paid_amount) AS outstanding, e.status AS einvoice_status
      FROM invoice i JOIN customer c ON c.id = i.customer_id LEFT JOIN einvoice_submission e ON e.id = i.einvoice_submission_id
      WHERE ($1::text IS NULL OR i.status = $1) AND ($2::uuid IS NULL OR i.customer_id = $2) AND ($3::date IS NULL OR i.issue_date >= $3) AND ($4::date IS NULL OR i.issue_date <= $4) ORDER BY i.issue_date DESC, i.created_at DESC LIMIT 500`, [q.status ?? null, q.customer ?? null, q.from ?? null, q.to ?? null])).rows);
  });
  const invoiceSchema = z.object({
    customer_id: z.string().uuid(), issue_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), note: z.string().max(500).optional().nullable(),
    lines: z.array(z.object({ description: z.string().max(200).optional(), product_id: z.string().uuid().optional(), qty: z.number().positive(), unit_price: z.number().min(0), tax_code_id: z.string().uuid().optional().nullable() })).min(1),
    deduct_stock: z.boolean().optional(), site_id: z.string().uuid().optional(), from_location_id: z.string().uuid().optional(), from_location_code: z.string().optional(), force: z.boolean().optional(), client_id: z.string().uuid().optional(),
  });
  app.post('/invoices', { preHandler: requirePerm('invoice.manage', 'pos.b2b') }, async (req, reply) => {
    const b = invoiceSchema.parse(req.body);
    return withCompany(cx(req), async (tx) => {
      const cust = (await tx.query(`SELECT * FROM customer WHERE id = $1 AND is_active FOR UPDATE`, [b.customer_id])).rows[0];
      if (!cust) throw new AppError(404, 'CUSTOMER_NOT_FOUND');
      const defTax = (await tx.query(`SELECT id, rate FROM tax_code WHERE is_default`)).rows[0];
      const lines: any[] = [];
      for (const [i, l] of b.lines.entries()) {
        let p: any = null;
        if (l.product_id) { p = (await tx.query(`SELECT p.id, p.sku, coalesce(p.name_zh, p.name_en, p.name_ms) AS name, p.tax_code_id, p.cost_price, p.default_location_id FROM product p WHERE p.id = $1`, [l.product_id])).rows[0]; if (!p) throw new AppError(404, 'PRODUCT_NOT_FOUND'); }
        const taxId = l.tax_code_id ?? p?.tax_code_id ?? defTax?.id ?? null;
        const rate = taxId ? Number((await tx.query(`SELECT rate FROM tax_code WHERE id = $1`, [taxId])).rows[0]?.rate ?? 0) : 0;
        const net = r2(l.qty * l.unit_price); const tax = r2(net * rate / 100);
        const desc = l.description ?? p?.name; if (!desc) throw new AppError(400, 'VALIDATION', `line ${i + 1}: description or product_id required`);
        lines.push({ line_no: i + 1, product_id: p?.id ?? null, description: desc, qty: l.qty, unit_price: l.unit_price, tax_code_id: taxId, tax_rate: rate, tax_amount: tax, line_total: r2(net + tax), unit_cost: Number(p?.cost_price ?? 0), net, product: p });
      }
      const subtotal = r2(lines.reduce((s, l) => s + l.net, 0)); const tax_amount = r2(lines.reduce((s, l) => s + l.tax_amount, 0)); const total = r2(subtotal + tax_amount);
      if (Number(cust.credit_limit) > 0 && Number(cust.balance) + total > Number(cust.credit_limit) && !(b.force && hasPerm(req.ctx, 'approval.decide'))) throw new AppError(400, 'CREDIT_LIMIT_EXCEEDED', { balance: Number(cust.balance), credit_limit: Number(cust.credit_limit), total });
      const issue = b.issue_date ?? new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
      const due = b.due_date ?? (() => { const d = new Date(`${issue}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + Number(cust.credit_terms_days)); return d.toISOString().slice(0, 10); })();
      const invoice_no = await nextDocNo(tx, req.ctx.companyId, 'INV', `INV-${issue.slice(0, 4)}-`);
      // 可选：扣库存（建 B2B 销售 + SALE 移动）
      let saleId: string | null = null;
      if (b.deduct_stock && lines.some((l) => l.product_id)) {
        const siteId = b.site_id ?? req.ctx.siteId ?? (await tx.query(`SELECT id FROM site WHERE is_active ORDER BY type DESC, created_at LIMIT 1`)).rows[0]?.id;
        if (!siteId) throw new AppError(400, 'VALIDATION', 'site_id required to deduct stock');
        const sale = (await tx.query(`INSERT INTO sale (company_id, site_id, receipt_no, sale_type, source, customer_id, cashier_id, subtotal, tax_amount, total, paid_total, status, note, client_id) VALUES ($1,$2,$3,'B2B','WEB',$4,$5,$6,$7,$8,0,'COMPLETED',$9,$10) RETURNING id`, [req.ctx.companyId, siteId, invoice_no, cust.id, req.ctx.userId, subtotal, tax_amount, total, b.note ?? null, b.client_id ?? null])).rows[0];
        saleId = sale.id;
        const customerLoc = (await tx.query(`SELECT id FROM location WHERE is_virtual AND virtual_type = 'CUSTOMER'`)).rows[0];
        for (const l of lines.filter((x) => x.product_id)) {
          const fromId = b.from_location_id ?? l.product.default_location_id ?? null;
          const mv = await applyMovement(tx, req.ctx, { product_id: l.product_id, from_location_id: fromId ?? undefined, from_location_code: fromId ? undefined : b.from_location_code, to_location_id: customerLoc.id, qty: l.qty, reason: 'SALE', ref_type: 'SALE', ref_id: saleId!, note: invoice_no });
          await tx.query(`INSERT INTO sale_line (company_id, sale_id, line_no, product_id, qty, unit_price, tax_code_id, tax_rate, tax_amount, line_total, unit_cost, from_location_id, movement_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [req.ctx.companyId, saleId, l.line_no, l.product_id, l.qty, l.unit_price, l.tax_code_id, l.tax_rate, l.tax_amount, l.line_total, l.unit_cost, fromId, mv.id]);
        }
      }
      const inv = (await tx.query(`INSERT INTO invoice (company_id, invoice_no, customer_id, sale_id, issue_date, due_date, subtotal, tax_amount, total, status, note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'UNPAID',$10) RETURNING *`, [req.ctx.companyId, invoice_no, cust.id, saleId, issue, due, subtotal, tax_amount, total, b.note ?? null])).rows[0];
      for (const l of lines) await tx.query(`INSERT INTO invoice_line (company_id, invoice_id, line_no, product_id, description, qty, unit_price, tax_code_id, tax_rate, tax_amount, line_total, unit_cost) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [req.ctx.companyId, inv.id, l.line_no, l.product_id, l.description, l.qty, l.unit_price, l.tax_code_id, l.tax_rate, l.tax_amount, l.line_total, l.unit_cost]);
      await tx.query(`UPDATE customer SET balance = balance + $2 WHERE id = $1`, [cust.id, total]);
      reply.status(201);
      return { ...inv, lines: lines.map(({ product, net, ...l }) => stripCost(req.ctx, l)) };
    });
  });
  const loadInvoice = async (tx: Tx, id: string) => {
    const inv = (await tx.query(`SELECT i.*, c.name AS customer_name, (i.total - i.paid_amount) AS outstanding, e.status AS einvoice_status, e.document_uuid, e.long_id, e.env AS einvoice_env FROM invoice i JOIN customer c ON c.id = i.customer_id LEFT JOIN einvoice_submission e ON e.id = i.einvoice_submission_id WHERE i.id = $1`, [id])).rows[0];
    if (!inv) throw notFound();
    let lines = (await tx.query(`SELECT * FROM invoice_line WHERE invoice_id = $1 ORDER BY line_no`, [id])).rows;
    if (!lines.length && inv.sale_id) lines = (await tx.query(`SELECT l.id, l.line_no, l.product_id, coalesce(p.name_zh, p.name_en) AS description, l.qty, l.unit_price, l.tax_code_id, l.tax_rate, l.tax_amount, l.line_total, l.unit_cost FROM sale_line l JOIN product p ON p.id = l.product_id WHERE l.sale_id = $1 ORDER BY l.line_no`, [inv.sale_id])).rows;
    const payments = (await tx.query(`SELECT p.*, u.name AS received_by_name FROM payment p LEFT JOIN app_user u ON u.id = p.received_by WHERE p.invoice_id = $1 ORDER BY p.received_at`, [id])).rows;
    return { inv, lines, payments };
  };
  app.get('/invoices/:id', { preHandler: requirePerm('invoice.manage', 'pos.b2b', 'report.sales') }, async (req) => {
    const { id } = req.params as any;
    return withCompany(cx(req), async (tx) => { const { inv, lines, payments } = await loadInvoice(tx, id); return { ...inv, lines: lines.map((l) => stripCost(req.ctx, l)), payments }; });
  });
  app.get('/invoices/:id/pdf', { preHandler: requirePerm('invoice.manage', 'pos.b2b', 'report.sales') }, async (req, reply) => {
    const { id } = req.params as any;
    const buf = await withCompany(cx(req), async (tx) => {
      const { inv, lines, payments } = await loadInvoice(tx, id);
      const customer = (await tx.query(`SELECT * FROM customer WHERE id = $1`, [inv.customer_id])).rows[0];
      const company = (await tx.query(`SELECT name, tin, sst_no, address FROM company WHERE id = $1`, [req.ctx.companyId])).rows[0];
      const einvoice = inv.einvoice_status === 'VALID' && inv.document_uuid && inv.long_id ? { uuid: inv.document_uuid, long_id: inv.long_id, verify_url: verifyUrl(inv.einvoice_env, inv.document_uuid, inv.long_id) } : null;
      return makeInvoicePdf({ invoice: inv, lines, customer, company, payments, einvoice });
    });
    reply.header('content-type', 'application/pdf').header('content-disposition', `inline; filename="invoice-${id}.pdf"`);
    return reply.send(buf);
  });
  app.post('/invoices/:id/payments', { preHandler: requirePerm('invoice.manage') }, async (req, reply) => {
    const { id } = req.params as any;
    const b = z.object({ amount: z.number().positive(), method: z.enum(['CASH', 'CARD', 'EWALLET', 'BANK_TRANSFER', 'CHEQUE']).default('BANK_TRANSFER'), reference: z.string().max(100).optional().nullable(), received_at: z.string().datetime({ offset: true }).optional() }).parse(req.body);
    return withCompany(cx(req), async (tx) => {
      const inv = (await tx.query(`SELECT * FROM invoice WHERE id = $1 FOR UPDATE`, [id])).rows[0]; if (!inv) throw notFound();
      if (['PAID', 'CANCELLED'].includes(inv.status)) throw new AppError(409, 'INVOICE_STATE', inv.status);
      const outstanding = r2(Number(inv.total) - Number(inv.paid_amount));
      if (b.amount > outstanding + 0.005) throw new AppError(400, 'PAYMENT_EXCEEDS', { outstanding });
      const pay = (await tx.query(`INSERT INTO payment (company_id, invoice_id, customer_id, method, amount, reference, received_by, received_at) VALUES ($1,$2,$3,$4,$5,$6,$7, coalesce($8::timestamptz, now())) RETURNING *`, [req.ctx.companyId, id, inv.customer_id, b.method, b.amount, b.reference ?? null, req.ctx.userId, b.received_at ?? null])).rows[0];
      const paid = r2(Number(inv.paid_amount) + b.amount);
      const status = paid >= Number(inv.total) - 0.005 ? 'PAID' : 'PARTIAL';
      const upd = (await tx.query(`UPDATE invoice SET paid_amount = $2, status = $3 WHERE id = $1 RETURNING *`, [id, paid, status])).rows[0];
      await tx.query(`UPDATE customer SET balance = balance - $2 WHERE id = $1`, [inv.customer_id, b.amount]);
      // 付清后把该客户的逾期工单自动解决
      if (status === 'PAID') await tx.query(`UPDATE ticket SET status = 'RESOLVED', resolved_at = now(), resolution = '已收款' WHERE type = 'OVERDUE_AR' AND ref_id = $1 AND status NOT IN ('RESOLVED','CLOSED') AND NOT EXISTS (SELECT 1 FROM invoice i WHERE i.customer_id = $1 AND i.status = 'OVERDUE' AND i.id <> $2)`, [inv.customer_id, id]);
      reply.status(201); return { payment: pay, invoice: upd };
    });
  });
  app.post('/invoices/:id/cancel', { preHandler: requirePerm('invoice.manage') }, async (req) => {
    const { id } = req.params as any; const b = z.object({ reason: z.string().min(1).max(200) }).parse(req.body);
    return withCompany(cx(req), async (tx) => {
      const inv = (await tx.query(`SELECT * FROM invoice WHERE id = $1 FOR UPDATE`, [id])).rows[0]; if (!inv) throw notFound();
      if (Number(inv.paid_amount) > 0 || inv.status === 'CANCELLED') throw new AppError(409, 'INVOICE_STATE', inv.status);
      await tx.query(`UPDATE customer SET balance = balance - $2 WHERE id = $1`, [inv.customer_id, inv.total]);
      return (await tx.query(`UPDATE invoice SET status = 'CANCELLED', note = coalesce(note || ' | ', '') || $2 WHERE id = $1 RETURNING *`, [id, `取消：${b.reason}`])).rows[0];
    });
  });

  // ---------- 对账单 ----------
  app.get('/customers/:id/statement', { preHandler: requirePerm('invoice.manage', 'statement.send', 'customer.manage') }, async (req, reply) => {
    const { id } = req.params as any;
    const q = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), format: z.enum(['json', 'pdf']).default('json') }).parse(req.query);
    return withCompany(cx(req), async (tx) => {
      const st = await computeStatement(tx, id, q.month);
      if (q.format === 'json') return st;
      const company = (await tx.query(`SELECT name, tin, sst_no, address FROM company WHERE id = $1`, [req.ctx.companyId])).rows[0];
      const buf = await makeStatementPdf({ customer: st.customer, company, month: q.month, opening_balance: st.opening_balance, closing_balance: st.closing_balance, lines: st.lines, aging: st.aging });
      reply.header('content-type', 'application/pdf').header('content-disposition', `inline; filename="statement-${q.month}.pdf"`);
      return reply.send(buf);
    });
  });
  app.post('/customers/:id/statement/send', { preHandler: requirePerm('statement.send') }, async (req) => {
    const { id } = req.params as any;
    const b = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }).parse(req.body ?? {});
    return withCompany(cx(req), (tx) => issueStatement(tx, req.ctx.companyId, id, b.month, { send: true }));
  });

  // ---------- 账龄 ----------
  app.get('/ar/aging', { preHandler: requirePerm('invoice.manage', 'report.sales', 'customer.manage') }, async (req) => withCompany(cx(req), async (tx) => {
    const rows = (await tx.query(`SELECT c.id AS customer_id, c.code, c.name, c.credit_limit, c.credit_terms_days, c.phone,
        coalesce(sum(CASE WHEN d <= 30 THEN o END),0) AS b0_30, coalesce(sum(CASE WHEN d BETWEEN 31 AND 60 THEN o END),0) AS b31_60, coalesce(sum(CASE WHEN d BETWEEN 61 AND 90 THEN o END),0) AS b61_90, coalesce(sum(CASE WHEN d > 90 THEN o END),0) AS b90p,
        coalesce(sum(o),0) AS total, count(*)::int AS invoices, max(d) AS max_days
      FROM customer c JOIN LATERAL (SELECT (i.total - i.paid_amount) AS o, ((now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date - i.due_date) AS d FROM invoice i WHERE i.customer_id = c.id AND i.status NOT IN ('PAID','CANCELLED')) x ON true
      GROUP BY c.id ORDER BY total DESC`)).rows;
    const sum = (k: string) => r2(rows.reduce((s, r) => s + Number(r[k]), 0));
    return { as_of: new Date().toISOString(), rows, totals: { b0_30: sum('b0_30'), b31_60: sum('b31_60'), b61_90: sum('b61_90'), b90p: sum('b90p'), total: sum('total') } };
  }));
}
