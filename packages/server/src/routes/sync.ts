import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { adminPool, withCompany } from '../lib/db.js';
import { requireAuth, hasPerm, canSeeCost } from '../lib/auth.js';
import { AppError } from '../lib/errors.js';
import { applyMovement, movementSchema, upsertShelf } from '../lib/movements.js';
import { config } from '../lib/config.js';
import { ERROR_MESSAGES, REASON_PERMISSION, SYNC_ENTITIES, type SyncPushResult } from '@wh/shared';

/** 游标：base64(JSON {entity: "iso|id"}) */
const decodeCursor = (c?: string): Record<string, string> => { try { return c ? JSON.parse(Buffer.from(c, 'base64url').toString()) : {}; } catch { return {}; } };
const encodeCursor = (o: Record<string, string>) => Buffer.from(JSON.stringify(o)).toString('base64url');
const QUARANTINE_CODES = new Set(['PERMISSION_DENIED', 'LOCATION_INACTIVE', 'PRODUCT_INACTIVE', 'REASON_DISABLED', 'CATEGORY_NOT_ALLOWED_IN_ZONE', 'INSUFFICIENT_STOCK', 'CROSS_SITE_NOT_ALLOWED']);
const versionLt = (a: string, b: string) => { const pa = a.split('.').map(Number), pb = b.split('.').map(Number); for (let i = 0; i < 3; i++) { if ((pa[i] ?? 0) < (pb[i] ?? 0)) return true; if ((pa[i] ?? 0) > (pb[i] ?? 0)) return false; } return false; };

