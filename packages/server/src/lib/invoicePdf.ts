import { fileURLToPath } from 'node:url';
// 发票 / 对账单 PDF（pdfkit，A4）。中文字体处理与 lib/labels.ts 一致：按顺序找 Noto Sans SC，找不到退回 Helvetica。
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { existsSync } from 'node:fs';

const fmt = (v: any) => Number(v ?? 0).toFixed(2);
const dateStr = (v: any) => (v ? new Date(v).toISOString().slice(0, 10) : '');
function registerCjk(doc: PDFKit.PDFDocument): boolean {
  const candidates: [string, string | undefined][] = [
    [process.env.LABEL_FONT || '', process.env.LABEL_FONT_FAMILY],
    [fileURLToPath(new URL('../../fonts/NotoSansSC-Regular.otf', import.meta.url)), undefined],
    ['/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc', 'WenQuanYi Zen Hei'],
    ['/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', 'NotoSansCJKsc-Regular'],
  ];
  for (const [path, family] of candidates) {
    if (!path || !existsSync(path)) continue;
    try { const probe = new PDFDocument({ autoFirstPage: false }); if (family) probe.font(path, family); else probe.font(path); probe.end(); if (family) doc.registerFont('cjk', path, family); else doc.registerFont('cjk', path); return true; } catch { /* 下一个 */ }
  }
  return false;
}
function start() {
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const chunks: Buffer[] = []; doc.on('data', (c) => chunks.push(c));
  const cjk = registerCjk(doc);
  const F = cjk ? 'cjk' : 'Helvetica'; const FB = cjk ? 'cjk' : 'Helvetica-Bold';
  const finish = async () => { doc.end(); await new Promise((r) => doc.on('end', r)); return Buffer.concat(chunks); };
  return { doc, F, FB, finish };
}
function header(doc: PDFKit.PDFDocument, F: string, FB: string, company: any, title: string) {
  const addr = company.address ?? {};
  doc.font(FB).fontSize(18).text(company.name, 40, 40);
  doc.font(F).fontSize(9).fillColor('#444').text([addr.line1, addr.line2, [addr.postcode, addr.city].filter(Boolean).join(' ')].filter(Boolean).join('\n') || ' ', 40, 62);
  doc.text(`TIN: ${company.tin ?? '-'}${company.sst_no ? `   SST: ${company.sst_no}` : ''}`, 40, 98);
  doc.fillColor('#000').font(FB).fontSize(22).text(title, 300, 40, { width: 255, align: 'right' });
}
function table(doc: PDFKit.PDFDocument, F: string, FB: string, y: number, cols: { title: string; w: number; align?: 'left' | 'right' }[], rows: string[][]): number {
  let x = 40; doc.font(FB).fontSize(9);
  doc.rect(40, y - 3, 515, 16).fill('#EEE'); doc.fillColor('#000');
  for (const c of cols) { doc.text(c.title, x + 3, y, { width: c.w - 6, align: c.align ?? 'left' }); x += c.w; }
  y += 16; doc.font(F);
  for (const r of rows) {
    if (y > 760) { doc.addPage(); y = 50; }
    x = 40; let h = 12;
    r.forEach((v, i) => { const hh = doc.heightOfString(v, { width: cols[i].w - 6 }); if (hh > h) h = hh; });
    r.forEach((v, i) => { doc.text(v, x + 3, y, { width: cols[i].w - 6, align: cols[i].align ?? 'left' }); x += cols[i].w; });
    y += h + 4; doc.moveTo(40, y - 2).lineTo(555, y - 2).strokeColor('#DDD').stroke();
  }
  return y;
}

