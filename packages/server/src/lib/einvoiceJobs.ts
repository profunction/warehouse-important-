// 电子发票提交核心 + 财务定时任务（模块 D）。
//  - submitSubmission：把 einvoice_submission 组成 UBL 文档提交 MyInvois，失败进重试队列（每 5 分钟，最多 72 小时，之后 FAILED 并开 EINVOICE 工单给会计）。
//  - 每月 1 日 02:00（KL）：上月每店零售收据合并发票提交；每个有往来的客户生成对账单并发 Telegram；损耗/周转/供应商准时率 Excel 发老板。
//  - 每天 09:00：逾期应收检查，发票 UNPAID/PARTIAL 过了到期日改 OVERDUE，每个逾期客户开一张 OVERDUE_AR 工单给 ACCOUNTS（A 模式 BOSS），7 天期限。
// 测试直接调用导出的 run* 函数（NODE_ENV=test 时 pg-boss 不启动）。
import type PgBoss from 'pg-boss';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { adminPool, rwPool, withCompany, type Tx } from './db.js';
import { config } from './config.js';
import { tgSend, tgSendDocument } from './telegram.js';
import { AppError } from './errors.js';
import { buildUblDocument, cancelDocument, CONSOLIDATED_BUYER, getDocumentStatus, loadMyInvoisConfig, monthStart, MONTH_RANGE_SQL, round2, submitDocument, supplierParty, verifyUrl, type MyInvoisConfig, type UblLine, type UblParty } from './myinvois.js';
import { issueStatement } from '../routes/ar.js';
import { reportXlsxBuffer, runReport } from '../routes/reports.js';

export const RETRY_MINUTES = 5;
export const MAX_RETRY_HOURS = 72;
export { monthStart, MONTH_RANGE_SQL };

