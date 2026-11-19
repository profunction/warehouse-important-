// O5 代理设定：选人 → 范围多选 → 起止、金额上限 → 确认；列出当前代理可撤销；显示「你是 X 的代理」。需要网络。
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '../../i18n/index.js';
import { Icon, I } from '../../ui/icons.js';
import { useAuth } from '../../store/auth.js';
import { Confirm, DoneScreen, ErrorScreen, Page, TopBar } from '../../ui/Shell.js';
import { api, ApiError } from '../../api/client.js';
import { fx } from '../../ui/feedback.js';

const SCOPES = ['ORDER', 'COUNT_VARIANCE', 'RETURN', 'ADJUST', 'TRANSFER', 'PAYMENT', 'IMPORT', 'PRICE_CHANGE'];
const day = (d: Date) => d.toISOString().slice(0, 10);
export default function Delegation() {
  const { t, lang } = useT(); const { me } = useAuth(); const nav = useNavigate();
  const [list, setList] = useState<any[]>([]); const [mine, setMine] = useState<any[]>([]); const [people, setPeople] = useState<any[]>([]);
  const [step, setStep] = useState<'list' | 'who' | 'scope' | 'done'>('list'); const [person, setPerson] = useState<any | null>(null); const [scope, setScope] = useState<string[]>([]);
  const [from, setFrom] = useState(day(new Date())); const [to, setTo] = useState(day(new Date(Date.now() + 7 * 86400_000))); const [perItem, setPerItem] = useState(''); const [daily, setDaily] = useState(''); const [standby, setStandby] = useState(false);
  const [err, setErr] = useState<string | null>(null); const [revoke, setRevoke] = useState<any | null>(null); const [busy, setBusy] = useState(false);
  const load = async () => { try { const [l, m] = await Promise.all([api('/delegations'), api('/me/delegations')]); setList(l); setMine(m); } catch (e) { setErr(e instanceof ApiError ? e.text(lang) : String(e)); } };
  useEffect(() => { void load(); api('/users').then((u) => setPeople(u.filter((x: any) => x.is_active && !x.is_super_admin && x.id !== me?.user.id))).catch(() => api('/counts/assignees').then(setPeople).catch(() => {})); }, []);
  const fmt = (d: string) => new Date(d).toLocaleDateString(lang === 'zh' ? 'zh-CN' : lang === 'ms' ? 'ms-MY' : 'en-MY', { month: 'short', day: 'numeric' });
  const submit = async () => {
    if (!person) return; setBusy(true);
    try {
      await api('/delegations', { body: { delegate_id: person.id, scope_types: scope, starts_at: new Date(from + 'T00:00:00').toISOString(), ends_at: new Date(to + 'T23:59:59').toISOString(), per_item_limit: perItem ? Number(perItem) : null, daily_limit: daily ? Number(daily) : null, is_standby: standby } });
      fx.done(); setStep('done'); await load();
    } catch (e) { setErr(e instanceof ApiError ? e.text(lang) : String(e)); } finally { setBusy(false); }
  };
  const doRevoke = async () => { if (!revoke) return; try { await api(`/delegations/${revoke.id}/revoke`, { method: 'POST' }); fx.done(); setRevoke(null); await load(); } catch (e) { setErr(e instanceof ApiError ? e.text(lang) : String(e)); } };
  const typeName = (x: string) => (t('type_' + x) === 'type_' + x ? x : t('type_' + x));
  if (step === 'done') return <DoneScreen title={t('delegation_created')} lines={[`${person?.name} · ${scope.length ? scope.map(typeName).join('、') : t('delegation_all')} · ${t('delegation_to')} ${to}`]} onHome={() => nav('/m')} onNext={() => { setPerson(null); setScope([]); setStep('list'); }} nextText={t('delegation_title')} />;
  const active = list.filter((d) => d.status === 'ACTIVE' && d.delegator_id === me?.user.id);
  return (
    <Page>
      <TopBar title={t('delegation_title')} onBack={() => (step === 'list' ? nav('/m') : step === 'who' ? setStep('list') : setStep('who'))} />
      {err && <ErrorScreen msg={err} onOk={() => setErr(null)} />}
      {revoke && <Confirm msg={`${t('delegation_revoke')}：${revoke.delegate_name}？`} okText={t('delegation_revoke')} danger onOk={doRevoke} onCancel={() => setRevoke(null)} />}
      {step === 'list' && (
        <>
          {mine.map((d) => <div key={d.id} className="overlay-bar bar-alert" style={{ position: 'static' }}>★ {t('delegation_you_are', { name: d.delegator_name, until: fmt(d.ends_at) })}</div>)}
          <div className="section">{t('delegation_current')}</div>
          {active.length === 0 ? <div className="empty">{t('delegation_none')}</div> : (
            <div className="list">
              {active.map((d) => (
                <div key={d.id} className="card" style={{ cursor: 'default' }} data-testid="delegation-row">
                  <div className="thumb" style={{ background: 'var(--red)', color: '#fff' }}><Icon name={I.Badge} size={28} /></div>
                  <div className="body"><div className="t">{d.delegate_name}</div><div className="s">{d.scope_types?.length ? d.scope_types.map(typeName).join('、') : t('delegation_all')} · {t('delegation_to')} {fmt(d.ends_at)}{d.per_item_limit ? ` · ≤ RM ${Number(d.per_item_limit)}` : ''}{d.is_standby ? ' · ★' : ''}</div></div>
                  <button className="btn btn-danger" style={{ width: 'auto', minHeight: 56, fontSize: 16 }} onClick={() => { fx.tap(); setRevoke(d); }} data-testid="revoke-btn">{t('delegation_revoke')}</button>
                </div>
              ))}
            </div>
          )}
          <div className="confirm-wrap"><button className="btn btn-primary btn-xl" onClick={() => { fx.tap(); setStep('who'); }} data-testid="new-delegation">＋ {t('delegation_set')}</button></div>
        </>
      )}
      {step === 'who' && (
        <>
          <div className="instruct"><span>{t('count_pick_person')}</span></div>
          <div className="list">
            {people.map((p) => <div key={p.id} className="card" onClick={() => { fx.tap(); setPerson(p); setStep('scope'); }} data-testid={`person-${p.name}`}>
              <div className="thumb"><Icon name={I.Badge} size={28} /></div>
              <div className="body"><div className="t">{p.name}</div><div className="s">{(p.roles ?? []).map((r: any) => (t('role_' + r.role_code) === 'role_' + r.role_code ? r.role_code : t('role_' + r.role_code))).join(' · ') || p.role_code || ''}</div></div>
              <div className="status">›</div>
            </div>)}
          </div>
        </>
      )}
      {step === 'scope' && person && (
        <>
          <div className="kv"><span className="k">{t('person_label')}</span><b style={{ fontSize: 24 }}>{person.name}</b></div>
          <div className="section">{t('delegation_scope')} · {scope.length ? scope.length : t('delegation_all')}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, padding: '6px var(--pad)' }}>
            {SCOPES.map((s) => <button key={s} className={`btn ${scope.includes(s) ? 'btn-primary' : 'btn-secondary'}`} style={{ width: 'auto', minHeight: 56, fontSize: 17, padding: '0 16px' }} onClick={() => { fx.tap(); setScope(scope.includes(s) ? scope.filter((x) => x !== s) : [...scope, s]); }} data-testid={`scope-${s}`}>{typeName(s)}</button>)}
          </div>
          {(scope.includes('ORDER') || scope.includes('PAYMENT')) && <div className="overlay-bar bar-stale" style={{ position: 'static' }}>⚠ {t('delegation_cost_warn')}</div>}
          <div className="login" style={{ paddingTop: 10 }}>
            <div className="row2" style={{ padding: 0 }}><label style={{ flex: 1 }}>{t('delegation_from')}<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label><label style={{ flex: 1 }}>{t('delegation_to')}<input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label></div>
            <div className="row2" style={{ padding: 0 }}><input type="number" inputMode="decimal" placeholder={t('delegation_per_item')} value={perItem} onChange={(e) => setPerItem(e.target.value)} /><input type="number" inputMode="decimal" placeholder={t('delegation_daily')} value={daily} onChange={(e) => setDaily(e.target.value)} /></div>
            <div className="s" style={{ color: 'var(--muted)' }}>{t('delegation_limit_blank')}</div>
            <button className={`btn ${standby ? 'btn-primary' : 'btn-secondary'}`} style={{ minHeight: 60, fontSize: 16 }} onClick={() => setStandby(!standby)}>{standby ? '★ ' : ''}{t('delegation_standby')}</button>
            <button className="btn btn-primary btn-xl" disabled={busy || !to} onClick={submit} data-testid="delegation-confirm"><Icon name={I.Check} size={26} /> {t('delegation_set')}</button>
          </div>
        </>
      )}
    </Page>
  );
}
