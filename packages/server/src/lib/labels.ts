import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { existsSync } from 'node:fs';
export interface LabelItem { qr: string; code: string; color: string; names: (string | null)[] }
const mm = (v: number) => v * 2.83465;
const SIZES: Record<string, [number, number]> = { '70x40': [70, 40], '100x50': [100, 50], badge: [54, 86] };
/** 货位标签 / 员工卡 PDF，一页一张，按打印机标签尺寸 */
export async function makeLabelsPdf(items: LabelItem[], size: '70x40' | '100x50' | 'badge'): Promise<Buffer> {
  const [w, h] = SIZES[size];
  const doc = new PDFDocument({ size: [mm(w), mm(h)], margin: 0, autoFirstPage: false });
  const chunks: Buffer[] = [];
  doc.on('data', (c) => chunks.push(c));
  // 中文字体：按顺序尝试，找不到退回 Helvetica（中文会显示为方框）
  const candidates: [string, string | undefined][] = [
    [process.env.LABEL_FONT || '', process.env.LABEL_FONT_FAMILY],
    [new URL('../../fonts/NotoSansSC-Regular.otf', import.meta.url).pathname, undefined],
    ['/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc', 'WenQuanYi Zen Hei'],
    ['/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', 'NotoSansCJKsc-Regular'],
  ];
  let cjk = false;
  for (const [path, family] of candidates) {
    if (!path || !existsSync(path)) continue;
    try { const probe = new PDFDocument({ autoFirstPage: false }); if (family) probe.font(path, family); else probe.font(path); probe.end(); if (family) doc.registerFont('cjk', path, family); else doc.registerFont('cjk', path); cjk = true; break; } catch { /* 下一个 */ }
  }
  for (const it of items) {
    doc.addPage();
    const png = await QRCode.toBuffer(it.qr, { errorCorrectionLevel: 'H', margin: 1, scale: 8 });
    if (size === 'badge') {
      doc.rect(0, 0, mm(w), mm(10)).fill(it.color);
      doc.image(png, mm(12), mm(14), { width: mm(30) });
      doc.fillColor('#000').font(cjk ? 'cjk' : 'Helvetica-Bold').fontSize(16).text(it.code, 0, mm(50), { width: mm(w), align: 'center' });
      doc.fontSize(9).text(it.names[0] ?? '', 0, mm(60), { width: mm(w), align: 'center' });
      doc.fontSize(7).fillColor('#555').text(it.qr, 0, mm(78), { width: mm(w), align: 'center' });
    } else {
      const qrSize = mm(h - 10);
      doc.image(png, mm(4), mm(5), { width: qrSize });
      doc.rect(0, mm(h - 4), mm(w), mm(4)).fill(it.color);
      doc.fillColor('#000').font(cjk ? 'cjk' : 'Helvetica-Bold').fontSize(size === '100x50' ? 30 : 20).text(it.code, mm(h - 2), mm(6), { width: mm(w - h), align: 'center' });
      doc.fontSize(size === '100x50' ? 10 : 7).font(cjk ? 'cjk' : 'Helvetica').text(it.names.filter(Boolean).join('  ·  '), mm(h - 2), mm(h * 0.55), { width: mm(w - h), align: 'center' });
    }
  }
  doc.end();
  await new Promise((r) => doc.on('end', r));
  return Buffer.concat(chunks);
}
