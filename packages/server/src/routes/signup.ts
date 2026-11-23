// 自助申请（不用登录）：
//  1. 开新店：填店名、老板名字、手机、PIN → 直接建公司（小店或中型模板），返回公司代码，马上能登录。环境变量 SIGNUP_MODE=off 关闭。
//  2. 员工申请加入：填公司代码、名字、手机、想做的岗位、PIN → 建一条待批申请，通知老板；老板在"用户管理"批准后才建账号。
// 防滥用：按 IP 限速（开店每小时 5 次，申请加入每小时 20 次）；只给一线岗位，老板、经理、会计不能自己申请。
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomInt } from 'node:crypto';
import { adminPool, withAdmin, withCompany } from '../lib/db.js';
import { hashPin, requireAuth, requirePerm } from '../lib/auth.js';
import { AppError, notFound } from '../lib/errors.js';
import { tgSend } from '../lib/telegram.js';

const SELF_ROLES: Record<'A' | 'B', string[]> = { A: ['WAREHOUSE', 'CASHIER'], B: ['WAREHOUSE', 'CASHIER', 'STOCKER', 'COUNTER'] };
const ROLE_ZH: Record<string, string> = { WAREHOUSE: '库存员', CASHIER: '收银员', STOCKER: '上架员', COUNTER: '盘点员' };
const pinSchema = z.string().regex(/^[0-9]{6}$/);
const phoneSchema = z.string().transform((s) => s.replace(/[\s-]/g, '')).pipe(z.string().regex(/^\+?[0-9]{8,15}$/));
const limit = (max: number) => ({ config: { rateLimit: process.env.NODE_ENV === 'test' ? false : { max, timeWindow: '1 hour' } } });
/** 公司代码：店名里的英文字母取前 4 个 + 3 位数字，没有英文就 SHOP + 4 位数字 */
const codeFrom = (name: string) => { const letters = name.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4); return letters.length >= 2 ? `${letters}${randomInt(100, 1000)}` : `SHOP${randomInt(1000, 10000)}`; };

