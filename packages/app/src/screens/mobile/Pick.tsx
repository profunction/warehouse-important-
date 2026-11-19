// B3 拣货 W10–W12：选调拨单（APPROVED/PICKING，我站点发出）→ 一屏一行"去 A-03-2 拿 6 箱 X"：扫货位 → 扫产品 → 输数 → 下一行 → 完成：打印箱贴、已装车。
// 约定：在线 POST /transfers/:id/pick-lines，离线 enqueue 'transfer_line_pick'；"这里没有"按本地快照找下一个有库存的货位，都没有则记为缺并跳过；发运需联网。
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '../../i18n/index.js';
import { Icon, I } from '../../ui/icons.js';
import { useAuth } from '../../store/auth.js';
import { Scanner } from '../../ui/Scanner.js';
import { DoneScreen, ErrorScreen, Page, ProductHead, QtyPad, TopBar } from '../../ui/Shell.js';
import { api, ApiError, isOnline } from '../../api/client.js';
import { db, applyLocalMovement } from '../../offline/db.js';
import { enqueue, uuidv7 } from '../../offline/sync.js';
import { resolveProduct, resolveLocation, virtualLoc } from './flow.js';
import { fx } from '../../ui/feedback.js';

type PLine = { id: string; product_id: string; name_zh?: string; name_ms?: string; name_en?: string; unit: string; case_qty: number | null; want: number; picked: number; loc: { id: string; code: string; color?: string } | null; short?: number; photo_url?: string; category_id?: string };
const errMsg = (e: any, lang: 'zh' | 'ms' | 'en') => (e instanceof ApiError ? e.text(lang) : String(e?.message ?? e));

