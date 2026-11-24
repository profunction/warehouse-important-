// 顾客当场自助（不用登录，店里贴二维码 /c/<公司代码>，收据二维码 /e/<公司代码>/<收据号>?t=签名）：
//  1. 会员登记：名字、手机（同一手机再登记就更新资料），可顺便存电子发票资料，以后收银报手机号就能自动开电子发票。不做积分。
//  2. 电子发票：扫收据二维码，自己填 TIN / 身份证、名字、电邮；72 小时内提交 MyInvois；超过 72 小时会并入月底合并发票。
//  3. 企业记账申请：填公司资料和想要的信用额，老板在"客户与应收"批准（定信用额和天数）后才能在收银台记账。
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { adminPool, withCompany } from '../lib/db.js';
import { requireAuth, requirePerm } from '../lib/auth.js';
import { AppError, notFound } from '../lib/errors.js';
import { tgSend } from '../lib/telegram.js';
import { nextDocNo } from '../lib/docno.js';
import { receiptToken } from '../lib/receiptLink.js';

const limit = (max: number) => ({ config: { rateLimit: process.env.NODE_ENV === 'test' ? false : { max, timeWindow: '1 hour' } } });
const phoneSchema = z.string().transform((s) => s.replace(/[\s-]/g, '')).pipe(z.string().regex(/^\+?[0-9]{8,15}$/));
const opt = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));
const profileSchema = z.object({ tin: opt(20), id_type: z.enum(['NRIC', 'BRN', 'PASSPORT', 'ARMY']).optional().nullable(), id_no: opt(30), name: opt(120), email: z.string().email().optional().nullable().or(z.literal('').transform(() => null)), phone: opt(20), address: opt(300), sst_no: opt(30) });
const EINV_WINDOW_H = 72;

async function shopByCode(code: string) {
  const c = (await adminPool.query(`SELECT id, name, short_code, plan, settings FROM company WHERE short_code = $1 AND is_active`, [String(code ?? '').toUpperCase()])).rows[0];
  if (!c) throw notFound(); return c;
}
const pubCx = (companyId: string) => ({ companyId, userId: null, deviceId: null });

