import { fileURLToPath } from 'node:url';
// 采购单 PDF / Excel（模块 A）。pdfkit 中文字体处理同 lib/labels.ts；文件写到 config.uploadDir，用 files.ts 的签名 URL 返回。
// 约定：文件名 po-<po_no>.pdf / .xlsx（重复生成覆盖）；金额 RM 两位小数；三语产品名用 zh，没有则 en / ms。
import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Tx } from './db.js';
import { config } from './config.js';
import { signedFileUrl } from '../routes/files.js';

export interface PoDoc {
  po: any; supplier: any; company: any; site: any | null;
  lines: { line_no: number; sku: string; name: string; barcode: string | null; unit: string; case_qty: number | null; ordered_qty: number; unit_cost: number; amount: number }[];
}
const pname = (r: any) => r.name_zh || r.name_en || r.name_ms || r.sku;

/** 读出一张 PO 的打印数据（在事务里，RLS 生效） */
export async function loadPoDoc(tx: Tx, poId: string): Promise<PoDoc> {
  const po = (await tx.query(`SELECT * FROM purchase_order WHERE id = $1`, [poId])).rows[0];
  if (!po) throw new Error('PO_NOT_FOUND');
  const supplier = (await tx.query(`SELECT * FROM supplier WHERE id = $1`, [po.supplier_id])).rows[0];
  const company = (await tx.query(`SELECT id, name, short_code, tin, sst_no, address FROM company WHERE id = $1`, [po.company_id])).rows[0];
  const site = po.deliver_to_site_id ? (await tx.query(`SELECT id, code, name, address FROM site WHERE id = $1`, [po.deliver_to_site_id])).rows[0] : null;
  const rows = (await tx.query(
    `SELECT l.line_no, l.ordered_qty, l.unit_cost, p.sku, p.name_zh, p.name_ms, p.name_en, p.unit,
            (SELECT barcode FROM barcode b WHERE b.product_id = p.id AND b.is_primary LIMIT 1) AS barcode,
            (SELECT max(pack_qty) FROM barcode b WHERE b.product_id = p.id AND b.barcode_type = 'CASE') AS case_qty
     FROM purchase_order_line l JOIN product p ON p.id = l.product_id WHERE l.po_id = $1 ORDER BY l.line_no`, [poId])).rows;
  return { po, supplier, company, site, lines: rows.map((r: any) => ({ line_no: r.line_no, sku: r.sku, name: pname(r), barcode: r.barcode, unit: r.unit, case_qty: r.case_qty ? Number(r.case_qty) : null, ordered_qty: Number(r.ordered_qty), unit_cost: Number(r.unit_cost), amount: Math.round(Number(r.ordered_qty) * Number(r.unit_cost) * 100) / 100 })) };
}

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
const money = (v: number) => `RM ${v.toFixed(2)}`;
const addr = (a: any) => (a ? (typeof a === 'string' ? a : [a.line1, a.line2, a.city, a.postcode, a.state].filter(Boolean).join(', ')) : '');
const dateStr = (v: any) => (v ? new Date(v).toISOString().slice(0, 10) : '');

