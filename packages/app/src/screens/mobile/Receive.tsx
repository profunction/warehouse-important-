// A2 / B2 收货 W1–W5：选待收 PO（顶部"无单收货"）→ 扫产品（显示应收/已收）→ 输数量（箱码默认按箱）→ 到期日 → 损坏数 + 拍照 → 完成对比差异开工单。
// 约定（设计文档没写的）：
//  - 在线时一律走 GRN（POST /goods-receipts → /lines → /complete）；离线时收货行 enqueue 为 entity 'grn_line'（已开 GRN）或退回旧的 movement 方式（没开 GRN）。
//  - 没有待收 PO 时直接进"无单收货"扫描，不多一步；A 模式（receive_direct_to_backroom）目标位置用本地默认后仓位，否则由服务器放收货区。
//  - 扫到不在 PO 上的产品先问一次"照样收吗"。
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '../../i18n/index.js';
import { Icon, I } from '../../ui/icons.js';
import { useAuth } from '../../store/auth.js';
import { Scanner } from '../../ui/Scanner.js';
import { Confirm, DoneScreen, ErrorScreen, ExpiryPicker, Page, ProductHead, QtyPad, TopBar } from '../../ui/Shell.js';
import { resolveProduct, resolveLocation, virtualLoc, zoneAllows, queueMovement, defaultBackroom } from './flow.js';
import { fx } from '../../ui/feedback.js';
import { db, applyLocalMovement } from '../../offline/db.js';
import { api, ApiError, isOnline } from '../../api/client.js';
import { enqueue, uuidv7 } from '../../offline/sync.js';

type Line = { product: any; qty: number; damaged: number; location: string };
type PoLine = { product_id: string; ordered: number; received: number; name_zh?: string; name_ms?: string; name_en?: string; case_qty?: number | null };
const errMsg = (e: any, lang: 'zh' | 'ms' | 'en') => (e instanceof ApiError ? e.text(lang) : String(e?.message ?? e));

