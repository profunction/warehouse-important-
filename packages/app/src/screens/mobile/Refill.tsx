// A3/S1-S4 补货：缺货清单 → 扫货架 → 扫产品（首次问是否设位置）→ 输数量
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '../../i18n/index.js';
import { Icon, I } from '../../ui/icons.js';
import { useAuth } from '../../store/auth.js';
import { Scanner } from '../../ui/Scanner.js';
import { Confirm, DoneScreen, ErrorScreen, Page, ProductHead, QtyPad, TopBar } from '../../ui/Shell.js';
import { api, isOnline } from '../../api/client.js';
import { db } from '../../offline/db.js';
import { resolveProduct, resolveLocation, queueMovement, backroomStock, queueShelf } from './flow.js';
import { fx } from '../../ui/feedback.js';

export default function Refill() {
  const { t, n } = useT(); const { me } = useAuth(); const nav = useNavigate();
  const [low, setLow] = useState<any[]>([]); const [step, setStep] = useState<'list' | 'shelf' | 'product' | 'qty' | 'done'>('list');
  const [shelf, setShelf] = useState<any>(null); const [cur, setCur] = useState<any>(null); const [back, setBack] = useState<{ location_id: string; code: string; qty: number }[]>([]); const [qty, setQty] = useState(''); const [defQty, setDefQty] = useState(''); const [askAssign, setAskAssign] = useState(false); const [assign, setAssign] = useState(false); const [err, setErr] = useState<string | null>(null); const [count, setCount] = useState(0); const [flash, setFlash] = useState<'green' | null>(null);
  const load = async () => {
    if (isOnline()) { try { setLow(await api('/stock/shelf-low')); return; } catch { /* 本地 */ } }
    const sa = await db.shelf_assignment.filter((s) => s.is_active && s.is_primary).toArray(); const out: any[] = [];
    for (const s of sa) { const p = await db.product.get(s.product_id); const l = await db.location.get(s.location_id); if (!p || !l) continue; const q = (await db.stock.get(s.product_id + s.location_id))?.qty ?? 0; const min = Math.max(p.min_level / 4, 1); if (q < min) out.push({ product_id: p.id, ...p, shelf_code: l.code, shelf_location_id: l.id, shelf_qty: q, shelf_min: min, backroom_qty: (await backroomStock(p.id)).filter((b) => b.zone_type !== 'SHELF').reduce((a, b) => a + b.qty, 0) }); }
    setLow(out.sort((a, b) => a.shelf_qty / a.shelf_min - b.shelf_qty / b.shelf_min));
  };
  useEffect(() => { void load(); }, []);
  const pickItem = async (it: any) => { fx.tap(); const p = await db.product.get(it.product_id); setCur(p); const l = await db.location.get(it.shelf_location_id); setShelf(l); await prepareQty(p, l); };
  const prepareQty = async (p: any, l: any) => {
    const br = (await backroomStock(p.id)).filter((b) => b.zone_type !== 'SHELF' && b.location_id !== l.id); setBack(br);
    setQty(''); setDefQty(br[0] ? String(Math.min(br[0].qty, Math.max(p.min_level ?? 0, 1))) : ''); setStep('qty');
  };
  const onScanShelf = async (code: string) => { const l = await resolveLocation(code); if (!l) { setErr(t('not_in_system')); return; } const z = l.zone_id ? await db.zone.get(l.zone_id) : null; if (z?.zone_type !== 'SHELF') { setErr(t('scan_shelf')); return; } setShelf(l); setStep('product'); };
  const onScanProduct = async (code: string) => {
    const f = await resolveProduct(code); if (!f) { setErr(t('not_in_system')); return; } setCur(f.product);
    const existing = await db.shelf_assignment.where('product_id').equals(f.product.id).filter((s) => s.is_active && s.location_id === shelf.id).first();
    if (!existing) { setAskAssign(true); return; }
    setAssign(false); await prepareQty(f.product, shelf);
  };
  const confirm = async () => {
    if (!me || !cur || !shelf) return; const q = Number(qty || defQty); if (q <= 0) return;
    const src = back[0]; if (!src) { setErr(t('backroom_has') + ' 0'); return; }
    await queueMovement(me, { product_id: cur.id, from_location_id: src.location_id, to_location_id: shelf.id, qty: q, reason: 'REFILL', assign_shelf: assign, summary: `${t('refill')} ${n(cur)} ${q} → ${shelf.code}` });
    setCount(count + 1); setFlash('green'); setTimeout(() => setFlash(null), 600); fx.scanOk(); await load(); setStep('list'); setCur(null); setAssign(false);
  };
  if (step === 'done') return <DoneScreen title={t('refill_done')} lines={[`${count}`]} onHome={() => nav('/m')} onNext={() => { setCount(0); setStep('list'); }} />;
  return (
    <Page flash={flash}>
      <TopBar title={t('refill')} progress={low.length ? `${low.length}` : undefined} onBack={() => (step === 'list' ? (count ? setStep('done') : nav('/m')) : setStep('list'))} confirmBack={step === 'qty'} />
      {err && <ErrorScreen msg={err} onOk={() => setErr(null)} />}
      {askAssign && cur && <Confirm msg={t('set_as_shelf', { code: shelf?.code })} okText={t('yes')} cancelText={t('no')} onOk={async () => { setAskAssign(false); setAssign(true); await prepareQty(cur, shelf); }} onCancel={async () => { setAskAssign(false); setAssign(false); await prepareQty(cur, shelf); }} />}
      {step === 'list' && (
        <>
          <div className="section">{t('shelf_low_list')}</div>
          {low.length === 0 ? <div className="empty"><div className="big"><Icon name={I.Check} size={48} /></div>{t('none_to_refill')}</div> : (
            <div className="list" data-testid="low-list">{low.map((it) => <div key={it.product_id + it.shelf_code} className="card" onClick={() => pickItem(it)}><div className="thumb">{it.photo_url ? <img src={it.photo_url} alt="" /> : <Icon name={I.Product} size={32} />}</div><div className="body"><div className="t">{n(it)}</div><div className="s"><span className="label-chip" style={{ background: '#1565C0' }}>{it.shelf_code}</span> {t('shelf_has')} {Number(it.shelf_qty)} · {t('backroom_has')} {Number(it.backroom_qty)}</div></div><div className="status"><span className="dot" style={{ background: Number(it.shelf_qty) <= 0 ? 'var(--red)' : 'var(--yellow)' }} /></div></div>)}</div>
          )}
          <div className="confirm-wrap"><button className="btn btn-ghost" onClick={() => setStep('shelf')} data-testid="refill-scan"><Icon name={I.Camera} size={24} /> {t('scan_shelf')}</button></div>
          {count > 0 && <div className="confirm-wrap"><button className="btn btn-primary" onClick={() => setStep('done')}><Icon name={I.Check} size={26} /> {t('done')}（{count}）</button></div>}
        </>
      )}
      {step === 'shelf' && <Scanner onScan={onScanShelf} instruction={t('scan_shelf')} icon={I.Shelf} enabled={!err} />}
      {step === 'product' && shelf && <><div className="instruct"><span className="label-chip" style={{ background: '#1565C0', fontSize: 28 }}>{shelf.code}</span></div><Scanner onScan={onScanProduct} instruction={t('scan_product')} icon={I.Product} enabled={!err && !askAssign} /></>}
      {step === 'qty' && cur && shelf && (
        <>
          <ProductHead p={cur} sub={`${back[0]?.code ?? '?'} (${t('backroom_has')} ${back[0]?.qty ?? 0}) → ${shelf.code}`} />
          <QtyPad value={qty} onChange={setQty} unit={cur.unit === 'KG' ? t('unit_kg') : t('unit_pcs')} allowDecimal={cur.unit === 'KG'} placeholder={defQty} />
          {back[0] && Number(qty || defQty) > back[0].qty && <div className="overlay-bar bar-offline"><Icon name={I.Warn} size={20} /> {t('backroom_has')} {back[0].qty}</div>}
          <div className="confirm-wrap"><button className="btn btn-primary btn-xl" disabled={!(Number(qty || defQty) > 0) || !back[0]} onClick={confirm} data-testid="qty-confirm"><Icon name={I.Check} size={26} /> {t('confirm')} {qty || defQty}</button></div>
        </>
      )}
    </Page>
  );
}