/** A4 采购单 PDF */
export async function buildPoPdf(d: PoDoc): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const chunks: Buffer[] = []; doc.on('data', (c) => chunks.push(c));
  const cjk = registerCjk(doc); const F = cjk ? 'cjk' : 'Helvetica'; const FB = cjk ? 'cjk' : 'Helvetica-Bold';
  const W = doc.page.width - 80;
  doc.font(FB).fontSize(20).text(d.company?.name ?? '', 40, 40, { width: W * 0.6 });
  doc.font(F).fontSize(9).fillColor('#444').text([addr(d.company?.address), d.company?.tin ? `TIN ${d.company.tin}` : '', d.company?.sst_no ? `SST ${d.company.sst_no}` : ''].filter(Boolean).join('\n'), 40, 66, { width: W * 0.6 });
  doc.fillColor('#000').font(FB).fontSize(22).text('PURCHASE ORDER 采购单', 40 + W * 0.55, 40, { width: W * 0.45, align: 'right' });
  doc.font(F).fontSize(11).text(`${d.po.po_no}\n日期 Date: ${dateStr(d.po.created_at)}\n预计到货 Expected: ${dateStr(d.po.expected_date) || '-'}`, 40 + W * 0.55, 70, { width: W * 0.45, align: 'right' });
  let y = 130;
  doc.font(FB).fontSize(11).text('供应商 Supplier', 40, y); doc.font(F).fontSize(10).text([d.supplier?.name, d.supplier?.phone, d.supplier?.email, d.supplier?.tin ? `TIN ${d.supplier.tin}` : ''].filter(Boolean).join('\n'), 40, y + 14, { width: W / 2 - 10 });
  doc.font(FB).fontSize(11).text('送货到 Deliver to', 40 + W / 2, y); doc.font(F).fontSize(10).text([d.site?.name ?? d.company?.name, addr(d.site?.address ?? d.company?.address)].filter(Boolean).join('\n'), 40 + W / 2, y + 14, { width: W / 2 });
  y = 200;
  const cols = [{ k: '#', w: 24, a: 'left' }, { k: '条码 Barcode', w: 92, a: 'left' }, { k: '产品 Product', w: W - 24 - 92 - 50 - 60 - 70 - 80, a: 'left' }, { k: '单位 Unit', w: 50, a: 'center' }, { k: '数量 Qty', w: 60, a: 'right' }, { k: '单价 Price', w: 70, a: 'right' }, { k: '金额 Amount', w: 80, a: 'right' }] as const;
  const header = () => { doc.rect(40, y, W, 20).fill('#eeeeee'); doc.fillColor('#000').font(FB).fontSize(9); let x = 40; for (const c of cols) { doc.text(c.k, x + 3, y + 6, { width: c.w - 6, align: c.a }); x += c.w; } y += 22; doc.font(F); };
  header();
  for (const l of d.lines) {
    if (y > doc.page.height - 120) { doc.addPage(); y = 40; header(); }
    const cells = [String(l.line_no), l.barcode ?? '', `${l.name}${l.case_qty && l.case_qty > 1 ? `  (1 箱 = ${l.case_qty})` : ''}`, l.unit, String(l.ordered_qty), l.unit_cost.toFixed(2), l.amount.toFixed(2)];
    let x = 40; doc.fontSize(9);
    const h = Math.max(16, doc.heightOfString(cells[2], { width: cols[2].w - 6 }) + 6);
    cells.forEach((c, i) => { doc.text(c, x + 3, y + 3, { width: cols[i].w - 6, align: cols[i].a }); x += cols[i].w; });
    y += h; doc.moveTo(40, y).lineTo(40 + W, y).strokeColor('#dddddd').stroke();
  }
  y += 10;
  doc.font(FB).fontSize(12).text(`合计 Total: ${money(Number(d.po.total_amount))}`, 40, y, { width: W, align: 'right' });
  if (d.po.note) doc.font(F).fontSize(10).text(`备注 Note: ${d.po.note}`, 40, y + 30, { width: W });
  doc.font(F).fontSize(8).fillColor('#666').text('Generated by WarehouseShop 仓店通', 40, doc.page.height - 50, { width: W, align: 'center' });
  doc.end();
  await new Promise((r) => doc.on('end', r));
  return Buffer.concat(chunks);
}

/** 采购单 Excel：供应商直接打开能看、能回填 */
export async function buildPoXlsx(d: PoDoc): Promise<Buffer> {
  const wb = new ExcelJS.Workbook(); wb.creator = 'WarehouseShop';
  const ws = wb.addWorksheet('PO');
  ws.addRow([d.company?.name ?? '']); ws.getRow(1).font = { bold: true, size: 14 };
  ws.addRow(['PURCHASE ORDER 采购单', d.po.po_no]);
  ws.addRow(['供应商 Supplier', d.supplier?.name ?? '']);
  ws.addRow(['日期 Date', dateStr(d.po.created_at), '预计到货 Expected', dateStr(d.po.expected_date)]);
  ws.addRow(['送货到 Deliver to', d.site?.name ?? d.company?.name ?? '']);
  ws.addRow([]);
  const head = ws.addRow(['#', '条码 Barcode', '货号 SKU', '产品 Product', '单位 Unit', '箱规 Case', '数量 Qty', '单价 Price', '金额 Amount']);
  head.font = { bold: true }; head.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEEEEE' } }; });
  for (const l of d.lines) ws.addRow([l.line_no, l.barcode ?? '', l.sku, l.name, l.unit, l.case_qty ?? '', l.ordered_qty, l.unit_cost, l.amount]);
  const tot = ws.addRow(['', '', '', '', '', '', '', '合计 Total', Number(d.po.total_amount)]); tot.font = { bold: true };
  if (d.po.note) ws.addRow(['备注 Note', d.po.note]);
  ws.columns = [{ width: 5 }, { width: 16 }, { width: 12 }, { width: 40 }, { width: 8 }, { width: 8 }, { width: 10 }, { width: 10 }, { width: 12 }];
  ws.getColumn(8).numFmt = '0.00'; ws.getColumn(9).numFmt = '0.00';
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** 生成并保存两份文件，返回签名 URL 和 PDF 本地路径（Telegram 发文档用） */
export async function savePoFiles(d: PoDoc): Promise<{ pdf_url: string; xlsx_url: string; pdfPath: string; xlsxPath: string }> {
  await mkdir(config.uploadDir, { recursive: true });
  const base = `po-${String(d.po.po_no).replace(/[^A-Za-z0-9_-]/g, '_')}`;
  const [pdf, xlsx] = await Promise.all([buildPoPdf(d), buildPoXlsx(d)]);
  const pdfPath = join(config.uploadDir, `${base}.pdf`); const xlsxPath = join(config.uploadDir, `${base}.xlsx`);
  await Promise.all([writeFile(pdfPath, pdf), writeFile(xlsxPath, xlsx)]);
  return { pdf_url: signedFileUrl(`${base}.pdf`), xlsx_url: signedFileUrl(`${base}.xlsx`), pdfPath, xlsxPath };
}