export async function syncRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/sync/pull', async (req) => {
    const q = z.object({ entities: z.string().optional(), cursor: z.string().optional(), limit: z.coerce.number().max(2000).default(2000) }).parse(req.query);
    const wanted = (q.entities?.split(',').filter(Boolean) ?? [...SYNC_ENTITIES]) as string[];
    const cur = decodeCursor(q.cursor);
    const ctx = req.ctx;
    return withCompany({ companyId: ctx.companyId, userId: ctx.userId }, async (tx) => {
      const out: Record<string, any[]> = {}; const next = { ...cur }; let has_more = false;
      const pull = async (entity: string, sql: string, params: any[], tsCol: string, idCol = 't.id') => {
        const [ts, id] = (cur[entity] ?? '|').split('|');
        const rows = (await tx.query(`SELECT x.*, to_char(x._cur_ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS _cur FROM (${sql.replace(/^SELECT /, `SELECT ${tsCol} AS _cur_ts, ${idCol} AS _cur_id, `)} AND (($1::timestamptz IS NULL) OR (${tsCol}, ${idCol}) > ($1::timestamptz, $2::uuid)) ORDER BY ${tsCol}, ${idCol} LIMIT ${q.limit + 1}) x`, [ts || null, id || '00000000-0000-0000-0000-000000000000', ...params])).rows;
        if (rows.length > q.limit) { has_more = true; rows.pop(); }
        if (rows.length) { const last = rows[rows.length - 1]; next[entity] = `${last._cur}|${last._cur_id}`; }
        out[entity] = rows.map(({ _cur, _cur_ts, _cur_id, ...r }: any) => r);
      };
      const site = ctx.siteId;
      const costCols = canSeeCost(ctx) ? 't.cost_price,' : '';
      if (wanted.includes('product')) await pull('product', `SELECT t.id, t.sku, t.name_zh, t.name_ms, t.name_en, t.name_pinyin, t.search_text, t.photo_url, t.category_id, t.unit, t.is_weighed, t.plu_code, ${costCols} t.sell_price, t.tax_code_id, t.min_level, t.reorder_qty, t.default_supplier_id, t.default_location_id, t.shelf_life_days, t.is_active, t.updated_at FROM product t WHERE 1=1`, [], 't.updated_at');
      if (wanted.includes('barcode')) await pull('barcode', `SELECT t.id, t.product_id, t.barcode, t.pack_qty, t.barcode_type, t.is_primary, t.updated_at FROM barcode t WHERE 1=1`, [], 't.updated_at');
      if (wanted.includes('category')) await pull('category', `SELECT t.id, t.code, t.name_zh, t.name_ms, t.name_en, t.icon, t.color, t.parent_id, t.default_backroom_code, t.sort_order, t.is_active, t.updated_at FROM category t WHERE 1=1`, [], 't.updated_at');
      if (wanted.includes('tax_code')) await pull('tax_code', `SELECT t.id, t.code, t.rate, t.is_default, t.updated_at FROM tax_code t WHERE 1=1`, [], 't.updated_at');
      if (wanted.includes('supplier')) await pull('supplier', `SELECT t.id, t.name, t.lead_time_days, t.is_active, t.updated_at FROM supplier t WHERE 1=1`, [], 't.updated_at');
      if (wanted.includes('zone')) await pull('zone', `SELECT t.id, t.site_id, t.code, t.name_zh, t.name_ms, t.name_en, t.zone_type, t.color, t.allowed_is_hard, t.sort_order, t.is_active, t.updated_at, (SELECT array_agg(category_id) FROM zone_category zc WHERE zc.zone_id = t.id) AS allowed_category_ids FROM zone t WHERE ($3::uuid IS NULL OR t.site_id = $3)`, [site], 't.updated_at');
      if (wanted.includes('location')) await pull('location', `SELECT t.id, t.site_id, t.zone_id, t.code, t.rack, t.level, t.is_virtual, t.virtual_type, t.is_active, t.updated_at FROM location t WHERE (t.is_virtual OR $3::uuid IS NULL OR t.site_id = $3)`, [site], 't.updated_at');
      if (wanted.includes('stock')) await pull('stock', `SELECT t.product_id, t.location_id, t.qty, t.earliest_expiry, t.last_movement_at FROM stock t JOIN location l ON l.id = t.location_id WHERE ($3::uuid IS NULL OR l.site_id = $3 OR l.is_virtual)`, [site], 't.last_movement_at', 't.product_id');
      if (wanted.includes('shelf_assignment')) await pull('shelf_assignment', `SELECT t.id, t.product_id, t.location_id, t.site_id, t.is_primary, t.is_active, t.assigned_at, t.updated_at FROM shelf_assignment t WHERE ($3::uuid IS NULL OR t.site_id = $3)`, [site], 't.updated_at');
      if (wanted.includes('knowledge_article')) await pull('knowledge_article', `SELECT t.id, t.screen_ref, t.question_zh, t.question_ms, t.question_en, t.answer_zh, t.answer_ms, t.answer_en, t.role_codes, t.is_active, t.updated_at FROM knowledge_article t WHERE 1=1`, [], 't.updated_at');
      const settings = (await tx.query(`SELECT settings, feature_flags FROM company WHERE id = $1`, [ctx.companyId])).rows[0];
      return { data: out, cursor: encodeCursor(next), has_more, server_time: new Date().toISOString(), settings: settings.settings, feature_flags: settings.feature_flags, min_app_version: config.minAppVersion };
    });
  });

  app.post('/sync/push', async (req) => {
    const body = z.object({
      batch_id: z.string().uuid(), device_id: z.string().uuid(), app_version: z.string(), device_time: z.string(), pending_count: z.number().int().optional(),
      items: z.array(z.object({ client_id: z.string().uuid(), entity: z.enum(['movement', 'shelf_assignment', 'ticket']), op: z.enum(['insert', 'upsert']), seq: z.number().int(), payload: z.record(z.any()) })).max(200),
    }).parse(req.body);
    const ctx = req.ctx;
    if (versionLt(body.app_version, config.minAppVersion)) throw new AppError(426, 'APP_TOO_OLD');
    const dev = (await adminPool.query(`SELECT status FROM device WHERE id = $1 AND company_id = $2`, [body.device_id, ctx.companyId])).rows[0];
    if (!dev) throw new AppError(404, 'NOT_FOUND', 'device');
    if (dev.status === 'DISABLED') throw new AppError(423, 'DEVICE_DISABLED');
    const skew = Math.round((Date.now() - new Date(body.device_time).getTime()) / 1000);
    // 批次幂等
    const prev = (await adminPool.query(`SELECT 1 FROM sync_batch WHERE id = $1`, [body.batch_id])).rowCount;
    const results: SyncPushResult[] = [];
    const items = [...body.items].sort((a, b) => a.seq - b.seq);
    const counts = { applied: 0, duplicate: 0, rejected: 0, quarantined: 0 };
    for (const it of items) {
      // 已处理过的 client_id → duplicate
      const done = (await adminPool.query(`SELECT server_id FROM sync_applied WHERE entity = $1 AND client_id = $2`, [it.entity, it.client_id])).rows[0];
      if (done) { results.push({ client_id: it.client_id, status: 'duplicate', server_id: done.server_id }); counts.duplicate++; continue; }
      try {
        const serverId = await withCompany({ companyId: ctx.companyId, userId: ctx.userId, deviceId: body.device_id }, async (tx) => {
          let sid: string;
          if (it.entity === 'movement') {
            const m = movementSchema.parse({ ...it.payload, id: it.client_id });
            if (!hasPerm(ctx, REASON_PERMISSION[m.reason])) throw new AppError(403, 'PERMISSION_DENIED', REASON_PERMISSION[m.reason]);
            sid = (await applyMovement(tx, { companyId: ctx.companyId, userId: ctx.userId, deviceId: body.device_id }, m)).id;
          } else if (it.entity === 'shelf_assignment') {
            if (!hasPerm(ctx, 'shelf.assign')) throw new AppError(403, 'PERMISSION_DENIED', 'shelf.assign');
            const s = z.object({ product_id: z.string().uuid(), location_id: z.string().uuid(), is_primary: z.boolean().optional(), assigned_at: z.string().optional() }).parse(it.payload);
            sid = (await upsertShelf(tx, ctx, { id: it.client_id, ...s })).id;
          } else {
            const t = z.object({ type: z.string(), title: z.string(), ref_type: z.string().optional(), ref_id: z.string().uuid().optional(), text: z.string().optional(), photo_url: z.string().optional(), site_id: z.string().uuid().optional() }).parse(it.payload);
            sid = (await tx.query(`INSERT INTO ticket (id, company_id, site_id, type, title, ref_type, ref_id, owner_role_code, priority, deadline_at) VALUES ($1,$2,$3,$4,$5,$6,$7,'BOSS','NORMAL', now() + interval '2 days') ON CONFLICT (id) DO NOTHING RETURNING id`, [it.client_id, ctx.companyId, t.site_id ?? ctx.siteId, t.type, t.title, t.ref_type ?? null, t.ref_id ?? null])).rows[0]?.id ?? it.client_id;
            if (t.text || t.photo_url) await tx.query(`INSERT INTO ticket_event (company_id, ticket_id, user_id, event, text, photo_url) VALUES ($1,$2,$3,$4,$5,$6)`, [ctx.companyId, sid, ctx.userId, t.photo_url ? 'PHOTO' : 'COMMENT', t.text ?? null, t.photo_url ?? null]);
          }
          await tx.query(`INSERT INTO sync_applied (company_id, entity, client_id, server_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [ctx.companyId, it.entity, it.client_id, sid]);
          return sid;
        });
        results.push({ client_id: it.client_id, status: 'applied', server_id: serverId }); counts.applied++;
      } catch (e: any) {
        const code: string = e instanceof AppError ? e.code : 'INTERNAL';
        const m = ERROR_MESSAGES[code] ?? ERROR_MESSAGES.INTERNAL;
        if (QUARANTINE_CODES.has(code)) {
          const ticketId = await withCompany({ companyId: ctx.companyId, userId: ctx.userId, deviceId: body.device_id }, async (tx) => {
            const t = (await tx.query(`INSERT INTO ticket (company_id, site_id, type, title, ref_type, owner_role_code, priority, deadline_at) VALUES ($1,$2,'SYNC_QUARANTINE',$3,'sync_quarantine','MANAGER','HIGH', now() + interval '1 day') RETURNING id`, [ctx.companyId, ctx.siteId, `同步记录被隔离：${code}`])).rows[0].id;
            await tx.query(`INSERT INTO sync_quarantine (company_id, device_id, user_id, batch_id, client_id, entity, payload, reason_code, reason_message, ticket_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [ctx.companyId, body.device_id, ctx.userId, body.batch_id, it.client_id, it.entity, it.payload, code, String(e.detail ?? e.message ?? ''), t]);
            await tx.query(`UPDATE ticket SET ref_id = (SELECT id FROM sync_quarantine WHERE client_id = $2 AND entity = $3) WHERE id = $1`, [t, it.client_id, it.entity]);
            await tx.query(`INSERT INTO sync_applied (company_id, entity, client_id, server_id) VALUES ($1,$2,$3,NULL) ON CONFLICT DO NOTHING`, [ctx.companyId, it.entity, it.client_id]);
            return t;
          });
          results.push({ client_id: it.client_id, status: 'quarantined', code, message_zh: m.zh, message_ms: m.ms, message_en: m.en, ticket_id: ticketId }); counts.quarantined++;
        } else {
          results.push({ client_id: it.client_id, status: 'rejected', code, message_zh: m.zh, message_ms: m.ms, message_en: m.en }); counts.rejected++;
        }
      }
    }
    if (!prev) await adminPool.query(`INSERT INTO sync_batch (id, company_id, device_id, user_id, received_count, applied_count, duplicate_count, rejected_count, quarantined_count, clock_skew_seconds, errors) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (id) DO NOTHING`,
      [body.batch_id, ctx.companyId, body.device_id, ctx.userId, items.length, counts.applied, counts.duplicate, counts.rejected, counts.quarantined, skew, JSON.stringify(results.filter((r) => r.status === 'rejected' || r.status === 'quarantined'))]);
    await adminPool.query(`UPDATE device SET last_seen_at = now(), app_version = $2, pending_count = $3, status = CASE WHEN status = 'OFFLINE' THEN 'ACTIVE' ELSE status END WHERE id = $1`, [body.device_id, body.app_version, body.pending_count ?? 0]);
    return { batch_id: body.batch_id, server_time: new Date().toISOString(), clock_skew_seconds: Math.abs(skew) > 300 ? skew : undefined, results };
  });

  /** 照片上传（工单、收货损坏） */
  app.post('/sync/photos', async (req) => {
    const file = await (req as any).file();
    if (!file) throw new AppError(400, 'VALIDATION', 'file required');
    const { writeFile, mkdir } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const name = `photo-${req.ctx.companyId.slice(0, 8)}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
    await mkdir(config.uploadDir, { recursive: true });
    await writeFile(join(config.uploadDir, name), await file.toBuffer());
    const { signedFileUrl } = await import('./files.js');
    return { url: signedFileUrl(name) };
  });
}
