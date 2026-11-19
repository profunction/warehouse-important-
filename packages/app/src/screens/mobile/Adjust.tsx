// M4 手动调整：扫产品 → 扫货位 → 输新数量 → 选原因 → 拍照 → 送审批。需要网络（审批）。
// 照片不走上传接口（第一阶段没有），在手机上缩到 ≤800px 的 JPEG 以 data URL 放进 photo_url（通常 <80KB）。
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '../../i18n/index.js';
import { Icon, I } from '../../ui/icons.js';
import { Scanner } from '../../ui/Scanner.js';
import { DoneScreen, ErrorScreen, Page, ProductHead, QtyPad, TopBar } from '../../ui/Shell.js';
import { resolveProduct, resolveLocation } from './flow.js';
import { stockAt } from '../../offline/db.js';
import { api, ApiError } from '../../api/client.js';
import { fx } from '../../ui/feedback.js';

const REASONS = ['DAMAGED', 'EXPIRED', 'SAMPLE', 'MISCOUNT', 'OTHER'] as const;
async function shrink(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const k = Math.min(1, 800 / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height); return c.toDataURL('image/jpeg', 0.7);
  } finally { URL.revokeObjectURL(url); }
}
export default function Adjust() {
  const { t, n, lang } = useT(); const nav = useNavigate(); const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<'prod' | 'loc' | 'qty' | 'reason' | 'photo' | 'done'>('prod');
  const [cur, setCur] = useState<{ product: any; barcode: string } | null>(null); const [loc, setLoc] = useState<any>(null); const [now, setNow] = useState(0);
  const [qty, setQty] = useState(''); const [reason, setReason] = useState<string | null>(null); const [photo, setPhoto] = useState<string | null>(null); const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null); const [result, setResult] = useState<any>(null); const [busy, setBusy] = useState(false);
  const onProd = async (code: string) => { const f = await resolveProduct(code); if (!f) { setErr(t('not_in_system')); return; } setCur({ product: f.product, barcode: code }); setStep('loc'); };
  const onLoc = async (code: string) => { const l = await resolveLocation(code); if (!l || l.is_virtual) { setErr(t('not_in_system')); return; } setLoc(l); setNow(await stockAt(cur!.product.id, l.id)); setQty(''); setStep('qty'); };
  const newQty = Number(qty);
  const submit = async () => {
    if (!cur || !loc || !reason || !photo) return; setBusy(true);
    try { const r = await api('/adjustments', { body: { client_id: crypto.randomUUID(), product_id: cur.product.id, location_id: loc.id, new_qty: newQty, reason, photo_url: photo, note: note || undefined } }); setResult(r); fx.done(); setStep('done'); }
    catch (e) { setErr(e instanceof ApiError ? e.text(lang) : String(e)); } finally { setBusy(false); }
  };
  const reset = () => { setCur(null); setLoc(null); setQty(''); setReason(null); setPhoto(null); setNote(''); setStep('prod'); };
  if (step === 'done' && result) return <DoneScreen title={result.status === 'APPROVED' ? t('adjust_applied') : t('adjust_submitted')} lines={[result.summary?.title ?? '']} onNext={reset} onHome={() => nav('/m')} />;
  const back: Record<string, () => void> = { prod: () => nav('/m'), loc: () => setStep('prod'), qty: () => setStep('loc'), reason: () => setStep('qty'), photo: () => setStep('reason') };
  return (
    <Page>
      <TopBar title={t('adjust_title')} progress={({ prod: '1/5', loc: '2/5', qty: '3/5', reason: '4/5', photo: '5/5' } as Record<string, string>)[step]} confirmBack={step === 'photo'} onBack={back[step]} />
      {err && <ErrorScreen msg={err} onOk={() => setErr(null)} />}
      {step === 'prod' && <Scanner onScan={onProd} instruction={t('scan_product')} icon={I.Product} enabled={!err} />}
      {step === 'loc' && cur && <><ProductHead p={cur.product} barcode={cur.barcode} /><Scanner onScan={onLoc} instruction={t('scan_location')} icon={I.MapPin} enabled={!err} /></>}
      {step === 'qty' && cur && (
        <>
          <ProductHead p={cur.product} sub={`${loc.code} · ${t('adjust_now_qty')} ${now} ${cur.product.unit === 'KG' ? t('unit_kg') : t('unit_pcs')}`} />
          <div className="instruct"><span>{t('adjust_new_qty')}</span></div>
          <QtyPad value={qty} onChange={setQty} unit={cur.product.unit === 'KG' ? t('unit_kg') : t('unit_pcs')} allowDecimal={cur.product.unit === 'KG'} />
          <div className="confirm-wrap"><button className="btn btn-primary btn-xl" disabled={qty === ''} onClick={() => { if (newQty === now) { setErr(t('adjust_no_change')); return; } fx.tap(); setStep('reason'); }} data-testid="qty-confirm"><Icon name={I.Check} size={26} /> {t('confirm')} {now} → {qty || '0'}</button></div>
        </>
      )}
      {step === 'reason' && cur && (
        <>
          <ProductHead p={cur.product} sub={`${loc.code} · ${now} → ${newQty}`} />
          <div className="instruct"><span>{t('adjust_reason')}</span></div>
          <div className="login" style={{ paddingTop: 0 }}>
            {REASONS.map((r) => <button key={r} className={`btn ${reason === r ? 'btn-primary' : 'btn-secondary'}`} style={{ minHeight: 72 }} onClick={() => { fx.tap(); setReason(r); }} data-testid={`reason-${r}`}>{t('reason_' + r)}</button>)}
            <input placeholder={t('note_optional')} value={note} onChange={(e) => setNote(e.target.value)} />
            <button className="btn btn-primary btn-xl" disabled={!reason} onClick={() => setStep('photo')}><Icon name={I.Check} size={26} /> {t('next')}</button>
          </div>
        </>
      )}
      {step === 'photo' && cur && (
        <>
          <ProductHead p={cur.product} sub={`${loc.code} · ${now} → ${newQty} · ${t('reason_' + reason)}`} />
          <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={async (e) => { const f = e.target.files?.[0]; if (f) { try { setPhoto(await shrink(f)); fx.scanOk(); } catch { setErr(t('camera_denied')); } } }} />
          {photo ? <div style={{ padding: '12px var(--pad)' }}><img src={photo} alt="" style={{ width: '100%', maxHeight: 300, objectFit: 'contain', background: '#000' }} /></div> : <div className="empty"><div className="big" style={{ borderColor: 'var(--muted)', color: 'var(--muted)' }}><Icon name={I.Camera} size={40} /></div>{t('adjust_photo_required')}</div>}
          <div className="confirm-wrap" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <button className="btn btn-secondary btn-xl" onClick={() => fileRef.current?.click()} data-testid="take-photo"><Icon name={I.Camera} size={26} /> {photo ? t('adjust_retake') : t('take_photo')}</button>
            <button className="btn btn-primary btn-xl" disabled={!photo || busy} onClick={submit} data-testid="adjust-submit"><Icon name={I.Check} size={26} /> {t('adjust_submit')}</button>
          </div>
        </>
      )}
    </Page>
  );
}
