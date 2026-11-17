import type { Tx } from './db.js';
import type { Tmpl, RawSheet, ColumnDef } from './xlsx.js';
export type Msg = { column: string; level: 'ERROR' | 'WARNING'; zh: string; ms: string; en: string };
export type ValidatedRow = { row_no: number; raw: Record<string, string>; norm: Record<string, any>; messages: Msg[]; status: 'OK' | 'WARNING' | 'ERROR'; action: 'CREATE' | 'UPDATE' | 'SKIP' };
const err = (column: string, zh: string, ms: string, en: string): Msg => ({ column, level: 'ERROR', zh, ms, en });
const warn = (column: string, zh: string, ms: string, en: string): Msg => ({ column, level: 'WARNING', zh, ms, en });
const UNIT_MAP: Record<string, string> = { '件': 'PCS', 'pcs': 'PCS', 'unit': 'PCS', '公斤': 'KG', 'kg': 'KG' };
const BTYPE_MAP: Record<string, string> = { '单件': 'UNIT', 'unit': 'UNIT', '箱': 'CASE', 'case': 'CASE', 'kotak': 'CASE' };
const ZTYPE_MAP: Record<string, string> = { '收货': 'RECEIVING', '存储': 'STORAGE', '货架': 'SHELF', '后仓': 'BACKROOM', receiving: 'RECEIVING', storage: 'STORAGE', shelf: 'SHELF', backroom: 'BACKROOM' };

export interface Lookups {
  categories: Map<string, { id: string; code: string; default_backroom_code: string | null; default_unit: string; default_shelf_life_days: number | null }>;
  taxCodes: Map<string, string>; defaultTax: string;
  suppliers: Map<string, string>;
  locations: Map<string, { id: string; has_stock: boolean }>;
  stockKeys: Set<string>;   // product_id|location_id 已有库存
  barcodes: Map<string, { product_id: string; pack_qty: number }>;
  products: Map<string, { id: string; sell_price: number; cost_price: number }>; // by primary barcode
  sites: Map<string, string>;
  plan: 'A' | 'B';
}
export async function loadLookups(tx: Tx): Promise<Lookups> {
  const categories = new Map<string, any>();
  for (const c of (await tx.query(`SELECT id, code, name_zh, name_ms, name_en, default_backroom_code, default_unit, default_shelf_life_days FROM category WHERE is_active`)).rows)
    for (const n of [c.code, c.name_zh, c.name_ms, c.name_en]) if (n) categories.set(String(n).toLowerCase(), c);
  const taxRows = (await tx.query(`SELECT id, code, is_default FROM tax_code`)).rows;
  const suppliers = new Map((await tx.query(`SELECT id, name FROM supplier WHERE is_active`)).rows.map((s) => [s.name.toLowerCase(), s.id]));
  const locations = new Map((await tx.query(`SELECT l.id, l.code, EXISTS (SELECT 1 FROM stock s WHERE s.location_id = l.id AND s.qty <> 0) AS has_stock FROM location l WHERE l.is_active AND NOT l.is_virtual`)).rows.map((l) => [l.code, { id: l.id, has_stock: l.has_stock }]));
  const barcodes = new Map((await tx.query(`SELECT barcode, product_id, pack_qty FROM barcode`)).rows.map((b) => [b.barcode, { product_id: b.product_id, pack_qty: Number(b.pack_qty) }]));
  const products = new Map((await tx.query(`SELECT p.id, p.sell_price, p.cost_price, b.barcode FROM product p JOIN barcode b ON b.product_id = p.id AND b.is_primary`)).rows.map((p) => [p.barcode, { id: p.id, sell_price: Number(p.sell_price), cost_price: Number(p.cost_price) }]));
  const sites = new Map((await tx.query(`SELECT id, code FROM site WHERE is_active`)).rows.map((s) => [s.code, s.id]));
  const stockKeys = new Set<string>((await tx.query(`SELECT product_id || '|' || location_id AS k FROM stock WHERE qty <> 0`)).rows.map((r) => r.k));
  const plan = (await tx.query(`SELECT plan FROM company`)).rows[0].plan;
  return { categories, taxCodes: new Map(taxRows.map((t) => [t.code, t.id])), defaultTax: taxRows.find((t) => t.is_default)?.id, suppliers, locations, barcodes, products, sites, plan, stockKeys };
}

