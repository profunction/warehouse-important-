import type { Tx } from './db.js';
import type { RequestCtx } from './auth.js';
import { z } from 'zod';
import { AppError, fromDbError } from './errors.js';

export const movementSchema = z.object({
  id: z.string().uuid().optional(),           // = client_id
  product_id: z.string().uuid().optional(),
  barcode: z.string().optional(),               // 可用条码代替 product_id，服务器换算 pack_qty
  from_location_id: z.string().uuid().optional(), from_location_code: z.string().optional(),
  to_location_id: z.string().uuid().optional(), to_location_code: z.string().optional(),
  qty: z.number().positive(),
  reason: z.enum(['RECEIVE', 'PUTAWAY', 'REFILL', 'TRANSFER_OUT', 'TRANSFER_IN', 'SALE', 'RETURN', 'COUNT', 'ADJUST']),
  ref_type: z.enum(['IMPORT', 'GRN', 'TRANSFER', 'SALE', 'RETURN', 'COUNT', 'ADJUST', 'MANUAL']).optional().nullable(),
  ref_id: z.string().uuid().optional().nullable(),
  expiry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  performed_at: z.string().datetime({ offset: true }).optional(),
  client_created_at: z.string().datetime({ offset: true }).optional(),
  note: z.string().max(200).optional().nullable(),
  assign_shelf: z.boolean().optional(),         // 补货时顺便登记货架
});
export type MovementInput = z.infer<typeof movementSchema>;

/** 解析位置：id 或 code（code 可带 LOC:XXX: 前缀），虚拟位置用 SUPPLIER 等 */
export async function resolveLocation(tx: Tx, id?: string, code?: string) {
  if (id) return (await tx.query(`SELECT * FROM location WHERE id = $1`, [id])).rows[0];
  if (code) return (await tx.query(`SELECT * FROM location WHERE code = $1`, [code.replace(/^LOC:[A-Z0-9]+:/i, '')])).rows[0];
  return null;
}

/** 唯一的库存写入口。所有收货、上架、补货、导入、同步都走这里。 */
export async function applyMovement(tx: Tx, ctx: Pick<RequestCtx, 'companyId' | 'userId' | 'deviceId'>, input: MovementInput) {
  let productId = input.product_id; let qty = input.qty;
  if (!productId && input.barcode) {
    const b = (await tx.query(`SELECT product_id, pack_qty FROM barcode WHERE barcode = $1`, [input.barcode])).rows[0];
    if (!b) throw new AppError(404, 'BARCODE_NOT_FOUND');
    productId = b.product_id; qty = qty * Number(b.pack_qty);
  }
  if (!productId) throw new AppError(400, 'VALIDATION', 'product_id or barcode required');
  const from = await resolveLocation(tx, input.from_location_id, input.from_location_code);
  const to = await resolveLocation(tx, input.to_location_id, input.to_location_code);
  if (!from || !to) throw new AppError(404, 'LOCATION_NOT_FOUND');
  const id = input.id ?? (await tx.query(`SELECT uuid_v7() id`)).rows[0].id;
  // 幂等：已有同 id 直接返回
  const existing = (await tx.query(`SELECT id FROM movement WHERE id = $1`, [id])).rows[0];
  if (existing) return { id, duplicate: true };
  try {
    await tx.query(
      `INSERT INTO movement (id, company_id, product_id, from_location_id, to_location_id, qty, reason, ref_type, ref_id, expiry_date, performed_by, performed_at, device_id, client_created_at, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,COALESCE($12::timestamptz, now()),$13,COALESCE($14::timestamptz, now()),$15)`,
      [id, ctx.companyId, productId, from.id, to.id, qty, input.reason, input.ref_type ?? null, input.ref_id ?? null, input.expiry_date ?? null, ctx.userId, input.performed_at ?? null, ctx.deviceId ?? null, input.client_created_at ?? null, input.note ?? null]);
  } catch (e) { throw fromDbError(e); }
  if (input.assign_shelf && input.reason === 'REFILL') {
    await upsertShelf(tx, ctx, { product_id: productId, location_id: to.id, is_primary: true });
  }
  return { id, duplicate: false, product_id: productId, qty };
}

export async function upsertShelf(tx: Tx, ctx: Pick<RequestCtx, 'companyId' | 'userId'>, s: { id?: string; product_id: string; location_id: string; is_primary?: boolean; assigned_at?: string }) {
  try {
    // 不用 ON CONFLICT：BEFORE 触发器会先把旧主货架改掉，和 ON CONFLICT 同时改同一行会报错
    const existing = (await tx.query(`SELECT id, is_primary FROM shelf_assignment WHERE product_id = $1 AND location_id = $2`, [s.product_id, s.location_id])).rows[0];
    if (existing) {
      await tx.query(`UPDATE shelf_assignment SET is_primary = ($2::boolean OR is_primary), is_active = true, assigned_at = greatest(assigned_at, COALESCE($3::timestamptz, now())), assigned_by = $4 WHERE id = $1`, [existing.id, s.is_primary ?? true, s.assigned_at ?? null, ctx.userId]);
      return { id: existing.id, inserted: false };
    }
    const r = await tx.query(
      `INSERT INTO shelf_assignment (id, company_id, product_id, location_id, site_id, is_primary, assigned_by, assigned_at)
       VALUES (COALESCE($1::uuid, uuid_v7()), $2, $3, $4, (SELECT site_id FROM location WHERE id = $4), COALESCE($5, true), $6, COALESCE($7::timestamptz, now())) RETURNING id`,
      [s.id ?? null, ctx.companyId, s.product_id, s.location_id, s.is_primary ?? null, ctx.userId, s.assigned_at ?? null]);
    return { id: r.rows[0].id, inserted: true };
  } catch (e) { throw fromDbError(e); }
}
