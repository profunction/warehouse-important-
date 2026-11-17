import ExcelJS from 'exceljs';
import type { Tx } from './db.js';
import type { RequestCtx } from './auth.js';
export type ColumnDef = { key: string; zh: string; ms: string; en: string; required: boolean; type: string; example?: string; options?: string[]; max?: number; min?: number; gt?: number };
export type Tmpl = { code: string; sheet_name_zh: string; sheet_name_ms: string; sheet_name_en: string; columns: ColumnDef[]; plans: string[] };

const ENUM_OPTIONS: Record<string, string[]> = { unit: ['件', '公斤'], barcode_type: ['单件', '箱'], zone_type: ['收货', '存储', '货架', '后仓'] };

/** 生成公司专属模板：三行表头 + 下拉选项 */
export async function buildTemplate(tx: Tx, ctx: RequestCtx, templates: Tmpl[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const cats = (await tx.query(`SELECT name_zh, name_ms, name_en FROM category WHERE is_active ORDER BY sort_order`)).rows.map((c) => c.name_zh || c.name_en);
  const taxes = (await tx.query(`SELECT code FROM tax_code ORDER BY code`)).rows.map((t) => t.code);
  const locs = (await tx.query(`SELECT code FROM location WHERE NOT is_virtual AND is_active ORDER BY code`)).rows.map((l) => l.code);
  const sups = (await tx.query(`SELECT name FROM supplier WHERE is_active ORDER BY name`)).rows.map((s) => s.name);
  const lists = wb.addWorksheet('选项'); lists.state = 'veryHidden';
  const listRef = (name: string, values: string[], col: number) => { values.forEach((v, i) => (lists.getCell(i + 1, col).value = v)); const L = lists.getColumn(col).letter; return values.length ? `选项!$${L}$1:$${L}$${values.length}` : null; };
  const refs: Record<string, string | null> = { category: listRef('category', cats, 1), tax_code: listRef('tax', taxes, 2), location: listRef('loc', locs, 3), backroom_location: listRef('loc', locs, 3), supplier: listRef('sup', sups, 4) };
  const guide = wb.addWorksheet('说明');
  guide.getColumn(1).width = 100;
  ['填写说明 / Panduan / Instructions', '1. 第 1 行中文列名，第 2 行马来文和英文，第 3 行示例。请从第 4 行开始填写。', '2. 带 * 的列必填。类别、税码、位置、供应商请用下拉选择。', '3. 单位：件 或 公斤。公斤商品必须填称重 PLU（5 位数字）。', '4. 一个文件最多 5000 行产品。', '5. 期初库存只在开店和年度大盘点时导入。'].forEach((t, i) => (guide.getCell(i + 1, 1).value = t));
  for (const t of templates) {
    const ws = wb.addWorksheet(t.sheet_name_zh);
    t.columns.forEach((c, i) => {
      const col = i + 1;
      ws.getCell(1, col).value = (c.required ? '*' : '') + c.zh; ws.getCell(1, col).font = { bold: true };
      ws.getCell(2, col).value = `${c.ms} / ${c.en}`; ws.getCell(2, col).font = { color: { argb: 'FF666666' }, size: 9 };
      ws.getCell(3, col).value = c.example ?? ''; ws.getCell(3, col).font = { italic: true, color: { argb: 'FF999999' } };
      ws.getColumn(col).width = Math.max(14, c.zh.length * 2 + 6);
      const opts = c.options ?? ENUM_OPTIONS[c.key]; const ref = refs[c.type] ?? refs[c.key];
      for (let r = 4; r <= 1003; r++) {
        if (opts) ws.getCell(r, col).dataValidation = { type: 'list', allowBlank: !c.required, formulae: [`"${opts.join(',')}"`] };
        else if (ref) ws.getCell(r, col).dataValidation = { type: 'list', allowBlank: true, formulae: [ref] };
        if (c.type === 'barcode' || c.type === 'any_barcode' || c.type === 'product_ref' || c.type === 'plu') ws.getCell(r, col).numFmt = '@';
      }
    });
    ws.views = [{ state: 'frozen', ySplit: 3 }];
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export type RawSheet = { code: string; rows: { row_no: number; raw: Record<string, string> }[] };
/** 读取上传文件，按模板列名匹配列（容忍多余列） */
export async function readUpload(buf: Buffer, templates: Tmpl[]): Promise<{ sheets: RawSheet[]; missing: { sheet: string; column: string }[] }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as any);
  const sheets: RawSheet[] = []; const missing: { sheet: string; column: string }[] = [];
  for (const t of templates) {
    const ws = wb.worksheets.find((w) => [t.sheet_name_zh, t.sheet_name_ms, t.sheet_name_en, t.code].includes(w.name.trim()));
    if (!ws) continue;
    const header = ws.getRow(1); const map: Record<number, string> = {};
    for (const c of t.columns) {
      let found = 0;
      header.eachCell((cell, n) => { const v = String(cell.value ?? '').replace(/^\*/, '').trim(); if (v === c.zh || v === c.en || v === c.ms || v === c.key) found = n; });
      if (!found && c.required) missing.push({ sheet: t.sheet_name_zh, column: c.zh });
      if (found) map[found] = c.key;
    }
    const rows: RawSheet['rows'] = [];
    ws.eachRow((row, n) => {
      if (n <= 3) return;
      const raw: Record<string, string> = {}; let any = false;
      row.eachCell({ includeEmpty: false }, (cell, col) => { const k = map[col]; if (!k) return; let v: any = cell.value; if (v && typeof v === 'object') v = (v as any).result ?? (v as any).text ?? (v instanceof Date ? v.toISOString().slice(0, 10) : JSON.stringify(v)); const s = String(v ?? '').trim(); if (s) { raw[k] = s; any = true; } });
      if (any) rows.push({ row_no: n, raw });
    });
    if (rows.length) sheets.push({ code: t.code, rows });
  }
  return { sheets, missing };
}