const num = (s?: string) => (s === undefined || s === '' ? undefined : Number(String(s).replace(/,/g, '')));
function checkCommon(c: ColumnDef, v: string | undefined, msgs: Msg[]) {
  if (c.required && (v === undefined || v === '')) { msgs.push(err(c.zh, `${c.zh}必填`, `${c.ms} wajib diisi`, `${c.en} is required`)); return false; }
  if (v === undefined || v === '') return true;
  if (c.type === 'text' && c.max && v.length > c.max) msgs.push(err(c.zh, `${c.zh}超过 ${c.max} 字`, `${c.ms} melebihi ${c.max} aksara`, `${c.en} over ${c.max} chars`));
  if (['money', 'qty', 'int'].includes(c.type)) {
    const n = num(v)!;
    if (Number.isNaN(n)) { msgs.push(err(c.zh, `${c.zh}"${v}"不是数字`, `${c.ms} "${v}" bukan nombor`, `${c.en} "${v}" is not a number`)); return false; }
    if (c.type === 'int' && !Number.isInteger(n)) msgs.push(err(c.zh, `${c.zh}必须是整数`, `${c.ms} mesti integer`, `${c.en} must be an integer`));
    if (c.min !== undefined && n < c.min) msgs.push(err(c.zh, `${c.zh}不能小于 ${c.min}`, `${c.ms} tidak boleh kurang ${c.min}`, `${c.en} cannot be below ${c.min}`));
    if (c.gt !== undefined && n <= c.gt) msgs.push(err(c.zh, `${c.zh}必须大于 ${c.gt}`, `${c.ms} mesti melebihi ${c.gt}`, `${c.en} must be greater than ${c.gt}`));
    if ((c as any).max !== undefined && c.type === 'int' && n > (c as any).max) msgs.push(err(c.zh, `${c.zh}不能大于 ${(c as any).max}`, `${c.ms} tidak boleh melebihi ${(c as any).max}`, `${c.en} cannot exceed ${(c as any).max}`));
  }
  if (c.type === 'barcode' || c.type === 'any_barcode' || c.type === 'product_ref') { if (!/^[0-9]{8,14}$/.test(v)) msgs.push(err(c.zh, `${c.zh}"${v}"只有 ${v.length} 位，条码应为 8 到 14 位数字`, `${c.ms} "${v}" ${v.length} digit, kod bar perlu 8-14 digit`, `${c.en} "${v}" has ${v.length} digits, barcode needs 8 to 14 digits`)); }
  if (c.type === 'plu' && !/^[0-9]{5}$/.test(v)) msgs.push(err(c.zh, `${c.zh}应为 5 位数字`, `${c.ms} perlu 5 digit`, `${c.en} must be 5 digits`));
  if (c.type === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) msgs.push(err(c.zh, `${c.zh}格式不对`, `${c.ms} format salah`, `${c.en} format invalid`));
  if (c.type === 'tin' && !/^(C|IG|D|E|F|PT|TA|TC|TN|TR|TP|J|LE)\d{9,12}$/i.test(v)) msgs.push(warn(c.zh, `${c.zh}格式可能不对`, `${c.ms} format mungkin salah`, `${c.en} format may be invalid`));
  if (c.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(v)) msgs.push(err(c.zh, `${c.zh}应为 YYYY-MM-DD`, `${c.ms} perlu YYYY-MM-DD`, `${c.en} must be YYYY-MM-DD`));
  return !msgs.some((m) => m.column === c.zh && m.level === 'ERROR');
}