export async function signupRoutes(app: FastifyInstance) {
  app.get('/signup/config', async () => ({ open: (process.env.SIGNUP_MODE ?? 'open') !== 'off', self_roles: SELF_ROLES }));

  app.post('/signup/company', limit(5), async (req, reply) => {
    if ((process.env.SIGNUP_MODE ?? 'open') === 'off') throw new AppError(403, 'FEATURE_DISABLED');
    const b = z.object({ shop_name: z.string().trim().min(2).max(80), boss_name: z.string().trim().min(1).max(60), phone: phoneSchema, email: z.string().email().optional().nullable(), pin: pinSchema, plan: z.enum(['A', 'B']).default('A'), short_code: z.string().regex(/^[A-Z0-9]{3,8}$/).optional() }).parse(req.body);
    const pinHash = await hashPin(b.pin);
    for (let i = 0; i < 6; i++) {
      const code = i === 0 && b.short_code ? b.short_code : codeFrom(b.shop_name);
      try {
        const r = await withAdmin(async (tx) => (await tx.query(`SELECT * FROM create_company_from_template($1,$2,$3,NULL,NULL,NULL,$4,$5,$6,$7,'{}'::jsonb)`, [b.shop_name, code, b.plan, b.boss_name, b.phone, pinHash, b.email ?? null])).rows[0]);
        await adminPool.query(`UPDATE company SET settings = settings || jsonb_build_object('signup', jsonb_build_object('at', now(), 'ip', $2::text, 'trial', true)) WHERE id = $1`, [r.o_company_id, req.ip]);
        reply.status(201);
        return { company_code: code, company_id: r.o_company_id, shop_name: b.shop_name, plan: b.plan };
      } catch (e: any) {
        if (e?.code === '23505' && String(e.detail ?? e.message).includes('short_code')) { if (i === 0 && b.short_code) throw new AppError(409, 'DUPLICATE', 'short_code'); continue; }
        if (e?.code === '23505') throw new AppError(409, 'DUPLICATE', e.detail);
        throw e;
      }
    }
    throw new AppError(409, 'DUPLICATE', 'short_code');
  });

  /** 申请加入前先确认公司代码对不对：只回店名和可申请的岗位 */
  app.get('/signup/company/:code', limit(60), async (req) => {
    const code = String((req.params as any).code ?? '').toUpperCase();
    const c = (await adminPool.query(`SELECT name, plan FROM company WHERE short_code = $1 AND is_active`, [code])).rows[0];
    if (!c) throw notFound();
    return { name: c.name, roles: SELF_ROLES[c.plan as 'A' | 'B'] };
  });

  app.post('/signup/join', limit(20), async (req, reply) => {
    const b = z.object({ company_code: z.string().transform((s) => s.trim().toUpperCase()), name: z.string().trim().min(1).max(60), phone: phoneSchema, pin: pinSchema, role_code: z.string(), language: z.enum(['zh', 'ms', 'en']).default('zh'), note: z.string().max(200).optional() }).parse(req.body);
    const c = (await adminPool.query(`SELECT id, plan FROM company WHERE short_code = $1 AND is_active`, [b.company_code])).rows[0];
    if (!c) throw notFound();
    if (!SELF_ROLES[c.plan as 'A' | 'B'].includes(b.role_code)) throw new AppError(400, 'VALIDATION', 'role_code');
    if ((await adminPool.query(`SELECT 1 FROM app_user WHERE company_id = $1 AND phone = $2`, [c.id, b.phone])).rowCount) throw new AppError(409, 'DUPLICATE', 'phone');
    try {
      const r = (await adminPool.query(`INSERT INTO staff_join_request (company_id, name, phone, language, role_code, pin_hash, note, ip) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, created_at`, [c.id, b.name, b.phone, b.language, b.role_code, await hashPin(b.pin), b.note ?? null, req.ip])).rows[0];
      void tgSend(c.id, `<b>新员工申请加入</b>\n${b.name} · ${b.phone}\n岗位：${ROLE_ZH[b.role_code] ?? b.role_code}${b.note ? `\n备注：${b.note}` : ''}\n请到网页"用户管理"批准或拒绝`, undefined, { type: 'STAFF_JOIN', refType: 'staff_join_request', refId: r.id });
      reply.status(201); return { id: r.id, status: 'PENDING' };
    } catch (e: any) { if (e?.code === '23505') throw new AppError(409, 'DUPLICATE', 'pending'); throw e; }
  });

  /** 申请人查状态（用公司代码 + 手机） */
  app.get('/signup/join/status', limit(60), async (req) => {
    const q = z.object({ company_code: z.string().transform((s) => s.trim().toUpperCase()), phone: phoneSchema }).parse(req.query);
    const r = (await adminPool.query(`SELECT r.status, r.created_at, r.decided_at FROM staff_join_request r JOIN company c ON c.id = r.company_id WHERE c.short_code = $1 AND r.phone = $2 ORDER BY r.created_at DESC LIMIT 1`, [q.company_code, q.phone])).rows[0];
    if (!r) throw notFound();
    return r;
  });

  // ---------- 老板批准 ----------
  app.register(async (a) => {
    a.addHook('preHandler', requireAuth);
    const cx = (req: any) => ({ companyId: req.ctx.companyId, userId: req.ctx.userId, deviceId: req.ctx.deviceId });
    a.get('/join-requests', { preHandler: requirePerm('user.manage') }, async (req) => {
      const q = z.object({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional() }).parse(req.query);
      return withCompany(cx(req), async (tx) => (await tx.query(`SELECT r.id, r.name, r.phone, r.language, r.role_code, r.note, r.status, r.created_at, r.decided_at, u.name AS decided_by_name FROM staff_join_request r LEFT JOIN app_user u ON u.id = r.decided_by WHERE ($1::text IS NULL OR r.status = $1) ORDER BY r.created_at DESC LIMIT 100`, [q.status ?? 'PENDING'])).rows);
    });
    a.post('/join-requests/:id/approve', { preHandler: requirePerm('user.manage') }, async (req) => {
      const { id } = req.params as any;
      const b = z.object({ role_code: z.string().optional(), site_id: z.string().uuid().optional().nullable() }).parse(req.body ?? {});
      return withCompany(cx(req), async (tx) => {
        const r = (await tx.query(`SELECT * FROM staff_join_request WHERE id = $1 FOR UPDATE`, [id])).rows[0];
        if (!r) throw notFound(); if (r.status !== 'PENDING') throw new AppError(409, 'APPROVAL_NOT_PENDING');
        const roleCode = b.role_code ?? r.role_code;
        if (['BOSS', 'SUPER_ADMIN'].includes(roleCode)) throw new AppError(400, 'VALIDATION', 'role_code');
        const role = (await tx.query(`SELECT id FROM role WHERE company_id = $1 AND code = $2`, [req.ctx.companyId, roleCode])).rows[0]; if (!role) throw notFound();
        const site = b.site_id ?? req.ctx.siteId ?? (await tx.query(`SELECT id FROM site WHERE is_active ORDER BY code LIMIT 1`)).rows[0]?.id ?? null;
        let u;
        try { u = (await tx.query(`INSERT INTO app_user (company_id, name, phone, language, pin_hash) VALUES ($1,$2,$3,$4,$5) RETURNING id, name, badge_code`, [req.ctx.companyId, r.name, r.phone, r.language, r.pin_hash])).rows[0]; }
        catch (e: any) { if (e?.code === '23505') throw new AppError(409, 'DUPLICATE', 'phone'); throw e; }
        await tx.query(`INSERT INTO user_site_role (company_id, user_id, site_id, role_id) VALUES ($1,$2,$3,$4)`, [req.ctx.companyId, u.id, site, role.id]);
        await tx.query(`UPDATE staff_join_request SET status = 'APPROVED', decided_by = $2, decided_at = now(), user_id = $3, role_code = $4 WHERE id = $1`, [id, req.ctx.userId, u.id, roleCode]);
        return { ok: true, user: u };
      });
    });
    a.post('/join-requests/:id/reject', { preHandler: requirePerm('user.manage') }, async (req) => {
      const { id } = req.params as any; const b = z.object({ note: z.string().max(200).optional() }).parse(req.body ?? {});
      return withCompany(cx(req), async (tx) => {
        const r = (await tx.query(`UPDATE staff_join_request SET status = 'REJECTED', decided_by = $2, decided_at = now(), decision_note = $3 WHERE id = $1 AND status = 'PENDING' RETURNING id`, [id, req.ctx.userId, b.note ?? null])).rows[0];
        if (!r) throw new AppError(409, 'APPROVAL_NOT_PENDING'); return { ok: true };
      });
    });
  });
}
