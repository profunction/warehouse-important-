import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { MeResponse } from '@wh/shared';
import { api, tokens, APP_VERSION } from '../api/client.js';
import { clearLocal, start as startSync, pull } from '../offline/sync.js';
import { kvGet, kvSet } from '../offline/db.js';
import { THEME_PRESETS, themeVars } from '@wh/shared';
import { sha256Hex } from '../lib/sha256.js';
export function applyTheme(theme: any) { const v = themeVars(theme); const r = document.documentElement; for (const [k, val] of Object.entries(v)) { if (k === '--btn-h') continue; r.style.setProperty(k, val); } r.style.removeProperty('--btn-h'); r.dataset.density = theme?.density ?? 'normal'; r.dataset.home = (theme?.home ?? 'list'); r.dataset.preset = theme?.preset ?? 'minimal'; r.dataset.nav = theme?.nav ?? (THEME_PRESETS[(theme?.preset ?? 'minimal') as keyof typeof THEME_PRESETS]?.defaults.nav ?? 'side'); }

export interface AuthState { me: MeResponse | null; loading: boolean; offlineUser: { name: string; roles: string[]; home_buttons: any[] } | null }
type Ctx = AuthState & {
  login: (body: any) => Promise<any>; logout: () => Promise<void>; refreshMe: () => Promise<void>; selectSite: (siteId: string) => Promise<void>;
  has: (perm: string) => boolean; isBoss: boolean; isWeb: boolean;
};
const C = createContext<Ctx>(null!);
// http://电脑IP 打开时没有 crypto.subtle，用纯 JS 版本兜底（以前这里会让登录报"PIN 不对"）
const sha = (s: string) => sha256Hex(s);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [offlineUser, setOfflineUser] = useState<AuthState['offlineUser']>(null);
  const refreshMe = useCallback(async () => {
    if (!tokens.access) { setMe(null); return; }
    try { const m = await api<MeResponse>('/me'); setMe(m); await kvSet('me', m); applyTheme((m.company.settings as any)?.theme); if (!tokens.device && !m.user.is_super_admin) { /* 网页登录不登记设备 */ } }
    catch (e: any) { if (e?.status === 401) { tokens.access = null; tokens.refresh = null; setMe(null); } else { const cached = await kvGet<MeResponse | null>('me', null); if (cached) { setMe(cached); applyTheme((cached.company.settings as any)?.theme); } } }
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
