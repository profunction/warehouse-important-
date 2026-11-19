// 老板手机 O2 订货：今日建议按供应商分组，改数量 / 不要，全部批准 → 生成 PO；"新订单"扫产品输数量 → 按供应商开 PO。需联网。
// 约定：改数量走 PUT /order-proposals/:id/lines（老板有 order.approve 可在 PENDING_APPROVAL 时改）；批准走 POST /order-proposals/:id/approve。
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '../../i18n/index.js';
import { Icon, I } from '../../ui/icons.js';
import { useAuth } from '../../store/auth.js';
import { Scanner } from '../../ui/Scanner.js';
import { Confirm, DoneScreen, ErrorScreen, Page, ProductHead, QtyPad, TopBar } from '../../ui/Shell.js';
import { api, ApiError, isOnline } from '../../api/client.js';
import { uuidv7 } from '../../offline/sync.js';
import { resolveProduct } from './flow.js';
import { db } from '../../offline/db.js';
import { fx } from '../../ui/feedback.js';

const errMsg = (e: any, lang: 'zh' | 'ms' | 'en') => (e instanceof ApiError ? e.text(lang) : String(e?.message ?? e));
type NewLine = { product: any; qty: number; pack_qty: number; barcode: string };
export default function Orders() {
  const { t, n, lang } = useT(); const { me, has } = useAuth(); const nav = useNavigate();
  const [prop, setProp] = useState<any | null | undefined>(undefined); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'proposal' | 'edit' | 'new' | 'newqty' | 'done'>('proposal'); const [editLine, setEditLine] = useState<any>(null); const [qty, setQty] = useState(''); const [ask, setAsk] = useState<'approve' | 'reject' | 'order' | null>(null);
  const [newLines, setNewLines] = useState<NewLine[]>([]); const [cur, setCur] = useState<{ product: any; pack_qty: number; barcode: string; case_qty?: number } | null>(null); const [result, setResult] = useState<any>(null);
  const canApprove = has('order.approve'); const canReview = has('order.review') || canApprove;
  const load = async () => { try { setProp(await api('/order-proposals/today')); } catch (e) { setProp(null); setErr(errMsg(e, lang)); } };
  useEffect(() => { if (isOnline()) void load(); else { setProp(null); setErr(t('needs_network')); } }, []);
  const lines: any[] = prop?.lines ?? [];
  const groups = new Map<string, any[]>(); for (const l of lines) { const k = l.supplier_name ?? t('no_supplier'); if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(l); }
  const live = lines.filter((l) => !l.is_removed); const total = live.reduce((a, l) => a + Number(l.amount ?? 0), 0);
  const saveLine = async (patch: any) => {
    setBusy(true); try { setProp(await api(`/order-proposals/${prop.id}/lines`, { method: 'PUT', body: { lines: [{ id: editLine?.id ?? patch.id, ...patch }] } })); setMode('proposal'); setEditLine(null); fx.scanOk(); } catch (e) { setErr(errMsg(e, lang)); } finally { setBusy(false); }
  };
  const decide = async (decision: 'approve' | 'reject') => {
    setBusy(true); setAsk(null);
    try {
      const r = canApprove ? await api(`/order-proposals/${prop.id}/approve`, { body: { decision } }) : await api(`/order-proposals/${prop.id}/submit`, { body: {} });
      setResult({ kind: decision, pos: r.purchase_orders?.length ?? 0, submitted: !canApprove }); setMode('done');
    } catch (e) { setErr(errMsg(e, lang)); } finally { setBusy(false); }
  };
  const generate = async () => { setBusy(true); try { const r = await api('/order-proposals/generate', { body: {} }); if (!r.proposal) setErr(t('nothing_low')); else await load(); } catch (e) { setErr(errMsg(e, lang)); } finally { setBusy(false); } };
  // 新订单
  const onScan = async (code: string) => {
    const f = await resolveProduct(code); if (!f) { setErr(t('not_in_system')); return; }
    const caseBc = await db.barcode.where('product_id').equals(f.product.id).filter((b) => b.barcode_type === 'CASE').first();
    setCur({ product: f.product, pack_qty: f.pack_qty, barcode: code, case_qty: caseBc ? Number(caseBc.pack_qty) : undefined }); setQty(''); setMode('newqty');
  };
  const addNew = () => { if (!cur || !(Number(qty) > 0)) return; fx.scanOk(); setNewLines([...newLines, { product: cur.product, qty: Number(qty) * cur.pack_qty, pack_qty: cur.pack_qty, barcode: cur.barcode }]); setCur(null); setMode('new'); };
  const placeOrder = async () => {
    setBusy(true); setAsk(null);
    try {
      const r = await api('/order-proposals', { body: { lines: newLines.map((l) => ({ product_id: l.product.id, qty: l.qty })) } });
      const a = canApprove ? await api(`/order-proposals/${r.id}/approve`, { body: { decision: 'approve' } }) : await api(`/order-proposals/${r.id}/submit`, { body: {} });
      setResult({ kind: 'order', pos: a.purchase_orders?.length ?? 0, submitted: !canApprove }); setNewLines([]); setMode('done');
    } catch (e) { setErr(errMsg(e, lang)); } finally { setBusy(false); }
  };
  const statusLabel = (s: string) => (t('status_' + s) === 'status_' + s ? s : t('status_' + s));
  if (mode === 'done') return <DoneScreen title={result.kind === 'reject' ? t('status_REJECTED') : result.submitted ? t('pending_approval') : result.kind === 'order' ? t('order_placed') : t('approved_pos', { n: result.pos })} lines={result.kind !== 'reject' && !result.submitted ? [t('approved_pos', { n: result.pos }), t('pdf_sent')] : []} onNext={() => { setMode('proposal'); void load(); }} nextText={t('orders')} onHome={() => nav('/m')} />;
  return (
    <Page>
      <TopBar title={mode === 'new' || mode === 'newqty' ? t('new_order') : t('todays_proposal')} progress={mode === 'new' ? `${newLines.length}` : live.length ? `${live.length}` : undefined} onBack={() => (mode === 'proposal' ? nav('/m') : mode === 'newqty' ? setMode('new') : setMode('proposal'))} confirmBack={mode === 'new' && newLines.length > 0} />
      {err && <ErrorScreen msg={err} onOk={() => setErr(null)} />}
      {ask && <Confirm msg={ask === 'approve' ? `${t('approve_all')}？${live.length} · RM ${total.toFixed(2)}` : ask === 'reject' ? `${t('reject')}？` : `${t('new_order')}：${newLines.length} · ${t('confirm')}？`} okText={ask === 'reject' ? t('reject') : t('confirm')} danger={ask === 'reject'} onOk={() => (ask === 'order' ? placeOrder() : decide(ask))} onCancel={() => setAsk(null)} />}
      {mode === 'proposal' && (
        <>
          <div className="confirm-wrap"><button className="btn btn-secondary btn-xl" onClick={() => { fx.tap(); setMode('new'); }} data-testid="new-order"><Icon name={I.Product} size={26} /> {t('new_order')}</button></div>
          {prop === undefined ? <div className="empty">{t('loading')}</div> : !prop ? (
            <div className="empty"><div className="big"><Icon name={I.Check} size={48} /></div>{t('no_proposal_today')}{canReview && <div className="confirm-wrap"><button className="btn btn-ghost" disabled={busy} onClick={generate}>{t('generate_now')}</button></div>}</div>
          ) : (
            <>
              <div className="kv"><span className="k">{String(prop.proposal_date).slice(0, 10)} · {statusLabel(prop.status)}</span><b>RM {total.toFixed(2)}</b></div>
              {[...groups.entries()].map(([sup, ls]) => (
                <div key={sup}>
                  <div className="section">{sup} · RM {ls.filter((l) => !l.is_removed).reduce((a, l) => a + Number(l.amount ?? 0), 0).toFixed(2)}</div>
                  <div className="list">{ls.map((l) => (
                    <div key={l.id} className="card" style={{ opacity: l.is_removed ? 0.45 : 1 }} onClick={() => { if (!canReview || !['PENDING_REVIEW', 'PENDING_APPROVAL', 'RETURNED'].includes(prop.status)) return; fx.tap(); setEditLine(l); setQty(String(Number(l.final_qty))); setMode('edit'); }}>
                      <div className="thumb">{l.photo_url ? <img src={l.photo_url} alt="" /> : <Icon name={I.Product} size={30} />}</div>
                      <div className="body"><div className="t">{n(l)}</div><div className="s">{t('current_qty')} {Number(l.current_qty)} · {t('suggested_qty')} {Number(l.suggested_qty)}{l.case_qty && Number(l.case_qty) > 1 ? `（${t('boxes_n', { n: Math.round((Number(l.final_qty) / Number(l.case_qty)) * 10) / 10 })}）` : ''}</div></div>
                      <div className="status" style={{ fontSize: 24, color: l.is_removed ? 'var(--red)' : 'var(--ink)', fontFamily: 'var(--serif)' }}>{l.is_removed ? t('remove_line') : Number(l.final_qty)}</div>
                    </div>
                  ))}</div>
                </div>
              ))}
              {['PENDING_REVIEW', 'PENDING_APPROVAL', 'RETURNED'].includes(prop.status) && canReview && (
                <>
                  <div className="confirm-wrap"><button className="btn btn-primary btn-xl" disabled={busy || live.length === 0} onClick={() => setAsk('approve')} data-testid="approve-all"><Icon name={I.Check} size={26} /> {canApprove ? t('approve_all') : t('submit_review')}</button></div>
                  {canApprove && <div className="row2"><button className="btn btn-danger" disabled={busy} onClick={() => setAsk('reject')}><Icon name={I.Close} size={22} /> {t('reject')}</button></div>}
                </>
              )}
              {prop.status === 'APPROVED' && prop.purchase_orders?.length > 0 && <div className="list">{prop.purchase_orders.map((p: any) => <div key={p.id} className="kv"><span className="k">{p.po_no}</span><b style={{ fontSize: 22 }}>{statusLabel(p.status)}{p.total_amount != null ? ` · RM ${Number(p.total_amount).toFixed(2)}` : ''}</b></div>)}</div>}
            </>
          )}
        </>
      )}
      {mode === 'edit' && editLine && (
        <>
          <ProductHead p={editLine} sub={`${t('current_qty')} ${Number(editLine.current_qty)} · ${t('suggested_qty')} ${Number(editLine.suggested_qty)} · ${editLine.supplier_name ?? t('no_supplier')}`} />
          <QtyPad value={qty} onChange={setQty} unit={t('unit_pcs')} caseQty={editLine.case_qty ? Number(editLine.case_qty) : undefined} />
          <div className="row2">
            <button className="btn btn-ghost" disabled={busy} onClick={() => saveLine({ is_removed: !editLine.is_removed })}><Icon name={I.Close} size={22} /> {editLine.is_removed ? t('restore_line') : t('remove_line')}</button>
            <button className="btn btn-primary" disabled={busy || !(Number(qty) >= 0)} onClick={() => saveLine({ final_qty: Number(qty), is_removed: false })} data-testid="line-save"><Icon name={I.Check} size={22} /> {t('confirm')} {qty}</button>
          </div>
        </>
      )}
      {mode === 'new' && (
        <>
          <Scanner onScan={onScan} instruction={t('scan_product')} icon={I.Product} last={newLines.length ? `${n(newLines[newLines.length - 1].product)} × ${newLines[newLines.length - 1].qty}` : undefined} enabled={!err && !ask} />
          {newLines.length > 0 && <>
            <div className="list">{newLines.map((l, i) => <div key={i} className="card" onClick={() => setNewLines(newLines.filter((_, j) => j !== i))}><div className="thumb"><Icon name={I.Product} size={30} /></div><div className="body"><div className="t">{n(l.product)}</div><div className="s">{l.qty} {t('unit_pcs')} · {t('remove')}</div></div></div>)}</div>
            <div className="confirm-wrap"><button className="btn btn-primary btn-xl" disabled={busy} onClick={() => setAsk('order')} data-testid="place-order"><Icon name={I.Check} size={26} /> {t('confirm')}（{newLines.length}）</button></div>
          </>}
        </>
      )}
      {mode === 'newqty' && cur && (
        <>
          <ProductHead p={cur.product} barcode={cur.barcode} sub={cur.pack_qty > 1 ? `1 ${t('case')} = ${cur.pack_qty} ${t('unit_pcs')}` : me?.company.plan === 'A' ? t('new_order') : ''} />
          <QtyPad value={qty} onChange={setQty} unit={cur.pack_qty > 1 ? t('case') : t('unit_pcs')} caseQty={cur.pack_qty > 1 ? 1 : cur.case_qty} />
          <div className="confirm-wrap"><button className="btn btn-primary btn-xl" disabled={!(Number(qty) > 0)} onClick={addNew} data-testid="qty-confirm"><Icon name={I.Check} size={26} /> {t('confirm')} {Number(qty) * cur.pack_qty || ''}</button></div>
        </>
      )}
    </Page>
  );
}
