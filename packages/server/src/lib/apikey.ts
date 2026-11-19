// 公司级 API 密钥（开放接口 Pandal）和站点级大屏密钥。格式 wh_<prefix8>.<secret32>，只存 sha256。
import { createHash, randomBytes } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { adminPool } from './db.js';
import { AppError } from './errors.js';

export interface ApiKeyCtx { id: string; companyId: string; siteId: string | null; scope: 'OPEN' | 'KIOSK' | 'POS'; name: string }
declare module 'fastify' { interface FastifyRequest { apiKey?: ApiKeyCtx } }
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
export function generateApiKey() { const prefix = randomBytes(4).toString('hex'); const secret = randomBytes(16).toString('hex'); const key = `wh_${prefix}.${secret}`; return { key, key_prefix: prefix, key_hash: sha(key) }; }
const cache = new Map<string, { at: number; ctx: ApiKeyCtx | null }>();
export async function lookupApiKey(key: string): Promise<ApiKeyCtx | null> {
  const m = key.match(/^wh_([0-9a-f]{8})\.([0-9a-f]{32})$/); if (!m) return null;
  const hit = cache.get(key); if (hit && Date.now() - hit.at < 60_000) return hit.ctx;
  const r = (await adminPool.query(`SELECT id, company_id, site_id, scope, name FROM api_key WHERE key_prefix = $1 AND key_hash = $2 AND is_active`, [m[1], sha(key)])).rows[0];
  const ctx = r ? { id: r.id, companyId: r.company_id, siteId: r.site_id, scope: r.scope, name: r.name } : null;
  cache.set(key, { at: Date.now(), ctx });
  if (r) void adminPool.query(`UPDATE api_key SET last_used_at = now() WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute')`, [r.id]);
  return ctx;
}
/** preHandler：x-api-key 或 Authorization: Bearer wh_… */
export function requireApiKey(...scopes: ApiKeyCtx['scope'][]) {
  return async (req: FastifyRequest) => {
    const h = (req.headers['x-api-key'] as string) || (req.headers.authorization?.startsWith('Bearer wh_') ? req.headers.authorization.slice(7) : '');
    const k = h ? await lookupApiKey(h) : null;
    if (!k) throw new AppError(401, 'API_KEY_INVALID');
    if (!scopes.includes(k.scope)) throw new AppError(403, k.scope === 'KIOSK' ? 'KIOSK_ONLY' : 'FORBIDDEN');
    req.apiKey = k;
  };
}
export function invalidateApiKeyCache() { cache.clear(); }
