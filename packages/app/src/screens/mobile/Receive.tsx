// A2 收货（无单）：扫产品 → 输数量（可到期日、损坏）→ 回到扫描；完成屏
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '../../i18n/index.js';
import { Icon, I } from '../../ui/icons.js';
import { useAuth } from '../../store/auth.js';
import { Scanner } from '../../ui/Scanner.js';
import { DoneScreen, ErrorScreen, ExpiryPicker, Page, ProductHead, QtyPad, TopBar } from '../../ui/Shell.js';
import { resolveProduct, resolveLocation, virtualLoc, zoneAllows, queueMovement, defaultBackroom } from './flow.js';
import { fx } from '../../ui/feedback.js';
import { db } from '../../offline/db.js';

type Line = { product: any; qty: number; location: string };
export default function Receive() {
  const { t, n, lang } = useT(); const { me } = useAuth(); const nav = useNavigate();
  const [step, setStep] = useState<'scan' | 'qty' | 'expiry' | 'location' | 'done'>('scan');
  const [cur, setCur] = useState<{ product: any; pack_qty: number; barcode: string; weight_kg: number | null; case_qty?: number } | null>(null);
  const [qty, setQty] = useState(''); const [expiry, setExpiry] = useState<string | null>(null); const [target, setTarget] = useState<any>(null);
  const [lines, setLines] = useState<Line[]>([]); const [err, setErr] = useState<string | null>(null); const [damaged, setDamaged] = useState(0); const [flash, setFlash] = useState<'green' | null>(null);
  const unitQty = Math.round((Number(qty) || 0) * (cur?.pack_qty ?? 1) * 1000) / 1000;
  const onScanProduct = async (code: string) => {
    const f = await resolveProduct(code); if (!f) { setErr(t('not_in_system')); return; }
    const caseBc = await db.barcode.where('product_id').equals(f.product.id).filter((b) => b.barcode_type === 'CASE').first();
    setCur({ product: f.product, pack_qty: f.pack_qty, barcode: code, weight_kg: f.weight_kg, case_qty: caseBc ? Number(caseBc.pack_qty) : undefined });
    setQty(f.weight_kg != null ? String(f.weight_kg) : ''); setExpiry(null);
    const loc = await defaultBackroom(f.product); setTarget(loc);
    setStep('qty');
  };
  const afterQty = () => { if (!cur || unitQty <= 0) return; fx.tap(); if (cur.product.shelf_life_days) setStep('expiry'); else void confirmTarget(); };
  const confirmTarget = async (exp: string | null = expiry) => {
    if (!cur) return;
    if (!target) { setStep('location'); return; }
    await commit(target, exp);
  };
  const onScanLocation = async (code: string) => {
    const l = await resolveLocation(code); if (!l) { setErr(t('not_in_system')); return; }
    if (!(await zoneAllows(l.id, cur!.product.category_id))) { setErr(t('reason_RECEIVE') + '：' + (lang === 'zh' ? '这类产品不能放这个区' : lang === 'ms' ? 'Kategori ini tidak boleh di zon ini' : 'This category is not allowed in this zone')); return; }
    await commit(l, expiry);
  };
  const commit = async (loc: any, exp: string | null) => {
    if (!cur || !me) return;
    if (!(await zoneAllows(loc.id, cur.product.category_id))) { setTarget(null); setErr(lang === 'zh' ? '这类产品不能放这个区' : lang === 'ms' ? 'Kategori ini tidak boleh di zon ini' : 'This category is not allowed in this zone'); setStep('location'); return; }
    const sup = await virtualLoc('SUPPLIER'); if (!sup) { setErr(t('stale_data')); return; }
    await queueMovement(me, { product_id: cur.product.id, from_location_id: sup.id, to_location_id: loc.id, qty: unitQty, reason: 'RECEIVE', expiry_date: exp, summary: `${t('receive')} ${n(cur.product)} ${unitQty}` });
    if (damaged > 0) { const dmg = await virtualLoc('DAMAGED'); if (dmg) await queueMovement(me, { product_id: cur.product.id, from_location_id: sup.id, to_location_id: dmg.id, qty: damaged, reason: 'RECEIVE', note: 'damaged', summary: `${t('damaged')} ${n(cur.product)} ${damaged}` }); }
    setLines([...lines, { product: cur.product, qty: unitQty, location: loc.code }]);
    fx.scanOk(); setFlash('green'); setTimeout(() => setFlash(null), 600);
    setCur(null); setQty(''); setDamaged(0); setStep('scan');
  };
  const total = lines.reduce((a, l) => a + l.qty, 0);
  if (step === 'done') return <DoneScreen title={t('receive_done')} lines={[t('items_summary', { p: lines.length, q: total })]} onNext={() => { setLines([]); setStep('scan'); }} onHome={() => nav('/m')} />;
  return (
    <Page flash={flash}>
      <TopBar title={t('receive_title')} progress={lines.length ? `${lines.length}` : undefined} confirmBack={step !== 'scan' || lines.length === 0 ? step !== 'scan' : false} onBack={() => (step === 'scan' ? (lines.length ? setStep('done') : nav('/m')) : setStep('scan'))} />
      {err && <ErrorScreen msg={err} onOk={() => setErr(null)} />}
      {step === 'scan' && (
        <>
          <Scanner onScan={onScanProduct} instruction={t('scan_product')} icon={I.Product} last={lines.length ? `${n(lines[lines.length - 1].product)} ✓ ${lines[lines.length - 1].qty}` : undefined} enabled={!err} />
          {lines.length > 0 && <div className="confirm-wrap"><button className="btn btn-primary btn-xl" onClick={() => setStep('done')} data-testid="finish"><Icon name={I.Check} size={26} /> {t('done')}（{lines.length}）</button></div>}
        </>
      )}
      {step === 'qty' && cur && (
        <>
          <ProductHead p={cur.product} barcode={cur.barcode} sub={`${cur.pack_qty > 1 ? `1 ${t('case')} = ${cur.pack_qty} ${t('unit_pcs')} · ` : ''}${t('put_at')} ${target?.code ?? '?'}`} />
          <QtyPad value={qty} onChange={setQty} unit={cur.pack_qty > 1 ? t('case') : cur.product.unit === 'KG' ? t('unit_kg') : t('unit_pcs')} caseQty={cur.pack_qty > 1 ? 1 : cur.case_qty} allowDecimal={cur.product.unit === 'KG'} auto={cur.weight_kg != null} />
          <div className="row2">
            <button className="btn btn-ghost" onClick={() => { const d = prompt(t('damaged_qty')); if (d) setDamaged(Number(d) || 0); }}><Icon name={I.Warn} size={22} /> {t('damaged')}{damaged ? ` ${damaged}` : ''}</button>
          </div>
          <div className="confirm-wrap"><button className="btn btn-primary btn-xl" disabled={unitQty <= 0} onClick={afterQty} data-testid="qty-confirm"><Icon name={I.Check} size={26} /> {t('confirm')} {unitQty} {cur.product.unit === 'KG' ? t('unit_kg') : t('unit_pcs')}</button></div>
        </>
      )}
      {step === 'expiry' && cur && <><ProductHead p={cur.product} /><ExpiryPicker onPick={(d) => { setExpiry(d); void confirmTarget(d); }} onSkip={() => void confirmTarget(null)} /></>}
      {step === 'location' && cur && <><ProductHead p={cur.product} sub={`${unitQty} ${t('unit_pcs')}`} /><Scanner onScan={onScanLocation} instruction={t('scan_location')} icon={I.MapPin} enabled={!err} /></>}
    </Page>
  );
}
