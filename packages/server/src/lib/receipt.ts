// 收据与 Z 报表文本（58mm 每行 32 字符；80mm 48 字符）+ ESC/POS 字节序列（给 wh-bridge 打印）。
// 约定（设计文档没写的部分）：
// - 中文等全角字符按 2 列计宽；产品名截到 16 列，数量×单价 + 小计右对齐补满一行。
// - 价格含税（SST 价内税），收据只列"含税 X.XX"一行。
// - 二维码内容 `RCPT:<receipt_no>`，ESC/POS 用 GS ( k（模型 2，模块 3 点，纠错 M）。
// - 文本以 UTF-8 输出；桥接程序按打印机能力转 GB18030 或渲染位图，这里不做编码。
import QRCode from 'qrcode';

export interface ReceiptLine { name: string; qty: number; unit_price: number; line_total: number; weight_kg?: number | null; discount?: number; unit?: string }
export interface ReceiptPayment { method: string; amount: number; tendered?: number | null; reference?: string | null }
export interface ReceiptData {
  company: { name: string; address?: any; tin?: string | null; sst_no?: string | null };
  site?: { name?: string; code?: string } | null;
  terminal_code?: string | null; cashier_name?: string | null;
  receipt_no: string; sold_at: string | Date; sale_type?: string; customer_name?: string | null;
  lines: ReceiptLine[];
  subtotal: number; discount_total: number; tax_amount: number; rounding: number; total: number; paid_total: number; change_amount: number;
  payments: ReceiptPayment[];
  einvoice_qr?: string | null; footer?: string | null;
}

