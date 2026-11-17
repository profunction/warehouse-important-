import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../store/auth.js';
import { useT } from '../../i18n/index.js';
import { Confirm, SyncBars } from '../../ui/Shell.js';
import { fx } from '../../ui/feedback.js';
import { api, isOnline } from '../../api/client.js';
import { subscribe } from '../../offline/sync.js';
import type { Lang } from '@wh/shared';
import { Icon, I, SCREEN_ICON } from '../../ui/icons.js';
import { Package } from 'lucide-react';

const ROUTE: Record<string, string | null> = { receive: '/m/receive', putaway: '/m/putaway', refill: '/m/refill', lookup: '/m/lookup', assign_shelf: '/m/assign-shelf', tickets: '/m/tickets', settings: '/m/settings', approvals: '/w/approvals', reports: '/w/dashboard', count: null, pick: null, my_records: null, pos: null, returns: null, close_day: null };
const NEEDS_NET = new Set(['approvals', 'reports']);
export default function Home() {
  const { me, logout, isWeb } = useAuth(); const { t, lang, setLang } = useT(); const nav = useNavigate();
  const [ask, setAsk] = useState(false); const [badges, setBadges] = useState<Record<string, number>>({}); const [online, setOnline] = useState(isOnline());
  useEffect(() => subscribe((s) => setOnline(s.online)), []);
  useEffect(() => { (async () => { try { const [low, tk] = await Promise.all([api('/stock/shelf-low'), api('/tickets/mine')]); setBadges({ refill: low.length, tickets: tk.length }); } catch { /* 离线用缓存 */ } })(); }, []);
  if (!me) return null;
  const buttons = me.home_buttons.length ? me.home_buttons : [{ screen: 'lookup', icon: 'search', color: '#616161' }];
  const go = (b: any) => { fx.tap(); const r = ROUTE[b.screen]; if (r) nav(r); };
  return (
    <div className="mobile">
      <SyncBars />
      <div className="topbar"><span className={`dot ${online ? 'live' : ''}`} style={{ background: online ? 'var(--green)' : 'var(--amber-500)' }} /> <span style={{ color: 'var(--muted)' }}>{online ? t('online') : t('offline')}</span><div className="title">{me.site?.name ?? me.company.name}</div><button className="btn btn-back" onClick={() => nav('/m/help')} aria-label="help"><Icon name={I.Help} size={24} /></button></div>
      <div className="hero"><div><div className="name">{t('hello')}，{me.user.name}</div><div className="role">{me.roles.map((r) => t('role_' + r) === 'role_' + r ? r : t('role_' + r)).join(' · ')}</div></div><div className="avatar" style={{ marginLeft: 'auto' }}>{me.user.name.slice(0, 1)}</div></div>
      <div className="home-grid stagger" data-testid="home-grid">
        {buttons.map((b) => {
          const r = ROUTE[b.screen]; const disabled = r === null || (NEEDS_NET.has(b.screen) && !online);
          return (
            <div key={b.screen} className={`home-tile ${disabled ? 'disabled' : ''}`} style={{ ['--tile' as any]: b.color }} onClick={() => !disabled && go(b)} data-testid={`tile-${b.screen}`}>
              <div className="icon"><Icon name={SCREEN_ICON[b.screen] ?? Package} size={40} /></div><div>{t(b.screen) === b.screen ? b.screen : t(b.screen)}</div>
              {disabled && <div className="badge soon">{r === null ? t('coming_soon') : t('needs_network')}</div>}
              {!disabled && badges[b.screen] > 0 && <div className="badge">{badges[b.screen] > 99 ? '99+' : badges[b.screen]}</div>}
            </div>
          );
        })}
      </div>
      {isWeb && <div style={{ padding: '0 16px' }}><button className="btn btn-secondary" onClick={() => nav('/w/dashboard')}>{t('reports')} / 网页管理</button></div>}
      <div className="bottombar">
        {(['zh', 'ms', 'en'] as Lang[]).map((l) => <button key={l} className={`lang ${lang === l ? 'active' : ''}`} onClick={() => setLang(l)}>{l === 'zh' ? '中' : l === 'ms' ? 'BM' : 'EN'}</button>)}
        <span style={{ flex: 1 }} />
        <button className="btn btn-back" onClick={() => nav('/m/help')}><Icon name={I.Mic} size={22} /> {t('ask_bot')}</button>
        <button className="btn btn-back" onClick={() => setAsk(true)} data-testid="logout"><Icon name={I.LogOut} size={22} /> {t('logout')}</button>
      </div>
      {ask && <Confirm msg={t('confirm_logout')} okText={t('logout')} danger onOk={() => void logout()} onCancel={() => setAsk(false)} />}
    </div>
  );
}