export interface InvoicePdfInput { invoice: any; lines: { description: string; qty: number; unit_price: number; tax_amount: number; line_total: number }[]; customer: any; company: any; payments?: any[]; einvoice?: { uuid: string; long_id: string; verify_url: string } | null }
/** 企业客户发票 PDF */
export async function makeInvoicePdf(i: InvoicePdfInput): Promise<Buffer> {
  const { doc, F, FB, finish } = start();
  header(doc, F, FB, i.company, 'INVOICE');
  doc.font(F).fontSize(10);
  doc.text(`Invoice No: ${i.invoice.invoice_no}`, 300, 75, { width: 255, align: 'right' });
  doc.text(`Date: ${dateStr(i.invoice.issue_date)}    Due: ${dateStr(i.invoice.due_date)}`, 300, 90, { width: 255, align: 'right' });
  doc.text(`Status: ${i.invoice.status}`, 300, 105, { width: 255, align: 'right' });
  const ca = i.customer.address ?? {};
  doc.font(FB).text('Bill To', 40, 130); doc.font(F).text([i.customer.name, ca.line1, ca.line2, [ca.postcode, ca.city].filter(Boolean).join(' '), i.customer.tin ? `TIN: ${i.customer.tin}` : null, i.customer.brn ? `BRN: ${i.customer.brn}` : null].filter(Boolean).join('\n'), 40, 145);
  let y = 215;
  y = table(doc, F, FB, y, [{ title: '#', w: 25 }, { title: 'Description 项目', w: 250 }, { title: 'Qty', w: 60, align: 'right' }, { title: 'Unit Price', w: 70, align: 'right' }, { title: 'Tax', w: 50, align: 'right' }, { title: 'Amount', w: 60, align: 'right' }],
    i.lines.map((l, n) => [String(n + 1), l.description, String(Number(l.qty)), fmt(l.unit_price), fmt(l.tax_amount), fmt(l.line_total)]));
  y += 8;
  const tot = (label: string, v: any, bold = false) => { doc.font(bold ? FB : F).fontSize(10).text(label, 360, y, { width: 110, align: 'right' }); doc.text(fmt(v), 475, y, { width: 80, align: 'right' }); y += 15; };
  tot('Subtotal', i.invoice.subtotal); tot('Tax (SST)', i.invoice.tax_amount); tot('Total', i.invoice.total, true); tot('Paid', i.invoice.paid_amount); tot('Balance Due', Number(i.invoice.total) - Number(i.invoice.paid_amount), true);
  if (i.payments?.length) { y += 10; y = table(doc, F, FB, y, [{ title: 'Payment Date', w: 120 }, { title: 'Method', w: 120 }, { title: 'Reference', w: 175 }, { title: 'Amount', w: 100, align: 'right' }], i.payments.map((p) => [dateStr(p.received_at), p.method, p.reference ?? '', fmt(p.amount)])); }
  if (i.einvoice?.verify_url) {
    const png = await QRCode.toBuffer(i.einvoice.verify_url, { margin: 1, scale: 4 });
    doc.image(png, 40, Math.max(y + 10, 620), { width: 90 });
    doc.font(F).fontSize(8).fillColor('#444').text(`MyInvois UUID: ${i.einvoice.uuid}\nScan to verify / 扫码验证`, 140, Math.max(y + 20, 630), { width: 300 });
  }
  if (i.invoice.note) doc.font(F).fontSize(9).fillColor('#444').text(`Note: ${i.invoice.note}`, 40, 740);
  return finish();
}

export interface StatementPdfInput { customer: any; company: any; month: string; opening_balance: number; closing_balance: number; lines: { date: string; doc_no: string; description: string; debit: number; credit: number; balance: number }[]; aging?: { current: number; d30: number; d60: number; d90: number } }
/** 客户月对账单 PDF */
export async function makeStatementPdf(s: StatementPdfInput): Promise<Buffer> {
  const { doc, F, FB, finish } = start();
  header(doc, F, FB, s.company, 'STATEMENT');
  doc.font(F).fontSize(10).text(`Period: ${s.month}`, 300, 75, { width: 255, align: 'right' });
  doc.text(`Printed: ${new Date().toISOString().slice(0, 10)}`, 300, 90, { width: 255, align: 'right' });
  doc.font(FB).text('Customer', 40, 130); doc.font(F).text([s.customer.name, s.customer.code ? `Code: ${s.customer.code}` : null, s.customer.tin ? `TIN: ${s.customer.tin}` : null, `Credit terms: ${s.customer.credit_terms_days} days`].filter(Boolean).join('\n'), 40, 145);
  let y = 210;
  y = table(doc, F, FB, y, [{ title: 'Date', w: 70 }, { title: 'Doc No', w: 100 }, { title: 'Description 说明', w: 155 }, { title: 'Debit', w: 65, align: 'right' }, { title: 'Credit', w: 65, align: 'right' }, { title: 'Balance', w: 60, align: 'right' }],
    [['', '', 'Opening balance 期初余额', '', '', fmt(s.opening_balance)], ...s.lines.map((l) => [l.date, l.doc_no, l.description, l.debit ? fmt(l.debit) : '', l.credit ? fmt(l.credit) : '', fmt(l.balance)]), ['', '', 'Closing balance 期末余额', '', '', fmt(s.closing_balance)]]);
  if (s.aging) {
    y += 20; doc.font(FB).fontSize(10).text('Aging 账龄', 40, y); y += 15;
    table(doc, F, FB, y, [{ title: 'Current 0-30', w: 128, align: 'right' }, { title: '31-60', w: 129, align: 'right' }, { title: '61-90', w: 129, align: 'right' }, { title: '90+', w: 129, align: 'right' }], [[fmt(s.aging.current), fmt(s.aging.d30), fmt(s.aging.d60), fmt(s.aging.d90)]]);
  }
  doc.font(F).fontSize(9).fillColor('#444').text('Please remit payment by the due date. Kindly quote invoice numbers. 请按期付款并注明发票号。', 40, 760, { width: 515, align: 'center' });
  return finish();
}
