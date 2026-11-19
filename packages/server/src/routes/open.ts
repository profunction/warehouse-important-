// 开放接口（第七组，Pandal 等外部收银系统）+ API 密钥管理。
// 约定（设计文档没写的部分）：
// - 门禁只看 API 密钥范围（requireApiKey('OPEN')），不检查 pandal 功能开关：A 模式也可能接收银机小程序推导出文件。
// - 外部销售的库存移动 performed_by 用该公司的 BOSS（触发器按 performed_by 查 movement.sale 权限；BOSS 有）。cashier_id 留空，source 'PANDAL'。
// - 未知条码：该行跳过并开 PANDAL_UNKNOWN 工单给 MANAGER（1 天），其余行照常；全部未知 → 400 VALIDATION（不建空单）。
// - external_ref 幂等：重复返回原结果（duplicate: true），并写 external_sync_log DUPLICATE。
// - 退货 POST /open/returns 直接产生 RETURN 销售（外部系统已有自己的审批），按原单 external_ref 找原单。
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withCompany, adminPool, type Tx } from '../lib/db.js';
import { requireAuth, requirePerm } from '../lib/auth.js';
import { requireApiKey, generateApiKey, invalidateApiKeyCache, type ApiKeyCtx } from '../lib/apikey.js';
import { AppError, notFound } from '../lib/errors.js';
import { createSale, createReturnSale, voidSale, loadSaleFull, resolveSite, type SaleCtx } from './pos.js';

/** 外部销售的执行人：BOSS（有 movement.sale/return 权限） */
export async function externalActor(tx: Tx, companyId: string): Promise<string> {
  const r = (await tx.query(`SELECT u.id FROM app_user u JOIN user_site_role usr ON usr.user_id = u.id JOIN role r ON r.id = usr.role_id WHERE u.company_id = $1 AND u.is_active AND r.code = 'BOSS' ORDER BY u.created_at LIMIT 1`, [companyId])).rows[0];
  if (!r) throw new AppError(400, 'VALIDATION', 'company has no boss user');
  return r.id;
}
async function companyCtx(tx: Tx, companyId: string, siteId: string | null): Promise<SaleCtx> {
  const c = (await tx.query(`SELECT plan, settings FROM company WHERE id = $1`, [companyId])).rows[0];
  return { companyId, userId: await externalActor(tx, companyId), deviceId: null, siteId, plan: c.plan, settings: c.settings ?? {} };
}
export const openSaleSchema = z.object({
  external_ref: z.string().min(1).max(80), site_code: z.string().optional().nullable(), terminal_code: z.string().max(10).optional().nullable(),
  sold_at: z.string().datetime({ offset: true }).optional().nullable(),
  lines: z.array(z.object({ barcode: z.string().min(1), qty: z.number().positive().default(1), weight_kg: z.number().positive().optional().nullable(), unit_price: z.number().min(0).optional().nullable(), discount: z.number().min(0).optional().nullable() })).min(1),
  payments: z.array(z.object({ method: z.enum(['CASH', 'CARD', 'EWALLET', 'BANK_TRANSFER', 'CHEQUE']), amount: z.number().min(0), reference: z.string().optional().nullable() })).default([]),
  customer_code: z.string().optional().nullable(), note: z.string().max(200).optional().nullable(),
});
export type OpenSaleInput = z.infer<typeof openSaleSchema>;

