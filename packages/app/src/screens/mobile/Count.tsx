// K1–K6 盲盘：今日盘点清单 → 扫货位 → 扫产品 → 输数量 → 货位完成 → 全部完成送审批。永远不显示系统量。
// 离线：录行和「货位完成」进 outbox（entity count_line / count_location_done），提交需要网络。任务清单缓存在 kv 供离线查看。
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '../../i18n/index.js';
import { Icon, I } from '../../ui/icons.js';
import { useAuth } from '../../store/auth.js';
import { Scanner } from '../../ui/Scanner.js';
import { DoneScreen, ErrorScreen, Page, ProductHead, QtyPad, TopBar } from '../../ui/Shell.js';
import { resolveProduct, resolveLocation } from './flow.js';
import { fx } from '../../ui/feedback.js';
import { api, ApiError, isOnline } from '../../api/client.js';
import { enqueue, uuidv7, push } from '../../offline/sync.js';
import { kvGet, kvSet, db } from '../../offline/db.js';

type Loc = { id: string; code: string; zone_code?: string; zone_color?: string; done: boolean; is_empty?: boolean; lines_count: number };
type Line = { location_id: string; product_id: string; counted_qty: number; name_zh?: string; name_ms?: string; name_en?: string; photo_url?: string; sku?: string };
type Sess = { id: string; session_no: string; status: string; count_type: string; zone_code?: string; locations: Loc[]; lines: Line[]; total: number; done: number };

