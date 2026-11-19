// M3 盘点安排：选区（或扫几个货位）→ 选人 → 确认。需要网络。
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '../../i18n/index.js';
import { Icon, I } from '../../ui/icons.js';
import { useAuth } from '../../store/auth.js';
import { Scanner } from '../../ui/Scanner.js';
import { DoneScreen, ErrorScreen, Page, TopBar } from '../../ui/Shell.js';
import { api, ApiError } from '../../api/client.js';
import { fx } from '../../ui/feedback.js';

export default function CountPlan() {
  const { t, n, lang } = useT(); const { me } = useAuth(); const nav = useNavigate();
  const [zones, setZones] = useState<any[]>([]); const [people, setPeople] = useState<any[]>([]);
  const [zone, setZone] = useState<any | null>(null); const [codes, setCodes] = useState<string[]>([]); const [scanning, setScanning] = useState(false);
  const [person, setPerson] = useState<any | null>(null); const [step, setStep] = useState<'where' | 'who' | 'done'>('where');
  const [err, setErr] = useState<string | null>(null); const [result, setResult] = useState<any>(null); const [busy, setBusy] = useState(false);
  useEffect(() => { api('/zones').then((z) => setZones(z.filter((x: any) => x.zone_type !== 'RECEIVING'))).catch((e) => setErr(e instanceof ApiError ? e.text(lang) : String(e))); api('/counts/assignees').then(setPeople).catch(() => {}); }, []);
  const onScan = async (code: string) => { const c = code.replace(/^LOC:[A-Z0-9]+:/i, ''); if (!codes.includes(c)) setCodes([...codes, c]); };
  const submit = async () => {
    if (!person) return; setBusy(true);
    try { const r = await api('/counts', { body: zone ? { zone_id: zone.id, assigned_to: person.id, count_type: 'FULL' } : { location_codes: codes, assigned_to: person.id, count_type: 'SPOT' } }); setResult(r); fx.done(); setStep('done'); }
    catch (e) { setErr(e instanceof ApiError ? e.text(lang) : String(e)); } finally { setBusy(false); }
  };
  if (step === 'done' && result) return <DoneScreen title={`${t('count_assigned')} ${result.session_no}`} lines={[`${person?.name} · ${t('count_locations_n', { n: result.location_ids.length })}`]} onNext={() => { setZone(null); setCodes([]); setPerson(null); setStep('where'); }} onHome={() => nav('/m')} />;
  return (
    <Page>
      <TopBar title={t('count_plan_title')} progress={step === 'where' ? '1/2' : '2/2'} onBack={() => (step === 'who' ? setStep('where') : scanning ? setScanning(false) : nav('/m'))} />
      {err && <ErrorScreen msg={err} onOk={() => setErr(null)} />}
      {step === 'where' && !scanning && (
        <>
          <div className="instruct"><span>{t('count_pick_zone')}</span></div>
          <div className="list">
            {zones.map((z) => <div key={z.id} className="card" onClick={() => { fx.tap(); setZone(z); setCodes([]); setStep('who'); }} data-testid={`zone-${z.code}`}>
              <div className="thumb" style={{ background: z.color, color: '#fff' }}><b style={{ fontSize: 22 }}>{z.code}</b></div>
              <div className="body"><div className="t">{n(z) || z.code}</div><div className="s">{t('count_locations_n', { n: Number(z.location_count ?? 0) })}</div></div>
              <div className="status">›</div>
            </div>)}
          </div>
          <div className="section">{t('count_or_scan_locations')}</div>
          <div className="row2">
            <button className="btn btn-secondary" onClick={() => { fx.tap(); setScanning(true); }} data-testid="scan-locs"><Icon name={I.MapPin} size={22} /> {t('scan_location')}{codes.length ? ` (${codes.length})` : ''}</button>
            {codes.length > 0 && <button className="btn btn-primary" onClick={() => { setZone(null); setStep('who'); }} data-testid="codes-next">{t('next')} ›</button>}
          </div>
          {codes.length > 0 && <div className="kv"><span className="k">{t('location_label')}</span><span style={{ fontSize: 18 }}>{codes.join('、')}</span></div>}
        </>
      )}
      {step === 'where' && scanning && (
        <>
          <Scanner onScan={onScan} instruction={t('scan_location')} icon={I.MapPin} last={codes.length ? codes[codes.length - 1] : undefined} />
          <div className="kv"><span className="k">{t('count_locations_n', { n: codes.length })}</span><span style={{ fontSize: 18 }}>{codes.join('、')}</span></div>
          <div className="confirm-wrap"><button className="btn btn-primary btn-xl" disabled={!codes.length} onClick={() => { setScanning(false); setZone(null); setStep('who'); }}><Icon name={I.Check} size={26} /> {t('next')}</button></div>
        </>
      )}
      {step === 'who' && (
        <>
          <div className="kv"><span className="k">{t('location_label')}</span><b style={{ fontSize: 22 }}>{zone ? `${zone.code} · ${t('count_locations_n', { n: Number(zone.location_count ?? 0) })}` : codes.join('、')}</b></div>
          <div className="instruct"><span>{t('count_pick_person')}</span></div>
          <div className="list">
            {people.filter((p) => p.id !== me?.user.id).map((p) => <div key={p.id} className={`card`} onClick={() => { fx.tap(); setPerson(p); }} data-testid={`person-${p.name}`} style={person?.id === p.id ? { background: 'var(--paper-dim)' } : undefined}>
              <div className="thumb"><Icon name={I.Badge} size={28} /></div>
              <div className="body"><div className="t">{p.name}</div><div className="s">{t('role_' + p.role_code) === 'role_' + p.role_code ? p.role_code : t('role_' + p.role_code)}</div></div>
              <div className="status">{person?.id === p.id && <Icon name={I.Check} size={26} style={{ color: 'var(--green)' }} />}</div>
            </div>)}
            {people.length === 0 && <div className="empty">{t('none_pending')}</div>}
          </div>
          <div className="confirm-wrap"><button className="btn btn-primary btn-xl" disabled={!person || busy} onClick={submit} data-testid="plan-confirm"><Icon name={I.Check} size={26} /> {t('confirm')}{person ? ` · ${person.name}` : ''}</button></div>
        </>
      )}
    </Page>
  );
}