/** Pandal/小程序 → 内部销售。供 /open/sales 与 posJobs 拉取共用。 */
export async function createSaleFromExternal(tx: Tx, key: { companyId: string; siteId: string | null }, system: string, input: OpenSaleInput) {
  const ctx = await companyCtx(tx, key.companyId, key.siteId);
  const site = input.site_code ? await resolveSite(tx, null, input.site_code) : await resolveSite(tx, key.siteId);
  // 成功/重复写在同一事务；失败时事务已中止，用 adminPool 另写一条（不随回滚丢失）
  const log = async (status: 'OK' | 'DUPLICATE' | 'ERROR', detail: any) => { await (status === 'ERROR' ? adminPool : tx).query(`INSERT INTO external_sync_log (company_id, system, direction, entity, external_ref, status, detail) VALUES ($1,$2,'PUSH','sale',$3,$4,$5)`, [key.companyId, system, input.external_ref, status, JSON.stringify(detail)]); };
  let customerId: string | null = null;
  if (input.customer_code) customerId = (await tx.query(`SELECT id FROM customer WHERE code = $1 AND is_active`, [input.customer_code])).rows[0]?.id ?? null;
  let r;
  try {
    r = await createSale(tx, { ...ctx, siteId: site.id }, {
      client_id: null, terminal_code: input.terminal_code ?? 'PD', session_id: null, receipt_no: null, device_id: null,
      lines: input.lines.map((l) => ({ barcode: l.barcode, qty: l.qty, weight_kg: l.weight_kg ?? null, unit_price: l.unit_price ?? null, discount: l.discount ?? null, discount_pct: null, product_id: null, supervisor_pin: null, approved_by_pin: null, note: null })),
      payments: input.payments.map((p) => ({ method: p.method, amount: p.amount, tendered: null, reference: p.reference ?? null })),
      customer_id: customerId, sale_type: 'RETAIL', einvoice_required: false, einvoice_buyer: null, sold_at: input.sold_at ?? null, note: input.note ?? null, hold_id: null,
    }, { source: 'PANDAL', site_id: site.id, external_ref: input.external_ref, skip_unknown: true, cashier_id: null });
  } catch (e: any) {
    // 全部条码未知等：事务已中止，工单用 adminPool 另开，再抛
    if (e instanceof AppError && e.code === 'VALIDATION' && (e.detail as any)?.skipped?.length) {
      await openUnknownTicket(adminPool, key.companyId, site.id, input.external_ref, (e.detail as any).skipped);
    }
    await log('ERROR', { code: e?.code ?? 'INTERNAL', detail: e?.detail ?? e?.message });
    throw e;
  }
  if (r.skipped?.length) await openUnknownTicket(tx, key.companyId, site.id, input.external_ref, r.skipped);
  await log(r.duplicate ? 'DUPLICATE' : 'OK', { sale_id: r.id, receipt_no: r.receipt_no, total: r.total, skipped: r.skipped });
  return { sale_id: r.id, receipt_no: r.receipt_no, external_ref: input.external_ref, total: r.total, tax_amount: r.tax_amount, lines: r.lines.map((l: any) => ({ barcode: l.barcode_scanned, product_id: l.product_id, qty: l.qty, unit_price: l.unit_price, line_total: l.line_total })), skipped_barcodes: r.skipped ?? [], duplicate: r.duplicate };
}
async function openUnknownTicket(tx: Pick<Tx, 'query'>, companyId: string, siteId: string, ref: string, barcodes: string[]) {
  await tx.query(`INSERT INTO ticket (company_id, site_id, type, title, ref_type, owner_role_code, priority, deadline_at) VALUES ($1,$2,'PANDAL_UNKNOWN',$3,'external_sale','MANAGER','NORMAL', now() + interval '1 day')`,
    [companyId, siteId, `Pandal 未知条码 ${barcodes.slice(0, 3).join(', ')}${barcodes.length > 3 ? ` 等 ${barcodes.length} 个` : ''}（交易 ${ref}）`]);
}

const productCols = `p.id, p.sku, p.name_zh, p.name_ms, p.name_en, p.photo_url, p.category_id, c.code AS category_code, p.unit, p.is_weighed, p.plu_code, p.sell_price, t.code AS tax_code, t.rate AS tax_rate, p.is_active, p.updated_at,
  coalesce((SELECT json_agg(json_build_object('barcode', b.barcode, 'pack_qty', b.pack_qty, 'barcode_type', b.barcode_type, 'is_primary', b.is_primary) ORDER BY b.is_primary DESC) FROM barcode b WHERE b.product_id = p.id), '[]'::json) AS barcodes`;
