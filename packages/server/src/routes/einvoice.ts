// 电子发票 MyInvois（模块 D）。提交逻辑在 lib/einvoiceJobs.ts（submitSubmission），客户端在 lib/myinvois.ts。
// 自定决定：
//  - 同一单据已有未失败的 submission 时，再提交直接返回已有行（200），不重复提交。
//  - 个人电子发票：sale.einvoice_buyer 必须有 tin 或 id_no（可在本接口传 buyer 覆盖写回 sale）。
//  - 合并发票受 feature_flags.einvoice_consolidated 门控（默认开）。
//  - 设定存在 company.settings.myinvois_*；client_secret 只回显掩码；PUT 不传 secret 时保留旧值。
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import QRCode from 'qrcode';
import { withCompany } from '../lib/db.js';
import { requireAuth, requirePerm } from '../lib/auth.js';
import { AppError, notFound } from '../lib/errors.js';
import { cancelSubmission, consolidatedPreview, createConsolidated, monthStart, submitSubmission } from '../lib/einvoiceJobs.js';
import { loadMyInvoisConfig, maskSecret, verifyUrl } from '../lib/myinvois.js';

const cx = (req: any) => ({ companyId: req.ctx.companyId, userId: req.ctx.userId, deviceId: req.ctx.deviceId });
const ACTIVE = ['QUEUED', 'SUBMITTED', 'VALID'];
const SUB_SQL = `SELECT e.*, CASE WHEN e.ref_type = 'sale' THEN s.receipt_no WHEN e.ref_type = 'invoice' THEN i.invoice_no ELSE 'CONS-' || si.code || '-' || to_char(cp.period_month, 'YYYYMM') END AS doc_no,
  CASE WHEN e.ref_type = 'sale' THEN s.total WHEN e.ref_type = 'invoice' THEN i.total ELSE cp.total END AS amount,
  CASE WHEN e.ref_type = 'sale' THEN coalesce(s.einvoice_buyer->>'name', s.einvoice_buyer->>'tin') WHEN e.ref_type = 'invoice' THEN c.name ELSE 'Consolidated Buyers' END AS buyer_name
  FROM einvoice_submission e LEFT JOIN sale s ON e.ref_type = 'sale' AND s.id = e.ref_id LEFT JOIN invoice i ON e.ref_type = 'invoice' AND i.id = e.ref_id LEFT JOIN customer c ON c.id = i.customer_id
  LEFT JOIN consolidated_invoice_period cp ON e.ref_type = 'consolidated_invoice_period' AND cp.id = e.ref_id LEFT JOIN site si ON si.id = cp.site_id`;

