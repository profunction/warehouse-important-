// P2 收银主屏：左 60% 购物车，右 40% 合计 + 大按钮。叠加层：P3 称重、P4 搜索、P10 折扣、P12 主管 PIN、数量键盘。
// 扫描：自动聚焦输入框接 HID 扫描枪（字符 + Enter）；纯数字 8–14 位当条码，其他当搜索词。
// 条码解析：本地 Dexie（product/barcode/称重码）→ 在线兜底 GET /products/by-barcode/:code（并写回本地缓存）。
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../store/auth.js';
import { useT } from '../../i18n/index.js';
import { api, ApiError, isOnline } from '../../api/client.js';
import { db, type CProduct } from '../../offline/db.js';
import { resolveProduct } from '../mobile/flow.js';
import { ErrorScreen, Confirm } from '../../ui/Shell.js';
import { fx } from '../../ui/feedback.js';
import { Icon, I } from '../../ui/icons.js';
import { bridge } from '../../pos/bridge.js';
import { lineTotal, lineDiscount, cartNet, roundTo, type CartLine } from '../../offline/posSync.js';
import { PosTop } from './PosApp.js';
import { usePos } from './posStore.js';
import { Keypad, Amount, Overlay, Btn, Tri, money, r2 } from './PosUi.js';
import { Scale, Percent, ShieldCheck, Search, Package, Trash2, PauseCircle, Undo2, Building2, Sigma, Hash, CreditCard } from 'lucide-react';

type Overlay = null | { kind: 'weigh'; product: CProduct; barcode?: string | null } | { kind: 'qty'; key: string } | { kind: 'discount'; key: string } | { kind: 'pin'; key: string; pct: number } | { kind: 'search'; q: string; results: CProduct[] };

