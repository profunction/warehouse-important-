// P8 退货：扫收据二维码（RCPT:…）或输收据号 → 勾行和数量 → 原因 → 申请（老板/经理审批）。需要网络。
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useT } from '../../i18n/index.js';
import { api, ApiError } from '../../api/client.js';
import { ErrorScreen, DoneScreen } from '../../ui/Shell.js';
import { fx } from '../../ui/feedback.js';
import { PosTop } from './PosApp.js';
import { Keypad, Btn, Tri, money, r2 } from './PosUi.js';
import { Search, Undo2 } from 'lucide-react';

export default function PosReturns() {
  const { t, n, lang } = useT(); const nav = useNavigate(); const [sp] = useSearchParams();
  const [no, setNo] = useState(sp.get('receipt') ?? ''); const [sale, setSale] = useState<any | null>(null); const [sel, setSel] = useState<Record<string, number>>({}); const [reason, setReason] = useState(''); const [err, setErr] = useState<string | null>(null); const [done, setDone] = useState<any | null>(null); const [busy, setBusy] = useState(false); const [qtyFor, setQtyFor] = useState<string | null>(null); const [kp, setKp] = useState('');
  const find = async (v = no) => {
    const raw = v.trim(); const urlM = raw.match(/\/e\/[^/]+\/([^/?#]+)/); const code = urlM ? decodeURIComponent(urlM[1]) : raw.replace(/^RCPT:/i, ''); if (!code) return;
    try { const s = await api(`/pos/sales/by-receipt/${encodeURIComponent(code)}`); setSale(s); setSel({}); fx.scanOk(); } catch (e: any) { setErr(e instanceof ApiError ? e.text(lang) : t('needs_network')); }
  };
  useEffect(() => { if (sp.get('receipt')) void find(sp.get('receipt')!); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  const avail = (l: any) => r2(Number(l.qty) - Number(l.returned_qty ?? 0));
  const toggle = (l: any) => { if (avail(l) <= 0) return; setSel((s) => { const c = { ...s }; if (c[l.id]) delete c[l.id]; else c[l.id] = l.is_weighed ? avail(l) : 1; return c; }); };
  const refund = r2(Object.entries(sel).reduce((a, [id, q]) => { const l = sale?.lines.find((x: any) => x.id === id); return l ? a + Number(l.line_total) / Number(l.qty) * q : a; }, 0));
  const submit = async () => {
    if (busy || !sale || !Object.keys(sel).length || !reason) return; setBusy(true);
    try { const r = await api('/pos/returns', { body: { sale_id: sale.id, lines: Object.entries(sel).map(([sale_line_id, qty]) => ({ sale_line_id, qty })), reason } }); setDone(r); fx.done(); }
    catch (e: any) { setErr(e instanceof ApiError ? e.text(lang) : t('needs_network')); } finally { setBusy(false); }
  };
  const REASONS = ['pos_reason_wrong', 'pos_reason_damaged', 'pos_reason_expired', 'pos_reason_other'];
  if (done) return <div className="pos"><PosTop /><DoneScreen title={t('pos_return_sent')} lines={[`${sale?.receipt_no} · ${t('pos_refund')} ${money(done.refund)}`]} onHome={() => nav('/pos')} nextText={t('pos_returns')} onNext={() => { setDone(null); setSale(null); setNo(''); }} /></div>;
  return (
    <div className="pos">
      <PosTop />
      <div className="pos-body">
        <div className="pos-cart">
          <div className="pos-scan">
            <input value={no} onChange={(e) => setNo(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void find()} placeholder={t('pos_scan_receipt')} autoFocus autoComplete="off" data-testid="ret-receipt" />
            <button className="pos-btn ghost" style={{ minHeight: 72, minWidth: 110, flexDirection: 'row' }} onClick={() => void find()} data-testid="ret-find"><Search size={26} />{t('pos_find')}</button>
          </div>
          <div className="pos-lines">
            {!sale && <div className="pos-empty"><Undo2 size={56} strokeWidth={1.2} /><div>{t('pos_scan_receipt')}</div></div>}
            {sale && <div className="pos-bar ok">{sale.receipt_no} · {new Date(sale.sold_at).toLocaleString()} · {money(sale.total)} · {sale.payments?.map((p: any) => p.method).join('+')}{sale.pending_return_approvals?.length ? ` · ${t('pos_return_sent')}` : ''}</div>}
            {sale && <div className="pos-bar warn" style={{ background: 'transparent', color: 'var(--muted)', borderBottom: '1px solid var(--hair)' }}>{t('pos_select_return_lines')}</div>}
            {sale?.lines.map((l: any) => (
              <button key={l.id} className={`pos-line ${sel[l.id] ? 'sel' : ''}`} onClick={() => toggle(l)} disabled={avail(l) <= 0} style={{ opacity: avail(l) <= 0 ? .5 : 1 }} data-testid="ret-line">
                <div className="thumb" style={{ fontSize: 28, fontWeight: 700, color: sel[l.id] ? 'var(--green)' : 'var(--muted)' }}>{sel[l.id] ? '✓' : ''}</div>
                <div><div className="name">{n(l)}</div><div className="sub">{l.is_weighed ? `${Number(l.qty).toFixed(3)} kg` : l.qty} × {money(l.unit_price)}{Number(l.returned_qty) > 0 ? ` · ${t('pos_already_returned')} ${l.returned_qty}` : ''}</div></div>
                <div className="qp">{sel[l.id] ? <span style={{ color: 'var(--green)', fontWeight: 600 }}>{t('pos_refund')} {sel[l.id]}{l.is_weighed ? ' kg' : ''}</span> : ''}{sel[l.id] && !l.is_weighed && avail(l) > 1 ? <button className="iconbtn" style={{ marginLeft: 8, minHeight: 44 }} onClick={(e) => { e.stopPropagation(); setQtyFor(l.id); setKp(''); }}>{t('pos_qty')}</button> : null}</div>
                <div className="amt">{Number(l.line_total).toFixed(2)}</div>
              </button>
            ))}
          </div>
        </div>
        <div className="pos-side">
          <Tri k="pos_returns" />
          <div className="pos-kv"><span className="k">{t('pos_refund')}</span><span className="v big" data-testid="ret-refund">{money(refund)}</span></div>
          <div className="hint">{t('pos_return_reason')}</div>
          <div className="pos-chips">{REASONS.map((k) => <button key={k} className={reason === t(k) ? 'on' : ''} onClick={() => { fx.tap(); setReason(t(k)); }}>{t(k)}</button>)}</div>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('pos_return_reason')} style={{ height: 64, fontSize: 22, padding: '0 14px', border: '1px solid var(--ink)', borderRadius: 10, background: '#fff' }} data-testid="ret-reason" />
          <div style={{ flex: 1 }} />
          <div className="pos-actions">
            <Btn k="back" color="ghost" onClick={() => nav('/pos')} />
            <Btn color="pay" icon={<Undo2 size={28} />} onClick={() => void submit()} disabled={busy || !sale || !Object.keys(sel).length || !reason} testid="ret-submit">{t('pos_apply_return')}</Btn>
          </div>
        </div>
      </div>
      {qtyFor && (() => { const l = sale.lines.find((x: any) => x.id === qtyFor); return (
        <div className="pos-overlay" onClick={() => setQtyFor(null)}><div className="pos-panel" onClick={(e) => e.stopPropagation()}>
          <Tri k="pos_qty" /><div className="hint">{n(l)} · max {avail(l)}</div>
          <Keypad value={kp} onChange={setKp} allowDecimal={false} onEnter={() => { const q = Math.min(avail(l), Number(kp || 1)); setSel((s) => ({ ...s, [l.id]: Math.max(1, q) })); setQtyFor(null); }} />
        </div></div>); })()}
      {err && <ErrorScreen msg={err} onOk={() => setErr(null)} />}
    </div>
  );
}
