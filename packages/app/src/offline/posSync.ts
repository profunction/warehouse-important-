// POS 离线销售：在线直接 POST /pos/sales；断网时本地生成收据号、进 outbox（entity 'sale'，服务器 registerSyncHandler('sale')）、更新本地库存快照。
// 约定：离线收据号用 `${站点}-${机号}-9xxxxx`（本机计数，从 900001 起），和服务器 000001 起的流水不重叠；服务器接受客户端收据号（不冲突时）。
import { api, ApiError, isOnline } from '../api/client.js';
import { db, kvGet, kvSet, applyLocalMovement, type PosSale, type CProduct } from './db.js';
import { enqueue, uuidv7 } from './sync.js';
import type { MeResponse } from '@wh/shared';

export interface CartLine { key: string; product: CProduct; qty: number; weight_kg?: number | null; unit_price: number; discount_pct?: number; supervisor_pin?: string | null; barcode?: string | null; pack_qty?: number }
export interface CartPayment { method: 'CASH' | 'CARD' | 'EWALLET' | 'CREDIT'; amount: number; tendered?: number | null; reference?: string | null }
export interface SaleDraft { terminal_code: string; session_id: string | null; lines: CartLine[]; payments: CartPayment[]; customer?: { id: string; name: string } | null; sale_type: 'RETAIL' | 'B2B'; einvoice_required?: boolean; hold_id?: string | null }
export const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const roundTo = (n: number, step: number) => (step > 0 ? r2(Math.round(n / step) * step) : r2(n));
export const lineGross = (l: CartLine) => r2((l.product.is_weighed ? Number(l.weight_kg ?? l.qty) : l.qty) * l.unit_price);
export const lineDiscount = (l: CartLine) => r2(lineGross(l) * (l.discount_pct ?? 0) / 100);
export const lineTotal = (l: CartLine) => r2(lineGross(l) - lineDiscount(l));
export const cartNet = (lines: CartLine[]) => r2(lines.reduce((a, l) => a + lineTotal(l), 0));
export async function posSettings() { const s = await kvGet<any>('sync.settings', {}); return { cash_rounding: Number(s?.cash_rounding ?? 0.05), cashier_discount_max_pct: Number(s?.cashier_discount_max_pct ?? 5), scale_barcode_format: s?.scale_barcode_format ?? null }; }
export const getTerminal = () => kvGet<string>('pos.terminal', 'P1');
export const setTerminal = (t: string) => kvSet('pos.terminal', t);

export async function nextLocalReceiptNo(siteCode: string, terminal: string) {
  const key = `pos.rcpt.${siteCode}-${terminal}`; const n = (await kvGet<number>(key, 900000)) + 1; await kvSet(key, n);
  return `${siteCode}-${terminal}-${String(n).padStart(6, '0')}`;
}
const toPayload = (d: SaleDraft, clientId: string, receiptNo?: string) => ({
  client_id: clientId, terminal_code: d.terminal_code, session_id: d.session_id, receipt_no: receiptNo ?? null,
  lines: d.lines.map((l) => ({ product_id: l.product.id, barcode: l.barcode ?? null, qty: l.product.is_weighed ? 1 : l.qty, weight_kg: l.product.is_weighed ? Number(l.weight_kg ?? l.qty) : null, unit_price: l.unit_price, discount_pct: l.discount_pct ?? null, supervisor_pin: l.supervisor_pin ?? null })),
  payments: d.payments.map((p) => ({ method: p.method, amount: p.amount, tendered: p.tendered ?? null, reference: p.reference ?? null })),
  customer_id: d.customer?.id ?? null, sale_type: d.sale_type, einvoice_required: !!d.einvoice_required, sold_at: new Date().toISOString(), hold_id: d.hold_id ?? null,
});
const isNetworkErr = (e: any) => !isOnline() || e?.code === 'NETWORK' || e?.status === 0 || e?.name === 'AbortError' || (e instanceof TypeError);

