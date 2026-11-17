import jwt from 'jsonwebtoken';
import argon2 from 'argon2';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { config } from './config.js';
import { AppError, forbidden, unauthorized } from './errors.js';
import { adminPool, withCompany } from './db.js';

export interface TokenPayload { uid: string; cid: string; sid?: string | null; sa?: boolean; typ: 'access' | 'refresh' }
export interface RequestCtx {
  userId: string; companyId: string; siteId: string | null; isSuperAdmin: boolean;
  deviceId: string | null; roles: string[];
  permissions: Map<string, Record<string, unknown> | null>;
  plan: 'A' | 'B'; lang: 'zh' | 'ms' | 'en'; name: string;
  settings: Record<string, any>;
}
declare module 'fastify' { interface FastifyRequest { ctx: RequestCtx } }

export const hashPin = (pin: string) => argon2.hash(pin, { type: argon2.argon2id });
export const verifyPin = (hash: string, pin: string) => argon2.verify(hash, pin).catch(() => false);
export const signToken = (p: Omit<TokenPayload, 'typ'>, typ: 'access' | 'refresh' = 'access') =>
  jwt.sign({ ...p, typ }, config.jwtSecret, { expiresIn: typ === 'access' ? config.tokenTtlSec : config.refreshTtlSec });
export function verifyToken(t: string): TokenPayload {
  try { return jwt.verify(t, config.jwtSecret) as TokenPayload; } catch { throw unauthorized(); }
}

// 权限缓存 60 秒
const permCache = new Map<string, { at: number; ctx: RequestCtx }>();
export function invalidatePermCache(userId?: string) {
  if (!userId) return permCache.clear();
  for (const k of [...permCache.keys()]) if (k.startsWith(userId + ':')) permCache.delete(k);
}

export async function loadCtx(p: TokenPayload, deviceId: string | null): Promise<RequestCtx> {
  const key = `${p.uid}:${p.cid}:${p.sid ?? ''}`;
  const hit = permCache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return { ...hit.ctx, deviceId };
  const ctx = await withCompany({ companyId: p.cid, userId: p.uid }, async (tx) => {
    const u = (await tx.query(`SELECT u.id, u.name, u.language, u.is_active, u.is_super_admin, c.plan, c.settings FROM app_user u JOIN company c ON c.id = u.company_id WHERE u.id = $1`, [p.uid])).rows[0];
    if (!u) throw unauthorized();
    if (!u.is_active) throw new AppError(401, 'USER_INACTIVE');
    const rows = (await tx.query(
      `SELECT r.code, rp.permission_code, rp.condition FROM user_site_role usr JOIN role r ON r.id = usr.role_id
       LEFT JOIN role_permission rp ON rp.role_id = r.id
       WHERE usr.user_id = $1 AND (usr.site_id IS NULL OR $2::uuid IS NULL OR usr.site_id = $2)`, [p.uid, p.sid ?? null])).rows;
    const permissions = new Map<string, Record<string, unknown> | null>();
    const roles = new Set<string>();
    for (const r of rows) { roles.add(r.code); if (r.permission_code) { const prev = permissions.get(r.permission_code); permissions.set(r.permission_code, prev === null ? null : (r.condition ?? null)); } }
    if (u.is_super_admin) roles.add('SUPER_ADMIN');
    return { userId: u.id, companyId: p.cid, siteId: p.sid ?? null, isSuperAdmin: u.is_super_admin, deviceId, roles: [...roles], permissions, plan: u.plan, lang: u.language, name: u.name, settings: u.settings } as RequestCtx;
  });
  permCache.set(key, { at: Date.now(), ctx });
  return ctx;
}

/** Fastify preHandler：要求登录 */
export async function requireAuth(req: FastifyRequest, _reply: FastifyReply) {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) throw unauthorized();
  const p = verifyToken(h.slice(7));
  if (p.typ !== 'access') throw unauthorized();
  const deviceId = (req.headers['x-device-id'] as string) || null;
  req.ctx = await loadCtx(p, deviceId);
  if (deviceId) {
    // 设备停用检查（轻量，不校验密钥；密钥在 sync 校验）
    const d = (await adminPool.query(`SELECT status FROM device WHERE id = $1 AND company_id = $2`, [deviceId, req.ctx.companyId])).rows[0];
    if (d && d.status === 'DISABLED') throw new AppError(423, 'DEVICE_DISABLED');
  }
}
export function hasPerm(ctx: RequestCtx, code: string) { return ctx.isSuperAdmin ? code !== 'movement.receive' : ctx.permissions.has(code); }
export function permCondition(ctx: RequestCtx, code: string) { return ctx.permissions.get(code) ?? null; }
/** 要求权限（任一） */
export function requirePerm(...codes: string[]) {
  return async (req: FastifyRequest) => {
    if (!req.ctx) throw unauthorized();
    if (req.ctx.isSuperAdmin) return;
    if (!codes.some((c) => req.ctx.permissions.has(c))) throw forbidden({ need: codes });
  };
}
export function requireSuperAdmin() {
  return async (req: FastifyRequest) => { if (!req.ctx?.isSuperAdmin) throw forbidden({ need: ['SUPER_ADMIN'] }); };
}
export const canSeeCost = (ctx: RequestCtx) => ctx.isSuperAdmin || ctx.permissions.has('product.view_cost');
/** 成本字段过滤：所有输出共用 */
export function stripCost<T extends Record<string, any>>(ctx: RequestCtx, row: T): T {
  if (canSeeCost(ctx)) return row;
  const { cost_price, unit_cost, last_cost, ...rest } = row;
  return rest as T;
}
