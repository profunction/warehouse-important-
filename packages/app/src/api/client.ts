// API 客户端：令牌、刷新、设备头、三语错误
import { msg, type Lang } from '@wh/shared';
export class ApiError extends Error {
  constructor(public status: number, public code: string, public body: any) { super(code); }
  text(lang: Lang) { return this.body?.[`message_${lang}`] ?? msg(this.code, lang); }
}
const LS = { access: 'wh.access', refresh: 'wh.refresh', device: 'wh.device' };
export const tokens = {
  get access() { return localStorage.getItem(LS.access); }, set access(v: string | null) { v ? localStorage.setItem(LS.access, v) : localStorage.removeItem(LS.access); },
  get refresh() { return localStorage.getItem(LS.refresh); }, set refresh(v: string | null) { v ? localStorage.setItem(LS.refresh, v) : localStorage.removeItem(LS.refresh); },
  get device() { return localStorage.getItem(LS.device); }, set device(v: string | null) { v ? localStorage.setItem(LS.device, v) : localStorage.removeItem(LS.device); },
};
export const APP_VERSION = '0.1.0';
let refreshing: Promise<boolean> | null = null;
async function tryRefresh(): Promise<boolean> {
  if (!tokens.refresh) return false;
  refreshing ??= fetch('/api/v1/auth/refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: tokens.refresh }) })
    .then(async (r) => { if (!r.ok) return false; const j = await r.json(); tokens.access = j.access_token; tokens.refresh = j.refresh_token; return true; })
    .catch(() => false).finally(() => (refreshing = null));
  return refreshing;
}
export interface ReqOpts { method?: string; body?: any; raw?: boolean; headers?: Record<string, string>; auth?: boolean; timeoutMs?: number }
export async function api<T = any>(path: string, opts: ReqOpts = {}): Promise<T> {
  const doFetch = async () => {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (opts.auth !== false && tokens.access) headers.authorization = `Bearer ${tokens.access}`;
    if (tokens.device) headers['x-device-id'] = tokens.device;
    let body: any = opts.body;
    if (body && !(body instanceof FormData)) { headers['content-type'] = 'application/json'; body = JSON.stringify(body); }
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 30000);
    try { return await fetch('/api/v1' + path, { method: opts.method ?? (body ? 'POST' : 'GET'), headers, body, signal: ctrl.signal }); } finally { clearTimeout(t); }
  };
  let r = await doFetch();
  if (r.status === 401 && opts.auth !== false && (await tryRefresh())) r = await doFetch();
  if (!r.ok) {
    let j: any = {}; try { j = await r.json(); } catch { /* 非 JSON */ }
    if (r.status === 401) { window.dispatchEvent(new CustomEvent('wh:unauthorized', { detail: j })); }
    if (r.status === 423 && j.code === 'DEVICE_DISABLED') window.dispatchEvent(new CustomEvent('wh:device-disabled'));
    throw new ApiError(r.status, j.code ?? (r.status === 0 ? 'NETWORK' : 'INTERNAL'), j);
  }
  if (opts.raw) return r as any;
  return r.status === 204 ? (undefined as any) : r.json();
}
export const isOnline = () => navigator.onLine;
