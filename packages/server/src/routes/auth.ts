import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { adminPool, withCompany } from '../lib/db.js';
import { AppError, badRequest, unauthorized } from '../lib/errors.js';
import { hashPin, invalidatePermCache, loadCtx, requireAuth, signToken, verifyPin, verifyToken } from '../lib/auth.js';
import { randomInt } from 'node:crypto';

const loginSchema = z.object({
  badge: z.string().optional(),          // 员工卡二维码内容 USR:<company_short>:<badge_code>
  company_code: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  pin: z.string().min(4).max(12),
  device: z.object({ id: z.string().uuid().optional(), name: z.string(), type: z.string().default('PHONE'), app_version: z.string().optional() }).optional(),
});

async function findUser(body: z.infer<typeof loginSchema>) {
  let companyCode = body.company_code;
  let badge: string | undefined;
  if (body.badge) {
    const m = body.badge.match(/^USR:([A-Z0-9]+):([0-9a-f]+)$/i);
    if (!m) throw new AppError(401, 'USER_NOT_FOUND');
    companyCode = m[1].toUpperCase(); badge = m[2];
  }
  if (body.email) {
    return (await adminPool.query(`SELECT u.*, c.short_code, c.plan FROM app_user u JOIN company c ON c.id = u.company_id WHERE lower(u.email) = lower($1)`, [body.email])).rows[0];
  }
  if (!companyCode) throw badRequest('VALIDATION', 'company_code required');
  const params = [companyCode, badge ?? null, body.phone ?? null];
  return (await adminPool.query(
    `SELECT u.*, c.short_code, c.plan FROM app_user u JOIN company c ON c.id = u.company_id
     WHERE c.short_code = $1 AND (($2::text IS NOT NULL AND u.badge_code = $2) OR ($3::text IS NOT NULL AND u.phone = $3))`, params)).rows[0];
}

async function sitesFor(userId: string, companyId: string) {
  return withCompany({ companyId, userId }, async (tx) => (await tx.query(
    `SELECT s.id, s.code, s.name, s.type, array_agg(DISTINCT r.code) AS roles
     FROM site s JOIN user_site_role usr ON (usr.site_id = s.id OR usr.site_id IS NULL) AND usr.user_id = $1
     JOIN role r ON r.id = usr.role_id WHERE s.company_id = $2 AND s.is_active GROUP BY s.id ORDER BY s.code`, [userId, companyId])).rows);
}