export async function customerSelfRoutes(app: FastifyInstance) {
  app.get('/public/shop/:code', limit(120), async (req) => { const c = await shopByCode((req.params as any).code); return { name: c.name, code: c.short_code, credit_enabled: true }; });

  /** 会员登记（按手机号合并） */
  app.post('/public/shop/:code/member', limit(30), async (req, reply) => {
    const c = await shopByCode((req.params as any).code);
    const b = z.object({ name: z.string().trim().min(1).max(120), phone: phoneSchema, email: z.string().email().optional().nullable().or(z.literal('').transform(() => null)), einvoice: profileSchema.optional().nullable(), consent: z.literal(true) }).parse(req.body);
    const r = await withCompany(pubCx(c.id), async (tx) => {
      const ex = (await tx.query(`SELECT id, code FROM customer WHERE phone = $1 ORDER BY created_at LIMIT 1`, [b.phone])).rows[0];
      const prof = b.einvoice && (b.einvoice.tin || b.einvoice.id_no) ? JSON.stringify({ ...b.einvoice, name: b.einvoice.name ?? b.name, email: b.einvoice.email ?? b.email ?? null, phone: b.phone }) : null;
      if (ex) {
        await tx.query(`UPDATE customer SET name = $2, email = COALESCE($3, email), is_member = true, member_since = COALESCE(member_since, now()), consent_at = now(), einvoice_profile = COALESCE($4::jsonb, einvoice_profile), tin = COALESCE(tin, $5), id_type = COALESCE(id_type, $6), id_no = COALESCE(id_no, $7) WHERE id = $1`,
          [ex.id, b.name, b.email ?? null, prof, b.einvoice?.tin ?? null, b.einvoice?.id_type ?? null, b.einvoice?.id_no ?? null]);
        return { id: ex.id, member_no: ex.code, existing: true };
      }
      const code = await nextDocNo(tx, c.id, 'MEMBER', 'M', '', 5);
      const n = (await tx.query(`INSERT INTO customer (company_id, code, name, phone, email, tin, id_type, id_no, is_member, member_since, source, consent_at, einvoice_profile, credit_limit, credit_terms_days)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,now(),'SELF',now(),$9,0,0) RETURNING id, code`, [c.id, code, b.name, b.phone, b.email ?? null, b.einvoice?.tin ?? null, b.einvoice?.id_type ?? null, b.einvoice?.id_no ?? null, prof])).rows[0];
      return { id: n.id, member_no: n.code, existing: false };
    });
    reply.status(r.existing ? 200 : 201); return { member_no: r.member_no, existing: r.existing, shop: c.name };
  });

  /** 企业记账申请 */
  app.post('/public/shop/:code/credit-apply', limit(10), async (req, reply) => {
    const c = await shopByCode((req.params as any).code);
    const b = z.object({ company_name: z.string().trim().min(2).max(120), brn: opt(30), tin: opt(20), sst_no: opt(30), address: z.string().trim().min(5).max(300), contact_name: z.string().trim().min(1).max(80), phone: phoneSchema, email: z.string().email(), requested_limit: z.coerce.number().min(100).max(1_000_000), requested_terms: z.coerce.number().int().refine((v) => [7, 14, 30, 60].includes(v)).default(30), note: opt(300), consent: z.literal(true) }).parse(req.body);
    if (!b.brn && !b.tin) throw new AppError(400, 'VALIDATION', 'brn or tin required');
    const r = await withCompany(pubCx(c.id), async (tx) => {
      const ex = (await tx.query(`SELECT id, code, credit_status FROM customer WHERE (tin IS NOT NULL AND tin = $1) OR (brn IS NOT NULL AND brn = $2) OR phone = $3 ORDER BY (tin = $1) DESC NULLS LAST, created_at LIMIT 1`, [b.tin, b.brn, b.phone])).rows[0];
      const addr = JSON.stringify({ line1: b.address });
      if (ex?.credit_status === 'PENDING') throw new AppError(409, 'DUPLICATE', 'pending');
      if (ex?.credit_status === 'APPROVED') throw new AppError(409, 'DUPLICATE', 'approved');
      if (ex) { await tx.query(`UPDATE customer SET name = $2, brn = COALESCE($3, brn), tin = COALESCE($4, tin), sst_no = COALESCE($5, sst_no), address = $6, contact_name = $7, phone = $8, email = $9, credit_status = 'PENDING', credit_requested_limit = $10, credit_requested_terms = $11, credit_note = $12, consent_at = now(), id_type = COALESCE(id_type, 'BRN'), id_no = COALESCE(id_no, $3) WHERE id = $1`, [ex.id, b.company_name, b.brn, b.tin, b.sst_no, addr, b.contact_name, b.phone, b.email, b.requested_limit, b.requested_terms, b.note]); return ex.id; }
      const code = await nextDocNo(tx, c.id, 'CUSTOMER_B2B', 'C', '', 5);
      return (await tx.query(`INSERT INTO customer (company_id, code, name, brn, tin, sst_no, id_type, id_no, address, contact_name, phone, email, credit_limit, credit_terms_days, credit_status, credit_requested_limit, credit_requested_terms, credit_note, source, consent_at)
        VALUES ($1,$2,$3,$4,$5,$6,'BRN',$4,$7,$8,$9,$10,0,$11,'PENDING',$12,$11,$13,'SELF',now()) RETURNING id`, [c.id, code, b.company_name, b.brn, b.tin, b.sst_no, addr, b.contact_name, b.phone, b.email, b.requested_terms, b.requested_limit, b.note])).rows[0].id;
    });
    void tgSend(c.id, `<b>企业记账申请</b>\n${b.company_name}${b.brn ? ` · BRN ${b.brn}` : ''}\n联系人：${b.contact_name} ${b.phone}\n想要信用额 RM ${b.requested_limit.toFixed(2)} · ${b.requested_terms} 天\n请到网页"客户与应收"批准或拒绝`, undefined, { type: 'CREDIT_APPLICATION', refType: 'customer', refId: r });
    reply.status(201); return { status: 'PENDING' };
  });

  /** 收据电子发票：先看收据 */
  app.get('/public/receipt/:code/:receipt', limit(120), async (req) => {
    const { code, receipt } = req.params as any; const { t } = req.query as any;
    const c = await shopByCode(code);
    if (t !== receiptToken(c.id, receipt)) throw notFound();
    return withCompany(pubCx(c.id), async (tx) => {
      const s = (await tx.query(`SELECT id, receipt_no, sold_at, total, status, sale_type, einvoice_required, einvoice_buyer FROM sale WHERE receipt_no = $1`, [receipt])).rows[0];
      if (!s || s.sale_type === 'RETURN') throw notFound();
      const sub = (await tx.query(`SELECT status, document_uuid, long_id, validated_at FROM einvoice_submission WHERE ref_type = 'sale' AND ref_id = $1 ORDER BY created_at DESC LIMIT 1`, [s.id])).rows[0];
      const hours = (Date.now() - new Date(s.sold_at).getTime()) / 3600_000;
      return { shop: c.name, receipt_no: s.receipt_no, sold_at: s.sold_at, total: Number(s.total), status: s.status, expired: hours > EINV_WINDOW_H, deadline: new Date(new Date(s.sold_at).getTime() + EINV_WINDOW_H * 3600_000).toISOString(), submitted: !!sub, einvoice_status: sub?.status ?? null, buyer_name: s.einvoice_buyer?.name ?? null };
    });
  });
  /** 收据电子发票：顾客自己填资料提交 */
  app.post('/public/receipt/:code/:receipt/einvoice', limit(30), async (req, reply) => {
    const { code, receipt } = req.params as any; const { t } = req.query as any;
    const c = await shopByCode(code);
    if (t !== receiptToken(c.id, receipt)) throw notFound();
    const b = profileSchema.extend({ name: z.string().trim().min(1).max(120), email: z.string().email(), save_as_member: z.boolean().default(false), phone: opt(20) }).parse(req.body);
    if (!b.tin && !b.id_no) throw new AppError(400, 'EINVOICE_BUYER_REQUIRED');
    const subId = await withCompany(pubCx(c.id), async (tx) => {
      const s = (await tx.query(`SELECT * FROM sale WHERE receipt_no = $1 FOR UPDATE`, [receipt])).rows[0];
      if (!s || s.sale_type === 'RETURN' || s.status !== 'COMPLETED') throw notFound();
      if ((Date.now() - new Date(s.sold_at).getTime()) / 3600_000 > EINV_WINDOW_H) throw new AppError(409, 'EINVOICE_EXPIRED');
      const ex = (await tx.query(`SELECT id, status FROM einvoice_submission WHERE ref_type = 'sale' AND ref_id = $1 AND status IN ('QUEUED','SUBMITTED','VALID') LIMIT 1`, [s.id])).rows[0];
      if (ex) throw new AppError(409, 'DUPLICATE', 'already submitted');
      const buyer = { tin: b.tin, id_type: b.id_type ?? (b.tin ? null : 'NRIC'), id_no: b.id_no, name: b.name, email: b.email, phone: b.phone, address: b.address, sst_no: b.sst_no };
      let customerId: string | null = s.customer_id;
      if (b.save_as_member && b.phone) {
        const phone = b.phone.replace(/[\s-]/g, '');
        const cu = (await tx.query(`SELECT id FROM customer WHERE phone = $1 LIMIT 1`, [phone])).rows[0];
        if (cu) { await tx.query(`UPDATE customer SET is_member = true, member_since = COALESCE(member_since, now()), einvoice_profile = $2, consent_at = now() WHERE id = $1`, [cu.id, JSON.stringify(buyer)]); customerId = customerId ?? cu.id; }
        else { const mcode = await nextDocNo(tx, c.id, 'MEMBER', 'M', '', 5); customerId = customerId ?? (await tx.query(`INSERT INTO customer (company_id, code, name, phone, email, tin, id_type, id_no, is_member, member_since, source, consent_at, einvoice_profile, credit_limit, credit_terms_days) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,now(),'SELF',now(),$9,0,0) RETURNING id`, [c.id, mcode, b.name, phone, b.email, b.tin, buyer.id_type, b.id_no, JSON.stringify(buyer)])).rows[0].id; }
      }
      await tx.query(`UPDATE sale SET einvoice_required = true, einvoice_buyer = $2, customer_id = COALESCE(customer_id, $3) WHERE id = $1`, [s.id, JSON.stringify(buyer), customerId]);
      const env = (c.settings?.myinvois_env ?? process.env.MYINVOIS_ENV ?? 'STUB').toUpperCase();
      return (await tx.query(`INSERT INTO einvoice_submission (company_id, doc_type, ref_type, ref_id, env, status) VALUES ($1,'INVOICE','sale',$2,$3,'QUEUED') RETURNING id`, [c.id, s.id, ['SANDBOX', 'PRODUCTION', 'STUB'].includes(env) ? env : 'STUB'])).rows[0].id;
    });
    let status = 'QUEUED';
    try { const { submitSubmission } = await import('../lib/einvoiceJobs.js'); const r = await submitSubmission(c.id, subId, null); status = r?.status ?? status; } catch { /* 进重试队列 */ }
    reply.status(201); return { status };
  });

  // ---------- 店里用（要登录） ----------
  app.register(async (a) => {
    a.addHook('preHandler', requireAuth);
    const cx = (req: any) => ({ companyId: req.ctx.companyId, userId: req.ctx.userId, deviceId: req.ctx.deviceId });
    /** 柜台贴的顾客登记二维码（PNG） */
    a.get('/customers/self-register-qr', async (req, reply) => {
      const q = z.object({ origin: z.string().url() }).parse(req.query);
      const c = (await adminPool.query(`SELECT short_code FROM company WHERE id = $1`, [req.ctx.companyId])).rows[0];
      const url = `${q.origin.replace(/\/$/, '')}/c/${c.short_code}`;
      const QRCode = (await import('qrcode')).default;
      reply.header('Content-Type', 'image/png').header('X-Url', url);
      return reply.send(await QRCode.toBuffer(url, { width: 600, margin: 2 }));
    });
    a.get('/customers/credit-applications', { preHandler: requirePerm('customer.manage', 'invoice.manage') }, async (req) => withCompany(cx(req), async (tx) =>
      (await tx.query(`SELECT id, code, name, brn, tin, sst_no, address, contact_name, phone, email, credit_requested_limit, credit_requested_terms, credit_note, credit_status, created_at, updated_at FROM customer WHERE credit_status = 'PENDING' ORDER BY updated_at`)).rows));
    a.post('/customers/:id/credit-decision', { preHandler: requirePerm('invoice.manage') }, async (req) => {
      const { id } = req.params as any;
      const b = z.object({ approve: z.boolean(), credit_limit: z.coerce.number().min(0).max(1_000_000).optional(), credit_terms_days: z.coerce.number().int().min(0).max(120).optional(), note: z.string().max(300).optional() }).parse(req.body);
      return withCompany(cx(req), async (tx) => {
        const cu = (await tx.query(`SELECT * FROM customer WHERE id = $1 FOR UPDATE`, [id])).rows[0]; if (!cu) throw notFound('CUSTOMER_NOT_FOUND');
        if (cu.credit_status !== 'PENDING') throw new AppError(409, 'APPROVAL_NOT_PENDING');
        if (b.approve) await tx.query(`UPDATE customer SET credit_status = 'APPROVED', credit_limit = $2, credit_terms_days = $3, credit_decided_by = $4, credit_decided_at = now(), credit_note = COALESCE($5, credit_note) WHERE id = $1`, [id, b.credit_limit ?? cu.credit_requested_limit ?? 0, b.credit_terms_days ?? cu.credit_requested_terms ?? 30, req.ctx.userId, b.note ?? null]);
        else await tx.query(`UPDATE customer SET credit_status = 'REJECTED', credit_limit = 0, credit_decided_by = $2, credit_decided_at = now(), credit_note = COALESCE($3, credit_note) WHERE id = $1`, [id, req.ctx.userId, b.note ?? null]);
        return (await tx.query(`SELECT id, name, credit_status, credit_limit, credit_terms_days FROM customer WHERE id = $1`, [id])).rows[0];
      });
    });
  });
}