/** 提交销售：在线走服务器；断网走 outbox。返回 { sale, offline } */
export async function submitSale(me: MeResponse, d: SaleDraft, lang: 'zh' | 'ms' | 'en' = 'zh'): Promise<{ sale: any; offline: boolean }> {
  const clientId = uuidv7();
  if (isOnline()) {
    try {
      const sale = await api('/pos/sales', { body: toPayload(d, clientId), timeoutMs: 10000 });
      await db.pos_sale.put({ client_id: clientId, receipt_no: sale.receipt_no, terminal_code: d.terminal_code, session_id: d.session_id, sold_at: sale.sold_at, total: Number(sale.total), change_amount: Number(sale.change_amount), status: 'synced', payload: null, receipt_text: sale.receipt_text, escpos_base64: sale.escpos_base64, server_id: sale.id, sale_type: sale.sale_type });
      await trimLocalSales();
      return { sale, offline: false };
    } catch (e: any) { if (!isNetworkErr(e)) throw e; /* 断网 → 走下面的离线路径 */ }
  }
  if (d.sale_type === 'B2B') throw new ApiError(0, 'NETWORK', {});     // 记账要查信用额，必须在线
  const siteCode = me.site?.code ?? 'SITE';
  const receipt_no = await nextLocalReceiptNo(siteCode, d.terminal_code);
  const settings = await posSettings();
  const net = cartNet(d.lines); const hasCash = d.payments.some((p) => p.method === 'CASH');
  const total = hasCash ? roundTo(net, settings.cash_rounding) : net; const rounding = r2(total - net);
  const paid = r2(d.payments.reduce((a, p) => a + (p.method === 'CASH' ? Math.max(p.tendered ?? 0, p.amount) : p.amount), 0));
  const change_amount = hasCash ? r2(paid - total) : 0;
  const payload = toPayload(d, clientId, receipt_no);
  await enqueue({ client_id: clientId, entity: 'sale', op: 'insert', user_id: me.user.id, payload, summary: `${receipt_no} RM ${total.toFixed(2)}` });
  // 本地库存快照：主货架 → CUSTOMER
  const customer = await db.location.filter((l) => l.is_virtual && l.virtual_type === 'CUSTOMER').first();
  for (const l of d.lines) {
    const shelf = (await db.shelf_assignment.where('product_id').equals(l.product.id).toArray()).find((s) => s.is_primary && s.is_active) ?? (await db.shelf_assignment.where('product_id').equals(l.product.id).first());
    if (shelf && customer) await applyLocalMovement(l.product.id, shelf.location_id, customer.id, l.product.is_weighed ? Number(l.weight_kg ?? l.qty) : l.qty);
  }
  const sale = {
    id: clientId, client_id: clientId, receipt_no, sale_type: d.sale_type, status: 'COMPLETED', terminal_code: d.terminal_code, sold_at: payload.sold_at, offline: true,
    lines: d.lines.map((l, i) => ({ id: `${clientId}-${i}`, line_no: i + 1, product_id: l.product.id, name_zh: l.product.name_zh, name_ms: l.product.name_ms, name_en: l.product.name_en, qty: l.product.is_weighed ? Number(l.weight_kg ?? l.qty) : l.qty, weight_kg: l.product.is_weighed ? Number(l.weight_kg ?? l.qty) : null, unit_price: l.unit_price, discount: lineDiscount(l), line_total: lineTotal(l), is_weighed: l.product.is_weighed, photo_url: l.product.photo_url })),
    payments: d.payments, subtotal: r2(d.lines.reduce((a, l) => a + lineGross(l), 0)), discount_total: r2(d.lines.reduce((a, l) => a + lineDiscount(l), 0)), tax_amount: 0, rounding, total, paid_total: paid, change_amount, customer_name: d.customer?.name ?? null,
    receipt_text: '', escpos_base64: null as string | null, qr_content: `RCPT:${receipt_no}`,
  };
  sale.receipt_text = localReceiptText(me, sale, lang);
  await db.pos_sale.put({ client_id: clientId, receipt_no, terminal_code: d.terminal_code, session_id: d.session_id, sold_at: payload.sold_at, total, change_amount, status: 'pending', payload, receipt_text: sale.receipt_text, sale_type: d.sale_type });
  return { sale, offline: true };
}
async function trimLocalSales() { const n = await db.pos_sale.where('status').equals('synced').count(); if (n > 300) { const old = await db.pos_sale.where('status').equals('synced').sortBy('sold_at'); await db.pos_sale.bulkDelete(old.slice(0, n - 300).map((s) => s.client_id)); } }
export async function recentLocalSales(limit = 50) { return (await db.pos_sale.orderBy('sold_at').reverse().limit(limit).toArray()); }
export async function pendingSaleCount() { return db.outbox.where('status').anyOf('pending', 'sending').filter((o) => o.entity === 'sale').count(); }

