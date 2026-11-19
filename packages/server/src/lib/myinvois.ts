// MyInvois（LHDN 电子发票）客户端。
// 环境：MYINVOIS_ENV=STUB|SANDBOX|PRODUCTION（公司设定 settings.myinvois_env 优先，默认 STUB）。
//   STUB        不联网，本地生成假 uuid/longId，立即 VALID（测试和未申请沙盒账号的公司）。
//   SANDBOX     https://preprod-api.myinvois.hasil.gov.my（身份：https://preprod-api.myinvois.hasil.gov.my/connect/token）
//   PRODUCTION  https://api.myinvois.hasil.gov.my
// 文档：UBL JSON 2.1 Invoice v1.0（预生产允许无数字签名）。提交走 POST /api/v1.0/documentsubmissions，
// 文档内容 base64 + SHA256，每次最多 100 份、5MB。状态用 GET /api/v1.0/documents/{uuid}/details；取消 PUT /api/v1.0/documents/state/{uuid}/state。
// 自定决定：凭据存在 company.settings.myinvois_client_id / myinvois_client_secret（PUT /einvoice/settings 写，读回只给掩码）。
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { adminPool } from './db.js';
import { AppError } from './errors.js';

export type MyInvoisEnv = 'STUB' | 'SANDBOX' | 'PRODUCTION';
export interface MyInvoisConfig {
  env: MyInvoisEnv; clientId: string | null; clientSecret: string | null;
  tin: string | null; brn: string | null; sstNo: string | null; msic: string | null; name: string; address: any; email?: string | null; phone?: string | null;
}
const BASE: Record<MyInvoisEnv, string> = { STUB: '', SANDBOX: 'https://preprod-api.myinvois.hasil.gov.my', PRODUCTION: 'https://api.myinvois.hasil.gov.my' };
export const VERIFY_BASE: Record<MyInvoisEnv, string> = { STUB: 'https://myinvois.hasil.gov.my', SANDBOX: 'https://preprod.myinvois.hasil.gov.my', PRODUCTION: 'https://myinvois.hasil.gov.my' };

/** 读公司的 MyInvois 设定（TIN、MSIC、凭据、环境）。超管/定时任务用 adminPool，不受 RLS 限制。 */
export async function loadMyInvoisConfig(companyId: string): Promise<MyInvoisConfig> {
  const c = (await adminPool.query(`SELECT name, tin, sst_no, msic_code, address, settings FROM company WHERE id = $1`, [companyId])).rows[0];
  if (!c) throw new AppError(404, 'NOT_FOUND');
  const s = c.settings ?? {};
  const env = String(s.myinvois_env || process.env.MYINVOIS_ENV || 'STUB').toUpperCase() as MyInvoisEnv;
  return { env: (['STUB', 'SANDBOX', 'PRODUCTION'] as const).includes(env) ? env : 'STUB', clientId: s.myinvois_client_id ?? null, clientSecret: s.myinvois_client_secret ?? null, tin: s.myinvois_tin ?? c.tin ?? null, brn: s.myinvois_brn ?? null, sstNo: c.sst_no ?? null, msic: s.myinvois_msic_code ?? c.msic_code ?? null, name: c.name, address: c.address ?? {}, email: s.company_email ?? null, phone: s.company_phone ?? null };
}
/** 凭据掩码：只露后 4 位 */
export const maskSecret = (v: string | null | undefined) => (v ? '••••' + v.slice(-4) : null);