// ---------- 组文档 ----------
function buyerFromJson(b: any): UblParty {
  if (!b || (!b.tin && !b.id_no)) throw new AppError(400, 'EINVOICE_BUYER_REQUIRED');
  return { tin: b.tin ?? 'EI00000000020', idType: b.id_type ?? (b.id_no ? 'NRIC' : undefined), idNo: b.id_no ?? undefined, sstNo: b.sst_no ?? null, name: b.name ?? 'Buyer', address: b.address ?? {}, email: b.email ?? null, phone: b.phone ?? null };
}
async function saleDoc(tx: Tx, saleId: string, cfg: MyInvoisConfig) {
  const s = (await tx.query(`SELECT s.*, si.code AS site_code FROM sale s JOIN site si ON si.id = s.site_id WHERE s.id = $1`, [saleId])).rows[0];
  if (!s) throw new AppError(404, 'NOT_FOUND', 'sale');
  const lines = (await tx.query(`SELECT l.*, p.sku, p.unit, coalesce(p.name_en, p.name_zh, p.name_ms) AS pname, t.myinvois_tax_type FROM sale_line l JOIN product p ON p.id = l.product_id LEFT JOIN tax_code t ON t.id = l.tax_code_id WHERE l.sale_id = $1 ORDER BY l.line_no`, [saleId])).rows;
  const ubl: UblLine[] = lines.map((l) => ({ description: l.pname, qty: Number(l.qty), unit: l.unit, unitPrice: Number(l.unit_price), discount: Number(l.discount), taxType: l.myinvois_tax_type ?? (Number(l.tax_amount) > 0 ? '01' : '06'), taxRate: Number(l.tax_rate), taxAmount: Number(l.tax_amount), lineTotal: Number(l.line_total), productCode: l.sku }));
  const docType = s.sale_type === 'RETURN' ? '02' : '01';
  return { docNo: s.receipt_no, doc: buildUblDocument({ docNo: s.receipt_no, docType, issuedAt: new Date(s.sold_at), supplier: supplierParty(cfg), buyer: buyerFromJson(s.einvoice_buyer), lines: ubl, subtotal: Number(s.subtotal), taxTotal: Number(s.tax_amount), total: Number(s.total), discountTotal: Number(s.discount_total), rounding: Number(s.rounding), paidAmount: Number(s.paid_total), refDocNo: s.original_sale_id ? (await tx.query(`SELECT receipt_no FROM sale WHERE id = $1`, [s.original_sale_id])).rows[0]?.receipt_no : null }) };
}
async function invoiceDoc(tx: Tx, invoiceId: string, cfg: MyInvoisConfig) {
  const inv = (await tx.query(`SELECT i.*, c.name AS cname, c.tin AS ctin, c.brn, c.sst_no AS csst, c.id_type, c.id_no, c.email, c.phone, c.address FROM invoice i JOIN customer c ON c.id = i.customer_id WHERE i.id = $1`, [invoiceId])).rows[0];
  if (!inv) throw new AppError(404, 'NOT_FOUND', 'invoice');
  if (!inv.ctin && !inv.brn && !inv.id_no) throw new AppError(400, 'EINVOICE_BUYER_REQUIRED', 'customer TIN missing');
  let lines = (await tx.query(`SELECT l.description, l.qty, l.unit_price, l.tax_rate, l.tax_amount, l.line_total, p.unit, p.sku, t.myinvois_tax_type FROM invoice_line l LEFT JOIN product p ON p.id = l.product_id LEFT JOIN tax_code t ON t.id = l.tax_code_id WHERE l.invoice_id = $1 ORDER BY l.line_no`, [invoiceId])).rows;
  if (!lines.length && inv.sale_id) lines = (await tx.query(`SELECT coalesce(p.name_en, p.name_zh) AS description, l.qty, l.unit_price, l.tax_rate, l.tax_amount, l.line_total, p.unit, p.sku, t.myinvois_tax_type FROM sale_line l JOIN product p ON p.id = l.product_id LEFT JOIN tax_code t ON t.id = l.tax_code_id WHERE l.sale_id = $1 ORDER BY l.line_no`, [inv.sale_id])).rows;
  if (!lines.length) lines = [{ description: `Invoice ${inv.invoice_no}`, qty: 1, unit_price: Number(inv.subtotal), tax_rate: 0, tax_amount: Number(inv.tax_amount), line_total: Number(inv.total), unit: 'PCS', sku: null, myinvois_tax_type: Number(inv.tax_amount) > 0 ? '01' : '06' }];
  const ubl: UblLine[] = lines.map((l) => ({ description: l.description, qty: Number(l.qty), unit: l.unit ?? 'PCS', unitPrice: Number(l.unit_price), taxType: l.myinvois_tax_type ?? (Number(l.tax_amount) > 0 ? '01' : '06'), taxRate: Number(l.tax_rate), taxAmount: Number(l.tax_amount), lineTotal: Number(l.line_total), productCode: l.sku ?? undefined }));
  const buyer: UblParty = { tin: inv.ctin ?? 'EI00000000020', idType: inv.brn ? 'BRN' : inv.id_type ?? undefined, idNo: inv.brn ?? inv.id_no ?? undefined, sstNo: inv.csst, name: inv.cname, address: inv.address ?? {}, email: inv.email, phone: inv.phone };
  return { docNo: inv.invoice_no, doc: buildUblDocument({ docNo: inv.invoice_no, docType: '01', issuedAt: new Date(inv.issue_date), supplier: supplierParty(cfg), buyer, lines: ubl, subtotal: Number(inv.subtotal), taxTotal: Number(inv.tax_amount), total: Number(inv.total), paidAmount: Number(inv.paid_amount) }) };
}
/** 合并发票预览数据：上月该店零售 COMPLETED、不要电子发票的销售，按类别汇总 */
export async function consolidatedPreview(tx: Tx, siteId: string, month: string) {
  const m = monthStart(month);
  const head = (await tx.query(`SELECT count(*)::int AS sale_count, coalesce(sum(total),0) AS total, coalesce(sum(tax_amount),0) AS tax_total, coalesce(sum(subtotal),0) AS subtotal, coalesce(sum(discount_total),0) AS discount_total, coalesce(sum(rounding),0) AS rounding
    FROM sale s WHERE s.site_id = $1 AND s.status = 'COMPLETED' AND s.sale_type IN ('RETAIL','RETURN') AND s.source <> 'WEB' AND NOT s.einvoice_required AND ${MONTH_RANGE_SQL('s.sold_at', '2')}`, [siteId, m])).rows[0];
  const by_category = (await tx.query(`SELECT c.code, coalesce(c.name_en, c.name_zh) AS name, c.name_zh, sum(l.qty * CASE WHEN s.sale_type = 'RETURN' THEN -1 ELSE 1 END) AS qty, sum(l.line_total * CASE WHEN s.sale_type = 'RETURN' THEN -1 ELSE 1 END) AS total, sum(l.tax_amount * CASE WHEN s.sale_type = 'RETURN' THEN -1 ELSE 1 END) AS tax, max(t.myinvois_tax_type) AS tax_type, max(l.tax_rate) AS tax_rate
    FROM sale s JOIN sale_line l ON l.sale_id = s.id JOIN product p ON p.id = l.product_id JOIN category c ON c.id = p.category_id LEFT JOIN tax_code t ON t.id = l.tax_code_id
    WHERE s.site_id = $1 AND s.status = 'COMPLETED' AND s.sale_type IN ('RETAIL','RETURN') AND s.source <> 'WEB' AND NOT s.einvoice_required AND ${MONTH_RANGE_SQL('s.sold_at', '2')} GROUP BY c.code, c.name_en, c.name_zh ORDER BY c.code`, [siteId, m])).rows;
  const existing = (await tx.query(`SELECT p.*, e.status AS submission_status, e.document_uuid FROM consolidated_invoice_period p LEFT JOIN einvoice_submission e ON e.id = p.submission_id WHERE p.site_id = $1 AND p.period_month = $2`, [siteId, m])).rows[0] ?? null;
  const first = (await tx.query(`SELECT min(receipt_no) AS first_no, max(receipt_no) AS last_no FROM sale s WHERE s.site_id = $1 AND s.status = 'COMPLETED' AND s.sale_type = 'RETAIL' AND NOT s.einvoice_required AND ${MONTH_RANGE_SQL('s.sold_at', '2')}`, [siteId, m])).rows[0];
  return { month, site_id: siteId, ...head, total: Number(head.total), receipt_range: first, by_category, existing };
}
async function consolidatedDoc(tx: Tx, periodId: string, cfg: MyInvoisConfig) {
  const p = (await tx.query(`SELECT p.*, s.code AS site_code FROM consolidated_invoice_period p JOIN site s ON s.id = p.site_id WHERE p.id = $1`, [periodId])).rows[0];
  if (!p) throw new AppError(404, 'NOT_FOUND', 'period');
  const month = String(p.period_month).slice(0, 7);
  const pv = await consolidatedPreview(tx, p.site_id, month);
  const docNo = `CONS-${p.site_code}-${month.replace('-', '')}`;
  const lines: UblLine[] = pv.by_category.map((c: any) => ({ description: `${c.name} (consolidated receipts ${pv.receipt_range?.first_no ?? ''} - ${pv.receipt_range?.last_no ?? ''})`, qty: 1, unit: 'PCS', unitPrice: round2(Number(c.total) - Number(c.tax)), taxType: c.tax_type ?? (Number(c.tax) > 0 ? '01' : '06'), taxRate: Number(c.tax_rate ?? 0), taxAmount: round2(Number(c.tax)), lineTotal: round2(Number(c.total)) }));
  if (!lines.length) lines.push({ description: 'Consolidated retail receipts', qty: 1, unitPrice: 0, taxType: '06', taxRate: 0, taxAmount: 0, lineTotal: 0 });
  const issuedAt = new Date(`${month}-01T00:00:00+08:00`); issuedAt.setMonth(issuedAt.getMonth() + 1); // 下月 1 日开出
  return { docNo, doc: buildUblDocument({ docNo, docType: '01', issuedAt, supplier: supplierParty(cfg), buyer: CONSOLIDATED_BUYER, lines, subtotal: round2(Number(pv.subtotal)), taxTotal: round2(Number(pv.tax_total)), total: round2(Number(pv.total)), discountTotal: round2(Number(pv.discount_total)), rounding: round2(Number(pv.rounding)) }) };
}
export async function buildSubmissionDoc(tx: Tx, sub: any, cfg: MyInvoisConfig) {
  if (sub.ref_type === 'sale') return saleDoc(tx, sub.ref_id, cfg);
  if (sub.ref_type === 'invoice') return invoiceDoc(tx, sub.ref_id, cfg);
  if (sub.ref_type === 'consolidated_invoice_period') return consolidatedDoc(tx, sub.ref_id, cfg);
  throw new AppError(400, 'VALIDATION', `unknown ref_type ${sub.ref_type}`);
}

