// P6 完成：绿屏找零大字；自动打印收据 + 开钱箱（现金）；打印收据 / 要电子发票（P7 表单，提交给模块 D 的 POST /einvoice/sales/:id）/ 不用收据 / 下一位。
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '../../i18n/index.js';
import { api, ApiError, isOnline } from '../../api/client.js';
import { bridge } from '../../pos/bridge.js';
import { PosTop } from './PosApp.js';
import { usePos } from './posStore.js';
import { Overlay, Btn, Tri, money } from './PosUi.js';
import { Printer, FileText, X, ArrowRight } from 'lucide-react';

export default function PosDone() {
  const { t, t2, lang } = useT(); const nav = useNavigate(); const { lastSale: s } = usePos();
  const [msg, setMsg] = useState<string | null>(null); const [ein, setEin] = useState(false); const [buyer, setBuyer] = useState({ tin: '', id_type: 'NRIC', id_no: '', name: '', email: '' }); const [busy, setBusy] = useState(false);
  const printed = useRef(false);
  useEffect(() => { if (!s) nav('/pos', { replace: true }); }, [s, nav]);
  const print = async () => {
    const r = await bridge.print(s.receipt_text, s.escpos_base64, { openDrawer: s.payments?.some((p: any) => p.method === 'CASH') });
    setMsg(r ? t('pos_printed') : t('pos_no_printer'));
    if (!r) console.log(s.receipt_text);
  };
  useEffect(() => { if (s && !printed.current) { printed.current = true; void print(); if (s.payments?.some((p: any) => p.method === 'CASH')) void bridge.drawer(); } }, [s]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!s) return null;
  const submitEinvoice = async () => {
    if (busy) return; setBusy(true);
    try {
      if (s.offline || !isOnline()) throw new ApiError(0, 'NETWORK', {});
      await api(`/einvoice/sales/${s.id}`, { body: { einvoice_buyer: buyer, buyer } });
      setMsg(t('pos_einvoice_sent')); setEin(false);
    } catch (e: any) {
      if (e instanceof ApiError && (e.status === 404 || e.status === 0 || e.code === 'NETWORK')) { setMsg(t('pos_einvoice_later')); setEin(false); }
      else setMsg(e instanceof ApiError ? e.text(lang) : String(e?.message ?? e));
    } finally { setBusy(false); }
  };
  const onTin = (v: string) => { // 顾客 MyInvois 二维码常见格式：TIN|IDTYPE|IDNO 或纯 TIN
    const m = v.split('|'); if (m.length >= 3) setBuyer({ ...buyer, tin: m[0], id_type: m[1].toUpperCase(), id_no: m[2] }); else setBuyer({ ...buyer, tin: v });
  };
  return (
    <div className="pos">
      <PosTop />
      <div className="pos-full green" data-testid="pos-done">
        <div className="t">{t('pos_done')} <span style={{ fontWeight: 400, fontSize: 22 }}>{t2('pos_done')}</span></div>
        <div className="change"><small>{t('pos_change')} {t2('pos_change')}</small><span data-testid="done-change">{Number(s.change_amount ?? 0).toFixed(2)}</span></div>
        <div className="sub">{t('pos_total')} {money(s.total)} · {s.receipt_no}{s.offline ? ` · ${t('pos_saved_offline')}` : ''}</div>
        {msg && <div className="sub" data-testid="done-msg">{msg}</div>}
        <div className="btns">
          <Btn color="ghost" icon={<Printer size={26} />} onClick={() => void print()} testid="done-print">{t('pos_print_receipt')} <small>{t2('pos_print_receipt')}</small></Btn>
          <Btn color="ghost" icon={<FileText size={26} />} onClick={() => setEin(true)} testid="done-einvoice">{t('pos_want_einvoice')} <small>{t2('pos_want_einvoice')}</small></Btn>
          <Btn color="ghost" icon={<X size={26} />} onClick={() => nav('/pos', { replace: true })} testid="done-no-receipt">{t('pos_no_receipt')} <small>{t2('pos_no_receipt')}</small></Btn>
        </div>
        <button className="pos-btn brass row next" style={{ minHeight: 96, fontSize: 30 }} onClick={() => nav('/pos', { replace: true })} data-testid="done-next"><ArrowRight size={32} /> {t('pos_next_customer')} <small>{t2('pos_next_customer')}</small></button>
      </div>
      {ein && (
        <Overlay onClose={() => setEin(false)}>
          <Tri k="pos_einvoice_title" /><div className="hint">{t('pos_scan_myinvois_qr')}</div>
          <div className="pos-cols">
            <div className="pos-field"><label>{t('pos_tin')}</label><input value={buyer.tin} onChange={(e) => onTin(e.target.value)} autoFocus data-testid="ein-tin" /></div>
            <div className="pos-field"><label>{t('pos_id_type')}</label><select value={buyer.id_type} onChange={(e) => setBuyer({ ...buyer, id_type: e.target.value })}>{['NRIC', 'BRN', 'PASSPORT', 'ARMY'].map((x) => <option key={x}>{x}</option>)}</select></div>
            <div className="pos-field"><label>{t('pos_id_no')}</label><input value={buyer.id_no} onChange={(e) => setBuyer({ ...buyer, id_no: e.target.value })} /></div>
            <div className="pos-field"><label>{t('pos_buyer_name')}</label><input value={buyer.name} onChange={(e) => setBuyer({ ...buyer, name: e.target.value })} /></div>
            <div className="pos-field"><label>{t('pos_email')}</label><input value={buyer.email} onChange={(e) => setBuyer({ ...buyer, email: e.target.value })} inputMode="email" /></div>
          </div>
          <div className="pos-actions"><Btn k="cancel" color="ghost" onClick={() => setEin(false)} /><Btn k="pos_submit" color="pay" onClick={() => void submitEinvoice()} disabled={busy || !buyer.tin} testid="ein-submit" /></div>
        </Overlay>
      )}
    </div>
  );
}
