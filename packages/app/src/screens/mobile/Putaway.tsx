// B2 上架 W6–W9：收货区待上架清单（在线按 GET /putaway/pending，按到货先后、可按 GRN 排；离线用本地快照）→ 扫产品（建议货位）→ 扫货位 → 输数量
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '../../i18n/index.js';
import { Icon, I } from '../../ui/icons.js';
import { useAuth } from '../../store/auth.js';
import { Scanner } from '../../ui/Scanner.js';
import { DoneScreen, ErrorScreen, Page, ProductHead, QtyPad, TopBar } from '../../ui/Shell.js';
import { db } from '../../offline/db.js';
import { api, isOnline } from '../../api/client.js';
import { resolveProduct, resolveLocation, zoneAllows, queueMovement } from './flow.js';
import { fx } from '../../ui/feedback.js';

export default function Putaway() {
  const { t, n } = useT(); const { me } = useAuth(); const nav = useNavigate();
  const [pending, setPending] = useState<any[]>([]); const [step, setStep] = useState<'list' | 'scan' | 'loc' | 'qty' | 'done'>('list');
  const [byGrn, setByGrn] = useState(false);
  const [cur, setCur] = useState<any>(null); const [from, setFrom] = useState<any>(null); const [suggest, setSuggest] = useState<any>(null); const [to, setTo] = useState<any>(null); const [qty, setQty] = useState(''); const [defQty, setDefQty] = useState(''); const [err, setErr] = useState<string | null>(null); const [doneCount, setDone] = useState(0);
  const load = async () => {
    if (isOnline()) {
      try {
        const rows = await api('/putaway/pending');
        setPending(rows.map((r: any) => ({ key: r.product_id + r.location_id, product_id: r.product_id, location_id: r.location_id, qty: Number(r.qty), grn_no: r.grn_no, received_at: r.received_at ?? r.last_movement_at, product: { id: r.product_id, sku: r.sku, name_zh: r.name_zh, name_ms: r.name_ms, name_en: r.name_en, photo_url: r.photo_url, unit: r.unit, category_id: r.category_id }, location: { id: r.location_id, code: r.location_code } })));
        return;
      } catch { /* 用本地 */ }
    }
    // 离线：收货区（RECEIVING）里有库存的产品
    const zones = await db.zone.filter((z) => z.zone_type === 'RECEIVING').toArray(); const zids = new Set(zones.map((z) => z.id));
    const locs = await db.location.filter((l) => !!l.zone_id && zids.has(l.zone_id)).toArray(); const lids = new Map(locs.map((l) => [l.id, l]));
    const st = await db.stock.filter((s) => lids.has(s.location_id) && s.qty > 0).toArray();
    setPending(await Promise.all(st.map(async (s) => ({ ...s, product: await db.product.get(s.product_id), location: lids.get(s.location_id) }))));
  };
  useEffect(() => { void load(); }, []);
  const begin = async (item: any) => {
    fx.tap(); setCur(item.product); setFrom(item.location); setQty(''); setDefQty(String(item.qty));
    let sg: any = null;
    if (isOnline()) { try { sg = await api(`/putaway/suggest?product=${item.product.id}`); } catch { /* 用本地 */ } }
    if (!sg) { const zs = await db.zone.filter((z) => ['STORAGE', 'BACKROOM'].includes(z.zone_type) && (z.allowed_category_ids ?? []).includes(item.product.category_id)).toArray(); if (zs[0]) { const l = await db.location.where('zone_id').equals(zs[0].id).first(); if (l) sg = { code: l.code, id: l.id, color: zs[0].color, offline: true }; } }
    setSuggest(sg); setStep('loc');
  };
  const onScanProduct = async (code: string) => { const f = await resolveProduct(code); const item = pending.find((p) => p.product_id === f?.product.id); if (!item) { setErr(t('not_in_system')); return; } await begin(item); };
  const onScanLoc = async (code: string) => {
    const l = await resolveLocation(code); if (!l) { setErr(t('not_in_system')); return; }
    if (!(await zoneAllows(l.id, cur.category_id))) { setErr(t('wrong_location', { got: l.code, want: suggest?.code ?? '?' })); return; }
    setTo(l); setStep('qty');
  };
  const confirm = async () => {
    if (!me) return; const q = Number(qty || defQty); if (q <= 0) return;
    await queueMovement(me, { product_id: cur.id, from_location_id: from.id, to_location_id: to.id, qty: q, reason: 'PUTAWAY', summary: `${t('putaway')} ${n(cur)} ${q} → ${to.code}` });
    setDone(doneCount + 1); await load(); setStep('list'); fx.scanOk();
  };
  const sorted = byGrn ? [...pending].sort((a, b) => String(a.grn_no ?? '').localeCompare(String(b.grn_no ?? '')) || String(a.received_at ?? '').localeCompare(String(b.received_at ?? ''))) : pending;
  if (step === 'done') return <DoneScreen title={t('putaway_done')} lines={[`${doneCount}`]} onHome={() => nav('/m')} />;
  return (
    <Page>
      <TopBar title={t('putaway')} progress={pending.length ? `${pending.length}` : undefined} onBack={() => (step === 'list' ? nav('/m') : setStep('list'))} confirmBack={step !== 'list'} />
      {err && <ErrorScreen msg={err} onOk={() => setErr(null)} />}
      {step === 'list' && (pending.length === 0 ? <div className="empty"><div className="big"><Icon name={I.Check} size={48} /></div>{t('none_pending')}</div> : (
        <>
          <div className="section" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>{t('pending_putaway')}{pending.some((p) => p.grn_no) && <button className="label-chip" style={{ background: byGrn ? 'var(--ink)' : 'transparent', color: byGrn ? '#fff' : 'var(--ink)', letterSpacing: 0, textTransform: 'none' }} onClick={() => { fx.tap(); setByGrn(!byGrn); }} data-testid="by-grn">{t('by_grn')}</button>}</div>
          <div className="list">{sorted.map((p) => <div key={p.key} className="card" onClick={() => begin(p)} data-testid="putaway-item"><div className="thumb">{p.product?.photo_url ? <img src={p.product.photo_url} alt="" /> : <Icon name={I.Product} size={32} />}</div><div className="body"><div className="t">{n(p.product)}</div><div className="s">{p.location?.code} · {p.qty}{p.grn_no ? ` · ${p.grn_no}` : ''}{p.received_at ? ` · ${t('arrived')} ${new Date(p.received_at).toLocaleDateString()}` : ''}</div></div></div>)}</div>
          <div className="confirm-wrap"><button className="btn btn-ghost" onClick={() => setStep('scan')}><Icon name={I.Camera} size={24} /> {t('scan_product')}</button></div>
        </>
      ))}
      {step === 'scan' && <Scanner onScan={onScanProduct} instruction={t('scan_product')} icon={I.Product} enabled={!err} />}
      {step === 'loc' && cur && (
        <>
          <ProductHead p={cur} sub={`${defQty} ${t('unit_pcs')}`} />
          {suggest && <div className="instruct" style={{ color: suggest.offline ? 'var(--brass)' : (suggest.color ?? 'var(--blue)') }}>{t('go_to')} <span className="label-chip" style={{ background: suggest.offline ? 'var(--brass)' : (suggest.color ?? 'var(--blue)'), color: '#fff', fontSize: 32 }}>{suggest.code}</span></div>}
          <Scanner onScan={onScanLoc} instruction={t('scan_location')} icon={I.MapPin} enabled={!err} />
        </>
      )}
      {step === 'qty' && cur && (
        <>
          <ProductHead p={cur} sub={`${from.code} → ${to.code}`} />
          <QtyPad value={qty} onChange={setQty} unit={cur.unit === 'KG' ? t('unit_kg') : t('unit_pcs')} allowDecimal={cur.unit === 'KG'} placeholder={defQty} />
          <div className="confirm-wrap"><button className="btn btn-primary btn-xl" disabled={!(Number(qty || defQty) > 0)} onClick={confirm} data-testid="qty-confirm"><Icon name={I.Check} size={26} /> {t('confirm')} {qty || defQty}</button></div>
        </>
      )}
      {step === 'list' && doneCount > 0 && <div className="confirm-wrap"><button className="btn btn-primary" onClick={() => setStep('done')}><Icon name={I.Check} size={26} /> {t('done')}（{doneCount}）</button></div>}
    </Page>
  );
}