// ---------- 提交 ----------
/** 提交（或轮询）一条 submission。任何错误不抛出，记入 error_json 并排队重试；返回更新后的行。 */
export async function submitSubmission(companyId: string, submissionId: string, userId?: string | null): Promise<any> {
  return withCompany({ companyId, userId: userId ?? null }, async (tx) => {
    const sub = (await tx.query(`SELECT * FROM einvoice_submission WHERE id = $1 FOR UPDATE`, [submissionId])).rows[0];
    if (!sub) throw new AppError(404, 'NOT_FOUND');
    if (!['QUEUED', 'FAILED', 'SUBMITTED'].includes(sub.status)) return sub;
    const cfg = await loadMyInvoisConfig(companyId);
    try {
      let r;
      if (sub.status === 'SUBMITTED' && sub.document_uuid) {
        const st = await getDocumentStatus(cfg, sub.document_uuid);
        r = { status: st.status === 'CANCELLED' ? 'INVALID' : st.status, submissionUid: sub.submission_uid, uuid: sub.document_uuid, longId: st.longId ?? sub.long_id, response: st.raw, error: st.error } as const;
      } else {
        const { doc, docNo } = await buildSubmissionDoc(tx, sub, cfg);
        await tx.query(`UPDATE einvoice_submission SET payload = $2, env = $3 WHERE id = $1`, [sub.id, JSON.stringify(doc), cfg.env]);
        r = await submitDocument(cfg, doc, docNo);
      }
      const qr = r.status === 'VALID' && r.uuid && r.longId ? verifyUrl(cfg.env, r.uuid, r.longId) : null;
      const row = (await tx.query(
        `UPDATE einvoice_submission SET status = $2, submission_uid = coalesce($3, submission_uid), document_uuid = coalesce($4, document_uuid), long_id = coalesce($5, long_id), response = $6, error_json = $7,
           validated_at = CASE WHEN $2 = 'VALID' THEN now() ELSE validated_at END, qr_url = coalesce($8, qr_url), next_retry_at = CASE WHEN $2 = 'SUBMITTED' THEN now() + make_interval(mins => $9) ELSE NULL END
         WHERE id = $1 RETURNING *`, [sub.id, r.status, r.submissionUid, r.uuid, r.longId, JSON.stringify(r.response ?? null), r.error ? JSON.stringify(r.error) : null, qr, RETRY_MINUTES])).rows[0];
      if (row.status === 'VALID' && sub.ref_type === 'invoice') await tx.query(`UPDATE invoice SET einvoice_submission_id = $2 WHERE id = $1`, [sub.ref_id, sub.id]);
      if (row.status === 'INVALID') await openEinvoiceTicket(tx, companyId, row, 'LHDN 拒绝');
      return row;
    } catch (e: any) {
      // 组文档本身的错误（缺买家 TIN 等）是数据问题，不重试：标 FAILED 并开工单
      const dataError = e instanceof AppError && e.status < 500;
      const tooOld = Date.now() - new Date(sub.created_at).getTime() > MAX_RETRY_HOURS * 3600_000;
      const status = dataError || tooOld ? 'FAILED' : 'QUEUED';
      const row = (await tx.query(`UPDATE einvoice_submission SET status = $2, retry_count = retry_count + 1, next_retry_at = CASE WHEN $2 = 'QUEUED' THEN now() + make_interval(mins => $4) ELSE NULL END, error_json = $3 WHERE id = $1 RETURNING *`,
        [sub.id, status, JSON.stringify({ message: String(e?.message ?? e), code: e?.code ?? null, response: e?.response ?? e?.detail ?? null, at: new Date().toISOString() }), RETRY_MINUTES])).rows[0];
      if (status === 'FAILED') await openEinvoiceTicket(tx, companyId, row, dataError ? String(e.code) : '重试 72 小时仍失败');
      return row;
    }
  }, rwPool);
}
async function openEinvoiceTicket(tx: Tx, companyId: string, sub: any, why: string) {
  const plan = (await tx.query(`SELECT plan FROM company WHERE id = $1`, [companyId])).rows[0]?.plan;
  await tx.query(`INSERT INTO ticket (company_id, type, title, ref_type, ref_id, owner_role_code, priority, deadline_at)
    SELECT $1, 'EINVOICE', $2, 'einvoice_submission', $3, $4, 'HIGH', now() + interval '3 days'
    WHERE NOT EXISTS (SELECT 1 FROM ticket t WHERE t.type = 'EINVOICE' AND t.ref_id = $3 AND t.status NOT IN ('RESOLVED','CLOSED'))`,
    [companyId, `电子发票失败：${sub.doc_type} ${sub.ref_type} · ${why}`, sub.id, plan === 'A' ? 'BOSS' : 'ACCOUNTS']);
}
/** 取消（72 小时内） */
export async function cancelSubmission(tx: Tx, companyId: string, sub: any, reason: string) {
  const cfg = await loadMyInvoisConfig(companyId);
  if (!['VALID', 'SUBMITTED'].includes(sub.status)) throw new AppError(409, 'EINVOICE_STATE');
  if (sub.validated_at && Date.now() - new Date(sub.validated_at).getTime() > MAX_RETRY_HOURS * 3600_000) throw new AppError(400, 'EINVOICE_CANCEL_WINDOW');
  const resp = sub.document_uuid ? await cancelDocument(cfg, sub.document_uuid, reason) : { local: true };
  return (await tx.query(`UPDATE einvoice_submission SET status = 'CANCELLED', cancelled_at = now(), response = coalesce(response, '{}'::jsonb) || jsonb_build_object('cancel', $2::jsonb, 'cancel_reason', $3::text) WHERE id = $1 RETURNING *`, [sub.id, JSON.stringify(resp), reason])).rows[0];
}
/** 建合并发票期间 + submission 并提交。已有 submission（非 FAILED/INVALID/CANCELLED）则 409。 */
export async function createConsolidated(companyId: string, userId: string | null, siteId: string, month: string) {
  const m = monthStart(month);
  const id = await withCompany({ companyId, userId }, async (tx) => {
    const pv = await consolidatedPreview(tx, siteId, month);
    if (pv.existing?.submission_id && !['FAILED', 'INVALID', 'CANCELLED'].includes(pv.existing.submission_status)) throw new AppError(409, 'DUPLICATE', 'consolidated invoice already submitted');
    const period = (await tx.query(`INSERT INTO consolidated_invoice_period (company_id, site_id, period_month, sale_count, total) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (company_id, site_id, period_month) DO UPDATE SET sale_count = EXCLUDED.sale_count, total = EXCLUDED.total RETURNING *`, [companyId, siteId, m, pv.sale_count, pv.total])).rows[0];
    const cfg = await loadMyInvoisConfig(companyId);
    const sub = (await tx.query(`INSERT INTO einvoice_submission (company_id, doc_type, ref_type, ref_id, env, status) VALUES ($1,'CONSOLIDATED','consolidated_invoice_period',$2,$3,'QUEUED') RETURNING id`, [companyId, period.id, cfg.env])).rows[0];
    await tx.query(`UPDATE consolidated_invoice_period SET submission_id = $2, locked = true WHERE id = $1`, [period.id, sub.id]);
    return sub.id as string;
  });
  return submitSubmission(companyId, id, userId);
}

