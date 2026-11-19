// B3 收调拨 S7：扫调拨单二维码（或从运输中清单选）→ 逐箱扫产品 → 输数 → 完成（对比发出和收到，差异开工单）
// 约定：在线 POST /transfers/:id/receive-lines，离线 enqueue 'transfer_line_receive'（目的位置由服务器定：店收货区/后仓）；完成需联网。
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '../../i18n/index.js';
import { Icon, I } from '../../ui/icons.js';
import { useAuth } from '../../store/auth.js';
import { Scanner } from '../../ui/Scanner.js';
import { DoneScreen, ErrorScreen, Page, ProductHead, QtyPad, TopBar } from '../../ui/Shell.js';
import { api, ApiError, isOnline } from '../../api/client.js';
import { enqueue, uuidv7 } from '../../offline/sync.js';
import { resolveProduct } from './flow.js';
import { fx } from '../../ui/feedback.js';

const errMsg = (e: any, lang: 'zh' | 'ms' | 'en') => (e instanceof ApiError ? e.text(lang) : String(e?.message ?? e));
export default function ReceiveTransfer() {
  const { t, n, lang } = useT(); const { me } = useAuth(); const nav = useNavigate();
  const [list, setList] = useState<any[] | null>(null); const [tr, setTr] = useState<any>(null); const [recv, setRecv] = useState<Record<string, number>>({});
  const [step, setStep] = useState<'list' | 'scan' | 'qty' | 'done'>('list'); const [cur, setCur] = useState<any>(null); const [qty, setQty] = useState(''); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [result, setResult] = useState<any>(null);
  const load = async () => { try { setList(await api(`/transfers?status=IN_TRANSIT${me?.site ? `&to_site=${me.site.id}` : ''}`)); } catch (e) { setList([]); setErr(errMsg(e, lang)); } };
  useEffect(() => { if (isOnline()) void load(); else { setList([]); setErr(t('needs_network')); } }, []);
  const open = async (d: any) => { setTr(d); const r: Record<string, number> = {}; for (const l of d.lines) r[l.product_id] = Number(l.received_qty); setRecv(r); setStep('scan'); };
  const onScanTransfer = async (code: string) => {
    try { const d = await api(`/transfers/by-no/${encodeURIComponent(code)}`); if (!['IN_TRANSIT', 'PICKING'].includes(d.status)) { setErr(t('status_' + d.status) === 'status_' + d.status ? d.status : t('status_' + d.status)); return; } fx.tap(); await open(d); } catch (e) { setErr(errMsg(e, lang)); }
  };
  const onScanProduct = async (code: string) => {
    const f = await resolveProduct(code); if (!f) { setErr(t('not_in_system')); return; }
    const line = tr.lines.find((l: any) => l.product_id === f.product.id); if (!line) { setErr(t('not_on_transfer')); return; }
    setCur({ line, pack_qty: f.pack_qty, product: f.product }); setQty(f.pack_qty > 1 ? '1' : String(Math.max(0, Number(line.picked_qty) - (recv[line.product_id] ?? 0)))); setStep('qty');
  };
  const unitQty = Math.round((Number(qty) || 0) * (cur?.pack_qty ?? 1) * 1000) / 1000;
  const confirm = async () => {
    if (!me || !cur || unitQty <= 0) return; setBusy(true); const client_id = uuidv7();
    try {
      if (isOnline()) await api(`/transfers/${tr.id}/receive-lines`, { body: { lines: [{ client_id, product_id: cur.line.product_id, qty: unitQty }] } });
      else await enqueue({ client_id, entity: 'transfer_line_receive', op: 'insert', user_id: me.user.id, summary: `${t('receive_transfer')} ${n(cur.product)} ${unitQty}`, payload: { transfer_id: tr.id, product_id: cur.line.product_id, qty: unitQty, performed_at: new Date().toISOString() } });
      setRecv({ ...recv, [cur.line.product_id]: (recv[cur.line.product_id] ?? 0) + unitQty }); fx.scanOk(); setCur(null); setStep('scan');
    } catch (e) { setErr(errMsg(e, lang)); } finally { setBusy(false); }
  };
  const complete = async () => {
    if (!isOnline()) { setErr(t('needs_network')); return; } setBusy(true);
    try { setResult(await api(`/transfers/${tr.id}/complete`, { body: {} })); setStep('done'); } catch (e) { setErr(errMsg(e, lang)); } finally { setBusy(false); }
  };
  const received = Object.values(recv).reduce((a, b) => a + b, 0);
  if (step === 'done') return <DoneScreen title={t('transfer_done')} lines={[tr.transfer_no, `${received} ${t('unit_pcs')}`]} warn={result?.variance?.length ? t('variance_n', { n: result.variance.length }) : undefined} onHome={() => nav('/m')} />;
  return (
    <Page>
      <TopBar title={tr ? `${t('receive_transfer')} · ${tr.transfer_no}` : t('receive_transfer')} progress={tr ? `${received}` : undefined} onBack={() => (step === 'list' ? nav('/m') : step === 'scan' ? (setTr(null), setStep('list')) : setStep('scan'))} confirmBack={step === 'qty'} />
      {err && <ErrorScreen msg={err} onOk={() => setErr(null)} />}
      {step === 'list' && (
        <>
          <Scanner onScan={onScanTransfer} instruction={t('scan_transfer_qr')} icon={I.Scan} enabled={!err} />
          <div className="section">{t('in_transit_list')}</div>
          {list === null ? <div className="empty">{t('loading')}</div> : <div className="list" data-testid="transit-list">{list.map((x) => <div key={x.id} className="card" onClick={async () => { fx.tap(); try { await open(await api(`/transfers/${x.id}`)); } catch (e) { setErr(errMsg(e, lang)); } }}><div className="thumb"><Icon name={I.Warehouse} size={30} /></div><div className="body"><div className="t">{x.transfer_no}</div><div className="s">{x.from_site_name} → {x.to_site_name} · {t('lines_n', { n: x.line_count })} · {t('sent_qty')} {Number(x.picked_total)}</div></div></div>)}{list.length === 0 && <div className="empty">{t('none_pending')}</div>}</div>}
        </>
      )}
      {step === 'scan' && tr && (
        <>
          <Scanner onScan={onScanProduct} instruction={t('scan_product')} icon={I.Product} enabled={!err} />
          <div className="list">{tr.lines.map((l: any) => <div key={l.id} className="kv" style={{ padding: '10px var(--pad)' }}><span className="k">{n(l)}</span><b style={{ fontSize: 22, color: (recv[l.product_id] ?? 0) >= Number(l.picked_qty) ? 'var(--green)' : 'var(--ink)' }}>{recv[l.product_id] ?? 0} / {Number(l.picked_qty)}</b></div>)}</div>
          <div className="confirm-wrap"><button className="btn btn-primary btn-xl" disabled={busy || received <= 0} onClick={complete} data-testid="finish"><Icon name={I.Check} size={26} /> {t('done')}</button></div>
        </>
      )}
      {step === 'qty' && cur && (
        <>
          <ProductHead p={cur.product} sub={`${t('sent_qty')} ${Number(cur.line.picked_qty)} · ${t('received_so_far')} ${recv[cur.line.product_id] ?? 0}${cur.pack_qty > 1 ? ` · 1 ${t('case')} = ${cur.pack_qty}` : ''}`} />
          <QtyPad value={qty} onChange={setQty} unit={cur.pack_qty > 1 ? t('case') : cur.product.unit === 'KG' ? t('unit_kg') : t('unit_pcs')} allowDecimal={cur.product.unit === 'KG'} />
          <div className="confirm-wrap"><button className="btn btn-primary btn-xl" disabled={busy || unitQty <= 0} onClick={confirm} data-testid="qty-confirm"><Icon name={I.Check} size={26} /> {t('confirm')} {unitQty}</button></div>
        </>
      )}
    </Page>
  );
}