// ---------- OAuth2 client_credentials，令牌缓存 50 分钟 ----------
const tokenCache = new Map<string, { token: string; exp: number }>();
async function getToken(cfg: MyInvoisConfig): Promise<string> {
  if (!cfg.clientId || !cfg.clientSecret) throw new AppError(400, 'EINVOICE_NOT_CONFIGURED');
  const key = `${cfg.env}:${cfg.clientId}`;
  const hit = tokenCache.get(key);
  if (hit && hit.exp > Date.now()) return hit.token;
  const body = new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, grant_type: 'client_credentials', scope: 'InvoicingAPI' });
  const r = await fetch(`${BASE[cfg.env]}/connect/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(15000) });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`myinvois token: ${r.status} ${j.error ?? ''}`);
  tokenCache.set(key, { token: j.access_token, exp: Date.now() + Math.min(Number(j.expires_in ?? 3600), 3600) * 1000 - 600_000 });
  return j.access_token;
}
async function apiCall(cfg: MyInvoisConfig, method: string, path: string, body?: any) {
  const token = await getToken(cfg);
  const r = await fetch(`${BASE[cfg.env]}${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
  const text = await r.text(); let j: any = {}; try { j = text ? JSON.parse(text) : {}; } catch { j = { raw: text }; }
  return { ok: r.ok, status: r.status, body: j };
}

// ---------- UBL JSON 2.1 文档 ----------
export interface UblParty { tin: string; idType?: 'BRN' | 'NRIC' | 'PASSPORT' | 'ARMY'; idNo?: string; sstNo?: string | null; name: string; address?: any; email?: string | null; phone?: string | null; msic?: string | null }
export interface UblLine { description: string; qty: number; unit?: string; unitPrice: number; discount?: number; taxType: string; taxRate: number; taxAmount: number; lineTotal: number; productCode?: string }
export interface UblDoc { docNo: string; docType: '01' | '02' | '03' | '04' | '11' | '12'; issuedAt: Date; currency?: string; supplier: UblParty; buyer: UblParty; lines: UblLine[]; subtotal: number; taxTotal: number; total: number; discountTotal?: number; rounding?: number; paidAmount?: number; refDocNo?: string | null }
const ubl = (v: any, extra: Record<string, any> = {}) => [{ _: v, ...extra }];
const amt = (v: number, cur = 'MYR') => [{ _: round2(v), currencyID: cur }];
/** 月份 'YYYY-MM' 校验并返回 'YYYY-MM-01'（合并发票、月结、报表共用） */
export const monthStart = (month: string) => { if (!/^\d{4}-\d{2}$/.test(String(month))) throw new AppError(400, 'VALIDATION', 'month must be YYYY-MM'); return `${month}-01`; };
/** KL 时区月份范围 SQL：col 落在参数 $p（'YYYY-MM-01'）那个月 */
export const MONTH_RANGE_SQL = (col: string, p: string) => `${col} >= ($${p}::date)::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur' AND ${col} < ($${p}::date + interval '1 month')::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur'`;
export const round2 = (v: number) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
/** MyInvois 税类型：tax_code.myinvois_tax_type（01 销售税、02 服务税、03 旅游税、04 高价值、05 低价值、06 不适用、E 免税） */
const partyJson = (p: UblParty, withMsic: boolean) => {
  const addr = p.address ?? {};
  const ids: any[] = [{ ID: ubl(p.tin, { schemeID: 'TIN' }) }];
  if (p.idType && p.idNo) ids.push({ ID: ubl(p.idNo, { schemeID: p.idType }) }); else ids.push({ ID: ubl('NA', { schemeID: 'BRN' }) });
  if (p.sstNo) ids.push({ ID: ubl(p.sstNo, { schemeID: 'SST' }) });
  return [{
    ...(withMsic ? { IndustryClassificationCode: ubl(p.msic ?? '00000', { name: addr.business_description ?? 'General retail' }) } : {}),
    PartyIdentification: ids,
    PostalAddress: [{ CityName: ubl(addr.city ?? 'NA'), PostalZone: ubl(addr.postcode ?? '00000'), CountrySubentityCode: ubl(addr.state_code ?? '14'), AddressLine: [{ Line: ubl(addr.line1 ?? 'NA') }, ...(addr.line2 ? [{ Line: ubl(addr.line2) }] : [])], Country: [{ IdentificationCode: ubl(addr.country ?? 'MYS', { listID: 'ISO3166-1', listAgencyID: '6' }) }] }],
    PartyLegalEntity: [{ RegistrationName: ubl(p.name) }],
    Contact: [{ Telephone: ubl(p.phone ?? 'NA'), ElectronicMail: ubl(p.email ?? 'NA') }],
  }];
};
/** 生成 UBL JSON 2.1 Invoice v1.0（签名位留空；预生产允许）。供销售、企业发票、合并发票共用。 */
export function buildUblDocument(d: UblDoc) {
  const cur = d.currency ?? 'MYR';
  const dt = d.issuedAt.toISOString();
  const byTax = new Map<string, { taxable: number; tax: number; rate: number }>();
  for (const l of d.lines) { const k = `${l.taxType}:${l.taxRate}`; const e = byTax.get(k) ?? { taxable: 0, tax: 0, rate: l.taxRate }; e.taxable += l.lineTotal - l.taxAmount; e.tax += l.taxAmount; byTax.set(k, e); }
  return {
    _D: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2', _A: 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2', _B: 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
    Invoice: [{
      ID: ubl(d.docNo), IssueDate: ubl(dt.slice(0, 10)), IssueTime: ubl(dt.slice(11, 19) + 'Z'),
      InvoiceTypeCode: ubl(d.docType, { listVersionID: '1.0' }), DocumentCurrencyCode: ubl(cur), TaxCurrencyCode: ubl(cur),
      ...(d.refDocNo ? { BillingReference: [{ InvoiceDocumentReference: [{ ID: ubl(d.refDocNo) }] }] } : {}),
      AccountingSupplierParty: [{ Party: partyJson(d.supplier, true) }],
      AccountingCustomerParty: [{ Party: partyJson(d.buyer, false) }],
      TaxTotal: [{ TaxAmount: amt(d.taxTotal, cur), TaxSubtotal: [...byTax.values()].map((t) => ({ TaxableAmount: amt(t.taxable, cur), TaxAmount: amt(t.tax, cur), TaxCategory: [{ ID: ubl(t.tax > 0 ? '01' : '06'), Percent: ubl(t.rate), TaxScheme: [{ ID: ubl('OTH', { schemeID: 'UN/ECE 5153', schemeAgencyID: '6' }) }] }] })) }],
      LegalMonetaryTotal: [{ LineExtensionAmount: amt(d.subtotal, cur), TaxExclusiveAmount: amt(d.subtotal - (d.discountTotal ?? 0), cur), TaxInclusiveAmount: amt(d.total, cur), AllowanceTotalAmount: amt(d.discountTotal ?? 0, cur), PayableRoundingAmount: amt(d.rounding ?? 0, cur), PayableAmount: amt(d.total, cur) }],
      InvoiceLine: d.lines.map((l, i) => ({
        ID: ubl(String(i + 1)), InvoicedQuantity: ubl(l.qty, { unitCode: l.unit === 'KG' ? 'KGM' : 'C62' }), LineExtensionAmount: amt(l.lineTotal - l.taxAmount, cur),
        ...(l.discount ? { AllowanceCharge: [{ ChargeIndicator: ubl(false), AllowanceChargeReason: ubl('Discount'), Amount: amt(l.discount, cur) }] } : {}),
        TaxTotal: [{ TaxAmount: amt(l.taxAmount, cur), TaxSubtotal: [{ TaxableAmount: amt(l.lineTotal - l.taxAmount, cur), TaxAmount: amt(l.taxAmount, cur), TaxCategory: [{ ID: ubl(l.taxType), Percent: ubl(l.taxRate), TaxScheme: [{ ID: ubl('OTH', { schemeID: 'UN/ECE 5153', schemeAgencyID: '6' }) }] }] }] }],
        Item: [{ CommodityClassification: [{ ItemClassificationCode: ubl(l.productCode ?? '004', { listID: 'CLASS' }) }], Description: ubl(l.description) }],
        Price: [{ PriceAmount: amt(l.unitPrice, cur) }],
        ItemPriceExtension: [{ Amount: amt(l.qty * l.unitPrice, cur) }],
      })),
    }],
  };
}
/** 从公司设定得到卖方信息 */
export function supplierParty(cfg: MyInvoisConfig): UblParty {
  if (!cfg.tin) throw new AppError(400, 'EINVOICE_NOT_CONFIGURED', 'company TIN missing');
  return { tin: cfg.tin, idType: cfg.brn ? 'BRN' : undefined, idNo: cfg.brn ?? undefined, sstNo: cfg.sstNo, name: cfg.name, address: cfg.address, email: cfg.email, phone: cfg.phone, msic: cfg.msic };
}
/** 合并发票的买方（LHDN 规定的通用 TIN） */
export const CONSOLIDATED_BUYER: UblParty = { tin: 'EI00000000010', idType: 'BRN', idNo: 'NA', name: 'Consolidated Buyers', address: { line1: 'NA', city: 'NA', postcode: '00000', state_code: '17', country: 'MYS' } };

// ---------- 提交 / 查状态 / 取消 ----------
export interface SubmitResult { status: 'VALID' | 'SUBMITTED' | 'INVALID' | 'FAILED'; submissionUid: string | null; uuid: string | null; longId: string | null; response: any; error?: any }
/** 提交一份文档。STUB：直接 VALID。SANDBOX/PRODUCTION：documentsubmissions，接受后再查一次 details 拿 longId。失败抛错（上层决定 QUEUED 重试）。 */
export async function submitDocument(cfg: MyInvoisConfig, doc: ReturnType<typeof buildUblDocument>, docNo: string): Promise<SubmitResult> {
  if (cfg.env === 'STUB') {
    const uuid = randomBytes(13).toString('hex').toUpperCase().slice(0, 26); const longId = randomBytes(20).toString('hex').toUpperCase();
    return { status: 'VALID', submissionUid: randomUUID().replace(/-/g, '').toUpperCase(), uuid, longId, response: { stub: true, docNo, acceptedAt: new Date().toISOString() } };
  }
  const json = JSON.stringify(doc);
  const r = await apiCall(cfg, 'POST', '/api/v1.0/documentsubmissions', { documents: [{ format: 'JSON', documentHash: createHash('sha256').update(json).digest('hex'), codeNumber: docNo, document: Buffer.from(json).toString('base64') }] });
  if (!r.ok) throw Object.assign(new Error(`myinvois submit ${r.status}`), { response: r.body });
  const rejected = r.body.rejectedDocuments?.[0];
  if (rejected) return { status: 'INVALID', submissionUid: r.body.submissionUid ?? null, uuid: null, longId: null, response: r.body, error: rejected.error };
  const uuid = r.body.acceptedDocuments?.[0]?.uuid ?? null;
  // 验证是异步的：等 2 秒查一次；仍在处理就留 SUBMITTED，重试队列再查
  await new Promise((res) => setTimeout(res, 2000));
  const st = uuid ? await getDocumentStatus(cfg, uuid) : null;
  const status: SubmitResult['status'] = !st || st.status === 'CANCELLED' ? 'SUBMITTED' : st.status;
  return { status, submissionUid: r.body.submissionUid ?? null, uuid, longId: st?.longId ?? null, response: { submit: r.body, details: st?.raw ?? null }, error: st?.error };
}
/** 查文档状态（Valid / Invalid / Submitted / Cancelled） */
export async function getDocumentStatus(cfg: MyInvoisConfig, uuid: string): Promise<{ status: SubmitResult['status'] | 'CANCELLED'; longId: string | null; raw: any; error?: any }> {
  if (cfg.env === 'STUB') return { status: 'VALID', longId: null, raw: { stub: true } };
  const r = await apiCall(cfg, 'GET', `/api/v1.0/documents/${uuid}/details`);
  if (!r.ok) throw Object.assign(new Error(`myinvois details ${r.status}`), { response: r.body });
  const s = String(r.body.status ?? '').toLowerCase();
  const status = s === 'valid' ? 'VALID' : s === 'invalid' ? 'INVALID' : s === 'cancelled' ? 'CANCELLED' : 'SUBMITTED';
  return { status, longId: r.body.longId ?? null, raw: r.body, error: r.body.validationResults?.validationSteps?.filter((x: any) => x.status === 'Invalid') };
}
/** 取消文档（卖方 72 小时内） */
export async function cancelDocument(cfg: MyInvoisConfig, uuid: string, reason: string): Promise<any> {
  if (cfg.env === 'STUB') return { stub: true, uuid, status: 'Cancelled', reason };
  const r = await apiCall(cfg, 'PUT', `/api/v1.0/documents/state/${uuid}/state`, { status: 'cancelled', reason });
  if (!r.ok) throw Object.assign(new Error(`myinvois cancel ${r.status}`), { response: r.body });
  return r.body;
}
/** 顾客扫码验证链接 */
export const verifyUrl = (env: MyInvoisEnv, uuid: string, longId: string) => `${VERIFY_BASE[env]}/${uuid}/share/${longId}`;