// ---------- 定时任务本体 ----------
/** 重试队列：到点的 QUEUED/SUBMITTED，一次最多 200 条 */
export async function runEinvoiceRetry() {
  const due = (await adminPool.query(`SELECT id, company_id FROM einvoice_submission WHERE status IN ('QUEUED','SUBMITTED') AND (next_retry_at IS NULL OR next_retry_at <= now()) ORDER BY created_at LIMIT 200`)).rows;
  let n = 0;
  for (const d of due) { try { await submitSubmission(d.company_id, d.id); n++; } catch (e: any) { console.error('einvoice retry', d.id, e.message); } }
  return n;
}
/** 逾期应收：改状态 + 每个逾期客户一张工单（7 天）。返回新开工单数。 */
export async function runOverdueArCheck(companyId?: string) {
  await adminPool.query(`UPDATE invoice SET status = 'OVERDUE' WHERE status IN ('UNPAID','PARTIAL') AND due_date < (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date AND ($1::uuid IS NULL OR company_id = $1)`, [companyId ?? null]);
  const r = await adminPool.query(`
    INSERT INTO ticket (company_id, type, title, ref_type, ref_id, owner_role_code, priority, deadline_at)
    SELECT c.company_id, 'OVERDUE_AR', format('逾期应收 %s：RM %s（%s 张发票，最久 %s 天）', c.name, to_char(sum(i.total - i.paid_amount), 'FM999999990.00'), count(*), max((now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date - i.due_date)),
           'customer', c.id, CASE WHEN co.plan = 'A' THEN 'BOSS' ELSE 'ACCOUNTS' END, 'HIGH', now() + interval '7 days'
    FROM invoice i JOIN customer c ON c.id = i.customer_id JOIN company co ON co.id = c.company_id
    WHERE i.status = 'OVERDUE' AND ($1::uuid IS NULL OR i.company_id = $1)
      AND NOT EXISTS (SELECT 1 FROM ticket t WHERE t.type = 'OVERDUE_AR' AND t.ref_id = c.id AND t.status NOT IN ('RESOLVED','CLOSED'))
    GROUP BY c.company_id, c.id, c.name, co.plan`, [companyId ?? null]);
  return r.rowCount ?? 0;
}
const prevMonth = () => { const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' })); d.setDate(1); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
/** 每月 1 日自动：合并发票、对账单、报表 Excel。month 省略 = 上月。返回各公司处理摘要。 */
export async function runMonthEndAuto(month = prevMonth(), onlyCompany?: string) {
  const m = monthStart(month);
  const companies = (await adminPool.query(`SELECT id, name, plan, feature_flags FROM company WHERE is_active AND ($1::uuid IS NULL OR id = $1)`, [onlyCompany ?? null])).rows;
  const out: any[] = [];
  for (const c of companies) {
    const summary: any = { company_id: c.id, consolidated: 0, statements: 0, reports: 0, errors: [] as string[] };
    try {
      // 1. 合并发票：每个上月有零售销售的店
      if (c.feature_flags?.einvoice_consolidated !== false) {
        const sites = (await adminPool.query(`SELECT DISTINCT s.site_id FROM sale s WHERE s.company_id = $1 AND s.status = 'COMPLETED' AND s.sale_type = 'RETAIL' AND NOT s.einvoice_required AND ${MONTH_RANGE_SQL('s.sold_at', '2')}
          AND NOT EXISTS (SELECT 1 FROM consolidated_invoice_period p JOIN einvoice_submission e ON e.id = p.submission_id WHERE p.site_id = s.site_id AND p.period_month = $2 AND e.status NOT IN ('FAILED','INVALID','CANCELLED'))`, [c.id, m])).rows;
        for (const s of sites) { try { await createConsolidated(c.id, null, s.site_id, month); summary.consolidated++; } catch (e: any) { summary.errors.push(`consolidated ${s.site_id}: ${e.message}`); } }
      }
      // 2. 对账单：上月有发票或付款、或月末有余额的客户
      const custs = (await adminPool.query(`SELECT DISTINCT c.id FROM customer c WHERE c.company_id = $1 AND c.is_active AND (c.balance <> 0 OR EXISTS (SELECT 1 FROM invoice i WHERE i.customer_id = c.id AND i.issue_date >= $2::date AND i.issue_date < $2::date + interval '1 month') OR EXISTS (SELECT 1 FROM payment p WHERE p.customer_id = c.id AND ${MONTH_RANGE_SQL('p.received_at', '2')}))`, [c.id, m])).rows;
      for (const cu of custs) { try { await withCompany({ companyId: c.id }, (tx) => issueStatement(tx, c.id, cu.id, month, { send: true })); summary.statements++; } catch (e: any) { summary.errors.push(`statement ${cu.id}: ${e.message}`); } }
      // 3. 报表 Excel 给老板（Telegram 文档；未配置 Telegram 时写通知带下载链接）
      const ctx = { companyId: c.id, userId: null, siteId: null, isSuperAdmin: true, permissions: new Map<string, any>([['product.view_cost', null]]) };
      const from = m; const to = new Date(`${m}T00:00:00Z`); to.setUTCMonth(to.getUTCMonth() + 1); const toS = to.toISOString().slice(0, 10);
      const files: string[] = [];
      await withCompany({ companyId: c.id }, async (tx) => {
        for (const [name, params] of [['shrinkage', { from, to: toS }], ['turnover', { days: 30 }], ['supplier-otif', { from, to: toS }]] as const) {
          const rep = await runReport(tx, ctx as any, name, params as any);
          const buf = await reportXlsxBuffer(name, rep.columns, rep.rows);
          await mkdir(config.uploadDir, { recursive: true });
          const fname = `export-${name}-${month}-${c.id.slice(0, 8)}.xlsx`; await writeFile(join(config.uploadDir, fname), buf); files.push(fname);
          summary.reports++;
        }
      });
      const { signedFileUrl } = await import('../routes/files.js');
      for (const f of files) { const mid = await tgSendDocument(c.id, join(config.uploadDir, f), `${month} 月结报表`, f); if (!mid) await tgSend(c.id, `<b>${month} 月结报表</b> ${f}\n下载：${signedFileUrl(f)}`, undefined, { type: 'REPORT' }); }
      await tgSend(c.id, `<b>${month} 月结自动任务完成</b>\n合并发票 ${summary.consolidated} 份 · 对账单 ${summary.statements} 份 · 报表 ${summary.reports} 份${summary.errors.length ? `\n错误 ${summary.errors.length} 项` : ''}\n请到网页端「月结」检查清单并锁定上月。`, undefined, { type: 'MONTH_END' });
    } catch (e: any) { summary.errors.push(e.message); }
    out.push(summary);
  }
  return out;
}

/** 由 lib/jobs.ts 的 startJobs 调用（只加一行） */
export async function registerEinvoiceJobs(boss: PgBoss) {
  await boss.createQueue('einvoice-retry');
  await boss.schedule('einvoice-retry', `*/${RETRY_MINUTES} * * * *`, {}, { tz: 'Asia/Kuala_Lumpur' });
  await boss.work('einvoice-retry', async () => { await runEinvoiceRetry(); });
  await boss.createQueue('finance-month-end');
  await boss.schedule('finance-month-end', '0 2 1 * *', {}, { tz: 'Asia/Kuala_Lumpur' });
  await boss.work('finance-month-end', async () => { await runMonthEndAuto(); });
  await boss.createQueue('overdue-ar-check');
  await boss.schedule('overdue-ar-check', '0 9 * * *', {}, { tz: 'Asia/Kuala_Lumpur' });
  await boss.work('overdue-ar-check', async () => { await runOverdueArCheck(); });
  console.log('jobs started: einvoice-retry, finance-month-end, overdue-ar-check');
}
