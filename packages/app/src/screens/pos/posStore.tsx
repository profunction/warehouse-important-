// POS 状态：机号、班次、购物车、客户、上一张销售。购物车存 sessionStorage，刷新不丢。
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, isOnline } from '../../api/client.js';
import { kvGet, kvSet, type CProduct } from '../../offline/db.js';
import { getTerminal, setTerminal as saveTerminal, posSettings, type CartLine } from '../../offline/posSync.js';
import { bridge } from '../../pos/bridge.js';
import { uuidv7 } from '../../offline/sync.js';

export interface PosCustomer { id: string; name: string; credit_available?: number | null; credit_limit?: number; balance?: number; mode?: 'MEMBER' | 'B2B'; phone?: string | null; code?: string | null; einvoice_profile?: any; credit_status?: string }
export interface PosSettings { cash_rounding: number; cashier_discount_max_pct: number; scale_barcode_format: any }
interface State { terminal: string; session: any | null; sessionLoading: boolean; lines: CartLine[]; selected: string | null; customer: PosCustomer | null; saleType: 'RETAIL' | 'B2B'; lastSale: any | null; settings: PosSettings; holdId: string | null }
interface Actions {
  setTerminal: (t: string) => Promise<void>; setSession: (s: any | null) => Promise<void>; refreshSession: () => Promise<any | null>;
  addProduct: (p: CProduct, o?: { qty?: number; weight_kg?: number | null; barcode?: string | null; pack_qty?: number; unit_price?: number }) => string;
  setQty: (key: string, qty: number) => void; setWeight: (key: string, kg: number) => void; removeLine: (key: string) => void; setDiscount: (key: string, pct: number, pin?: string | null) => void; setPrice: (key: string, price: number, pin?: string | null) => void;
  select: (key: string | null) => void; clear: () => void; loadLines: (lines: CartLine[], holdId?: string | null) => void;
  setCustomer: (c: PosCustomer | null) => void; setLastSale: (s: any) => void;
}
const Ctx = createContext<(State & Actions)>(null!);
const CART_KEY = 'wh.pos.cart';
const loadCart = (): { lines: CartLine[]; customer: PosCustomer | null; holdId: string | null } => { try { return JSON.parse(sessionStorage.getItem(CART_KEY) || '') ?? { lines: [], customer: null, holdId: null }; } catch { return { lines: [], customer: null, holdId: null }; } };

export function PosProvider({ children }: { children: ReactNode }) {
  const init = loadCart();
  const [terminal, setTerminalS] = useState('P1');
  const [session, setSessionS] = useState<any | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [lines, setLines] = useState<CartLine[]>(init.lines);
  const [selected, setSelected] = useState<string | null>(null);
  const [customer, setCustomerS] = useState<PosCustomer | null>(init.customer);
  const [holdId, setHoldId] = useState<string | null>(init.holdId);
  const [lastSale, setLastSale] = useState<any | null>(null);
  const [settings, setSettings] = useState<PosSettings>({ cash_rounding: 0.05, cashier_discount_max_pct: 5, scale_barcode_format: null });
  useEffect(() => { try { sessionStorage.setItem(CART_KEY, JSON.stringify({ lines, customer, holdId })); } catch { /* 无 */ } }, [lines, customer, holdId]);
  useEffect(() => { bridge.start(); void posSettings().then(setSettings); }, []);
  const refreshSession = useCallback(async (term?: string) => {
    const t = term ?? terminal;
    if (isOnline()) {
      try { const r = await api(`/pos/sessions/current?terminal_code=${encodeURIComponent(t)}`, { timeoutMs: 8000 }); setSessionS(r.session); await kvSet(`pos.session.${t}`, r.session); return r.session; } catch { /* 用缓存 */ }
    }
    const cached = await kvGet<any>(`pos.session.${t}`, null); setSessionS(cached); return cached;
  }, [terminal]);
  useEffect(() => { (async () => { const t = await getTerminal(); setTerminalS(t); await refreshSession(t); setSessionLoading(false); })(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  const setTerminal = useCallback(async (t: string) => { setTerminalS(t); await saveTerminal(t); await refreshSession(t); }, [refreshSession]);
  const setSession = useCallback(async (s: any | null) => { setSessionS(s); await kvSet(`pos.session.${terminal}`, s); }, [terminal]);
  const addProduct: Actions['addProduct'] = useCallback((p, o = {}) => {
    const key = uuidv7();
    setLines((ls) => {
      // 同产品同价无折扣 → 合并数量（称重不合并）
      if (!p.is_weighed) { const same = ls.find((l) => l.product.id === p.id && !l.discount_pct && l.unit_price === (o.unit_price ?? Number(p.sell_price))); if (same) { setSelected(same.key); return ls.map((l) => (l === same ? { ...l, qty: l.qty + (o.qty ?? 1) * (o.pack_qty ?? 1) } : l)); } }
      setSelected(key);
      return [...ls, { key, product: p, qty: p.is_weighed ? 1 : (o.qty ?? 1) * (o.pack_qty ?? 1), weight_kg: p.is_weighed ? o.weight_kg ?? null : null, unit_price: o.unit_price ?? Number(p.sell_price), discount_pct: 0, barcode: o.barcode ?? null, pack_qty: o.pack_qty ?? 1 }];
    });
    return key;
  }, []);
  const upd = (key: string, f: (l: CartLine) => CartLine) => setLines((ls) => ls.map((l) => (l.key === key ? f(l) : l)));
  const v = useMemo<State & Actions>(() => ({
    terminal, session, sessionLoading, lines, selected, customer, saleType: customer && customer.mode !== 'MEMBER' ? 'B2B' : 'RETAIL', lastSale, settings, holdId,
    setTerminal, setSession, refreshSession: () => refreshSession(), addProduct,
    setQty: (key, qty) => upd(key, (l) => ({ ...l, qty: Math.max(0.001, qty) })), setWeight: (key, kg) => upd(key, (l) => ({ ...l, weight_kg: kg })),
    removeLine: (key) => { setLines((ls) => ls.filter((l) => l.key !== key)); setSelected((s) => (s === key ? null : s)); },
    setDiscount: (key, pct, pin) => upd(key, (l) => ({ ...l, discount_pct: pct, supervisor_pin: pin ?? l.supervisor_pin ?? null })),
    setPrice: (key, price, pin) => upd(key, (l) => ({ ...l, unit_price: price, supervisor_pin: pin ?? l.supervisor_pin ?? null })),
    select: setSelected, clear: () => { setLines([]); setSelected(null); setCustomerS(null); setHoldId(null); }, loadLines: (ls, hid) => { setLines(ls); setSelected(ls[0]?.key ?? null); setHoldId(hid ?? null); },
    setCustomer: setCustomerS, setLastSale,
  }), [terminal, session, sessionLoading, lines, selected, customer, lastSale, settings, holdId, setTerminal, setSession, refreshSession, addProduct]);
  return <Ctx.Provider value={v}>{children}</Ctx.Provider>;
}
export const usePos = () => useContext(Ctx);
