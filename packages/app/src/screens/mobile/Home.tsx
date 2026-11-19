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
import { Package, ChevronRight, UserCheck } from 'lucide-react';
import { useCustomerCallWatcher } from './Tickets.js';

const ROUTE: Record<string, string | null> = { receive: '/m/receive', putaway: '/m/putaway', refill: '/m/refill', lookup: '/m/lookup', assign_shelf: '/m/assign-shelf', tickets: '/m/tickets', settings: '/m/settings', approvals: '/m/approvals', reports: '/m/reports', count: '/m/count', pick: '/m/pick', my_records: '/m/my-records', pos: '/pos', returns: '/pos/returns', close_day: '/pos/close', count_plan: '/m/count-plan', order_proposals: '/m/orders', purchase_orders: '/w/orders', suppliers: '/w/products?tab=suppliers', ar: '/w/ar', ap: '/w/ap', payments: '/w/ar?tab=payments', month_end: '/w/month-end', delegation: '/m/delegation', adjust: '/m/adjust' };
const NEEDS_NET = new Set(['approvals', 'reports', 'count_plan', 'order_proposals', 'purchase_orders', 'suppliers', 'ar', 'ap', 'payments', 'month_end', 'delegation', 'my_records']);
const GREET: Record<Lang, [string, string]> = { zh: ['早安', '晚安'], ms: ['Selamat pagi', 'Selamat petang'], en: ['Good morning', 'Good evening'] };

export default function Home() {
  const { me, logout, isWeb } = useAuth(); const { t, t2, lang, setLang } = useT(); const nav = useNavigate();
  const [ask, setAsk] = useState(false); const [badges, setBadges] = useState<Record<string, number>>({}); const [online, setOnline] = useState(isOnline()); const [dels, setDels] = useState<any[]>([]);
  useCustomerCallWatcher();
  useEffect(() => subscribe((s) => setOnline(s.online)), []);
  useEffect(() => { (async () => { try { const [low, tk, ap] = await Promise.all([api('/stock/shelf-low'), api('/tickets/mine'), api('/approvals/pending').catch(() => [])]); setBadges({ refill: low.length, tickets: tk.length, approvals: ap.length }); } catch { /* 离线用缓存 */ } try { setDels(await api('/me/delegations')); } catch { /* */ } })(); }, []);
  if (!me) return null;
  const buttons = me.home_buttons.length ? me.home_buttons : [{ screen: 'lookup', icon: 'search', color: '#616161' }];
  const go = (b: any) => { fx.tap(); const r = ROUTE[b.screen]; if (r) nav(r); };
  const now = new Date(); const hour = now.getHours();
  const dateLine = now.toLocaleDateString(lang === 'zh' ? 'zh-CN' : lang === 'ms' ? 'ms-MY' : 'en-MY', { weekday: 'long', month: 'long', day: 'numeric' });
  const roleLine = me.roles.map((r) => (t('role_' + r) === 'role_' + r ? r : t('role_' + r))).join(' · ');
  return (
    <div className="mobile">
      <SyncBars />
      <div className="topstrip">
        <div className="wordmark">{me.company.name}<small>{me.site?.name ?? me.company.short_code} · <span className="dot" style={{ background: online ? 'var(--green)' : 'var(--brass)', verticalAlign: 'middle', marginRight: 4 }} />{online ? t('online') : t('offline')}</small></div>
        <button className="seal" onClick={() => nav('/m/help')} aria-label="help">{(me.site?.name ?? me.company.name).slice(0, 1)}</button>
      </div>
      <div className="hero">
        <div><div className="label">{dateLine}</div><div className="name" style={{ marginTop: 8 }}>{GREET[lang][hour < 14 ? 0 : 1]}，{me.user.name}</div><div className="role">{roleLine}</div></div>
      </div>
      {dels.length > 0 && <div className="deleg-hint" style={{ margin: '10px var(--pad) 0', padding: '10px 14px', border: '1px solid var(--brass)', display: 'flex', gap: 10, alignItems: 'center', fontSize: 'var(--fs-small)' }}><UserCheck size={22} strokeWidth={1.6} /><span>{lang === 'zh' ? `你是 ${dels[0].delegator_name} 的代理，到 ${new Date(dels[0].ends_at).toLocaleDateString('zh-CN')}` : lang === 'ms' ? `Anda wakil ${dels[0].delegator_name} hingga ${new Date(dels[0].ends_at).toLocaleDateString('ms-MY')}` : `You are ${dels[0].delegator_name}'s delegate until ${new Date(dels[0].ends_at).toLocaleDateString('en-MY')}`}</span></div>}
      <div className="brass-rule" />
      <div className="home-grid stagger" data-testid="home-grid">
        {buttons.map((b, i) => {
          const r = ROUTE[b.screen]; const disabled = r === null || (NEEDS_NET.has(b.screen) && !online);
          const zh = t(b.screen) === b.screen ? b.screen : t(b.screen); const ms = t2(b.screen);
          return (
            <div key={b.screen} className={`home-tile ${disabled ? 'disabled' : ''}`} onClick={() => !disabled && go(b)} data-testid={`tile-${b.screen}`}>
              <span className="no">{String(i + 1).padStart(2, '0')}</span>
              <span className="icon"><Icon name={SCREEN_ICON[b.screen] ?? Package} size={30} strokeWidth={1.6} /></span>
              <span className="tt"><div className="zh">{zh}</div><div className="ms">{ms}</div></span>
              {disabled ? <span className="badge soon">{r === null ? t('coming_soon') : t('needs_network')}</span> : badges[b.screen] > 0 ? <span className="badge">{badges[b.screen] > 99 ? '99+' : badges[b.screen]}</span> : null}
              <ChevronRight className="chev" size={22} strokeWidth={1.6} />
            </div>
          );
        })}
      </div>
      {isWeb && <div style={{ padding: '12px var(--pad) 0' }}><button className="btn btn-ghost" style={{ minHeight: 60, fontSize: 17 }} onClick={() => nav('/w/dashboard')}>{t('reports')} · 网页管理</button></div>}
      <div className="bottombar">
        {(['zh', 'ms', 'en'] as Lang[]).map((l) => <button key={l} className={`lang ${lang === l ? 'active' : ''}`} onClick={() => setLang(l)}>{l === 'zh' ? '中文' : l === 'ms' ? 'BM' : 'EN'}</button>)}
        <span style={{ flex: 1 }} />
        <button className="btn btn-back" onClick={() => nav('/m/help')}><Icon name={I.Mic} size={20} strokeWidth={1.6} /> {t('ask_bot')}</button>
        <button className="btn btn-back" onClick={() => setAsk(true)} data-testid="logout"><Icon name={I.LogOut} size={20} strokeWidth={1.6} /> {t('logout')}</button>
      </div>
      {ask && <Confirm msg={t('confirm_logout')} okText={t('logout')} danger onOk={() => void logout()} onCancel={() => setAsk(false)} />}
    </div>
  );
}