// ---- 本地收据文本（离线用；版式同服务器 lib/receipt.ts 58mm 32 列） ----
const W = 32;
const dw = (s: string) => { let w = 0; for (const ch of s) w += /[⺀-꓏가-힣豈-﫿︰-﹏＀-｠]/.test(ch) ? 2 : 1; return w; };
const trunc = (s: string, m: number) => { let o = ''; let w = 0; for (const ch of s) { const c = dw(ch); if (w + c > m) break; o += ch; w += c; } return o; };
const lr = (l: string, r: string) => { const left = trunc(l, W - dw(r) - 1); return left + ' '.repeat(Math.max(0, W - dw(left) - dw(r))) + r; };
const ctr = (s: string) => { const w = dw(s); return w >= W ? s : ' '.repeat(Math.floor((W - w) / 2)) + s; };
const money = (n: number) => Number(n).toFixed(2);
const PAY: Record<string, string> = { CASH: '现金 Tunai', CARD: '卡 Kad', EWALLET: '电子钱包 eWallet', CREDIT: '记账 Kredit' };
export function localReceiptText(me: MeResponse, s: any, lang: 'zh' | 'ms' | 'en' = 'zh') {
  const out: string[] = []; const sep = '-'.repeat(W);
  out.push(ctr(trunc(me.company.name, W))); out.push(sep);
  out.push(lr(`收据 ${s.receipt_no}`, '')); out.push(lr(new Date(s.sold_at).toLocaleString('en-GB', { hour12: false }).slice(0, 17), `${me.site?.code ?? ''}-${s.terminal_code}`)); out.push(lr(`收银 ${me.user.name}`, ''));
  if (s.offline) out.push(ctr('(离线 Luar talian)'));
  out.push(sep);
  for (const l of s.lines) {
    const name = trunc(lang === 'ms' ? (l.name_ms || l.name_en || l.name_zh) : lang === 'en' ? (l.name_en || l.name_ms || l.name_zh) : (l.name_zh || l.name_en || l.name_ms), 16);
    const q = l.is_weighed ? `${Number(l.qty).toFixed(3)}kg` : String(l.qty);
    const right = `${q} x ${money(l.unit_price)} ${money(l.line_total).padStart(8)}`;
    if (dw(name) + dw(right) + 1 <= W) out.push(lr(name, right)); else { out.push(name); out.push(right.padStart(W)); }
    if (l.discount) out.push(lr('  折扣 Diskaun', `-${money(l.discount)}`));
  }
  out.push(sep); out.push(lr('小计 Subtotal', money(s.subtotal)));
  if (s.discount_total) out.push(lr('折扣 Diskaun', `-${money(s.discount_total)}`));
  if (s.rounding) out.push(lr('取整 Rounding', (s.rounding > 0 ? '+' : '') + money(s.rounding)));
  out.push(lr('合计 TOTAL', `RM ${money(s.total)}`));
  for (const p of s.payments) out.push(lr(PAY[p.method] ?? p.method, money(p.tendered ?? p.amount)));
  if (s.change_amount) out.push(lr('找零 Baki', money(s.change_amount)));
  out.push(sep); out.push(ctr('谢谢 Terima kasih')); out.push(ctr(`RCPT:${s.receipt_no}`));
  return out.join('\n') + '\n';
}
/** 从服务器刷新客户副本（模块 D 的 /customers，没开通时退回 /pos/customers） */
export async function refreshCustomers(search = '') {
  const q = search ? `?search=${encodeURIComponent(search)}` : '';
  let rows: any[] | null = null;
  try { rows = await api(`/customers${q}`); } catch (e: any) { if (e?.status === 404) { try { rows = await api(`/pos/customers${q}`); } catch { rows = null; } } else if (e?.status !== 0) rows = null; }
  if (Array.isArray(rows)) { await db.customer.bulkPut(rows.map((c: any) => ({ id: c.id, code: c.code ?? null, name: c.name, tin: c.tin ?? null, phone: c.phone ?? null, email: c.email ?? null, credit_terms_days: Number(c.credit_terms_days ?? 30), credit_limit: Number(c.credit_limit ?? 0), balance: Number(c.balance ?? 0), is_active: c.is_active ?? true, updated_at: c.updated_at }))); return rows; }
  return null;
}