const productFrom = `FROM product p JOIN tax_code t ON t.id = p.tax_code_id JOIN category c ON c.id = p.category_id`;

export async function openRoutes(app: FastifyInstance) {
  // ----- 外部系统（API 密钥） -----
  app.register(async (o) => {
    o.addHook('preHandler', requireApiKey('OPEN'));
    const kx = (req: any) => ({ companyId: (req.apiKey as ApiKeyCtx).companyId, userId: null });

    o.get('/open/health', async (req) => ({ ok: true, time: new Date().toISOString(), company_id: req.apiKey!.companyId, key: req.apiKey!.name, scope: req.apiKey!.scope }));

    o.get('/open/products', async (req) => {
      const q = z.object({ since: z.string().optional(), limit: z.coerce.number().min(1).max(2000).default(500), include_inactive: z.coerce.boolean().optional() }).parse(req.query);
      return withCompany(kx(req), async (tx) => {
        const rows = (await tx.query(`SELECT ${productCols} ${productFrom} WHERE ($1::timestamptz IS NULL OR p.updated_at > $1) AND ($3::boolean OR p.is_active) ORDER BY p.updated_at, p.id LIMIT $2`, [q.since ?? null, q.limit + 1, !!q.include_inactive])).rows;
        const has_more = rows.length > q.limit; if (has_more) rows.pop();
        return { data: rows, has_more, next_since: rows.length ? rows[rows.length - 1].updated_at : q.since ?? null, server_time: new Date().toISOString() };
      });
    });
    o.get('/open/products/:barcode', async (req) => {
      const { barcode } = req.params as any;
      return withCompany(kx(req), async (tx) => {
        const r = (await tx.query(`SELECT ${productCols}, b.pack_qty AS scanned_pack_qty ${productFrom} JOIN barcode b ON b.product_id = p.id WHERE b.barcode = $1`, [barcode])).rows[0];
        if (!r) throw notFound('BARCODE_NOT_FOUND');
        return r;
      });
    });
    o.get('/open/stock/:barcode', async (req) => {
      const { barcode } = req.params as any;
      const q = z.object({ site: z.string().optional() }).parse(req.query);
      return withCompany(kx(req), async (tx) => {
        const b = (await tx.query(`SELECT product_id FROM barcode WHERE barcode = $1`, [barcode])).rows[0];
        if (!b) throw notFound('BARCODE_NOT_FOUND');
        const siteId = q.site ? (await tx.query(`SELECT id FROM site WHERE code = $1 OR id::text = $1`, [q.site])).rows[0]?.id : req.apiKey!.siteId;
        const qty = Number((await tx.query(`SELECT coalesce(sum(s.qty),0) q FROM stock s JOIN location l ON l.id = s.location_id WHERE s.product_id = $1 AND NOT l.is_virtual AND ($2::uuid IS NULL OR l.site_id = $2)`, [b.product_id, siteId ?? null])).rows[0].q);
        const hide = !!(await tx.query(`SELECT (settings->>'open_api_hide_qty')::boolean AS h FROM company WHERE id = $1`, [req.apiKey!.companyId])).rows[0]?.h;
        return { barcode, product_id: b.product_id, site_id: siteId ?? null, in_stock: qty > 0, ...(hide ? {} : { qty }) };
      });
    });
    o.get('/open/customers', async (req) => withCompany(kx(req), async (tx) => (await tx.query(`SELECT id, code, name, tin, brn, phone, email, credit_terms_days, credit_limit, balance, is_active, updated_at FROM customer WHERE is_active ORDER BY name`)).rows));

    o.post('/open/sales', async (req, reply) => {
      const b = openSaleSchema.parse(req.body);
      const r = await withCompany(kx(req), (tx) => createSaleFromExternal(tx, req.apiKey!, 'PANDAL', b));
      reply.status(r.duplicate ? 200 : 201);
      return r;
    });
    o.post('/open/sales/:external_ref/void', async (req) => {
      const { external_ref } = req.params as any;
      const b = z.object({ reason: z.string().max(200).default('VOID') }).parse(req.body ?? {});
      return withCompany(kx(req), async (tx) => {
        const s = (await tx.query(`SELECT id FROM sale WHERE external_ref = $1`, [external_ref])).rows[0];
        if (!s) throw notFound('NOT_FOUND');
        const actor = await externalActor(tx, req.apiKey!.companyId);
        const r = await voidSale(tx, { companyId: req.apiKey!.companyId, userId: actor }, s.id, b.reason);
        await tx.query(`INSERT INTO external_sync_log (company_id, system, direction, entity, external_ref, status, detail) VALUES ($1,'PANDAL','PUSH','void',$2,$3,$4)`, [req.apiKey!.companyId, external_ref, r.duplicate ? 'DUPLICATE' : 'OK', JSON.stringify({ sale_id: s.id })]);
        return { sale_id: s.id, external_ref, status: r.status, duplicate: r.duplicate };
      });
    });
    o.post('/open/returns', async (req, reply) => {
      const b = z.object({ external_ref: z.string().min(1), return_ref: z.string().min(1).max(80), lines: z.array(z.object({ barcode: z.string(), qty: z.number().positive() })).min(1), reason: z.string().max(200).optional().nullable(), method: z.enum(['CASH', 'CARD', 'EWALLET']).optional().nullable() }).parse(req.body);
      const r = await withCompany(kx(req), async (tx) => {
        const s = (await tx.query(`SELECT id FROM sale WHERE external_ref = $1`, [b.external_ref])).rows[0];
        if (!s) throw notFound('NOT_FOUND');
        const actor = await externalActor(tx, req.apiKey!.companyId);
        const lines: { product_id: string; qty: number }[] = [];
        for (const l of b.lines) { const bc = (await tx.query(`SELECT product_id, pack_qty FROM barcode WHERE barcode = $1`, [l.barcode])).rows[0]; if (!bc) throw notFound('BARCODE_NOT_FOUND'); lines.push({ product_id: bc.product_id, qty: l.qty * Number(bc.pack_qty) }); }
        const ret = await createReturnSale(tx, { companyId: req.apiKey!.companyId, userId: actor }, { original_sale_id: s.id, lines, reason: b.reason ?? null, method: b.method ?? null, external_ref: b.return_ref, source: 'PANDAL', performed_by: actor });
        await tx.query(`INSERT INTO external_sync_log (company_id, system, direction, entity, external_ref, status, detail) VALUES ($1,'PANDAL','PUSH','return',$2,$3,$4)`, [req.apiKey!.companyId, b.return_ref, ret.duplicate ? 'DUPLICATE' : 'OK', JSON.stringify({ sale_id: ret.id, total: ret.total })]);
        return { sale_id: ret.id, receipt_no: ret.receipt_no, return_ref: b.return_ref, total: ret.total, duplicate: ret.duplicate };
      });
      reply.status(r.duplicate ? 200 : 201);
      return r;
    });
    o.get('/open/sales', async (req) => {
      const q = z.object({ from: z.string().optional(), to: z.string().optional(), source: z.string().optional(), limit: z.coerce.number().max(2000).default(500) }).parse(req.query);
      return withCompany(kx(req), async (tx) => {
        const rows = (await tx.query(`SELECT s.id, s.receipt_no, s.external_ref, s.sale_type, s.source, s.status, s.terminal_code, st.code AS site_code, s.subtotal, s.discount_total, s.tax_amount, s.rounding, s.total, s.sold_at,
            (SELECT json_agg(json_build_object('method', p.method, 'amount', p.amount)) FROM payment p WHERE p.sale_id = s.id) AS payments
          FROM sale s JOIN site st ON st.id = s.site_id WHERE s.status <> 'HELD' AND ($1::timestamptz IS NULL OR s.sold_at >= $1) AND ($2::timestamptz IS NULL OR s.sold_at < $2) AND ($3::text IS NULL OR s.source = $3) ORDER BY s.sold_at LIMIT $4`, [q.from ?? null, q.to ?? null, q.source ?? null, q.limit])).rows;
        return { data: rows, totals: { count: rows.length, total: Math.round(rows.reduce((a: number, r: any) => a + (r.sale_type === 'RETURN' ? -Number(r.total) : Number(r.total)), 0) * 100) / 100 } };
      });
    });
    o.post('/open/webhooks', async (req, reply) => {
      const b = z.object({ url: z.string().url(), events: z.array(z.enum(['product.updated', 'price.updated', 'product.deactivated', 'sale.created'])).min(1) }).parse(req.body);
      return withCompany(kx(req), async (tx) => {
        const secret = (await import('node:crypto')).randomBytes(16).toString('hex');
        const r = (await tx.query(`INSERT INTO webhook_subscription (company_id, url, events, secret) VALUES ($1,$2,$3,$4) RETURNING id, url, events, is_active, created_at`, [req.apiKey!.companyId, b.url, b.events, secret])).rows[0];
        reply.status(201);
        return { ...r, secret };
      });
    });
    o.get('/open/webhooks', async (req) => withCompany(kx(req), async (tx) => (await tx.query(`SELECT id, url, events, is_active, created_at FROM webhook_subscription WHERE is_active ORDER BY created_at`)).rows));
  });

  // ----- API 密钥管理（登录用户，integration.edit） -----
  app.register(async (k) => {
    k.addHook('preHandler', requireAuth);
    k.addHook('preHandler', requirePerm('integration.edit'));
    const cx = (req: any) => ({ companyId: req.ctx.companyId, userId: req.ctx.userId, deviceId: req.ctx.deviceId });
    k.get('/api-keys', async (req) => withCompany(cx(req), async (tx) => (await tx.query(`SELECT k.id, k.name, k.scope, k.site_id, s.code AS site_code, k.key_prefix, k.last_used_at, k.is_active, k.created_at FROM api_key k LEFT JOIN site s ON s.id = k.site_id ORDER BY k.created_at DESC`)).rows));
    k.post('/api-keys', async (req, reply) => {
      const b = z.object({ name: z.string().min(1).max(60), scope: z.enum(['OPEN', 'KIOSK', 'POS']), site_id: z.string().uuid().optional().nullable() }).parse(req.body);
      const g = generateApiKey();
      return withCompany(cx(req), async (tx) => {
        const r = (await tx.query(`INSERT INTO api_key (company_id, site_id, name, scope, key_prefix, key_hash) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, name, scope, site_id, key_prefix, is_active, created_at`, [req.ctx.companyId, b.site_id ?? null, b.name, b.scope, g.key_prefix, g.key_hash])).rows[0];
        reply.status(201);
        return { ...r, key: g.key };   // 明文只返回这一次
      });
    });
    k.post('/api-keys/:id/disable', async (req) => {
      const { id } = req.params as any;
      const r = await withCompany(cx(req), async (tx) => (await tx.query(`UPDATE api_key SET is_active = false WHERE id = $1 RETURNING id, name, scope, is_active`, [id])).rows[0]);
      if (!r) throw notFound('NOT_FOUND');
      invalidateApiKeyCache();
      return r;
    });
    k.get('/external-sync-log', async (req) => {
      const q = z.object({ limit: z.coerce.number().max(500).default(100) }).parse(req.query);
      return withCompany(cx(req), async (tx) => (await tx.query(`SELECT * FROM external_sync_log ORDER BY at DESC LIMIT $1`, [q.limit])).rows);
    });
  });
}