export default function PosMain() {
  const { me } = useAuth(); const { t, t2, n, lang } = useT(); const nav = useNavigate();
  const pos = usePos();
  const [ov, setOv] = useState<Overlay>(null); const [err, setErr] = useState<string | null>(null); const [askClear, setAskClear] = useState(false); const [toast, setToast] = useState<string | null>(null);
  const [input, setInput] = useState(''); const inputRef = useRef<HTMLInputElement>(null);
  const [kp, setKp] = useState(''); const [pin, setPin] = useState(''); const [scaleReading, setScaleReading] = useState<{ weight_kg: number; stable: boolean } | null>(null);
  const focus = useCallback(() => { if (!ov) setTimeout(() => inputRef.current?.focus(), 50); }, [ov]);
  useEffect(() => { focus(); const i = setInterval(() => { if (!ov && document.activeElement !== inputRef.current && (document.activeElement?.tagName ?? '') !== 'INPUT') inputRef.current?.focus(); }, 1500); return () => clearInterval(i); }, [ov, focus]);
  useEffect(() => { if (toast) { const x = setTimeout(() => setToast(null), 2500); return () => clearTimeout(x); } }, [toast]);
  const net = cartNet(pos.lines);
  const hasCashRounding = roundTo(net, pos.settings.cash_rounding) !== net;
  const sel = pos.lines.find((l) => l.key === pos.selected) ?? null;

  const addResolved = (p: CProduct, o: { pack_qty?: number; weight_kg?: number | null; barcode?: string | null }) => {
    if (p.is_weighed && o.weight_kg == null) { setOv({ kind: 'weigh', product: p, barcode: o.barcode }); setKp(''); setScaleReading(null); return; }
    pos.addProduct(p, { pack_qty: o.pack_qty ?? 1, weight_kg: o.weight_kg ?? null, barcode: o.barcode ?? null }); fx.scanOk();
  };
  const handleCode = async (raw: string) => {
    const code = raw.trim(); if (!code) return;
    if (/^RCPT:/i.test(code)) { nav(`/pos/returns?receipt=${encodeURIComponent(code.slice(5))}`); return; }
    if (/^\d{8,14}$/.test(code)) {
      const r = await resolveProduct(code);
      if (r) { addResolved(r.product as CProduct, { pack_qty: r.pack_qty, weight_kg: r.weight_kg, barcode: code }); return; }
      if (isOnline()) {
        try {
          const p = await api(`/products/by-barcode/${code}`, { timeoutMs: 6000 });
          const prod: CProduct = { ...p, sell_price: Number(p.sell_price), is_active: p.is_active ?? true };
          await db.product.put(prod); if (p.scanned_barcode) await db.barcode.put({ id: `${p.id}-${code}`, product_id: p.id, barcode: code, pack_qty: Number(p.pack_qty ?? 1), barcode_type: p.barcode_type ?? 'UNIT', is_primary: false });
          addResolved(prod, { pack_qty: Number(p.pack_qty ?? 1), weight_kg: p.weight_kg ?? null, barcode: code }); return;
        } catch (e: any) { if (!(e instanceof ApiError && e.status === 404)) { setErr(e instanceof ApiError ? e.text(lang) : t('needs_network')); return; } }
      }
      setErr(t('pos_not_found')); return;
    }
    // 搜索
    const q = code.toLowerCase();
    const results = await db.product.filter((p) => p.is_active && ((p.search_text ?? '').toLowerCase().includes(q) || (p.name_zh ?? '').includes(code) || (p.name_en ?? '').toLowerCase().includes(q) || (p.name_ms ?? '').toLowerCase().includes(q) || (p.sku ?? '').toLowerCase() === q)).limit(24).toArray();
    setOv({ kind: 'search', q: code, results });
  };
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') { const v = input; setInput(''); void handleCode(v); } };
  const readScale = async () => { const r = await bridge.scale(); setScaleReading(r); if (r?.stable) { setKp(String(r.weight_kg)); } };
  useEffect(() => { if (ov?.kind === 'weigh') { void readScale(); const i = setInterval(() => { void readScale(); }, 1000); return () => clearInterval(i); } }, [ov?.kind]);   // eslint-disable-line react-hooks/exhaustive-deps
  const confirmWeigh = () => { if (ov?.kind !== 'weigh') return; const kg = Number(kp); if (!(kg > 0)) return; pos.addProduct(ov.product, { weight_kg: r2(kg * 1000) / 1000, barcode: ov.barcode }); fx.scanOk(); setOv(null); };
  const confirmQty = () => { if (ov?.kind !== 'qty') return; const q = Number(kp); const l = pos.lines.find((x) => x.key === ov.key); if (!l) return; if (!(q > 0)) { pos.removeLine(ov.key); } else if (l.product.is_weighed) pos.setWeight(ov.key, q); else pos.setQty(ov.key, Math.round(q)); setOv(null); };
  const applyDiscount = (pct: number, pinCode?: string) => { if (!ov || !('key' in ov)) return; pos.setDiscount(ov.key, pct, pinCode ?? null); setOv(null); setToast(`${t('pos_discount')} ${pct}%`); };
  const confirmDiscount = () => { if (ov?.kind !== 'discount') return; const pct = Math.min(100, Number(kp || 0)); if (pct > pos.settings.cashier_discount_max_pct) { setOv({ kind: 'pin', key: ov.key, pct }); setPin(''); } else applyDiscount(pct); };
  const hold = async () => {
    if (!pos.lines.length) return;
    if (!isOnline()) { setErr(t('pos_hold_needs_net')); return; }
    try {
      const r = await api('/pos/sales/hold', { body: { terminal_code: pos.terminal, customer_id: pos.customer?.id ?? null, lines: pos.lines.map((l) => ({ product_id: l.product.id, qty: l.product.is_weighed ? 1 : l.qty, weight_kg: l.product.is_weighed ? Number(l.weight_kg ?? 0) : null, unit_price: l.unit_price, discount_pct: l.discount_pct ?? 0, barcode: l.barcode ?? null })) } });
      pos.clear(); fx.done(); setToast(t('pos_held_ok', { code: r.hold_code })); void bridge.print(`${t('pos_hold')} ${r.hold_code}\n${new Date().toLocaleString()}\n${money(r.total)}\n`, null);
    } catch (e: any) { setErr(e instanceof ApiError ? e.text(lang) : t('needs_network')); }
  };
  const lineQtyText = (l: CartLine) => l.product.is_weighed ? `${Number(l.weight_kg ?? 0).toFixed(3)} kg × ${money(l.unit_price)}` : `${l.qty} × ${money(l.unit_price)}`;

  return (
    <div className="pos" onClick={focus}>
      <PosTop />
      {toast && <div className="pos-bar ok" data-testid="pos-toast">{toast}</div>}
      <div className="pos-body">
        <div className="pos-cart">
          <div className="pos-scan">
            <input ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={onKey} placeholder={t('pos_scan_or_type')} autoFocus autoComplete="off" inputMode="text" data-testid="pos-scan" />
            <button className="pos-btn ghost" style={{ minHeight: 72, minWidth: 100, flexDirection: 'row' }} onClick={() => { const v = input; setInput(''); void handleCode(v || ' '); }} data-testid="pos-search-btn"><Search size={26} />{t('pos_find')}</button>
          </div>
          <div className="pos-lines" data-testid="pos-lines">
            {pos.lines.length === 0 && <div className="pos-empty"><Package size={56} strokeWidth={1.2} /><div>{t('pos_empty_cart')}</div><div style={{ fontSize: 18 }}>{t2('pos_empty_cart')}</div></div>}
            {pos.lines.map((l) => (
              <button key={l.key} className={`pos-line ${pos.selected === l.key ? 'sel' : ''}`} onClick={(e) => { e.stopPropagation(); pos.select(l.key); }} data-testid="cart-line">
                <div className="thumb">{l.product.photo_url ? <img src={l.product.photo_url} alt="" /> : <Package size={34} strokeWidth={1.3} />}</div>
                <div><div className="name">{n(l.product)}</div><div className="sub">{l.barcode ?? l.product.sku}{l.discount_pct ? <span className="disc"> · -{l.discount_pct}% ({money(lineDiscount(l))})</span> : null}</div></div>
                <div className="qp">{lineQtyText(l)}</div>
                <div className="amt">{lineTotal(l).toFixed(2)}</div>
              </button>
            ))}
          </div>
        </div>
        <div className="pos-side">
          <div className="pos-total">
            <div className="row"><span>{t('pos_items', { n: pos.lines.reduce((a, l) => a + (l.product.is_weighed ? 1 : l.qty), 0) })}</span><span>{t('pos_subtotal')} {net.toFixed(2)}</span></div>
            {hasCashRounding && <div className="row"><span>{t('pos_rounding')} ({t('pos_cash')})</span><span>{(roundTo(net, pos.settings.cash_rounding) - net > 0 ? '+' : '') + (roundTo(net, pos.settings.cash_rounding) - net).toFixed(2)}</span></div>}
            <div className="big"><span className="l">{t('pos_total')}<br /><small style={{ fontWeight: 400, color: 'var(--muted)', fontSize: 14 }}>{t2('pos_total')} · {t('pos_tax_incl')}</small></span><span className="n" data-testid="pos-total">{net.toFixed(2)}</span></div>
            {pos.customer && <div className="cust"><span><Building2 size={18} /> {pos.customer.name} · {t('pos_credit_left')} {money(pos.customer.credit_available)}</span><button className="iconbtn" style={{ minHeight: 40, border: '1px solid var(--hair)', background: 'transparent', fontSize: 16 }} onClick={() => pos.setCustomer(null)}>{t('pos_clear_customer')}</button></div>}
          </div>
          <div className="pos-actions">
            <Btn color="pay" icon={<CreditCard size={30} />} onClick={() => pos.lines.length && nav('/pos/pay')} disabled={!pos.lines.length} testid="pos-pay">{t('pos_pay')} <small>{t2('pos_pay')} · {money(net)}</small></Btn>
            <Btn k="pos_qty" color="blue" icon={<Hash size={24} />} onClick={() => { if (!sel) { setErr(t('pos_select_line_first')); return; } setKp(''); setOv({ kind: 'qty', key: sel.key }); }} testid="pos-qty" />
            <Btn k="pos_delete_line" color="red" icon={<Trash2 size={24} />} onClick={() => { if (!sel) { setErr(t('pos_select_line_first')); return; } pos.removeLine(sel.key); }} testid="pos-delete" />
            <Btn k="pos_discount" color="orange" icon={<Percent size={24} />} onClick={() => { if (!sel) { setErr(t('pos_select_line_first')); return; } setKp(String(sel.discount_pct || '')); setOv({ kind: 'discount', key: sel.key }); }} testid="pos-discount" />
            <Btn k="pos_hold" color="grey" icon={<PauseCircle size={24} />} onClick={() => (pos.lines.length ? void hold() : nav('/pos/hold'))} testid="pos-hold" />
            <Btn k="pos_returns" color="brass" icon={<Undo2 size={24} />} onClick={() => nav('/pos/returns')} testid="pos-returns" />
            <Btn k="pos_b2b" color="blue" icon={<Building2 size={24} />} onClick={() => nav('/pos/b2b')} testid="pos-b2b" />
            <Btn k="pos_close_day" color="grey" icon={<Sigma size={24} />} onClick={() => nav('/pos/close')} testid="pos-close" />
          </div>
          {pos.lines.length > 0 && <button className="pos-btn ghost row" style={{ minHeight: 56 }} onClick={() => setAskClear(true)} data-testid="pos-clear"><Trash2 size={20} /> {t('pos_clear_cart')} <small>{t2('pos_clear_cart')}</small></button>}
        </div>
      </div>

      {ov?.kind === 'weigh' && (
        <Overlay onClose={() => setOv(null)}>
          <Tri k="pos_weigh" /><div className="hint">{n(ov.product)} · {money(ov.product.sell_price)}/{t('pos_kg')}</div>
          <div className="pos-cols">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Amount label={t('pos_kg')} value={kp} prefix="" placeholder="0.000" testid="weigh-kg" />
              <div className={`pos-bar ${scaleReading ? (scaleReading.stable ? 'ok' : 'warn') : 'warn'}`} style={{ borderRadius: 10 }}><Scale size={22} /> {scaleReading ? `${t('pos_scale_reading')} ${scaleReading.weight_kg.toFixed(3)} kg ${scaleReading.stable ? '✓' : '· ' + t('pos_scale_unstable')}` : t('pos_scale_none')}</div>
              <div className="hint">{t('pos_weigh_hint')}</div>
              <div className="hint">{money(r2(Number(kp || 0) * Number(ov.product.sell_price)))}</div>
              <Btn k="pos_read_scale" color="blue" icon={<Scale size={22} />} onClick={() => void readScale()} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}><Keypad value={kp} onChange={setKp} onEnter={confirmWeigh} /><Btn k="cancel" color="ghost" onClick={() => setOv(null)} /></div>
          </div>
        </Overlay>
      )}
      {ov?.kind === 'qty' && sel && (
        <Overlay onClose={() => setOv(null)}>
          <Tri k="pos_qty" /><div className="hint">{n(sel.product)}</div>
          <div className="pos-cols">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Amount label={sel.product.is_weighed ? t('pos_kg') : t('pos_qty')} value={kp} prefix="" placeholder={sel.product.is_weighed ? String(sel.weight_kg ?? 0) : String(sel.qty)} testid="qty-kg" />
              {!sel.product.is_weighed && <div className="pos-quick">{[1, 2, 6, 12].map((q) => <button key={q} onClick={() => { fx.tap(); pos.setQty(sel.key, q); setOv(null); }}>{q}</button>)}</div>}
              <Btn k="pos_delete_line" color="red" icon={<Trash2 size={22} />} onClick={() => { pos.removeLine(sel.key); setOv(null); }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}><Keypad value={kp} onChange={setKp} allowDecimal={sel.product.is_weighed} onEnter={confirmQty} /><Btn k="cancel" color="ghost" onClick={() => setOv(null)} /></div>
          </div>
        </Overlay>
      )}
      {ov?.kind === 'discount' && sel && (
        <Overlay onClose={() => setOv(null)}>
          <Tri k="pos_discount_title" /><div className="hint">{n(sel.product)} · {money(sel.unit_price)} × {sel.product.is_weighed ? `${sel.weight_kg} kg` : sel.qty}</div>
          <div className="pos-cols">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Amount label={t('pos_discount_pct')} value={kp} prefix="" placeholder="0" testid="discount-pct" />
              <div className="pos-quick">{[0, 5, 10, 20].map((p) => <button key={p} className={Number(kp) === p ? 'on' : ''} onClick={() => { fx.tap(); setKp(String(p)); }}>{p}%</button>)}</div>
              {Number(kp || 0) > pos.settings.cashier_discount_max_pct && <div className="pos-bar warn" style={{ borderRadius: 10 }}><ShieldCheck size={22} /> {t('pos_discount_limit', { max: pos.settings.cashier_discount_max_pct })}</div>}
              <div className="hint">{t('pos_total')}: {money(r2(lineTotal({ ...sel, discount_pct: Number(kp || 0) })))}</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}><Keypad value={kp} onChange={setKp} allowDecimal={false} onEnter={confirmDiscount} /><Btn k="cancel" color="ghost" onClick={() => setOv(null)} /></div>
          </div>
        </Overlay>
      )}
      {ov?.kind === 'pin' && (
        <Overlay onClose={() => setOv(null)}>
          <Tri k="pos_supervisor" /><div className="hint">{t('pos_discount_limit', { max: pos.settings.cashier_discount_max_pct })} · {ov.pct}%</div>
          <div className="pos-cols">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="hint">{t('pos_supervisor_pin')}</div>
              <div className="pin-dots" style={{ display: 'flex', gap: 14, justifyContent: 'center', padding: 20 }}>{[0, 1, 2, 3, 4, 5].map((i) => <span key={i} style={{ width: 22, height: 22, borderRadius: '50%', border: '2px solid var(--ink)', background: i < pin.length ? 'var(--ink)' : 'transparent' }} />)}</div>
              <div className="hint">{t('pos_supervisor')}：{t2('pos_supervisor')}</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}><Keypad value={pin} onChange={(v) => setPin(v.slice(0, 6))} allowDecimal={false} onEnter={() => pin.length === 6 && applyDiscount(ov.pct, pin)} /><Btn k="cancel" color="ghost" onClick={() => setOv(null)} /></div>
          </div>
        </Overlay>
      )}
      {ov?.kind === 'search' && (
        <Overlay onClose={() => setOv(null)} wide>
          <Tri k="pos_product_search" /><div className="hint">“{ov.q}” · {ov.results.length}</div>
          {ov.results.length === 0 ? <div className="pos-empty">{t('pos_no_results')}</div> : (
            <div className="pos-grid">{ov.results.map((p) => <button key={p.id} className="pos-tile" onClick={() => { setOv(null); addResolved(p, {}); }} data-testid="search-result"><div className="thumb">{p.photo_url ? <img src={p.photo_url} alt="" /> : <Package size={48} strokeWidth={1.2} />}</div><div>{n(p)}</div><div className="p">{money(p.sell_price)}{p.is_weighed ? '/kg' : ''}</div></button>)}</div>
          )}
          <Btn k="cancel" color="ghost" onClick={() => setOv(null)} />
        </Overlay>
      )}
      {askClear && <Confirm msg={t('pos_clear_cart_q')} okText={t('pos_clear_cart')} danger onOk={() => { pos.clear(); setAskClear(false); }} onCancel={() => setAskClear(false)} />}
      {err && <ErrorScreen msg={err} onOk={() => { setErr(null); focus(); }} />}
      <span style={{ display: 'none' }}>{me?.user.id}<Icon name={I.Scan} size={1} /></span>
    </div>
  );
}
