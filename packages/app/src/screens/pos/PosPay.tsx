// P5 付款：现金（收到金额 + 快捷面额，找零按 cash_rounding 取整）/ 卡 / 电子钱包，可多种组合；有客户时可"记账"（B2B）。
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../store/auth.js';
import { useT } from '../../i18n/index.js';
import { ApiError } from '../../api/client.js';
import { ErrorScreen } from '../../ui/Shell.js';
import { fx } from '../../ui/feedback.js';
import { submitSale, cartNet, roundTo, type CartPayment } from '../../offline/posSync.js';
import { PosTop } from './PosApp.js';
import { usePos } from './posStore.js';
import { Keypad, Amount, Btn, Tri, money, r2 } from './PosUi.js';
import { Banknote, CreditCard, Smartphone, Building2, Trash2 } from 'lucide-react';

type Method = CartPayment['method'];
export default function PosPay() {
  const { me } = useAuth(); const { t, t2, lang } = useT(); const nav = useNavigate(); const pos = usePos();
  const [method, setMethod] = useState<Method>('CASH'); const [amt, setAmt] = useState(''); const [ref, setRef] = useState(''); const [pays, setPays] = useState<CartPayment[]>([]); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (!pos.lines.length) nav('/pos', { replace: true }); }, [pos.lines.length, nav]);
  const net = cartNet(pos.lines);
  const cashInvolved = method === 'CASH' || pays.some((p) => p.method === 'CASH');
  const total = cashInvolved ? roundTo(net, pos.settings.cash_rounding) : net;
  const paidSoFar = r2(pays.reduce((a, p) => a + (p.method === 'CASH' ? Math.max(p.tendered ?? 0, p.amount) : p.amount), 0));
  const remaining = r2(Math.max(0, total - paidSoFar));
  const entered = amt === '' ? remaining : Number(amt);
  const change = method === 'CASH' ? r2(Math.max(0, paidSoFar + entered - total)) : 0;
  const quick = [1, 5, 10, 20, 50, 100].filter((q) => q >= remaining).slice(0, 3);
  const addPay = (): CartPayment[] => {
    const a = method === 'CASH' ? Math.max(entered, 0) : Math.min(entered, remaining);
    if (!(a > 0)) return pays;
    const p: CartPayment = method === 'CASH' ? { method, amount: Math.min(a, remaining), tendered: a } : { method, amount: a, reference: ref || null };
    const next = [...pays, p]; setPays(next); setAmt(''); setRef(''); return next;
  };
  const submit = async (payments: CartPayment[], saleType: 'RETAIL' | 'B2B' = 'RETAIL') => {
    if (busy) return; setBusy(true);
    try {
      const r = await submitSale(me!, { terminal_code: pos.terminal, session_id: pos.session?.id ?? null, lines: pos.lines, payments, customer: pos.customer, sale_type: saleType, hold_id: pos.holdId }, lang);
      pos.setLastSale({ ...r.sale, offline: r.offline, member: pos.customer?.mode === 'MEMBER' ? pos.customer : null }); pos.clear(); fx.done(); nav('/pos/done', { replace: true });
    } catch (e: any) { setErr(e instanceof ApiError ? (e.code === 'NETWORK' ? t('needs_network') : e.text(lang)) : String(e?.message ?? e)); }
    finally { setBusy(false); }
  };
  const confirm = () => {
    const next = addPay();
    const paid = r2(next.reduce((a, p) => a + (p.method === 'CASH' ? Math.max(p.tendered ?? 0, p.amount) : p.amount), 0));
    if (paid + 1e-9 < total) { fx.error(); setErr(`${t('pos_payment_short')}：${t('pos_remaining')} ${money(r2(total - paid))}`); return; }
    void submit(next);
  };
  const chargeAccount = () => { if (!pos.customer) return; if ((pos.customer.credit_available ?? Infinity) < net) { setErr(t('pos_credit_over')); return; } void submit([{ method: 'CREDIT', amount: net }], 'B2B'); };
  const icon = (m: Method) => m === 'CASH' ? <Banknote size={28} /> : m === 'CARD' ? <CreditCard size={28} /> : m === 'EWALLET' ? <Smartphone size={28} /> : <Building2 size={28} />;
  return (
    <div className="pos">
      <PosTop />
      <div className="pos-body">
        <div className="pos-side" style={{ borderRight: '1px solid var(--hair)' }}>
          <Tri k="pos_pay" />
          <div className="pos-total">
            <div className="row"><span>{t('pos_items', { n: pos.lines.length })}</span><span>{t('pos_subtotal')} {net.toFixed(2)}</span></div>
            {total !== net && <div className="row"><span>{t('pos_rounding')}</span><span>{(total - net > 0 ? '+' : '') + (total - net).toFixed(2)}</span></div>}
            <div className="big"><span className="l">{t('pos_total')}<br /><small style={{ fontWeight: 400, color: 'var(--muted)', fontSize: 14 }}>{t2('pos_total')}</small></span><span className="n" data-testid="pay-total">{total.toFixed(2)}</span></div>
          </div>
          {pays.length > 0 && <div className="pos-list">{pays.map((p, i) => <div key={i} className="pos-card"><div>{t(`pos_${p.method.toLowerCase()}`)}{p.reference ? <div className="s">{p.reference}</div> : null}</div><div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><span className="r">{money(p.tendered ?? p.amount)}</span><button className="iconbtn" style={{ minHeight: 44, border: '1px solid var(--hair)', background: 'transparent' }} onClick={() => setPays(pays.filter((_, j) => j !== i))}><Trash2 size={20} /></button></div></div>)}</div>}
          <div className="pos-kv">
            <span className="k">{t('pos_remaining')}</span><span className="v">{money(remaining)}</span>
            {method === 'CASH' && <><span className="k">{t('pos_change')}</span><span className="v big" data-testid="pay-change">{money(change)}</span></>}
          </div>
          <div style={{ flex: 1 }} />
          <Btn k="back" color="ghost" onClick={() => nav('/pos')} testid="pay-back" />
        </div>
        <div className="pos-side">
          <div className="pos-actions three">
            {(['CASH', 'CARD', 'EWALLET'] as Method[]).map((m) => <Btn key={m} k={`pos_${m.toLowerCase()}`} color={method === m ? 'pay' : 'ghost'} className={method === m ? '' : ''} icon={icon(m)} onClick={() => { setMethod(m); setAmt(''); }} testid={`pay-${m.toLowerCase()}`} />)}
          </div>
          <Amount label={method === 'CASH' ? t('pos_tendered') : t('pos_paid')} value={amt} placeholder={remaining.toFixed(2)} testid="pay-amount" />
          {method === 'CASH' ? (
            <div className="pos-quick">
              <button className="on" onClick={() => { fx.tap(); setAmt(remaining.toFixed(2)); }} data-testid="pay-exact">{t('pos_exact')}</button>
              {quick.map((q) => <button key={q} onClick={() => { fx.tap(); setAmt(String(q)); }} data-testid={`pay-quick-${q}`}>RM {q}</button>)}
            </div>
          ) : (
            <div className="pos-field"><label>{t('pos_reference')}</label><input value={ref} onChange={(e) => setRef(e.target.value)} data-testid="pay-reference" /></div>
          )}
          <Keypad value={amt} onChange={setAmt} />
          <div className="pos-actions">
            <Btn k="pos_add_payment" color="grey" onClick={() => addPay()} disabled={!(entered > 0) || (method !== 'CASH' && entered >= remaining)} />
            {pos.customer && pos.customer.mode !== 'MEMBER' ? <Btn color="blue" icon={<Building2 size={24} />} onClick={chargeAccount} disabled={busy} testid="pay-credit">{t('pos_charge_account')} <small>{pos.customer.name}</small></Btn> : <span />}
            <Btn color="pay" icon={<CreditCard size={30} />} onClick={confirm} disabled={busy} testid="pay-confirm">{t('pos_confirm_pay')} <small>{t2('pos_confirm_pay')}</small></Btn>
          </div>
        </div>
      </div>
      {err && <ErrorScreen msg={err} onOk={() => setErr(null)} />}
    </div>
  );
}