export function validateSheet(t: Tmpl, sheet: RawSheet, lk: Lookups, allSheets: RawSheet[], opts: { fill_min_levels?: boolean } = {}): ValidatedRow[] {
  const out: ValidatedRow[] = [];
  const seen = new Map<string, number>();
  const newBarcodesInProductSheet = new Set(allSheets.find((s) => s.code === 'PRODUCT')?.rows.map((r) => r.raw.barcode) ?? []);
  const newExtraBarcodes = new Map<string, number>((allSheets.find((s) => s.code === 'BARCODE')?.rows ?? []).map((r) => [r.raw.barcode, Number(r.raw.pack_qty) || 1]));
  for (const r of sheet.rows) {
    const msgs: Msg[] = []; const norm: Record<string, any> = {}; let action: ValidatedRow['action'] = 'CREATE';
    for (const c of t.columns) {
      const v = r.raw[c.key];
      if (!checkCommon(c, v, msgs)) continue;
      if (v === undefined || v === '') continue;
      switch (c.type) {
        case 'money': case 'qty': case 'int': norm[c.key] = num(v); break;
        case 'enum': {
          const map = c.key === 'unit' ? UNIT_MAP : c.key === 'barcode_type' ? BTYPE_MAP : ZTYPE_MAP;
          const m = map[v.toLowerCase()]; if (!m) msgs.push(err(c.zh, `${c.zh}只能是 ${c.options?.join(' 或 ')}`, `${c.ms} hanya ${c.options?.join('/')}`, `${c.en} must be ${c.options?.join(' or ')}`)); else norm[c.key] = m; break;
        }
        case 'category': {
          const cat = lk.categories.get(v.toLowerCase());
          if (!cat) { const avail = [...new Set([...lk.categories.values()].map((x: any) => x.name_zh ?? x.code))].join('、'); msgs.push(err(c.zh, `类别"${v}"不在类别清单。可用：${avail}`, `Kategori "${v}" tiada. Pilihan: ${avail}`, `Category "${v}" not found. Available: ${avail}`)); }
          else norm.category = cat; break;
        }
        case 'tax_code': { const id = lk.taxCodes.get(v); if (!id) msgs.push(err(c.zh, `税码"${v}"不存在`, `Kod cukai "${v}" tiada`, `Tax code "${v}" not found`)); else norm.tax_code_id = id; break; }
        case 'supplier': { const id = lk.suppliers.get(v.toLowerCase()); const inSheet = allSheets.find((s) => s.code === 'SUPPLIER')?.rows.some((x) => x.raw.name?.toLowerCase() === v.toLowerCase()); if (!id && !inSheet) msgs.push(warn(c.zh, `供应商"${v}"不存在，将新建`, `Pembekal "${v}" akan dicipta`, `Supplier "${v}" will be created`)); norm.supplier_name = v; norm.supplier_id = id ?? null; break; }
        case 'location': { const l = lk.locations.get(v); if (!l) msgs.push(err(c.zh, `位置"${v}"不存在`, `Lokasi "${v}" tiada`, `Location "${v}" not found`)); else norm[c.key] = l; break; }
        case 'site': { const id = lk.sites.get(v); if (!id) msgs.push(err(c.zh, `站点"${v}"不存在`, `Tapak "${v}" tiada`, `Site "${v}" not found`)); else norm.site_id = id; break; }
        case 'product_ref': { const b = lk.barcodes.get(v); if (!b && !newBarcodesInProductSheet.has(v)) msgs.push(err(c.zh, `产品主条码"${v}"不在产品表也不在系统`, `Kod bar produk "${v}" tiada`, `Product barcode "${v}" not found`)); norm.product_barcode = v; break; }
        case 'any_barcode': { const b = lk.barcodes.get(v); if (!b && !newBarcodesInProductSheet.has(v) && !newExtraBarcodes.has(v)) msgs.push(err(c.zh, `条码"${v}"不在系统`, `Kod bar "${v}" tiada`, `Barcode "${v}" not found`)); norm.barcode = v; norm.pack_qty = b?.pack_qty ?? newExtraBarcodes.get(v) ?? 1; break; }
        case 'category_list': { const ids: string[] = []; for (const part of v.split(/[;；,]/).map((s) => s.trim()).filter(Boolean)) { const cat = lk.categories.get(part.toLowerCase()); if (!cat) msgs.push(err(c.zh, `类别"${part}"不存在`, `Kategori "${part}" tiada`, `Category "${part}" not found`)); else ids.push(cat.id); } norm.allowed_category_ids = ids; break; }
        case 'ignore': break;
        default: norm[c.key] = v;
      }
    }
    // 表内重复
    const dupKey = t.code === 'PRODUCT' ? r.raw.barcode : t.code === 'BARCODE' ? r.raw.barcode : t.code === 'SUPPLIER' ? r.raw.name?.toLowerCase() : t.code === 'OPENING_STOCK' ? `${r.raw.barcode}|${r.raw.location}` : t.code === 'LOCATION' ? `${r.raw.site_code}|${r.raw.zone_code}` : r.raw.name;
    if (dupKey) { const first = seen.get(dupKey); if (first) msgs.push(t.code === 'OPENING_STOCK' ? warn('条码', `与第 ${first} 行同产品同位置，将合并`, `Sama dengan baris ${first}, akan digabung`, `Same as row ${first}, will be merged`) : err(t.columns[0].zh, `与第 ${first} 行重复`, `Berulang dengan baris ${first}`, `Duplicate of row ${first}`)); else seen.set(dupKey, r.row_no); }
    // 表专属规则
    if (t.code === 'PRODUCT') {
      if (!r.raw.name_zh && !r.raw.name_ms && !r.raw.name_en) msgs.push(err('中文名', '三语名称至少填一个', 'Isi sekurang-kurangnya satu nama', 'At least one name is required'));
      if (norm.unit === 'KG' && !r.raw.plu_code) msgs.push(err('称重 PLU', '公斤商品必须填称重 PLU', 'Produk KG mesti ada PLU', 'KG products need a scale PLU'));
      if (norm.sell_price !== undefined && norm.cost_price !== undefined && norm.sell_price < norm.cost_price) msgs.push(warn('售价', `售价 ${norm.sell_price} 低于成本价 ${norm.cost_price}`, `Harga jual ${norm.sell_price} bawah kos ${norm.cost_price}`, `Sell price ${norm.sell_price} below cost ${norm.cost_price}`));
      if (norm.cost_price === 0) msgs.push(warn('成本价', '成本价为 0', 'Harga kos 0', 'Cost price is 0'));
      if (norm.reorder_qty !== undefined && norm.min_level !== undefined && norm.reorder_qty < norm.min_level) msgs.push(warn('补货量', '补货量小于最低量', 'Kuantiti pesan semula bawah paras minimum', 'Reorder qty below min level'));
      if (opts.fill_min_levels && norm.category && (norm.min_level === undefined || norm.reorder_qty === undefined)) {
        const pack = norm.pack_qty ?? 12; norm.min_level ??= norm.unit === 'KG' ? 2 : pack; norm.reorder_qty ??= norm.unit === 'KG' ? 5 : pack * 2;
        for (let i = msgs.length - 1; i >= 0; i--) if (['最低量', '补货量'].includes(msgs[i].column)) msgs.splice(i, 1);
      }
      if (norm.category && !norm.unit) norm.unit = norm.category.default_unit;
      if (norm.category && !r.raw.shelf_life_days && norm.category.default_shelf_life_days) norm.shelf_life_days = norm.category.default_shelf_life_days;
      if (norm.category && !r.raw.backroom_location && norm.category.default_backroom_code && lk.plan === 'A') norm.backroom_location = lk.locations.get(norm.category.default_backroom_code) ?? null;
      const existing = r.raw.barcode ? lk.products.get(r.raw.barcode) : undefined;
      if (existing) { action = 'UPDATE'; norm.existing_id = existing.id; if (norm.sell_price !== undefined && norm.sell_price !== existing.sell_price) msgs.push(warn('售价', `售价 ${existing.sell_price} → ${norm.sell_price}`, `Harga jual ${existing.sell_price} → ${norm.sell_price}`, `Sell price ${existing.sell_price} → ${norm.sell_price}`)); }
      else if (r.raw.barcode && lk.barcodes.has(r.raw.barcode)) msgs.push(err('主条码', `条码"${r.raw.barcode}"已是另一个产品的非主条码`, `Kod bar "${r.raw.barcode}" milik produk lain`, `Barcode "${r.raw.barcode}" belongs to another product`));
    }
    if (t.code === 'BARCODE') {
      if (lk.barcodes.has(r.raw.barcode) || newBarcodesInProductSheet.has(r.raw.barcode)) msgs.push(err('条码', `条码"${r.raw.barcode}"已存在`, `Kod bar "${r.raw.barcode}" sudah ada`, `Barcode "${r.raw.barcode}" already exists`));
      if (norm.barcode_type === 'UNIT' && norm.pack_qty !== 1) msgs.push(err('换算数量', '单件的换算数量必须为 1', 'Unit mesti 1', 'Unit pack qty must be 1'));
      if (norm.barcode_type === 'CASE' && !(norm.pack_qty > 1)) msgs.push(err('换算数量', '箱的换算数量必须大于 1', 'Kotak mesti melebihi 1', 'Case pack qty must exceed 1'));
    }
    if (t.code === 'SUPPLIER' && lk.suppliers.has(r.raw.name?.toLowerCase())) { action = 'UPDATE'; norm.existing_id = lk.suppliers.get(r.raw.name.toLowerCase()); }
    if (t.code === 'OPENING_STOCK' && norm.location) { const pid = lk.barcodes.get(norm.barcode)?.product_id; if (pid && lk.stockKeys.has(`${pid}|${norm.location.id}`)) msgs.push(err('位置代码', `此产品在位置"${r.raw.location}"已有库存，期初库存不能重复导入`, `Produk ini sudah ada stok di "${r.raw.location}"`, `This product already has stock at "${r.raw.location}"`)); }
    if (t.code === 'OPENING_STOCK' && norm.expiry_date && norm.expiry_date < new Date().toISOString().slice(0, 10)) msgs.push(err('到期日', '到期日不能早于今天', 'Tarikh luput tidak boleh lepas', 'Expiry cannot be in the past'));
    const status = msgs.some((m) => m.level === 'ERROR') ? 'ERROR' : msgs.length ? 'WARNING' : 'OK';
    out.push({ row_no: r.row_no, raw: r.raw, norm, messages: msgs, status, action: status === 'ERROR' ? 'SKIP' : action });
  }
  return out;
}
