// P11 日结：预期现金 / 数到的现金 / 差额 → 确认 → Z 报表（可打印）。需要网络。
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '../../i18n/index.js';
import { api, ApiError, isOnline } from '../../api/client.js';
import { ErrorScreen, Confirm } from '../../ui/Shell.js';
import { fx } from '../../ui/feedback.js';
import { bridge } from '../../pos/bridge.js';
import { PosTop } from './PosApp.js';
import { usePos } from './posStore.js';
import { Keypad, Amount, Btn, Tri, money, r2 } from './PosUi.js';
import { Printer, Sigma } from 'lucide-react';

export default function PosClose() {
  const { t, lang } = useT(); const nav = useNavigate(); const pos = usePos();
  const [counted, setCounted] = useState(''); const [ask, setAsk] = useState(false); const [err, setErr] = useState<string | null>(null); const [z, setZ] = useState<any | null>(null); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { void pos.refreshSession(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  const s = pos.session;
  const expected = s ? r2(Number(s.opening_cash) + Number(s.cash_total) - Number(s.refund_total)) : 0;
  const variance = r2(Number(counted || 0) - expected);
  const close = async () => {
    if (!s || busy) return; setBusy(true); setAsk(false);
    try { const r = await api(`/pos/sessions/${s.id}/close`, { body: { counted_cash: Number(counted || 0) } }); setZ(r); await pos.setSession(null); fx.done(); void bridge.print(r.z_report, r.z_report_escpos_base64); }
    catch (e: any) { setErr(e instanceof ApiError ? e.text(lang) : t('pos_close_needs_net')); } finally { setBusy(false); }
  };
  if (z) return (
    <div className="pos"><PosTop />
      <div className="pos-body">
        <div className="pos-side" style={{ borderRight: '1px solid var(--hair)' }}>
          <Tri k="pos_closed" />
          <div className="pos-kv">
            <span className="k">{t('pos_sales_count')}</span><span className="v">{z.sales_count}</span>
            <span className="k">{t('pos_sales_total')}</span><span className="v">{money(z.sales_total)}</span>
            <span className="k">{t('pos_refunds')}</span><span className="v">{money(z.refund_total)}</span>
            <span className="k">{t('pos_expected_cash')}</span><span className="v">{money(z.expected_cash)}</span>
            <span className="k">{t('pos_counted_cash')}</span><span className="v">{money(z.counted_cash)}</span>
            <span className="k">{t('pos_variance')}</span><span className={`v big ${Number(z.variance) < 0 ? 'neg' : 'pos'}`} data-testid="close-variance">{Number(z.variance) > 0 ? '+' : ''}{Number(z.variance).toFixed(2)}</span>
          </div>
          {z.ticket_id && <div className="pos-bar warn" style={{ borderRadius: 10 }}>{t('pos_variance_big')}</div>}
          {msg && <div className="pos-bar ok" style={{ borderRadius: 10 }}>{msg}</div>}
          <div style={{ flex: 1 }} />
          <Btn color="blue" icon={<Printer size={26} />} onClick={() => void bridge.print(z.z_report, z.z_report_escpos_base64).then((r) => setMsg(r ? t('pos_printed') : t('pos_no_printer')))}>{t('pos_print_z')}</Btn>
          <Btn k="done" color="pay" onClick={() => nav('/pos/open', { replace: true })} testid="close-done" />
        </div>
        <div className="pos-side"><pre className="pos-pre" data-testid="z-report">{z.z_report}</pre></div>
      </div>
    </div>
  );
  return (
    <div className="pos"><PosTop />
      {!isOnline() && <div className="pos-bar warn">{t('pos_close_needs_net')}</div>}
      <div className="pos-body">
        <div className="pos-side" style={{ borderRight: '1px solid var(--hair)' }}>
          <Tri k="pos_close_title" />
          {!s ? <div className="pos-empty">{t('pos_no_shift')}</div> : (
            <div className="pos-kv">
              <span className="k">{t('pos_terminal')}</span><span className="v">{s.terminal_code}</span>
              <span className="k">{t('pos_shift_open_since', { t: new Date(s.opened_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) })}</span><span className="v">{s.cashier_name ?? ''}</span>
              <span className="k">{t('pos_sales_count')}</span><span className="v">{s.sales_count}</span>
              <span className="k">{t('pos_sales_total')}</span><span className="v">{money(s.sales_total)}</span>
              <span className="k">{t('pos_cash')}</span><span className="v">{money(s.cash_total)}</span>
              <span className="k">{t('pos_card')} / {t('pos_ewallet')}</span><span className="v">{money(Number(s.card_total) + Number(s.ewallet_total))}</span>
              <span className="k">{t('pos_refunds')}</span><span className="v">{money(s.refund_total)}</span>
              <span className="k">{t('pos_opening_cash')}</span><span className="v">{money(s.opening_cash)}</span>
              <span className="k">{t('pos_expected_cash')}</span><span className="v big" data-testid="close-expected">{money(expected)}</span>
              <span className="k">{t('pos_variance')}</span><span className={`v big ${variance < 0 ? 'neg' : 'pos'}`}>{counted === '' ? '—' : (variance > 0 ? '+' : '') + variance.toFixed(2)}</span>
            </div>
          )}
          <div style={{ flex: 1 }} />
          <Btn k="back" color="ghost" onClick={() => nav('/pos')} />
        </div>
        <div className="pos-side">
          <Amount label={t('pos_counted_cash')} value={counted} testid="close-counted" />
          <Keypad value={counted} onChange={setCounted} />
          <Btn color="pay" icon={<Sigma size={28} />} onClick={() => setAsk(true)} disabled={!s || busy || counted === ''} testid="close-confirm">{t('pos_close_confirm')}</Btn>
        </div>
      </div>
      {ask && <Confirm msg={`${t('pos_counted_cash')} ${money(Number(counted || 0))} · ${t('pos_variance')} ${variance > 0 ? '+' : ''}${variance.toFixed(2)}`} okText={t('pos_close_confirm')} onOk={() => void close()} onCancel={() => setAsk(false)} />}
      {err && <ErrorScreen msg={err} onOk={() => setErr(null)} />}
    </div>
  );
}