export default function Count() {
  const { t, n, lang } = useT(); const { me } = useAuth(); const nav = useNavigate();
  const [sessions, setSessions] = useState<Sess[]>([]); const [loading, setLoading] = useState(true);
  const [sess, setSess] = useState<Sess | null>(null); const [loc, setLoc] = useState<Loc | null>(null);
  const [step, setStep] = useState<'list' | 'scanLoc' | 'scanProd' | 'qty' | 'done'>('list');
  const [cur, setCur] = useState<{ product: any; pack_qty: number; barcode: string; weight_kg: number | null } | null>(null);
  const [qty, setQty] = useState(''); const [err, setErr] = useState<string | null>(null); const [flash, setFlash] = useState<'green' | null>(null); const [doneMsg, setDoneMsg] = useState(''); const [busy, setBusy] = useState(false);

  const load = async () => {
    try { if (isOnline()) { const r = await api<Sess[]>('/counts/my-today'); setSessions(r); await kvSet('counts.myToday', r); } else setSessions(await kvGet<Sess[]>('counts.myToday', [])); }
    catch { setSessions(await kvGet<Sess[]>('counts.myToday', [])); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  const saveLocal = async (s: Sess) => { const list = sessions.map((x) => (x.id === s.id ? s : x)); setSessions(list); setSess(s); await kvSet('counts.myToday', list); };
  const total = sessions.reduce((a, s) => a + s.total, 0); const doneN = sessions.reduce((a, s) => a + s.done, 0);

  const openLoc = async (s: Sess, l: Loc) => {
    fx.tap();
    if (s.status === 'ASSIGNED' && isOnline()) { try { const r = await api(`/counts/${s.id}/start`, { method: 'POST' }); s = { ...s, status: r.status }; await saveLocal(s); } catch (e) { if (e instanceof ApiError) { setErr(e.text(lang)); return; } } }
    setSess(s); setLoc(l); setStep('scanLoc');
  };
  const onScanLoc = async (code: string) => {
    const l = await resolveLocation(code);
    if (!l) { setErr(t('not_in_system')); return; }
    if (l.id !== loc!.id) { setErr(t('wrong_location', { got: l.code, want: loc!.code })); return; }
    fx.scanOk(); setStep('scanProd');
  };
  const onScanProd = async (code: string) => {
    const f = await resolveProduct(code); if (!f) { setErr(t('not_in_system')); return; }
    setCur({ product: f.product, pack_qty: f.pack_qty, barcode: code, weight_kg: f.weight_kg }); setQty(f.weight_kg != null ? String(f.weight_kg) : ''); setStep('qty');
  };
  const unitQty = Math.round((Number(qty) || 0) * (cur?.pack_qty ?? 1) * 1000) / 1000;
  const confirmQty = async () => {
    if (!cur || !sess || !loc || !me) return;
    const client_id = uuidv7(); const payload = { session_id: sess.id, location_id: loc.id, product_id: cur.product.id, counted_qty: unitQty, counted_at: new Date().toISOString() };
    let sent = false;
    if (isOnline()) { try { await api(`/counts/${sess.id}/lines`, { body: { client_id, ...payload } }); sent = true; } catch (e) { if (e instanceof ApiError && e.status !== 0 && e.code !== 'NETWORK') { setErr(e.text(lang)); return; } } }
    if (!sent) await enqueue({ client_id, entity: 'count_line', op: 'insert', user_id: me.user.id, summary: `${t('count')} ${loc.code} ${n(cur.product)} ${unitQty}`, payload });
    // 本地覆盖同货位同产品
    const lines = sess.lines.filter((x) => !(x.location_id === loc.id && x.product_id === cur.product.id));
    lines.push({ location_id: loc.id, product_id: cur.product.id, counted_qty: unitQty, name_zh: cur.product.name_zh, name_ms: cur.product.name_ms, name_en: cur.product.name_en, photo_url: cur.product.photo_url, sku: cur.product.sku });
    const locs = sess.locations.map((x) => (x.id === loc.id ? { ...x, lines_count: lines.filter((y) => y.location_id === loc.id).length } : x));
    await saveLocal({ ...sess, lines, locations: locs }); setLoc(locs.find((x) => x.id === loc.id)!);
    fx.scanOk(); setFlash('green'); setTimeout(() => setFlash(null), 500); setCur(null); setQty(''); setStep('scanProd');
  };
  const locDone = async (isEmpty: boolean) => {
    if (!sess || !loc || !me) return; fx.tap();
    let sent = false;
    if (isOnline()) { try { await api(`/counts/${sess.id}/location-done`, { body: { location_id: loc.id, is_empty: isEmpty } }); sent = true; } catch (e) { if (e instanceof ApiError && e.status !== 0 && e.code !== 'NETWORK') { setErr(e.text(lang)); return; } } }
    if (!sent) await enqueue({ client_id: uuidv7(), entity: 'count_location_done', op: 'insert', user_id: me.user.id, summary: `${t('count_location_done')} ${loc.code}`, payload: { session_id: sess.id, location_id: loc.id, is_empty: isEmpty } });
    const locs = sess.locations.map((x) => (x.id === loc.id ? { ...x, done: true, is_empty: isEmpty } : x));
    const s2 = { ...sess, locations: locs, done: locs.filter((x) => x.done).length, status: 'IN_PROGRESS' };
    await saveLocal(s2); fx.done(); setLoc(null); setStep('list');
  };
  const submit = async (s: Sess) => {
    if (!isOnline()) { setErr(t('count_need_network')); return; }
    setBusy(true);
    try {
      await push();   // 先把离线的行推上去
      const pending = await db.outbox.where('status').anyOf('pending', 'sending').count(); if (pending > 0) { setErr(t('count_need_network')); return; }
      const r = await api(`/counts/${s.id}/submit`, { method: 'POST' });
      setDoneMsg(r.status === 'APPROVED' ? t('count_no_variance') : t('count_submitted'));
      const list = sessions.filter((x) => x.id !== s.id); setSessions(list); await kvSet('counts.myToday', list); setSess(null); setStep('done');
    } catch (e) { setErr(e instanceof ApiError ? e.text(lang) : String(e)); } finally { setBusy(false); }
  };
  const linesHere = sess && loc ? sess.lines.filter((x) => x.location_id === loc.id) : [];

  if (step === 'done') return <DoneScreen title={doneMsg} onNext={sessions.length ? () => setStep('list') : undefined} onHome={() => nav('/m')} />;
  return (
    <Page flash={flash}>
      <TopBar title={step === 'list' ? t('count_today') : `${t('count')} · ${loc?.code ?? ''}`} progress={step === 'list' && total ? `${doneN}/${total}` : undefined} confirmBack={step === 'qty'} onBack={() => (step === 'list' ? nav('/m') : step === 'qty' ? setStep('scanProd') : setStep(step === 'scanProd' ? 'scanLoc' : 'list'))} />
      {err && <ErrorScreen msg={err} onOk={() => setErr(null)} />}
      {step === 'list' && (
        loading ? <div className="empty">{t('loading')}</div> : sessions.length === 0 ? <div className="empty"><div className="big"><Icon name={I.Check} size={48} /></div>{t('count_no_task')}</div> : (
          <>
            <div className="instruct"><span>{t('count_progress', { t: total, d: doneN })}</span></div>
            {sessions.map((s) => (
              <div key={s.id}>
                <div className="section">{s.session_no} · {t('count_type_' + s.count_type)}{s.zone_code ? ` · ${s.zone_code}` : ''}</div>
                <div className="list">
                  {s.locations.map((l) => (
                    <div key={l.id} className="card" onClick={() => !l.done && openLoc(s, l)} data-testid={`count-loc-${l.code}`} style={l.done ? { opacity: 0.6 } : undefined}>
                      <div className="thumb" style={{ background: l.zone_color ?? undefined, color: l.zone_color ? '#fff' : undefined }}><Icon name={I.MapPin} size={30} /></div>
                      <div className="body"><div className="t">{l.code}</div><div className="s">{l.done ? (l.is_empty ? t('count_location_empty') : t('done')) : `${t('count_counted')} ${l.lines_count}`}</div></div>
                      <div className="status">{l.done ? <Icon name={I.Check} size={26} style={{ color: 'var(--green)' }} /> : <span className="dot" style={{ background: l.lines_count ? 'var(--yellow)' : 'var(--muted)' }} />}</div>
                    </div>
                  ))}
                </div>
                {s.done >= s.total && <div className="confirm-wrap"><button className="btn btn-primary btn-xl" disabled={busy} onClick={() => submit(s)} data-testid="count-submit"><Icon name={I.Check} size={26} /> {t('count_submit')}</button></div>}
              </div>
            ))}
          </>
        )
      )}
      {step === 'scanLoc' && loc && <><div className="kv"><span className="k">{t('location_label')}</span><b>{loc.code}</b></div><Scanner onScan={onScanLoc} instruction={t('scan_location')} icon={I.MapPin} enabled={!err} /></>}
      {step === 'scanProd' && loc && sess && (
        <>
          <Scanner onScan={onScanProd} instruction={t('scan_product')} icon={I.Product} last={linesHere.length ? `${n(linesHere[linesHere.length - 1])} ✓ ${linesHere[linesHere.length - 1].counted_qty}` : undefined} enabled={!err} />
          <div className="section">{t('count_products_counted')}（{linesHere.length}）</div>
          <div className="list" data-testid="counted-list">
            {linesHere.length === 0 && <div className="empty" style={{ padding: '16px' }}>{t('count_none_yet')}</div>}
            {linesHere.map((l) => <div key={l.product_id} className="card" style={{ minHeight: 64, padding: '10px 2px' }}><div className="body"><div className="t">{n(l)}</div><div className="s">{l.sku}</div></div><div className="status"><b style={{ fontSize: 24, color: 'var(--ink)' }}>{l.counted_qty}</b></div></div>)}
          </div>
          <div className="confirm-wrap" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <button className="btn btn-primary btn-xl" disabled={linesHere.length === 0} onClick={() => locDone(false)} data-testid="loc-done"><Icon name={I.Check} size={26} /> {t('count_location_done')}</button>
            {linesHere.length === 0 && <button className="btn btn-secondary" onClick={() => locDone(true)} data-testid="loc-empty">{t('count_location_empty')}</button>}
          </div>
        </>
      )}
      {step === 'qty' && cur && (
        <>
          <ProductHead p={cur.product} barcode={cur.barcode} sub={`${loc?.code} · ${cur.pack_qty > 1 ? `1 ${t('case')} = ${cur.pack_qty} ${t('unit_pcs')}` : t('count_actual')}`} />
          <QtyPad value={qty} onChange={setQty} unit={cur.pack_qty > 1 ? t('case') : cur.product.unit === 'KG' ? t('unit_kg') : t('unit_pcs')} allowDecimal={cur.product.unit === 'KG'} auto={cur.weight_kg != null} />
          <div className="confirm-wrap"><button className="btn btn-primary btn-xl" disabled={qty === ''} onClick={confirmQty} data-testid="qty-confirm"><Icon name={I.Check} size={26} /> {t('confirm')} {unitQty} {cur.product.unit === 'KG' ? t('unit_kg') : t('unit_pcs')}</button></div>
        </>
      )}
    </Page>
  );
}
