import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { MeResponse } from '@wh/shared';
import { api, tokens, APP_VERSION } from '../api/client.js';
import { clearLocal, start as startSync, pull } from '../offline/sync.js';
import { kvGet, kvSet } from '../offline/db.js';

export interface AuthState { me: MeResponse | null; loading: boolean; offlineUser: { name: string; roles: string[]; home_buttons: any[] } | null }
type Ctx = AuthState & {
  login: (body: any) => Promise<any>; logout: () => Promise<void>; refreshMe: () => Promise<void>; selectSite: (siteId: string) => Promise<void>;
  has: (perm: string) => boolean; isBoss: boolean; isWeb: boolean;
};
const C = createContext<Ctx>(null!);
async function sha(s: string) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join(''); }

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [offlineUser, setOfflineUser] = useState<AuthState['offlineUser']>(null);
  const refreshMe = useCallback(async () => {
    if (!tokens.access) { setMe(null); return; }
    try { const m = await api<MeResponse>('/me'); setMe(m); await kvSet('me', m); if (!tokens.device && !m.user.is_super_admin) { /* 网页登录不登记设备 */ } }
    catch (e: any) { if (e?.status === 401) { tokens.access = null; tokens.refresh = null; setMe(null); } else { const cached = await kvGet<MeResponse | null>('me', null); if (cached) setMe(cached); } }
  }, []);
  useEffect(() => { (async () => { await refreshMe(); setLoading(false); if (tokens.access) void startSync(); })(); }, [refreshMe]);
  useEffect(() => {
    const onUnauth = () => { tokens.access = null; tokens.refresh = null; setMe(null); };
    window.addEventListener('wh:unauthorized', onUnauth); return () => window.removeEventListener('wh:unauthorized', onUnauth);
  }, []);
  const login = useCallback(async (body: any) => {
    const isMobile = !body.email;
    const device = isMobile ? { id: tokens.device ?? undefined, name: `${navigator.platform || 'phone'} ${new Date().toISOString().slice(0, 10)}`, type: 'PHONE', app_version: APP_VERSION } : undefined;
    try {
      const r = await api('/auth/login', { body: { ...body, device }, auth: false });
      tokens.access = r.access_token; tokens.refresh = r.refresh_token; if (r.device_id) tokens.device = r.device_id;
      // 离线登录凭据：7 天
      if (isMobile) await kvSet(`offline.cred.${await sha((body.badge ?? body.phone) + ':' + (body.company_code ?? ''))}`, { pinHash: await sha(body.pin + ':' + r.user.id), userId: r.user.id, at: Date.now(), access: r.access_token, refresh: r.refresh_token });
      await refreshMe(); void startSync(); void pull(true);
      return r;
    } catch (e: any) {
      if (e?.code === 'NETWORK' || e?.status === 0 || !navigator.onLine) {
        const cred = await kvGet<any>(`offline.cred.${await sha((body.badge ?? body.phone) + ':' + (body.company_code ?? ''))}`, null);
        if (cred && Date.now() - cred.at < 7 * 86400_000 && cred.pinHash === await sha(body.pin + ':' + cred.userId)) {
          tokens.access = cred.access; tokens.refresh = cred.refresh; const cached = await kvGet<MeResponse | null>('me', null); if (cached) setMe(cached); return { offline: true };
        }
      }
      throw e;
    }
  }, [refreshMe]);
  const logout = useCallback(async () => { try { await api('/auth/logout', { method: 'POST' }); } catch { /* 离线也能退出 */ } tokens.access = null; tokens.refresh = null; setMe(null); }, []);
  const selectSite = useCallback(async (siteId: string) => { const r = await api('/auth/select-site', { body: { site_id: siteId } }); tokens.access = r.access_token; await refreshMe(); await clearLocal(); await kvSet('sync.cursor', ''); void pull(true); }, [refreshMe]);
  const v = useMemo<Ctx>(() => ({
    me, loading, offlineUser, login, logout, refreshMe, selectSite,
    has: (p) => !!me && (me.user.is_super_admin || p in me.permissions),
    isBoss: !!me?.roles.includes('BOSS'), isWeb: !!me && (me.user.is_super_admin || me.roles.some((r) => ['BOSS', 'MANAGER', 'PURCHASER', 'ACCOUNTS', 'SUPER_ADMIN'].includes(r))),
  }), [me, loading, offlineUser, login, logout, refreshMe, selectSite]);
  return <C.Provider value={v}>{children}</C.Provider>;
}
export const useAuth = () => useContext(C);