export async function authRoutes(app: FastifyInstance) {
  app.post('/auth/login', { config: { rateLimit: process.env.NODE_ENV === 'test' ? false : { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = loginSchema.parse(req.body);
    const u = await findUser(body);
    if (!u) throw new AppError(401, 'USER_NOT_FOUND');
    if (!u.is_active) throw new AppError(401, 'USER_INACTIVE');
    if (u.pin_locked_until && new Date(u.pin_locked_until) > new Date()) throw new AppError(423, 'PIN_LOCKED');
    const okPin = await verifyPin(u.pin_hash, body.pin);
    if (!okPin) {
      const failed = u.pin_failed_count + 1;
      await adminPool.query(`UPDATE app_user SET pin_failed_count = $2::int, pin_locked_until = CASE WHEN $2::int >= 5 THEN now() + interval '15 minutes' END WHERE id = $1`, [u.id, failed]);
      throw new AppError(failed >= 5 ? 423 : 401, failed >= 5 ? 'PIN_LOCKED' : 'PIN_WRONG');
    }
    await adminPool.query(`UPDATE app_user SET pin_failed_count = 0, pin_locked_until = NULL WHERE id = $1`, [u.id]);
    await adminPool.query(`INSERT INTO audit_log (company_id, user_id, action, table_name, row_id, ip) VALUES ($1,$2,'LOGIN','app_user',$2,$3)`, [u.company_id, u.id, req.ip]);
    // 设备登记（手机首次登录）
    let deviceId: string | null = null;
    if (body.device) {
      const d = body.device;
      if (d.id) {
        const r = await adminPool.query(`UPDATE device SET last_seen_at = now(), app_version = COALESCE($3, app_version), status = CASE WHEN status='OFFLINE' THEN 'ACTIVE' ELSE status END WHERE id = $1 AND company_id = $2 RETURNING id, status`, [d.id, u.company_id, d.app_version ?? null]);
        if (r.rows[0]?.status === 'DISABLED') throw new AppError(423, 'DEVICE_DISABLED');
        deviceId = r.rows[0]?.id ?? null;
      }
      if (!deviceId) {
        const r = await adminPool.query(`INSERT INTO device (company_id, type, name, app_version, last_seen_at, created_by) VALUES ($1,$2,$3,$4,now(),$5) RETURNING id`, [u.company_id, d.type, d.name, d.app_version ?? null, u.id]);
        deviceId = r.rows[0].id;
      }
    }
    const sites = await sitesFor(u.id, u.company_id);
    const sid = sites.length === 1 ? sites[0].id : null;
    const access = signToken({ uid: u.id, cid: u.company_id, sid, sa: u.is_super_admin });
    const refresh = signToken({ uid: u.id, cid: u.company_id, sid, sa: u.is_super_admin }, 'refresh');
    return reply.send({ access_token: access, refresh_token: refresh, device_id: deviceId, sites, needs_site_selection: sites.length > 1, user: { id: u.id, name: u.name, language: u.language, font_scale: u.font_scale, is_super_admin: u.is_super_admin }, company: { id: u.company_id, short_code: u.short_code, plan: u.plan } });
  });

  app.post('/auth/refresh', async (req) => {
    const { refresh_token } = z.object({ refresh_token: z.string() }).parse(req.body);
    const p = verifyToken(refresh_token);
    if (p.typ !== 'refresh') throw unauthorized();
    const u = (await adminPool.query(`SELECT is_active FROM app_user WHERE id = $1`, [p.uid])).rows[0];
    if (!u?.is_active) throw new AppError(401, 'USER_INACTIVE');
    return { access_token: signToken({ uid: p.uid, cid: p.cid, sid: p.sid, sa: p.sa }), refresh_token: signToken({ uid: p.uid, cid: p.cid, sid: p.sid, sa: p.sa }, 'refresh') };
  });

  app.post('/auth/select-site', { preHandler: requireAuth }, async (req) => {
    const { site_id } = z.object({ site_id: z.string().uuid() }).parse(req.body);
    const sites = await sitesFor(req.ctx.userId, req.ctx.companyId);
    if (!sites.some((s) => s.id === site_id)) throw new AppError(403, 'FORBIDDEN');
    invalidatePermCache(req.ctx.userId);
    return { access_token: signToken({ uid: req.ctx.userId, cid: req.ctx.companyId, sid: site_id, sa: req.ctx.isSuperAdmin }) };
  });

  app.get('/me', { preHandler: requireAuth }, async (req) => {
    const ctx = req.ctx;
    return withCompany({ companyId: ctx.companyId, userId: ctx.userId }, async (tx) => {
      const u = (await adminPool.query(`SELECT id, name, language, font_scale, photo_url, is_super_admin, badge_code FROM app_user WHERE id = $1`, [ctx.userId])).rows[0];
      const c = (await tx.query(`SELECT id, name, short_code, plan, settings, feature_flags FROM company WHERE id = $1`, [ctx.companyId])).rows[0];
      const site = ctx.siteId ? (await tx.query(`SELECT id, code, name, type FROM site WHERE id = $1`, [ctx.siteId])).rows[0] : null;
      const sites = await sitesFor(ctx.userId, ctx.companyId);
      // 首页按钮：取该站点第一个角色的按钮（多角色时合并去重，最多 4）
      const btnRows = (await tx.query(`SELECT r.home_buttons FROM user_site_role usr JOIN role r ON r.id = usr.role_id WHERE usr.user_id = $1 AND (usr.site_id IS NULL OR $2::uuid IS NULL OR usr.site_id = $2) ORDER BY r.code`, [ctx.userId, ctx.siteId])).rows;
      const seen = new Set<string>(); const home_buttons: any[] = [];
      for (const r of btnRows) for (const b of r.home_buttons) if (!seen.has(b.screen) && home_buttons.length < 4) { seen.add(b.screen); home_buttons.push(b); }
      const permissions: Record<string, any> = {}; for (const [k, v] of ctx.permissions) permissions[k] = v;
      return { user: u, company: c, site, sites, roles: ctx.roles, permissions, home_buttons };
    });
  });

  app.put('/me/preferences', { preHandler: requireAuth }, async (req) => {
    const b = z.object({ language: z.enum(['zh', 'ms', 'en']).optional(), font_scale: z.number().optional() }).parse(req.body);
    await withCompany({ companyId: req.ctx.companyId, userId: req.ctx.userId }, (tx) => tx.query(`UPDATE app_user SET language = COALESCE($2, language), font_scale = COALESCE($3, font_scale) WHERE id = $1`, [req.ctx.userId, b.language ?? null, b.font_scale ?? null]));
    invalidatePermCache(req.ctx.userId);
    return { ok: true };
  });

  app.post('/auth/change-pin', { preHandler: requireAuth }, async (req) => {
    const b = z.object({ old_pin: z.string(), new_pin: z.string().regex(/^[0-9]{6}$/) }).parse(req.body);
    const u = (await adminPool.query(`SELECT pin_hash FROM app_user WHERE id = $1`, [req.ctx.userId])).rows[0];
    if (!(await verifyPin(u.pin_hash, b.old_pin))) throw new AppError(401, 'PIN_WRONG');
    await adminPool.query(`UPDATE app_user SET pin_hash = $2 WHERE id = $1`, [req.ctx.userId, await hashPin(b.new_pin)]);
    return { ok: true };
  });

  app.post('/auth/logout', { preHandler: requireAuth }, async (req) => {
    await adminPool.query(`INSERT INTO audit_log (company_id, user_id, action, table_name, row_id) VALUES ($1,$2,'LOGOUT','app_user',$2)`, [req.ctx.companyId, req.ctx.userId]);
    return { ok: true };
  });
}
export const newPin = () => String(randomInt(0, 1_000_000)).padStart(6, '0');