export default function Pick() {
  const { t, n, lang } = useT(); const { me } = useAuth(); const nav = useNavigate();
  const [list, setList] = useState<any[] | null>(null); const [tr, setTr] = useState<any>(null); const [lines, setLines] = useState<PLine[]>([]); const [idx, setIdx] = useState(0);
  const [step, setStep] = useState<'list' | 'loc' | 'prod' | 'qty' | 'finish' | 'done'>('list'); const [qty, setQty] = useState(''); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [qr, setQr] = useState('');
  const load = async () => { try { setList(await api(`/transfers?status=APPROVED,PICKING${me?.site ? `&from_site=${me.site.id}` : ''}`)); } catch (e) { setList([]); setErr(errMsg(e, lang)); } };
  useEffect(() => { if (isOnline()) void load(); else { setList([]); setErr(t('needs_network')); } }, []);
  const cur = lines[idx];
  const open = async (x: any) => {
    fx.tap(); setBusy(true);
    try {
      const d = await api(`/transfers/${x.id}`); setTr(d);
      const ls: PLine[] = d.lines.map((l: any) => ({ id: l.id, product_id: l.product_id, name_zh: l.name_zh, name_ms: l.name_ms, name_en: l.name_en, unit: l.unit, photo_url: l.photo_url, case_qty: l.case_qty ? Number(l.case_qty) : null, want: Number(l.approved_qty ?? l.requested_qty), picked: Number(l.picked_qty), loc: l.pick_location_id ? { id: l.pick_location_id, code: l.pick_location_code, color: l.pick_zone_color } : null }))
        .filter((l: PLine) => l.picked < l.want).sort((a: PLine, b: PLine) => (a.loc?.code ?? 'zzz').localeCompare(b.loc?.code ?? 'zzz'));
      setLines(ls); setIdx(0); setQty(''); setStep(ls.length ? 'loc' : 'finish');
    } catch (e) { setErr(errMsg(e, lang)); } finally { setBusy(false); }
  };
  const nextLocation = async () => {
    if (!cur) return;
    const st = (await db.stock.where('product_id').equals(cur.product_id).toArray()).filter((s) => s.qty > 0 && s.location_id !== cur.loc?.id);
    const cands: { id: string; code: string; qty: number }[] = [];
    for (const s of st) { const l = await db.location.get(s.location_id); if (!l || l.is_virtual || (me?.site && l.site_id !== me.site.id)) continue; cands.push({ id: l.id, code: l.code, qty: s.qty }); }
    cands.sort((a, b) => b.qty - a.qty);
    const upd = [...lines];
    if (cands[0]) { upd[idx] = { ...cur, loc: { id: cands[0].id, code: cands[0].code } }; setLines(upd); fx.tap(); setErr(null); }
    else { upd[idx] = { ...cur, short: cur.want - cur.picked }; setLines(upd); setErr(t('no_other_location')); advance(); }
  };
  const onScanLoc = async (code: string) => {
    const l = await resolveLocation(code); if (!l) { setErr(t('not_in_system')); return; }
    if (cur.loc && l.id !== cur.loc.id) { const upd = [...lines]; upd[idx] = { ...cur, loc: { id: l.id, code: l.code } }; setLines(upd); }   // 扫了别的货位也接受
    else if (!cur.loc) { const upd = [...lines]; upd[idx] = { ...cur, loc: { id: l.id, code: l.code } }; setLines(upd); }
    setStep('prod');
  };
  const onScanProd = async (code: string) => { const f = await resolveProduct(code); if (!f || f.product.id !== cur.product_id) { setErr(t('wrong_product_scan')); return; } setQty(String(cur.want - cur.picked)); setStep('qty'); };
  const confirm = async () => {
    if (!me || !cur?.loc) return; const q = Number(qty); if (q <= 0) return; setBusy(true);
    const client_id = uuidv7();
    try {
      if (isOnline()) await api(`/transfers/${tr.id}/pick-lines`, { body: { lines: [{ client_id, product_id: cur.product_id, location_id: cur.loc.id, qty: q }] } });
      else { await enqueue({ client_id, entity: 'transfer_line_pick', op: 'insert', user_id: me.user.id, summary: `${t('pick')} ${n(cur)} ${q}`, payload: { transfer_id: tr.id, product_id: cur.product_id, location_id: cur.loc.id, qty: q, performed_at: new Date().toISOString() } }); }
      const transit = await virtualLoc('TRANSIT'); if (transit) await applyLocalMovement(cur.product_id, cur.loc.id, transit.id, q);
      const upd = [...lines]; upd[idx] = { ...cur, picked: cur.picked + q, short: cur.picked + q < cur.want ? cur.want - cur.picked - q : undefined }; setLines(upd);
      fx.scanOk(); advance(upd);
    } catch (e) { setErr(errMsg(e, lang)); } finally { setBusy(false); }
  };
  const advance = (ls: PLine[] = lines) => { const next = ls.findIndex((l, i) => i > idx && l.picked < l.want && l.short == null); if (next >= 0) { setIdx(next); setQty(''); setStep('loc'); } else setStep('finish'); };
  const dispatch = async () => {
    setBusy(true);
    try { const d = await api(`/transfers/${tr.id}/dispatch`, { body: {} }); setQr(d.qr); setStep('done'); } catch (e) { setErr(errMsg(e, lang)); } finally { setBusy(false); }
  };
  const printLabels = async () => {
    try { const r: Response = await api(`/transfers/${tr.id}/labels?n=${Math.max(1, Math.ceil(lines.reduce((a, l) => a + l.picked, 0) / 12))}`, { raw: true }); const url = URL.createObjectURL(await r.blob()); window.open(url, '_blank'); } catch (e) { setErr(errMsg(e, lang)); }
  };
  const unit = (l: PLine) => (l.case_qty && l.case_qty > 1 ? `${t('boxes_n', { n: Math.round(((l.want - l.picked) / l.case_qty) * 10) / 10 })}` : (l.unit === 'KG' ? t('unit_kg') : t('unit_pcs')));
  const pickedTotal = lines.reduce((a, l) => a + l.picked, 0);
  if (step === 'done') return <DoneScreen title={t('dispatched')} lines={[tr?.transfer_no, `${tr?.from_site_code} → ${tr?.to_site_code}`, qr]} onHome={() => nav('/m')} />;
  return (
    <Page>
      <TopBar title={tr ? `${t('pick')} · ${tr.transfer_no}` : t('pick')} progress={tr ? `${idx + 1}/${lines.length}` : undefined} onBack={() => (step === 'list' ? nav('/m') : step === 'loc' || step === 'finish' ? (setTr(null), setStep('list'), void load()) : setStep('loc'))} confirmBack={step === 'prod' || step === 'qty'} />
      {err && <ErrorScreen msg={err} onOk={() => setErr(null)} />}
      {step === 'list' && (list === null ? <div className="empty">{t('loading')}</div> : list.length === 0 ? <div className="empty"><div className="big"><Icon name={I.Check} size={48} /></div>{t('none_pending')}</div> : (
        <><div className="section">{t('pick_list')}</div>
          <div className="list" data-testid="pick-list">{list.map((x) => <div key={x.id} className="card" onClick={() => !busy && open(x)}><div className="thumb"><Icon name={I.Shop} size={30} /></div><div className="body"><div className="t">{t('to_site')} {x.to_site_name}</div><div className="s">{x.transfer_no} · {t('lines_n', { n: x.line_count })} · {Number(x.qty_total)} {t('unit_pcs')}{x.required_at ? ` · ${t('required_at')} ${new Date(x.required_at).toLocaleString()}` : ''}</div></div><div className="status">{x.status === 'PICKING' ? t('status_PICKING') : ''}</div></div>)}</div></>
      ))}
      {(step === 'loc' || step === 'prod') && cur && (
        <>
          <ProductHead p={cur} sub={`${t('picked')} ${cur.picked} ${t('of_total')} ${cur.want}`} />
          <div className="instruct" style={{ color: cur.loc?.color ?? 'var(--blue)' }}>{cur.loc ? <>{t('go_to')} <span className="label-chip" style={{ background: cur.loc.color ?? 'var(--blue)', color: '#fff', fontSize: 32 }}>{cur.loc.code}</span> · {cur.want - cur.picked} {unit(cur)}</> : t('scan_location')}</div>
          {step === 'loc' ? <Scanner onScan={onScanLoc} instruction={t('scan_location')} icon={I.MapPin} enabled={!err} /> : <Scanner onScan={onScanProd} instruction={t('scan_product')} icon={I.Product} enabled={!err} />}
          <div className="row2">
            <button className="btn btn-ghost" onClick={nextLocation} data-testid="not-here"><Icon name={I.Warn} size={22} /> {t('not_here')}</button>
            <button className="btn btn-ghost" onClick={() => { fx.tap(); advance(); }}>{t('skip_line')}</button>
          </div>
        </>
      )}
      {step === 'qty' && cur && (
        <>
          <ProductHead p={cur} sub={`${cur.loc?.code} → TRANSIT · ${t('expected')} ${cur.want - cur.picked}`} />
          <QtyPad value={qty} onChange={setQty} unit={cur.unit === 'KG' ? t('unit_kg') : t('unit_pcs')} caseQty={cur.case_qty ?? undefined} allowDecimal={cur.unit === 'KG'} />
          <div className="confirm-wrap"><button className="btn btn-primary btn-xl" disabled={busy || !(Number(qty) > 0)} onClick={confirm} data-testid="qty-confirm"><Icon name={I.Check} size={26} /> {t('confirm')} {qty}</button></div>
        </>
      )}
      {step === 'finish' && tr && (
        <>
          <div className="section">{t('pick_done')}</div>
          <div className="list">{lines.map((l) => <div key={l.id} className="kv" style={{ padding: '10px var(--pad)' }}><span className="k">{n(l)}</span><b style={{ fontSize: 22, color: l.picked >= l.want ? 'var(--green)' : 'var(--red)' }}>{l.picked} / {l.want}{l.picked < l.want ? ` · ${t('pick_short', { n: l.want - l.picked })}` : ''}</b></div>)}</div>
          <div className="kv"><span className="k">{t('picked')}</span><b>{pickedTotal} {t('unit_pcs')}</b></div>
          <div className="row2"><button className="btn btn-ghost" onClick={printLabels}><Icon name={I.Ticket} size={22} /> {t('print_box_label')}</button></div>
          <div className="confirm-wrap"><button className="btn btn-primary btn-xl" disabled={busy || pickedTotal <= 0} onClick={dispatch} data-testid="dispatch"><Icon name={I.Check} size={26} /> {t('loaded')}</button></div>
        </>
      )}
    </Page>
  );
}
