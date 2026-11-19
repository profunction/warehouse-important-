// 本地数据库（第 4 节）：主数据缓存 + outbox + 游标
import Dexie, { type Table } from 'dexie';
export interface CProduct { id: string; sku: string; name_zh?: string; name_ms?: string; name_en?: string; name_pinyin?: string; search_text: string; photo_url?: string; category_id: string; unit: 'PCS' | 'KG'; is_weighed: boolean; plu_code?: string; cost_price?: number; sell_price: number; min_level: number; reorder_qty: number; default_location_id?: string; shelf_life_days?: number; is_active: boolean; updated_at: string }
export interface CBarcode { id: string; product_id: string; barcode: string; pack_qty: number; barcode_type: string; is_primary: boolean }
export interface CLocation { id: string; site_id?: string; zone_id?: string; code: string; rack?: number; level?: number; is_virtual: boolean; virtual_type?: string; is_active: boolean }
export interface CZone { id: string; site_id: string; code: string; name_zh?: string; name_ms?: string; name_en?: string; zone_type: string; color: string; allowed_is_hard: boolean; allowed_category_ids?: string[]; sort_order: number; is_active: boolean }
export interface CStock { key: string; product_id: string; location_id: string; qty: number; earliest_expiry?: string }
export interface CShelf { id: string; product_id: string; location_id: string; site_id: string; is_primary: boolean; is_active: boolean; assigned_at: string }
export interface CCategory { id: string; code: string; name_zh?: string; name_ms?: string; name_en?: string; icon: string; color: string; default_backroom_code?: string; is_active: boolean }
export interface OutboxItem { client_id: string; entity: string; op: 'insert' | 'upsert'; seq: number; payload: any; created_at: string; user_id: string; status: 'pending' | 'sending' | 'rejected'; error?: { code: string; message_zh: string; message_ms: string; message_en: string }; summary?: string }
export interface KV { key: string; value: any }
class WhDb extends Dexie {
  product!: Table<CProduct, string>; barcode!: Table<CBarcode, string>; location!: Table<CLocation, string>; zone!: Table<CZone, string>;
  stock!: Table<CStock, string>; shelf_assignment!: Table<CShelf, string>; category!: Table<CCategory, string>; knowledge_article!: Table<any, string>;
  outbox!: Table<OutboxItem, string>; kv!: Table<KV, string>;
  constructor() {
    super('wh');
    this.version(1).stores({
      product: 'id, sku, category_id, is_active, plu_code', barcode: 'id, barcode, product_id', location: 'id, code, zone_id, site_id', zone: 'id, site_id, code',
      stock: 'key, product_id, location_id', shelf_assignment: 'id, product_id, location_id, [product_id+is_primary]', category: 'id, code', knowledge_article: 'id, screen_ref',
      outbox: 'client_id, seq, status, user_id', kv: 'key',
    });
  }
}
export const db = new WhDb();
export const kvGet = async <T,>(key: string, def: T): Promise<T> => ((await db.kv.get(key))?.value ?? def);
export const kvSet = (key: string, value: any) => db.kv.put({ key, value });
/** 本地查询：条码 → 产品（含换算） */
export async function findByBarcode(code: string, scaleFmt?: any) {
  const b = await db.barcode.where('barcode').equals(code).first();
  if (b) { const p = await db.product.get(b.product_id); return p ? { product: p, pack_qty: Number(b.pack_qty), barcode_type: b.barcode_type, weight_kg: null as number | null } : null; }
  const f = scaleFmt ?? { prefix: '2', plu_len: 5, weight_len: 5, unit: 'g' };
  if (code.startsWith(f.prefix) && code.length === f.prefix.length + f.plu_len + f.weight_len + 1) {
    const plu = code.slice(f.prefix.length, f.prefix.length + f.plu_len);
    const p = await db.product.where('plu_code').equals(plu).first();
    if (p?.is_weighed) { const raw = Number(code.slice(f.prefix.length + f.plu_len, f.prefix.length + f.plu_len + f.weight_len)); return { product: p, pack_qty: 1, barcode_type: 'SCALE_PLU', weight_kg: f.unit === 'g' ? raw / 1000 : raw }; }
  }
  return null;
}
export async function findLocation(code: string) { return db.location.where('code').equals(code.replace(/^LOC:[A-Z0-9]+:/i, '')).first(); }
export async function stockOf(productId: string) { return db.stock.where('product_id').equals(productId).toArray(); }
export async function stockAt(productId: string, locationId: string) { return (await db.stock.get(productId + locationId))?.qty ?? 0; }
/** 本地库存快照随 outbox 同步变化 */
export async function applyLocalMovement(productId: string, fromId: string, toId: string, qty: number) {
  await db.transaction('rw', db.stock, async () => {
    for (const [loc, d] of [[fromId, -qty], [toId, qty]] as [string, number][]) {
      const k = productId + loc; const cur = await db.stock.get(k);
      await db.stock.put({ key: k, product_id: productId, location_id: loc, qty: (cur?.qty ?? 0) + d, earliest_expiry: cur?.earliest_expiry });
    }
  });
}
