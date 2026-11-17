// 收货/上架/补货共用：本地解析条码和位置，写 outbox，更新本地快照
import { db, findByBarcode, findLocation, applyLocalMovement, kvGet } from '../../offline/db.js';
import { enqueue, uuidv7 } from '../../offline/sync.js';
import type { MeResponse } from '@wh/shared';

export async function resolveProduct(code: string) { return findByBarcode(code, (await kvGet<any>('sync.settings', {}))?.scale_barcode_format); }
export async function resolveLocation(code: string) { return findLocation(code); }
export async function virtualLoc(type: 'SUPPLIER' | 'CUSTOMER' | 'TRANSIT' | 'DAMAGED') { return db.location.filter((l) => l.is_virtual && l.virtual_type === type).first(); }
/** 后仓硬限制在本地也先检查，避免离线时录了被隔离 */
export async function zoneAllows(locationId: string, categoryId: string) {
  const l = await db.location.get(locationId); if (!l?.zone_id) return true;
  const z = await db.zone.get(l.zone_id); if (!z?.allowed_is_hard || !z.allowed_category_ids?.length) return true;
  return z.allowed_category_ids.includes(categoryId);
}
export async function queueMovement(me: MeResponse, m: { product_id: string; from_location_id: string; to_location_id: string; qty: number; reason: string; expiry_date?: string | null; note?: string; assign_shelf?: boolean; summary: string }) {
  const client_id = uuidv7();
  await enqueue({ client_id, entity: 'movement', op: 'insert', user_id: me.user.id, summary: m.summary, payload: { product_id: m.product_id, from_location_id: m.from_location_id, to_location_id: m.to_location_id, qty: m.qty, reason: m.reason, expiry_date: m.expiry_date ?? null, note: m.note ?? null, assign_shelf: m.assign_shelf ?? false, performed_at: new Date().toISOString(), client_created_at: new Date().toISOString() } });
  await applyLocalMovement(m.product_id, m.from_location_id, m.to_location_id, m.qty);
  if (m.assign_shelf) await db.shelf_assignment.put({ id: uuidv7(), product_id: m.product_id, location_id: m.to_location_id, site_id: me.site?.id ?? '', is_primary: true, is_active: true, assigned_at: new Date().toISOString() });
  return client_id;
}
export async function queueShelf(me: MeResponse, product_id: string, location_id: string) {
  const client_id = uuidv7();
  await enqueue({ client_id, entity: 'shelf_assignment', op: 'upsert', user_id: me.user.id, summary: `shelf ${location_id}`, payload: { product_id, location_id, is_primary: true, assigned_at: new Date().toISOString() } });
  const old = await db.shelf_assignment.where('product_id').equals(product_id).toArray(); for (const o of old) if (o.is_primary) await db.shelf_assignment.update(o.id, { is_primary: false });
  await db.shelf_assignment.put({ id: client_id, product_id, location_id, site_id: me.site?.id ?? '', is_primary: true, is_active: true, assigned_at: new Date().toISOString() });
}
export async function backroomStock(productId: string) {
  const st = await db.stock.where('product_id').equals(productId).toArray();
  const out: { location_id: string; code: string; qty: number; zone_type: string }[] = [];
  for (const s of st) { if (s.qty <= 0) continue; const l = await db.location.get(s.location_id); if (!l || l.is_virtual || !l.zone_id) continue; const z = await db.zone.get(l.zone_id); if (!z) continue; out.push({ location_id: l.id, code: l.code, qty: s.qty, zone_type: z.zone_type }); }
  return out.sort((a, b) => b.qty - a.qty);
}
export async function defaultBackroom(product: { default_location_id?: string; category_id: string }) {
  if (product.default_location_id) { const l = await db.location.get(product.default_location_id); if (l) return l; }
  const c = await db.category.get(product.category_id);
  if (c?.default_backroom_code) return findLocation(c.default_backroom_code);
  return null;
}