/** 终端显示宽度：全角 2 列 */
export function displayWidth(s: string) { let w = 0; for (const ch of s) w += /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch) ? 2 : 1; return w; }
export function truncWidth(s: string, max: number) { let out = ''; let w = 0; for (const ch of s) { const cw = displayWidth(ch); if (w + cw > max) break; out += ch; w += cw; } return out; }
export function padEnd(s: string, width: number) { return s + ' '.repeat(Math.max(0, width - displayWidth(s))); }
export function padStart(s: string, width: number) { return ' '.repeat(Math.max(0, width - displayWidth(s))) + s; }
export function center(s: string, width: number) { const w = displayWidth(s); if (w >= width) return s; const left = Math.floor((width - w) / 2); return ' '.repeat(left) + s; }
export function lr(left: string, right: string, width: number) { const l = truncWidth(left, width - displayWidth(right) - 1); return padEnd(l, width - displayWidth(right)) + right; }
export const money = (n: number) => (Number(n) || 0).toFixed(2);
export const fmtQty = (q: number, weighed?: boolean) => weighed ? `${Number(q).toFixed(3)}kg` : Number.isInteger(Number(q)) ? String(q) : Number(q).toFixed(3);
const PAY_LABEL: Record<string, string> = { CASH: '现金 Tunai', CARD: '卡 Kad', EWALLET: '电子钱包 eWallet', CREDIT: '记账 Kredit', BANK_TRANSFER: '转账 Bank', CHEQUE: '支票 Cek' };
function fmtTime(d: string | Date) {
  const dt = new Date(d);
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(dt);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${g('year')}-${g('month')}-${g('day')} ${g('hour')}:${g('minute')}`;
}
function addrLines(a: any): string[] {
  if (!a) return []; if (typeof a === 'string') return [a];
  return [[a.line1, a.line2].filter(Boolean).join(' '), [a.postcode, a.city, a.state].filter(Boolean).join(' ')].filter(Boolean);
}

/** 收据文本：width 32（58mm）或 48（80mm） */
export function buildReceiptText(d: ReceiptData, width = 32): string {
  const W = width; const out: string[] = []; const sep = '-'.repeat(W);
  out.push(center(truncWidth(d.company.name, W), W));
  for (const l of addrLines(d.company.address)) out.push(center(truncWidth(l, W), W));
  if (d.company.tin) out.push(center(`TIN ${d.company.tin}`, W));
  if (d.company.sst_no) out.push(center(`SST ${d.company.sst_no}`, W));
  out.push(sep);
  if (d.sale_type === 'RETURN') out.push(center('** 退货 RETURN **', W));
  if (d.sale_type === 'B2B') out.push(center('记账 B2B / Kredit', W));
  out.push(lr(`收据 ${d.receipt_no}`, '', W));
  out.push(lr(fmtTime(d.sold_at), `${d.site?.code ?? ''}${d.terminal_code ? '-' + d.terminal_code : ''}`, W));
  if (d.cashier_name) out.push(lr(`收银 ${d.cashier_name}`, '', W));
  if (d.customer_name) out.push(lr(`客户 ${d.customer_name}`, '', W));
  out.push(sep);
  const nameW = W === 32 ? 16 : 24;
  for (const l of d.lines) {
    const weighed = !!l.weight_kg || l.unit === 'KG';
    const qp = `${fmtQty(l.qty, weighed)} x ${money(l.unit_price)}`;
    const name = truncWidth(l.name, nameW);
    const right = `${qp} ${padStart(money(l.line_total), 8)}`;
    if (displayWidth(name) + displayWidth(right) + 1 <= W) out.push(lr(name, right, W));
    else { out.push(name); out.push(padStart(right, W)); }
    if (l.discount && l.discount > 0) out.push(lr('  折扣 Diskaun', `-${money(l.discount)}`, W));
  }
  out.push(sep);
  out.push(lr('小计 Subtotal', money(d.subtotal), W));
  if (d.discount_total) out.push(lr('折扣 Diskaun', `-${money(d.discount_total)}`, W));
  out.push(lr('含税 SST', money(d.tax_amount), W));
  if (d.rounding) out.push(lr('取整 Rounding', (d.rounding > 0 ? '+' : '') + money(d.rounding), W));
  out.push(lr('合计 TOTAL', `RM ${money(d.total)}`, W));
  for (const p of d.payments) out.push(lr(PAY_LABEL[p.method] ?? p.method, money(p.tendered ?? p.amount), W));
  if (d.change_amount) out.push(lr('找零 Baki', money(d.change_amount), W));
  out.push(sep);
  out.push(center('谢谢 Terima kasih', W));
  if (d.footer) out.push(center(truncWidth(d.footer, W), W));
  out.push(center(`RCPT:${d.receipt_no}`, W));
  return out.join('\n') + '\n';
}

// ---------- ESC/POS ----------
const ESC = 0x1b, GS = 0x1d;
const b = (...xs: (number | number[] | Buffer | string)[]) => Buffer.concat(xs.map((x) => typeof x === 'string' ? Buffer.from(x, 'utf8') : Buffer.isBuffer(x) ? x : Buffer.from(Array.isArray(x) ? x : [x])));
export const escpos = {
  init: () => b([ESC, 0x40]),
  align: (a: 0 | 1 | 2) => b([ESC, 0x61, a]),
  bold: (on: boolean) => b([ESC, 0x45, on ? 1 : 0]),
  size: (w: number, h: number) => b([GS, 0x21, ((w - 1) << 4) | (h - 1)]),
  text: (s: string) => b(s),
  feed: (n = 3) => b([ESC, 0x64, n]),
  cut: () => b([GS, 0x56, 0x42, 0x00]),
  /** 钱箱：ESC p 0 25 250 */
  drawer: () => b([ESC, 0x70, 0x00, 0x19, 0xfa]),
  /** 二维码：GS ( k 模型 2、模块 size 点、纠错 M，再打印 */
  qr: (content: string, size = 3) => {
    const data = Buffer.from(content, 'utf8'); const len = data.length + 3;
    return b([GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00], [GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, size], [GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31],
      [GS, 0x28, 0x6b, len & 0xff, (len >> 8) & 0xff, 0x31, 0x50, 0x30], data, [GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30]);
  },
};
/** 收据 ESC/POS：文本（UTF-8）+ 二维码 + 切纸；openDrawer 时附加钱箱脉冲 */
export function buildReceiptEscPos(d: ReceiptData, opts: { width?: number; openDrawer?: boolean; einvoiceQr?: string | null } = {}): Buffer {
  const text = buildReceiptText(d, opts.width ?? 32);
  const parts: Buffer[] = [escpos.init()];
  if (opts.openDrawer) parts.push(escpos.drawer());
  parts.push(escpos.align(0), escpos.text(text.replace(/\n/g, '\r\n')));
  parts.push(escpos.align(1), escpos.qr(`RCPT:${d.receipt_no}`, 3), escpos.feed(1));
  if (opts.einvoiceQr) parts.push(escpos.text('MyInvois\r\n'), escpos.qr(opts.einvoiceQr, 3), escpos.feed(1));
  parts.push(escpos.align(0), escpos.feed(3), escpos.cut());
  return Buffer.concat(parts);
}
/** 收据二维码 PNG（网页端显示/电子收据） */
export async function receiptQrPng(receiptNo: string) { return QRCode.toBuffer(`RCPT:${receiptNo}`, { width: 180, margin: 1 }); }

// ---------- Z 报表 ----------
export interface ZReportData {
  company: { name: string }; site: { code: string; name?: string }; terminal_code: string; cashier_name: string;
  opened_at: string | Date; closed_at: string | Date; opening_cash: number; sales_count: number; sales_total: number;
  cash_total: number; card_total: number; ewallet_total: number; refund_total: number; expected_cash: number; counted_cash: number; variance: number;
  tax_total?: number; discount_total?: number; rounding_total?: number; voided_count?: number; return_count?: number;
  by_hour?: { hour: string; count: number; total: number }[];
}
export function buildZReport(z: ZReportData, width = 32): string {
  const W = width; const sep = '='.repeat(W); const thin = '-'.repeat(W); const out: string[] = [];
  out.push(center(truncWidth(z.company.name, W), W)); out.push(center('Z 报表 Laporan Z', W)); out.push(sep);
  out.push(lr('站点 Site', `${z.site.code}`, W)); out.push(lr('机号 Terminal', z.terminal_code, W)); out.push(lr('收银 Cashier', truncWidth(z.cashier_name, 14), W));
  out.push(lr('开班 Buka', fmtTime(z.opened_at), W)); out.push(lr('日结 Tutup', fmtTime(z.closed_at), W)); out.push(thin);
  out.push(lr('交易数 Transaksi', String(z.sales_count), W)); out.push(lr('销售 Jualan', money(z.sales_total), W));
  if (z.discount_total) out.push(lr('折扣 Diskaun', money(z.discount_total), W));
  if (z.tax_total != null) out.push(lr('含税 SST', money(z.tax_total), W));
  if (z.rounding_total) out.push(lr('取整 Rounding', money(z.rounding_total), W));
  out.push(lr('退款 Refund', money(z.refund_total), W));
  if (z.voided_count) out.push(lr('作废 Batal', String(z.voided_count), W));
  out.push(thin);
  out.push(lr('现金 Tunai', money(z.cash_total), W)); out.push(lr('卡 Kad', money(z.card_total), W)); out.push(lr('电子钱包 eWallet', money(z.ewallet_total), W)); out.push(thin);
  out.push(lr('开班现金 Tunai buka', money(z.opening_cash), W)); out.push(lr('预期现金 Dijangka', money(z.expected_cash), W)); out.push(lr('实数 Dikira', money(z.counted_cash), W));
  out.push(lr('差额 Beza', (z.variance > 0 ? '+' : '') + money(z.variance), W));
  if (z.by_hour?.length) { out.push(thin); for (const h of z.by_hour) out.push(lr(`${h.hour}:00  ${h.count} 笔`, money(h.total), W)); }
  out.push(sep);
  return out.join('\n') + '\n';
}
export function buildZReportEscPos(z: ZReportData, width = 32) { return Buffer.concat([escpos.init(), escpos.text(buildZReport(z, width).replace(/\n/g, '\r\n')), escpos.feed(3), escpos.cut()]); }
