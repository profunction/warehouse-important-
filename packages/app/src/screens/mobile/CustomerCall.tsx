// S6 顾客呼叫（模块 E）：全屏红、走道和产品照片、"我去"/"别人去"。由 Tickets.tsx 的 useCustomerCallWatcher() 跳进来（?id=工单）。
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useT } from '../../i18n/index.js';
import { Icon, I } from '../../ui/icons.js';
import { api, isOnline } from '../../api/client.js';
import { useAuth } from '../../store/auth.js';
import { fx } from '../../ui/feedback.js';
import { db } from '../../offline/db.js';
import { markCallSeen } from './Tickets.js';

export default function CustomerCall() {
  const { t, n } = useT(); const nav = useNavigate(); const [sp] = useSearchParams(); const { me } = useAuth();
  const id = sp.get('id'); const [tk, setTk] = useState<any>(null); const [prod, setProd] = useState<any>(null); const [err, setErr] = useState(''); const [done, setDone] = useState<'mine' | 'other' | null>(null); const [tick, setTick] = useState(0);
  const load = async () => { if (!id) return; try { const r = await api(`/tickets/${id}`); setTk(r); if (r.ref_type === 'kiosk' && r.ref_id) { const p = await db.product.get(r.ref_id); setProd(p ?? null); } if (r.status !== 'NEW' && r.owner_id !== me?.user.id) setDone('other'); } catch (e: any) { setErr(e?.text ? e.text('zh') : 'error'); } };
  useEffect(() => { void load(); if (id) markCallSeen(id); fx.alert(); const poll = setInterval(() => { if (!done && isOnline()) void load(); setTick((x) => x + 1); }, 5000); return () => clearInterval(poll); }, [id]);
  const go = async () => { if (!id) return; try { await api(`/tickets/${id}/accept`, { method: 'POST' }); fx.done(); setDone('mine'); setTimeout(() => nav('/m/tickets'), 1500); } catch (e: any) { if (e?.status === 409) { setDone('other'); fx.error(); } else setErr(e?.text ? e.text('zh') : 'error'); } };
  const waited = tk?.created_at ? Math.max(0, Math.round((Date.now() - new Date(tk.created_at).getTime()) / 60000)) : 0;
  const aisle = tk?.title?.split('@')[1]?.trim() ?? tk?.events?.[0]?.text ?? '';
  const bg = done === 'mine' ? 'var(--green)' : done === 'other' ? 'var(--muted)' : 'var(--red)';
  return (
    <div className="mobile" style={{ background: bg, color: '#fff', minHeight: '100vh', display: 'flex', flexDirection: 'column', padding: 'var(--pad)', gap: 18 }} data-testid="customer-call">
      <div style={{ fontSize: 15, letterSpacing: '.24em', textTransform: 'uppercase', opacity: .85 }}>{t('cc_title')} {tk ? `#${tk.ticket_no}` : ''}</div>
      <div style={{ fontSize: 34, fontWeight: 700, lineHeight: 1.15 }}>{done === 'mine' ? t('cc_handled') : done === 'other' ? t('cc_someone_took') : t('cc_customer_needs')}</div>
      {err && <div style={{ background: 'rgba(0,0,0,.25)', padding: 12, borderRadius: 10 }}>{err}</div>}
      <div style={{ background: 'rgba(255,255,255,.14)', borderRadius: 16, padding: 16, display: 'flex', gap: 16, alignItems: 'center' }}>
        <div style={{ width: 110, height: 110, borderRadius: 14, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', color: 'var(--muted)', flex: 'none' }}>{prod?.photo_url ? <img src={prod.photo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Icon name={I.Product} size={56} />}</div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, opacity: .8 }}>{t('cc_product')}</div>
          <div style={{ fontSize: 26, fontWeight: 600 }}>{prod ? n(prod) : (tk?.title?.replace(/^顾客找\s*/, '').split('@')[0] ?? '—')}</div>
          <div style={{ fontSize: 14, opacity: .8, marginTop: 8 }}>{t('cc_aisle')}</div>
          <div style={{ fontSize: 36, fontWeight: 800 }}>{aisle || '—'}</div>
        </div>
      </div>
      <div style={{ fontSize: 18, opacity: .9 }}>{t('cc_waiting', { n: waited })}{tk?.owner_name && tk.status !== 'NEW' ? ` · ${t('cc_accepted_by', { name: tk.owner_name })}` : ''}<span style={{ display: 'none' }}>{tick}</span></div>
      <div style={{ flex: 1 }} />
      {!done && <>
        <button className="btn btn-xl" style={{ background: '#fff', color: 'var(--red)', fontWeight: 800, fontSize: 32 }} onClick={go} data-testid="cc-go"><Icon name={I.Check} size={34} /> {t('cc_i_go')}</button>
        <button className="btn btn-xl" style={{ background: 'rgba(255,255,255,.18)', color: '#fff' }} onClick={() => { if (id) markCallSeen(id, true); nav(-1); }}>{t('cc_someone_else')}</button>
      </>}
      {done && <button className="btn btn-xl" style={{ background: '#fff', color: 'var(--fg)' }} onClick={() => nav('/m/tickets')}>{t('ok')}</button>}
    </div>
  );
}
