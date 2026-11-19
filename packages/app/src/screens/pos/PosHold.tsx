// P10 取单：挂单清单（店内任何机都能取）→ 点一张 → 行回到购物车。需要网络。
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '../../i18n/index.js';
import { api, ApiError } from '../../api/client.js';
import { db, type CProduct } from '../../offline/db.js';
import { ErrorScreen } from '../../ui/Shell.js';
import { fx } from '../../ui/feedback.js';
import { uuidv7 } from '../../offline/sync.js';
import type { CartLine } from '../../offline/posSync.js';
import { PosTop } from './PosApp.js';
import { usePos } from './posStore.js';
import { Btn, Tri, money } from './PosUi.js';
import { PauseCircle } from 'lucide-react';

export default function PosHold() {
  const { t, n, lang } = useT(); const nav = useNavigate(); const pos = usePos();
  const [rows, setRows] = useState<any[] | null>(null); const [err, setErr] = useState<string | null>(null);
  const load = async () => { try { setRows(await api('/pos/sales/held')); } catch (e: any) { setErr(e instanceof ApiError ? e.text(lang) : t('needs_network')); setRows([]); } };
  useEffect(() => { void load(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  const recall = async (h: any) => {
    try {
      const s = await api(`/pos/sales/held/${h.id}/recall`, { method: 'POST' });
      const lines: CartLine[] = [];
      for (const l of s.lines) {
        const p: CProduct = (await db.product.get(l.product_id)) ?? { id: l.product_id, sku: l.sku, name_zh: l.name_zh, name_ms: l.name_ms, name_en: l.name_en, search_text: '', category_id: '', unit: l.unit ?? 'PCS', is_weighed: !!l.is_weighed, sell_price: Number(l.unit_price), min_level: 0, reorder_qty: 0, is_active: true, updated_at: '', photo_url: l.photo_url };
        lines.push({ key: uuidv7(), product: p, qty: p.is_weighed ? 1 : Number(l.qty), weight_kg: p.is_weighed ? Number(l.qty) : null, unit_price: Number(l.unit_price), discount_pct: Number(l.discount_pct ?? 0), barcode: l.barcode_scanned ?? null });
      }
      pos.loadLines(lines, s.id); if (s.customer_id && s.customer_name) pos.setCustomer({ id: s.customer_id, name: s.customer_name }); fx.done(); nav('/pos');
    } catch (e: any) { setErr(e instanceof ApiError ? e.text(lang) : t('needs_network')); void load(); }
  };
  return (
    <div className="pos"><PosTop />
      <div className="pos-center" style={{ alignItems: 'stretch' }}>
        <div className="pos-panel wide" style={{ margin: '0 auto' }}>
          <Tri k="pos_held_list" />
          {rows === null ? <div className="pos-empty">{t('loading')}</div> : rows.length === 0 ? <div className="pos-empty"><PauseCircle size={56} strokeWidth={1.2} /><div>{t('pos_no_held')}</div></div> : (
            <div className="pos-list">{rows.map((h) => <button key={h.id} className="pos-card" onClick={() => void recall(h)} data-testid="held-card"><div><b>{h.hold_code}</b> · {h.terminal_code} · {new Date(h.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}{h.customer_name ? ` · ${h.customer_name}` : ''}<div className="s">{(h.lines ?? []).map((l: any) => `${n(l)} ×${l.qty}`).join('，')}</div></div><div className="r">{money(h.total)}</div></button>)}</div>
          )}
          <Btn k="back" color="ghost" onClick={() => nav('/pos')} />
        </div>
      </div>
      {err && <ErrorScreen msg={err} onOk={() => setErr(null)} />}
    </div>
  );
}
