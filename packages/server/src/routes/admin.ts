import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withCompany, withAdmin, adminPool } from '../lib/db.js';
import { requireAuth, requirePerm, requireSuperAdmin, hashPin, invalidatePermCache, hasPerm } from '../lib/auth.js';
import { AppError, notFound } from '../lib/errors.js';
import { newPin } from './auth.js';

export async function adminRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);
  const cx = (req: any) => ({ companyId: req.ctx.companyId, userId: req.ctx.userId, deviceId: req.ctx.deviceId });

  // ---------- 仪表板 ----------
  app.get('/dashboard', async (req) => withCompany(cx(req), async (tx) => {
    const site = req.ctx.siteId;
    const one = async (sql: string, p: any[] = []) => (await tx.query(sql, p)).rows[0];
    const stockValue = hasPerm(req.ctx, 'product.view_cost') ? Number((await one(`SELECT coalesce(sum(s.qty * p.cost_price),0) v FROM stock s JOIN product p ON p.id = s.product_id JOIN location l ON l.id = s.location_id WHERE NOT l.is_virtual AND ($1::uuid IS NULL OR l.site_id = $1)`, [site])).v) : null;
    return {
      stock_value: stockValue,
      product_count: Number((await one(`SELECT count(*) n FROM product WHERE is_active`)).n),
      total_qty: Number((await one(`SELECT coalesce(sum(s.qty),0) v FROM stock s JOIN location l ON l.id = s.location_id WHERE NOT l.is_virtual AND ($1::uuid IS NULL OR l.site_id = $1)`, [site])).v),
      movements_today: Number((await one(`SELECT count(*) n FROM movement WHERE performed_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Kuala_Lumpur') AT TIME ZONE 'Asia/Kuala_Lumpur'`)).n),
      pending_imports: Number((await one(`SELECT count(*) n FROM import_job WHERE status IN ('VALIDATED','PENDING_APPROVAL')`)).n),
      pending_approvals: Number((await one(`SELECT count(*) n FROM approval_request WHERE status = 'PENDING'`)).n),
      negative_stock: Number((await one(`SELECT count(*) n FROM stock s JOIN location l ON l.id = s.location_id WHERE s.qty < 0 AND NOT l.is_virtual`)).n),
      low_stock: Number((await one(`SELECT count(*) n FROM (SELECT p.id FROM product p LEFT JOIN stock s ON s.product_id = p.id LEFT JOIN location l ON l.id = s.location_id AND NOT l.is_virtual WHERE p.is_active GROUP BY p.id, p.min_level HAVING coalesce(sum(s.qty) FILTER (WHERE NOT l.is_virtual),0) < p.min_level) x`)).n),
      devices_offline: Number((await one(`SELECT count(*) n FROM device WHERE status <> 'DISABLED' AND type IN ('PHONE','POS','KIOSK') AND (last_seen_at IS NULL OR last_seen_at < now() - interval '2 hours')`)).n),
      open_tickets: Number((await one(`SELECT count(*) n FROM ticket WHERE status NOT IN ('RESOLVED','CLOSED')`)).n),
      labels_unprinted: Number((await one(`SELECT count(*) n FROM location WHERE NOT is_virtual AND is_active AND qr_printed_at IS NULL`)).n),
      expiring_14d: Number((await one(`SELECT count(*) n FROM expiry_lot WHERE qty > 0 AND expiry_date <= current_date + 14`)).n),
    };
  }));

  // ---------- 用户 ----------
  app.get('/users', { preHandler: requirePerm('user.manage', 'user.reset_pin') }, async (req) => withCompany(cx(req), async (tx) => (await tx.query(
    `SELECT u.id, u.name, u.phone, u.email, u.language, u.badge_code, u.is_active, u.is_super_admin, u.created_at,
       coalesce(json_agg(json_build_object('site_id', usr.site_id, 'site_code', s.code, 'role_id', r.id, 'role_code', r.code)) FILTER (WHERE usr.id IS NOT NULL), '[]') AS roles
     FROM app_user u LEFT JOIN user_site_role usr ON usr.user_id = u.id LEFT JOIN role r ON r.id = usr.role_id LEFT JOIN site s ON s.id = usr.site_id GROUP BY u.id ORDER BY u.is_active DESC, u.name`)).rows));
  app.post('/users', { preHandler: requirePerm('user.manage') }, async (req, reply) => {
    const b = z.object({ name: z.string().min(1), phone: z.string().optional().nullable(), email: z.string().email().optional().nullable(), language: z.enum(['zh', 'ms', 'en']).default('zh'), roles: z.array(z.object({ role_code: z.string(), site_id: z.string().uuid().nullable().optional() })).min(1), pin: z.string().regex(/^[0-9]{6}$/).optional() }).parse(req.body);
    const pin = b.pin ?? newPin();
    const cond = req.ctx.permissions.get('user.manage');
    const r = await withCompany(cx(req), async (tx) => {
      const u = (await tx.query(`INSERT INTO app_user (company_id, name, phone, email, language, pin_hash) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, badge_code`, [req.ctx.companyId, b.name, b.phone ?? null, b.email ?? null, b.language, await hashPin(pin)])).rows[0];
      for (const ro of b.roles) {
        if (cond?.own_site_only && (ro.site_id !== req.ctx.siteId || ['BOSS', 'MANAGER', 'SUPER_ADMIN'].includes(ro.role_code))) throw new AppError(403, 'FORBIDDEN', 'own_site_only');
        const role = (await tx.query(`SELECT id FROM role WHERE company_id = $1 AND code = $2`, [req.ctx.companyId, ro.role_code])).rows[0]; if (!role) throw notFound();
        await tx.query(`INSERT INTO user_site_role (company_id, user_id, site_id, role_id) VALUES ($1,$2,$3,$4)`, [req.ctx.companyId, u.id, ro.site_id ?? null, role.id]);
      }
      return u;
    });
    reply.status(201); return { ...r, pin };   // PIN 只在创建响应里显示一次，供打印员工卡时告知
  });
  app.put('/users/:id', { preHandler: requirePerm('user.manage') }, async (req) => {
    const { id } = req.params as any;
    const b = z.object({ name: z.string().optional(), phone: z.string().optional().nullable(), email: z.string().email().optional().nullable(), language: z.enum(['zh', 'ms', 'en']).optional(), is_active: z.boolean().optional(), roles: z.array(z.object({ role_code: z.string(), site_id: z.string().uuid().nullable().optional() })).optional() }).parse(req.body);
    await withCompany(cx(req), async (tx) => {
      const sets: string[] = []; const params: any[] = [id];
      for (const k of ['name', 'phone', 'email', 'language', 'is_active']) if ((b as any)[k] !== undefined) { params.push((b as any)[k]); sets.push(`${k} = $${params.length}`); }
      if (sets.length) await tx.query(`UPDATE app_user SET ${sets.join(', ')} WHERE id = $1`, params);
      if (b.roles) {
        await tx.query(`DELETE FROM user_site_role WHERE user_id = $1`, [id]);
        for (const ro of b.roles) { const role = (await tx.query(`SELECT id FROM role WHERE company_id = $1 AND code = $2`, [req.ctx.companyId, ro.role_code])).rows[0]; if (role) await tx.query(`INSERT INTO user_site_role (company_id, user_id, site_id, role_id) VALUES ($1,$2,$3,$4)`, [req.ctx.companyId, id, ro.site_id ?? null, role.id]); }
      }
    });
    invalidatePermCache(id);
    return { ok: true };
  });
  app.post('/users/:id/reset-pin', { preHandler: requirePerm('user.reset_pin') }, async (req) => {
    const { id } = req.params as any;
    const pin = newPin();
    const h = await hashPin(pin);
    await withCompany(cx(req), (tx) => tx.query(`UPDATE app_user SET pin_hash = $2, pin_failed_count = 0, pin_locked_until = NULL WHERE id = $1`, [id, h]));
    return { pin };
  });
  app.get('/roles', async (req) => withCompany(cx(req), async (tx) => (await tx.query(`SELECT r.id, r.code, r.name_zh, r.name_ms, r.name_en, r.home_buttons, (SELECT json_agg(json_build_object('code', rp.permission_code, 'condition', rp.condition)) FROM role_permission rp WHERE rp.role_id = r.id) AS permissions FROM role r WHERE r.company_id = $1 ORDER BY r.code`, [req.ctx.companyId])).rows));

  // ---------- 设备 ----------
  app.get('/devices', { preHandler: requirePerm('device.view', 'device.manage') }, async (req) => withCompany(cx(req), async (tx) => (await tx.query(`SELECT d.*, s.code AS site_code FROM device d LEFT JOIN site s ON s.id = d.site_id ORDER BY d.last_seen_at DESC NULLS LAST`)).rows));
  app.post('/devices', { preHandler: requirePerm('device.manage') }, async (req, reply) => {
    const b = z.object({ type: z.string(), name: z.string(), site_id: z.string().uuid().optional().nullable(), serial: z.string().optional().nullable(), paired_to_device_id: z.string().uuid().optional().nullable(), config_json: z.record(z.any()).optional() }).parse(req.body);
    return withCompany(cx(req), async (tx) => { reply.status(201); return (await tx.query(`INSERT INTO device (company_id, type, name, site_id, serial, paired_to_device_id, config_json) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [req.ctx.companyId, b.type, b.name, b.site_id ?? null, b.serial ?? null, b.paired_to_device_id ?? null, b.config_json ?? {}])).rows[0]; });
  });
  app.put('/devices/:id', { preHandler: requirePerm('device.manage') }, async (req) => {
    const { id } = req.params as any;
    const b = z.object({ name: z.string().optional(), site_id: z.string().uuid().optional().nullable(), status: z.enum(['ACTIVE', 'OFFLINE', 'DISABLED']).optional(), config_json: z.record(z.any()).optional() }).parse(req.body);
    return withCompany(cx(req), async (tx) => { const r = (await tx.query(`UPDATE device SET name = COALESCE($2, name), site_id = COALESCE($3, site_id), status = COALESCE($4, status), config_json = COALESCE($5, config_json) WHERE id = $1 RETURNING *`, [id, b.name ?? null, b.site_id ?? null, b.status ?? null, b.config_json ?? null])).rows[0]; if (!r) throw notFound(); return r; });
  });
  app.post('/devices/:id/heartbeat', async (req) => {
    const { id } = req.params as any;
    await adminPool.query(`UPDATE device SET last_seen_at = now(), status = CASE WHEN status = 'OFFLINE' THEN 'ACTIVE' ELSE status END WHERE id = $1 AND company_id = $2`, [id, req.ctx.companyId]);
    return { ok: true };
  });

  // ---------- 审计 ----------
  app.get('/audit', { preHandler: requirePerm('audit.view') }, async (req) => {
    const q = z.object({ table: z.string().optional(), user: z.string().uuid().optional(), row: z.string().uuid().optional(), from: z.string().optional(), to: z.string().optional(), limit: z.coerce.number().max(500).default(100), offset: z.coerce.number().default(0) }).parse(req.query);
    return withCompany(cx(req), async (tx) => (await tx.query(`SELECT a.id, a.at, a.action, a.table_name, a.row_id, a.changed_columns, a.before_json, a.after_json, a.ip, u.name AS user_name FROM audit_log a LEFT JOIN app_user u ON u.id = a.user_id
      WHERE ($1::text IS NULL OR a.table_name = $1) AND ($2::uuid IS NULL OR a.user_id = $2) AND ($3::uuid IS NULL OR a.row_id = $3) AND ($4::timestamptz IS NULL OR a.at >= $4) AND ($5::timestamptz IS NULL OR a.at < $5) ORDER BY a.at DESC LIMIT $6 OFFSET $7`, [q.table ?? null, q.user ?? null, q.row ?? null, q.from ?? null, q.to ?? null, q.limit, q.offset])).rows);
  });

  // ---------- 审批 ----------

  // 工单接口已搬到 routes/tickets.ts（模块 E）
  /** 隔离记录处理 */
  app.get('/sync/quarantine', { preHandler: requirePerm('ticket.manage') }, async (req) => withCompany(cx(req), async (tx) => (await tx.query(`SELECT q.*, u.name AS user_name, d.name AS device_name FROM sync_quarantine q JOIN app_user u ON u.id = q.user_id JOIN device d ON d.id = q.device_id WHERE q.status = 'PENDING' ORDER BY q.created_at`)).rows));
  app.post('/sync/quarantine/:id/discard', { preHandler: requirePerm('ticket.manage') }, async (req) => {
    const { id } = req.params as any;
    return withCompany(cx(req), async (tx) => { await tx.query(`UPDATE sync_quarantine SET status = 'DISCARDED', resolved_by = $2, resolved_at = now() WHERE id = $1`, [id, req.ctx.userId]); await tx.query(`UPDATE ticket SET status = 'CLOSED', resolved_at = now(), resolution = 'discarded' WHERE ref_id = $1`, [id]); return { ok: true }; });
  });
  app.post('/sync/quarantine/:id/retry', { preHandler: requirePerm('ticket.manage') }, async (req) => {
    const { id } = req.params as any;
    const { applyMovement, movementSchema, upsertShelf } = await import('../lib/movements.js');
    return withCompany(cx(req), async (tx) => {
      const q = (await tx.query(`SELECT * FROM sync_quarantine WHERE id = $1 AND status = 'PENDING'`, [id])).rows[0]; if (!q) throw notFound();
      await tx.query(`DELETE FROM sync_applied WHERE entity = $1 AND client_id = $2`, [q.entity, q.client_id]);
      const origCtx = { companyId: req.ctx.companyId, userId: q.user_id, deviceId: q.device_id };
      let sid: string;
      if (q.entity === 'movement') sid = (await applyMovement(tx, origCtx, movementSchema.parse({ ...q.payload, id: q.client_id }))).id;
      else sid = (await upsertShelf(tx, origCtx, { id: q.client_id, ...q.payload })).id;
      await tx.query(`INSERT INTO sync_applied (company_id, entity, client_id, server_id) VALUES ($1,$2,$3,$4)`, [req.ctx.companyId, q.entity, q.client_id, sid]);
      await tx.query(`UPDATE sync_quarantine SET status = 'RETRIED', resolved_by = $2, resolved_at = now() WHERE id = $1`, [id, req.ctx.userId]);
      await tx.query(`UPDATE ticket SET status = 'RESOLVED', resolved_at = now(), resolution = 'retried' WHERE ref_id = $1`, [id]);
      return { ok: true, server_id: sid };
    });
  });

  // 知识库接口已搬到 routes/bot.ts（模块 E）

  // ---------- 公司设定 ----------
  app.get('/company', async (req) => withCompany(cx(req), async (tx) => (await tx.query(`SELECT id, name, short_code, plan, tin, sst_no, msic_code, address, currency, timezone, settings, feature_flags FROM company WHERE id = $1`, [req.ctx.companyId])).rows[0]));
  app.put('/company/settings', { preHandler: requirePerm('settings.edit') }, async (req) => {
    const b = z.object({ settings: z.record(z.any()).optional(), name: z.string().optional(), tin: z.string().optional().nullable(), sst_no: z.string().optional().nullable(), msic_code: z.string().optional().nullable(), address: z.any().optional(), telegram_chat_id: z.string().optional().nullable() }).parse(req.body);
    const allowed = ['order_proposal_time', 'approval_threshold_count_variance', 'approval_threshold_adjust', 'approval_threshold_payment', 'cashier_discount_max_pct', 'pos_terminal_count', 'scale_barcode_format', 'theme', 'pandal_api_url', 'pandal_api_key', 'cash_variance_ticket', 'adjust_daily_limit', 'count_variance_ticket_threshold', 'ap_match_tolerance'];
    const patch: Record<string, any> = {}; for (const k of allowed) if (b.settings?.[k] !== undefined) patch[k] = b.settings[k];
    return withCompany(cx(req), async (tx) => (await tx.query(`UPDATE company SET settings = settings || $2::jsonb, name = COALESCE($3, name), tin = COALESCE($4, tin), sst_no = COALESCE($5, sst_no), msic_code = COALESCE($6, msic_code), address = COALESCE($7, address), telegram_chat_id = COALESCE($8, telegram_chat_id) WHERE id = $1 RETURNING id, name, settings`, [req.ctx.companyId, JSON.stringify(patch), b.name ?? null, b.tin ?? null, b.sst_no ?? null, b.msic_code ?? null, b.address ?? null, b.telegram_chat_id ?? null])).rows[0]);
  });

  // ---------- 超管：公司 ----------
  app.get('/admin/companies', { preHandler: requireSuperAdmin() }, async () => withAdmin(async (tx) => (await tx.query(
    `SELECT c.id, c.name, c.short_code, c.plan, c.is_active, c.created_at, c.feature_flags,
       (SELECT count(*) FROM product p WHERE p.company_id = c.id AND p.is_active) AS products,
       (SELECT count(*) FROM app_user u WHERE u.company_id = c.id AND u.is_active) AS users,
       (SELECT count(*) FROM movement m WHERE m.company_id = c.id AND m.performed_at > now() - interval '7 days') AS movements_7d,
       (SELECT max(last_seen_at) FROM device d WHERE d.company_id = c.id) AS last_device_seen,
       (SELECT count(*) FROM sync_quarantine q WHERE q.company_id = c.id AND q.status = 'PENDING') AS quarantined
     FROM company c ORDER BY c.created_at DESC`)).rows));
  app.post('/admin/companies', { preHandler: requireSuperAdmin() }, async (req, reply) => {
    const b = z.object({ name: z.string().min(1), short_code: z.string().regex(/^[A-Z0-9]{3,8}$/), plan: z.enum(['A', 'B']), tin: z.string().optional().nullable(), sst_no: z.string().optional().nullable(), address: z.any().optional(), boss_name: z.string().min(1), boss_phone: z.string().min(6), boss_email: z.string().email().optional().nullable(), boss_pin: z.string().regex(/^[0-9]{6}$/).optional(), zone_overrides: z.record(z.object({ racks: z.number().int().min(1).max(20), levels: z.number().int().min(1).max(6) })).default({}) }).parse(req.body);
    const pin = b.boss_pin ?? newPin();
    const r = await withAdmin(async (tx) => (await tx.query(`SELECT * FROM create_company_from_template($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [b.name, b.short_code, b.plan, b.tin ?? null, b.sst_no ?? null, b.address ?? null, b.boss_name, b.boss_phone, await hashPin(pin), b.boss_email ?? null, JSON.stringify(b.zone_overrides)])).rows[0]);
    reply.status(201);
    return { company_id: r.o_company_id, site_id: r.o_site_id, boss_user_id: r.o_boss_user_id, boss_badge: `USR:${b.short_code}:${r.o_boss_badge_code}`, boss_pin: pin };
  });
  app.put('/admin/companies/:id', { preHandler: requireSuperAdmin() }, async (req) => {
    const { id } = req.params as any;
    const b = z.object({ is_active: z.boolean().optional(), feature_flags: z.record(z.boolean()).optional(), plan: z.enum(['A', 'B']).optional() }).parse(req.body);
    return withAdmin(async (tx) => (await tx.query(`UPDATE company SET is_active = COALESCE($2, is_active), feature_flags = feature_flags || COALESCE($3::jsonb, '{}'::jsonb), plan = COALESCE($4, plan) WHERE id = $1 RETURNING id, name, plan, is_active, feature_flags`, [id, b.is_active ?? null, b.feature_flags ? JSON.stringify(b.feature_flags) : null, b.plan ?? null])).rows[0]);
  });
  /** 超管切换到某公司操作：签发该公司的令牌 */
  app.post('/admin/companies/:id/enter', { preHandler: requireSuperAdmin() }, async (req) => {
    const { id } = req.params as any;
    const { signToken } = await import('../lib/auth.js');
    const exists = (await adminPool.query(`SELECT 1 FROM company WHERE id = $1`, [id])).rowCount; if (!exists) throw notFound();
    return { access_token: signToken({ uid: req.ctx.userId, cid: id, sid: null, sa: true }) };
  });
  app.get('/admin/sync-monitor', { preHandler: requireSuperAdmin() }, async () => withAdmin(async (tx) => (await tx.query(`SELECT d.id, d.name, d.type, d.status, d.last_seen_at, d.pending_count, d.app_version, c.short_code, (SELECT count(*) FROM sync_quarantine q WHERE q.device_id = d.id AND q.status = 'PENDING') AS quarantined FROM device d JOIN company c ON c.id = d.company_id WHERE d.type IN ('PHONE','POS','KIOSK') ORDER BY d.last_seen_at NULLS FIRST`)).rows));
}