export async function einvoiceRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);
  const buyerSchema = z.object({ name: z.string().optional(), tin: z.string().optional().nullable(), id_type: z.enum(['NRIC', 'BRN', 'PASSPORT', 'ARMY']).optional().nullable(), id_no: z.string().optional().nullable(), sst_no: z.string().optional().nullable(), email: z.string().optional().nullable(), phone: z.string().optional().nullable(), address: z.any().optional() });

  /** 个人电子发票（顾客在 POS 要求） */
  app.post('/einvoice/sales/:sale_id', { preHandler: requirePerm('einvoice.manage', 'pos.sell') }, async (req, reply) => {
    const { sale_id } = req.params as any;
    const b = z.object({ buyer: buyerSchema.optional() }).parse(req.body ?? {});
    const id = await withCompany(cx(req), async (tx) => {
      const s = (await tx.query(`SELECT * FROM sale WHERE id = $1 FOR UPDATE`, [sale_id])).rows[0]; if (!s) throw notFound();
      if (s.status !== 'COMPLETED') throw new AppError(409, 'EINVOICE_STATE', `sale ${s.status}`);
      const buyer = b.buyer ?? s.einvoice_buyer;
      if (!buyer || (!buyer.tin && !buyer.id_no)) throw new AppError(400, 'EINVOICE_BUYER_REQUIRED');
      if (b.buyer) await tx.query(`UPDATE sale SET einvoice_buyer = $2, einvoice_required = true WHERE id = $1`, [sale_id, JSON.stringify(buyer)]);
      else if (!s.einvoice_required) await tx.query(`UPDATE sale SET einvoice_required = true WHERE id = $1`, [sale_id]);
      const existing = (await tx.query(`SELECT * FROM einvoice_submission WHERE ref_type = 'sale' AND ref_id = $1 AND status = ANY($2) ORDER BY created_at DESC LIMIT 1`, [sale_id, ACTIVE])).rows[0];
      if (existing) return { id: existing.id, existing: true };
      const cfg = await loadMyInvoisConfig(req.ctx.companyId);
      const r = (await tx.query(`INSERT INTO einvoice_submission (company_id, doc_type, ref_type, ref_id, env, status) VALUES ($1, $2, 'sale', $3, $4, 'QUEUED') RETURNING id`, [req.ctx.companyId, s.sale_type === 'RETURN' ? 'CREDIT_NOTE' : 'INVOICE', sale_id, cfg.env])).rows[0];
      return { id: r.id, existing: false };
    });
    const row = id.existing ? await withCompany(cx(req), async (tx) => (await tx.query(`${SUB_SQL} WHERE e.id = $1`, [id.id])).rows[0]) : await submitSubmission(req.ctx.companyId, id.id, req.ctx.userId);
    reply.status(id.existing ? 200 : 201); return row;
  });
  /** 企业发票 */
  app.post('/einvoice/invoices/:invoice_id', { preHandler: requirePerm('einvoice.manage', 'invoice.manage') }, async (req, reply) => {
    const { invoice_id } = req.params as any;
    const id = await withCompany(cx(req), async (tx) => {
      const inv = (await tx.query(`SELECT i.*, c.tin, c.brn, c.id_no FROM invoice i JOIN customer c ON c.id = i.customer_id WHERE i.id = $1`, [invoice_id])).rows[0]; if (!inv) throw notFound();
      if (inv.status === 'CANCELLED') throw new AppError(409, 'EINVOICE_STATE', 'invoice cancelled');
      if (!inv.tin && !inv.brn && !inv.id_no) throw new AppError(400, 'EINVOICE_BUYER_REQUIRED', 'customer TIN/BRN missing');
      const existing = (await tx.query(`SELECT * FROM einvoice_submission WHERE ref_type = 'invoice' AND ref_id = $1 AND status = ANY($2) ORDER BY created_at DESC LIMIT 1`, [invoice_id, ACTIVE])).rows[0];
      if (existing) return { id: existing.id, existing: true };
      const cfg = await loadMyInvoisConfig(req.ctx.companyId);
      const r = (await tx.query(`INSERT INTO einvoice_submission (company_id, doc_type, ref_type, ref_id, env, status) VALUES ($1, 'INVOICE', 'invoice', $2, $3, 'QUEUED') RETURNING id`, [req.ctx.companyId, invoice_id, cfg.env])).rows[0];
      await tx.query(`UPDATE invoice SET einvoice_submission_id = $2 WHERE id = $1`, [invoice_id, r.id]);
      return { id: r.id, existing: false };
    });
    const row = id.existing ? await withCompany(cx(req), async (tx) => (await tx.query(`${SUB_SQL} WHERE e.id = $1`, [id.id])).rows[0]) : await submitSubmission(req.ctx.companyId, id.id, req.ctx.userId);
    reply.status(id.existing ? 200 : 201); return row;
  });
  app.get('/einvoice/submissions', { preHandler: requirePerm('einvoice.manage', 'invoice.manage', 'period.lock') }, async (req) => {
    const q = z.object({ status: z.string().optional(), doc_type: z.string().optional(), limit: z.coerce.number().int().min(1).max(1000).default(300) }).parse(req.query);
    return withCompany(cx(req), async (tx) => (await tx.query(`${SUB_SQL} WHERE ($1::text IS NULL OR e.status = $1) AND ($2::text IS NULL OR e.doc_type = $2) ORDER BY e.created_at DESC LIMIT $3`, [q.status ?? null, q.doc_type ?? null, q.limit])).rows);
  });
  app.get('/einvoice/submissions/:id', { preHandler: requirePerm('einvoice.manage', 'invoice.manage') }, async (req) => {
    const { id } = req.params as any;
    return withCompany(cx(req), async (tx) => { const r = (await tx.query(`${SUB_SQL} WHERE e.id = $1`, [id])).rows[0]; if (!r) throw notFound(); return r; });
  });
  app.post('/einvoice/submissions/:id/retry', { preHandler: requirePerm('einvoice.manage') }, async (req) => {
    const { id } = req.params as any;
    await withCompany(cx(req), async (tx) => {
      const s = (await tx.query(`SELECT status FROM einvoice_submission WHERE id = $1`, [id])).rows[0]; if (!s) throw notFound();
      if (!['QUEUED', 'FAILED', 'SUBMITTED', 'INVALID'].includes(s.status)) throw new AppError(409, 'EINVOICE_STATE', s.status);
      // INVALID 的允许重新提交（修好 TIN 之后）
      if (s.status === 'INVALID') await tx.query(`UPDATE einvoice_submission SET status = 'QUEUED', document_uuid = NULL, long_id = NULL, retry_count = 0 WHERE id = $1`, [id]);
    });
    return submitSubmission(req.ctx.companyId, id, req.ctx.userId);
  });
  app.post('/einvoice/submissions/:id/cancel', { preHandler: requirePerm('einvoice.manage') }, async (req) => {
    const { id } = req.params as any;
    const b = z.object({ reason: z.string().min(1).max(300) }).parse(req.body);
    return withCompany(cx(req), async (tx) => {
      const s = (await tx.query(`SELECT * FROM einvoice_submission WHERE id = $1 FOR UPDATE`, [id])).rows[0]; if (!s) throw notFound();
      const r = await cancelSubmission(tx, req.ctx.companyId, s, b.reason);
      if (s.ref_type === 'consolidated_invoice_period') await tx.query(`UPDATE consolidated_invoice_period SET locked = false WHERE id = $1`, [s.ref_id]);
      await tx.query(`INSERT INTO audit_log (company_id, user_id, action, table_name, row_id, after_json) VALUES ($1,$2,'UPDATE','einvoice_submission',$3,$4)`, [req.ctx.companyId, req.ctx.userId, id, JSON.stringify({ action: 'EINVOICE_CANCEL', reason: b.reason })]);
      return r;
    });
  });
  app.get('/einvoice/submissions/:id/qr', { preHandler: requirePerm('einvoice.manage', 'invoice.manage', 'pos.sell') }, async (req, reply) => {
    const { id } = req.params as any;
    const s = await withCompany(cx(req), async (tx) => (await tx.query(`SELECT * FROM einvoice_submission WHERE id = $1`, [id])).rows[0]);
    if (!s) throw notFound();
    if (s.status !== 'VALID' || !s.document_uuid || !s.long_id) throw new AppError(409, 'EINVOICE_STATE', s.status);
    const url = s.qr_url ?? verifyUrl(s.env, s.document_uuid, s.long_id);
    const png = await QRCode.toBuffer(url, { errorCorrectionLevel: 'M', margin: 1, scale: 6 });
    reply.header('content-type', 'image/png').header('x-verify-url', url).header('cache-control', 'public, max-age=86400');
    return reply.send(png);
  });

  // ---------- 合并发票 ----------
  const checkFlag = async (tx: any, companyId: string) => { const f = (await tx.query(`SELECT feature_flags FROM company WHERE id = $1`, [companyId])).rows[0]?.feature_flags ?? {}; if (f.einvoice_consolidated === false) throw new AppError(403, 'FEATURE_DISABLED'); };
  app.post('/einvoice/consolidated/:site_id/:month/preview', { preHandler: requirePerm('einvoice.manage') }, async (req) => {
    const { site_id, month } = req.params as any; monthStart(month);
    return withCompany(cx(req), async (tx) => { await checkFlag(tx, req.ctx.companyId); return consolidatedPreview(tx, site_id, month); });
  });
  app.post('/einvoice/consolidated/:site_id/:month/submit', { preHandler: requirePerm('einvoice.manage') }, async (req, reply) => {
    const { site_id, month } = req.params as any; monthStart(month);
    await withCompany(cx(req), async (tx) => { await checkFlag(tx, req.ctx.companyId); const s = (await tx.query(`SELECT 1 FROM site WHERE id = $1`, [site_id])).rows[0]; if (!s) throw notFound(); });
    const r = await createConsolidated(req.ctx.companyId, req.ctx.userId, site_id, month);
    reply.status(201); return r;
  });
  app.get('/einvoice/consolidated', { preHandler: requirePerm('einvoice.manage', 'period.lock') }, async (req) => withCompany(cx(req), async (tx) => (await tx.query(`SELECT p.*, s.code AS site_code, s.name AS site_name, e.status AS submission_status, e.document_uuid, e.validated_at FROM consolidated_invoice_period p JOIN site s ON s.id = p.site_id LEFT JOIN einvoice_submission e ON e.id = p.submission_id ORDER BY p.period_month DESC, s.code LIMIT 200`)).rows));

  // ---------- 设定 ----------
  app.get('/einvoice/settings', { preHandler: requirePerm('settings.edit', 'einvoice.manage') }, async (req) => {
    const cfg = await loadMyInvoisConfig(req.ctx.companyId);
    return { env: cfg.env, client_id: cfg.clientId, client_secret: maskSecret(cfg.clientSecret), tin: cfg.tin, brn: cfg.brn, sst_no: cfg.sstNo, msic_code: cfg.msic, configured: cfg.env === 'STUB' || !!(cfg.clientId && cfg.clientSecret && cfg.tin), verify_base: cfg.env };
  });
  app.put('/einvoice/settings', { preHandler: requirePerm('settings.edit') }, async (req) => {
    const b = z.object({ client_id: z.string().max(200).optional().nullable(), client_secret: z.string().max(200).optional().nullable(), env: z.enum(['STUB', 'SANDBOX', 'PRODUCTION']).optional(), tin: z.string().max(20).optional().nullable(), brn: z.string().max(30).optional().nullable(), msic_code: z.string().regex(/^[0-9]{5}$/).optional().nullable() }).parse(req.body);
    await withCompany(cx(req), async (tx) => {
      const patch: Record<string, any> = {};
      if (b.client_id !== undefined) patch.myinvois_client_id = b.client_id;
      if (b.client_secret) patch.myinvois_client_secret = b.client_secret;    // 掩码或空不覆盖
      if (b.env) patch.myinvois_env = b.env;
      if (b.brn !== undefined) patch.myinvois_brn = b.brn;
      await tx.query(`UPDATE company SET settings = settings || $2::jsonb, tin = coalesce($3, tin), msic_code = coalesce($4, msic_code) WHERE id = $1`, [req.ctx.companyId, JSON.stringify(patch), b.tin ?? null, b.msic_code ?? null]);
      await tx.query(`INSERT INTO audit_log (company_id, user_id, action, table_name, row_id, after_json) VALUES ($1,$2,'UPDATE','company_settings_myinvois',$1,$3)`, [req.ctx.companyId, req.ctx.userId, JSON.stringify({ ...patch, myinvois_client_secret: b.client_secret ? maskSecret(b.client_secret) : undefined, tin: b.tin, msic_code: b.msic_code })]);
    });
    const { invalidatePermCache } = await import('../lib/auth.js'); invalidatePermCache();
    const cfg = await loadMyInvoisConfig(req.ctx.companyId);
    return { env: cfg.env, client_id: cfg.clientId, client_secret: maskSecret(cfg.clientSecret), tin: cfg.tin, brn: cfg.brn, msic_code: cfg.msic, configured: cfg.env === 'STUB' || !!(cfg.clientId && cfg.clientSecret && cfg.tin) };
  });
}