export default function Receive() {
  const { t, n, lang } = useT(); const { me } = useAuth(); const nav = useNavigate();
  const [step, setStep] = useState<'list' | 'scan' | 'qty' | 'expiry' | 'damage' | 'location' | 'done'>('list');
  const [pending, setPending] = useState<any[] | null>(null);
  const [grn, setGrn] = useState<any>(null); const [po, setPo] = useState<any>(null); const poLines = useRef<Map<string, PoLine>>(new Map());
  const [cur, setCur] = useState<{ product: any; pack_qty: number; barcode: string; weight_kg: number | null; case_qty?: number } | null>(null);
  const [qty, setQty] = useState(''); const [expiry, setExpiry] = useState<string | null>(null); const [target, setTarget] = useState<any>(null);
  const [lines, setLines] = useState<Line[]>([]); const [err, setErr] = useState<string | null>(null); const [damaged, setDamaged] = useState(''); const [photo, setPhoto] = useState<string | null>(null); const [flash, setFlash] = useState<'green' | null>(null);
  const [askNotOnPo, setAskNotOnPo] = useState<any>(null); const [result, setResult] = useState<any>(null); const [busy, setBusy] = useState(false);
  const unitQty = Math.round((Number(qty) || 0) * (cur?.pack_qty ?? 1) * 1000) / 1000;
  const directBackroom = !!(me?.company.settings as any)?.receive_direct_to_backroom;

  useEffect(() => { (async () => {
    if (!isOnline()) { setPending([]); await startNoPo(); return; }
    try { const list = await api('/goods-receipts/pending'); setPending(list); if (!list.length) await startNoPo(); }
    catch { setPending([]); await startNoPo(); }
  })(); }, []);

  const startNoPo = async () => {
    fx.tap(); poLines.current = new Map(); setPo(null);
    if (isOnline()) { try { setGrn(await api('/goods-receipts', { body: {} })); } catch { setGrn(null); } } else setGrn(null);
    setStep('scan');
  };
  const startPo = async (p: any) => {
    fx.tap(); setBusy(true);
    try {
      const g = await api('/goods-receipts', { body: { po_id: p.id } });
      const d = await api(`/purchase-orders/${p.id}`);
      poLines.current = new Map(d.lines.map((l: any) => [l.product_id, { product_id: l.product_id, ordered: Number(l.ordered_qty), received: Number(l.received_qty), name_zh: l.name_zh, name_ms: l.name_ms, name_en: l.name_en, case_qty: l.case_qty }]));
      setGrn(g); setPo(d); setStep('scan');
    } catch (e) { setErr(errMsg(e, lang)); } finally { setBusy(false); }
  };
  const onScanProduct = async (code: string) => {
    let f = await resolveProduct(code);
    if (!f && isOnline()) { try { const p = await api(`/products/by-barcode/${encodeURIComponent(code)}`); if (p) f = { product: p, pack_qty: Number(p.pack_qty ?? 1), barcode_type: p.barcode_type ?? 'UNIT', weight_kg: null }; } catch { /* 下面报错 */ } }
    if (!f) { setErr(t('not_in_system')); return; }
    if (po && !poLines.current.has(f.product.id)) { setAskNotOnPo({ f, code }); return; }
    await begin(f, code);
  };
  const begin = async (f: any, code: string) => {
    const caseBc = await db.barcode.where('product_id').equals(f.product.id).filter((b) => b.barcode_type === 'CASE').first();
    setCur({ product: f.product, pack_qty: f.pack_qty, barcode: code, weight_kg: f.weight_kg, case_qty: caseBc ? Number(caseBc.pack_qty) : undefined });
    setQty(f.weight_kg != null ? String(f.weight_kg) : ''); setExpiry(null); setDamaged(''); setPhoto(null);
    setTarget(directBackroom ? await defaultBackroom(f.product) : null);
    setStep('qty');
  };
  const afterQty = () => { if (!cur || (unitQty <= 0 && !(Number(damaged) > 0))) return; fx.tap(); if (cur.product.shelf_life_days) setStep('expiry'); else void confirmTarget(); };
  const confirmTarget = async (exp: string | null = expiry) => {
    if (!cur) return;
    if (directBackroom && !target) { setStep('location'); return; }   // A 模式没有默认后仓位 → 扫货位
    await commit(target, exp);
  };
  const onScanLocation = async (code: string) => {
    const l = await resolveLocation(code); if (!l) { setErr(t('not_in_system')); return; }
    if (!(await zoneAllows(l.id, cur!.product.category_id))) { setErr(t('wrong_location', { got: l.code, want: '?' })); return; }
    await commit(l, expiry);
  };
  const commit = async (loc: any, exp: string | null) => {
    if (!cur || !me) return;
    if (loc && !(await zoneAllows(loc.id, cur.product.category_id))) { setTarget(null); setErr(lang === 'zh' ? '这类产品不能放这个区' : lang === 'ms' ? 'Kategori ini tidak boleh di zon ini' : 'This category is not allowed in this zone'); setStep('location'); return; }
    const dmg = Number(damaged) || 0; const client_id = uuidv7(); setBusy(true);
    try {
      if (grn) {
        const payload = { client_id, product_id: cur.product.id, qty: unitQty, damaged_qty: dmg, expiry_date: exp, to_location_id: loc?.id ?? null, photo_url: photo, performed_at: new Date().toISOString() };
        let locCode = loc?.code ?? '';
        if (isOnline()) { const r = await api(`/goods-receipts/${grn.id}/lines`, { body: payload }); locCode = r.line?.location_code ?? locCode; }
        else { await enqueue({ client_id, entity: 'grn_line', op: 'insert', user_id: me.user.id, summary: `${t('receive')} ${n(cur.product)} ${unitQty}`, payload: { ...payload, grn_id: grn.id } }); }
        const sup = await virtualLoc('SUPPLIER'); if (sup && loc && unitQty > 0) await applyLocalMovement(cur.product.id, sup.id, loc.id, unitQty);
        const pl = poLines.current.get(cur.product.id); if (pl) pl.received += unitQty;
        setLines([...lines, { product: cur.product, qty: unitQty, damaged: dmg, location: locCode }]);
      } else {
        const sup = await virtualLoc('SUPPLIER'); if (!sup || !loc) { setErr(t('stale_data')); return; }
        if (unitQty > 0) await queueMovement(me, { product_id: cur.product.id, from_location_id: sup.id, to_location_id: loc.id, qty: unitQty, reason: 'RECEIVE', expiry_date: exp, summary: `${t('receive')} ${n(cur.product)} ${unitQty}` });
        if (dmg > 0) { const d = await virtualLoc('DAMAGED'); if (d) await queueMovement(me, { product_id: cur.product.id, from_location_id: sup.id, to_location_id: d.id, qty: dmg, reason: 'RECEIVE', note: 'damaged', summary: `${t('damaged')} ${n(cur.product)} ${dmg}` }); }
        setLines([...lines, { product: cur.product, qty: unitQty, damaged: dmg, location: loc.code }]);
      }
      fx.scanOk(); setFlash('green'); setTimeout(() => setFlash(null), 600);
      setCur(null); setQty(''); setDamaged(''); setPhoto(null); setStep('scan');
    } catch (e) { setErr(errMsg(e, lang)); } finally { setBusy(false); }
  };
  const finish = async () => {
    if (!grn || !me) { setStep('done'); return; }
    setBusy(true);
    try {
      if (isOnline()) setResult(await api(`/goods-receipts/${grn.id}/complete`, { body: {} }));
      else { await enqueue({ client_id: uuidv7(), entity: 'grn_complete', op: 'insert', user_id: me.user.id, summary: `${t('done')} ${grn.grn_no}`, payload: { grn_id: grn.id } }); setResult({ offline: true }); }
      setStep('done');
    } catch (e) { setErr(errMsg(e, lang)); } finally { setBusy(false); }
  };
  const takePhoto = async (file: File | null) => {
    if (!file) return;
    if (!isOnline()) { setErr(t('needs_network')); return; }
    try { const fd = new FormData(); fd.append('file', file); const r = await api('/sync/photos', { body: fd }); setPhoto(r.url); fx.scanOk(); } catch (e) { setErr(errMsg(e, lang)); }
  };
  const expectedOf = (pid: string) => { const pl = poLines.current.get(pid); return pl ? { ordered: pl.ordered, received: pl.received } : null; };
  const total = lines.reduce((a, l) => a + l.qty, 0);
  const unitLabel = (p: any) => (p.unit === 'KG' ? t('unit_kg') : t('unit_pcs'));

  if (step === 'done') {
    const r = result ?? {}; const summ: string[] = [t('items_summary', { p: lines.length, q: total })];
    if (grn) summ.push(`${t('grn_no')} ${grn.grn_no}`);
    if (r.offline) summ.push(t('complete_offline_hint'));
    else if (result) {
      if (r.po_status) summ.push(r.po_status === 'RECEIVED' ? t('po_received') : t('po_partial'));
      if (r.short?.length) summ.push(`${t('short_items')}：${r.short.map((s: any) => `${s.name} −${s.diff}`).join('、')}`);
      if (r.over?.length) summ.push(`${t('over_items')}：${r.over.map((s: any) => `${s.name} +${s.diff}`).join('、')}`);
      if (r.damaged?.length) summ.push(`${t('damaged_items')}：${r.damaged.map((s: any) => `${s.name} ${s.qty}`).join('、')}`);
      if (!r.short?.length && !r.over?.length && !r.damaged?.length) summ.push(t('no_variance'));
    }
    const nTickets = r.tickets_opened?.length ?? 0;
    return <DoneScreen title={t('receive_done')} lines={summ} warn={nTickets ? t('tickets_opened', { n: nTickets }) : undefined} onNext={() => { setLines([]); setResult(null); setGrn(null); setPo(null); setPending(null); setStep('list'); void (async () => { try { const list = isOnline() ? await api('/goods-receipts/pending') : []; setPending(list); if (!list.length) await startNoPo(); } catch { setPending([]); await startNoPo(); } })(); }} onHome={() => nav('/m')} />;
  }
  const title = po ? `${t('receive_title')} · ${po.po_no}` : grn ? `${t('receive_title')} · ${t('receive_without_po')}` : t('receive_title');
  return (
    <Page flash={flash}>
      <TopBar title={title} progress={lines.length ? `${lines.length}` : undefined} confirmBack={step !== 'scan' && step !== 'list'} onBack={() => (step === 'list' ? nav('/m') : step === 'scan' ? (lines.length ? void finish() : nav('/m')) : setStep('scan'))} />
      {err && <ErrorScreen msg={err} onOk={() => setErr(null)} />}
      {askNotOnPo && <Confirm msg={`${n(askNotOnPo.f.product)}：${t('not_on_po')}`} okText={t('receive_anyway')} onOk={() => { const a = askNotOnPo; setAskNotOnPo(null); void begin(a.f, a.code); }} onCancel={() => setAskNotOnPo(null)} />}
      {step === 'list' && (
        <>
          <div className="confirm-wrap"><button className="btn btn-secondary btn-xl" onClick={startNoPo} data-testid="receive-no-po"><Icon name={I.Product} size={26} /> {t('receive_without_po')}</button></div>
          <div className="section">{t('pending_po')}</div>
          {pending === null ? <div className="empty">{t('loading')}</div> : (
            <div className="list" data-testid="po-list">
              {pending.map((p) => (
                <div key={p.id} className="card" onClick={() => !busy && startPo(p)} data-testid={`po-${p.po_no}`}>
                  <div className="thumb"><Icon name={I.Ticket} size={30} /></div>
                  <div className="body"><div className="t">{p.supplier_name}</div><div className="s">{p.po_no} · {t('lines_n', { n: p.line_count })}{p.expected_date ? ` · ${t('expected_date')} ${String(p.expected_date).slice(0, 10)}` : ''}{Number(p.received_total) > 0 ? ` · ${t('received_so_far')} ${Number(p.received_total)}/${Number(p.ordered_total)}` : ''}</div></div>
                  <div className="status">{p.status === 'PARTIAL' ? t('status_PARTIAL') : ''}</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      {step === 'scan' && (
        <>
          <Scanner onScan={onScanProduct} instruction={t('scan_product')} icon={I.Product} last={lines.length ? `${n(lines[lines.length - 1].product)} ✓ ${lines[lines.length - 1].qty}` : undefined} enabled={!err && !askNotOnPo} />
          {po && (
            <div className="list">
              {[...poLines.current.values()].map((pl) => <div key={pl.product_id} className="kv" style={{ padding: '10px var(--pad)' }}><span className="k">{n(pl)}</span><b style={{ fontSize: 22, color: pl.received >= pl.ordered ? 'var(--green)' : 'var(--ink)' }}>{pl.received} / {pl.ordered}</b></div>)}
            </div>
          )}
          {lines.length > 0 && <div className="confirm-wrap"><button className="btn btn-primary btn-xl" disabled={busy} onClick={finish} data-testid="finish"><Icon name={I.Check} size={26} /> {t('done')}（{lines.length}）</button></div>}
        </>
      )}
      {step === 'qty' && cur && (() => { const ex = expectedOf(cur.product.id); return (
        <>
          <ProductHead p={cur.product} barcode={cur.barcode} sub={`${cur.pack_qty > 1 ? `1 ${t('case')} = ${cur.pack_qty} ${t('unit_pcs')} · ` : ''}${ex ? `${t('expected')} ${Math.max(0, ex.ordered - ex.received)} · ${t('received_so_far')} ${ex.received}` : `${t('put_at')} ${target?.code ?? (directBackroom ? '?' : 'RCV')}`}`} />
          <QtyPad value={qty} onChange={setQty} unit={cur.pack_qty > 1 ? t('case') : unitLabel(cur.product)} caseQty={cur.pack_qty > 1 ? 1 : cur.case_qty} allowDecimal={cur.product.unit === 'KG'} auto={cur.weight_kg != null} />
          {ex && unitQty > 0 && ex.received + unitQty > ex.ordered && <div className="instruct" style={{ color: 'var(--brass)', fontSize: 20 }}>{t('more_than_expected', { n: ex.received + unitQty - ex.ordered })}</div>}
          <div className="row2">
            <button className="btn btn-ghost" onClick={() => { fx.tap(); setStep('damage'); }} data-testid="damaged"><Icon name={I.Warn} size={22} /> {t('damaged')}{Number(damaged) > 0 ? ` ${damaged}` : ''}</button>
          </div>
          <div className="confirm-wrap"><button className="btn btn-primary btn-xl" disabled={busy || (unitQty <= 0 && !(Number(damaged) > 0))} onClick={afterQty} data-testid="qty-confirm"><Icon name={I.Check} size={26} /> {t('confirm')} {unitQty} {unitLabel(cur.product)}</button></div>
        </>
      ); })()}
      {step === 'damage' && cur && (
        <>
          <ProductHead p={cur.product} sub={t('damaged_qty')} />
          <QtyPad value={damaged} onChange={setDamaged} unit={unitLabel(cur.product)} allowDecimal={cur.product.unit === 'KG'} />
          <div className="row2">
            <label className="btn btn-ghost" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}><Icon name={I.Camera} size={22} /> {photo ? t('photo_taken') : t('take_photo')}<input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={(e) => takePhoto(e.target.files?.[0] ?? null)} /></label>
            <button className="btn btn-primary" onClick={() => { fx.tap(); setStep('qty'); }} data-testid="damage-ok"><Icon name={I.Check} size={22} /> {t('confirm')}</button>
          </div>
          <div className="instruct" style={{ fontSize: 18, color: 'var(--muted)' }}>{t('damaged_photo_hint')}</div>
        </>
      )}
      {step === 'expiry' && cur && <><ProductHead p={cur.product} /><ExpiryPicker onPick={(d) => { setExpiry(d); void confirmTarget(d); }} onSkip={() => void confirmTarget(null)} /></>}
      {step === 'location' && cur && <><ProductHead p={cur.product} sub={`${unitQty} ${unitLabel(cur.product)}`} /><Scanner onScan={onScanLocation} instruction={t('scan_location')} icon={I.MapPin} enabled={!err} /></>}
    </Page>
  );
}
