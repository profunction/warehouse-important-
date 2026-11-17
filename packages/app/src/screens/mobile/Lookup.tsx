import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '../../i18n/index.js';
import { useAuth } from '../../store/auth.js';
import { Scanner } from '../../ui/Scanner.js';
import { ErrorScreen, Page, ProductHead, TopBar } from '../../ui/Shell.js';
import { api, isOnline } from '../../api/client.js';
import { db, findByBarcode, stockOf } from '../../offline/db.js';
import { kvGet } from '../../offline/db.js';

export default function Lookup() {
  const { t, n, lang } = useT(); const { has } = useAuth(); const nav = useNavigate();
  const [res, setRes] = useState<any | null>(null); const [err, setErr] = useState<string | null>(null); const [offline, setOffline] = useState(false);
  const onScan = async (code: string) => {
    if (isOnline()) {
      try { const r = await api(`/stock/lookup/${encodeURIComponent(code)}`); setRes({ ...r, barcode: code }); setOffline(false); return; } catch (e: any) { if (e?.status === 404) { setErr(t('not_in_system')); return; } }
    }
    // 本地
    const f = await findByBarcode(code, (await kvGet<any>('sync.settings', {}))?.scale_barcode_format);
    if (!f) { setErr(t('not_in_system')); return; }
    const st = await stockOf(f.product.id); const locs = await Promise.all(st.filter((s) => s.qty !== 0).map(async (s) => ({ ...s, ...(await db.location.get(s.location_id)) })));
    const shelves = await db.shelf_assignment.where('product_id').equals(f.product.id).filter((s) => s.is_active).toArray();
    setRes({ product: f.product, barcode: code, total_qty: locs.filter((l) => !l.is_virtual).reduce((a, l) => a + l.qty, 0), locations: locs.filter((l) => !l.is_virtual), shelves: await Promise.all(shelves.map(async (s) => ({ code: (await db.location.get(s.location_id))?.code, is_primary: s.is_primary }))), recent_movements: [], sales_30d: null });
    setOffline(true);
  };
  return (
    <Page>
      <TopBar title={t('lookup')} onBack={() => (res ? setRes(null) : nav('/m'))} />
      {err && <ErrorScreen msg={err} onOk={() => setErr(null)} />}
      {!res ? <Scanner onScan={onScan} instruction={t('scan_product')} icon="📦" /> : (
        <div data-testid="lookup-result">
          <ProductHead p={res.product} barcode={res.barcode} sub={`${t('price')} RM ${Number(res.product.sell_price).toFixed(2)}${has('product.view_cost') && res.product.cost_price != null ? ` · ${t('cost')} RM ${Number(res.product.cost_price).toFixed(2)}` : ''}`} />
          {offline && <div className="overlay-bar bar-offline">{t('offline_data')}</div>}
          <div className="kv"><span className="k">{t('total_stock')}</span><b style={{ fontSize: 'var(--fs-title)' }} data-testid="total-qty">{res.total_qty} {res.product.unit === 'KG' ? t('unit_kg') : t('unit_pcs')}</b></div>
          {res.sales_30d != null && <div className="kv"><span className="k">{t('sales_30d')}</span><b>{res.sales_30d}</b></div>}
          <div className="section">{t('locations')}</div>
          {res.locations.map((l: any) => <div className="kv" key={l.code}><span><span className="label-chip" style={{ background: l.zone_color ?? '#616161' }}>{l.code}</span>{l.earliest_expiry ? <span style={{ color: '#777', fontSize: 'var(--fs-small)' }}> · {t('expiry')} {l.earliest_expiry}</span> : null}</span><b>{l.qty}</b></div>)}
          {res.shelves?.length > 0 && <><div className="section">{t('shelves')}</div><div className="kv"><span>{res.shelves.map((s: any) => s.code + (s.is_primary ? ' ★' : '')).join('，')}</span></div></>}
          {res.recent_movements?.length > 0 && <><div className="section">{t('recent')}</div>{res.recent_movements.map((m: any) => <div className="kv" key={m.id}><span className="k">{new Date(m.performed_at).toLocaleString(lang === 'zh' ? 'zh-CN' : lang === 'ms' ? 'ms-MY' : 'en-MY', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} {t('reason_' + m.reason)} {m.from_code}→{m.to_code}</span><b>{m.qty}</b></div>)}</>}
          <div className="confirm-wrap"><button className="btn btn-primary btn-xl" onClick={() => setRes(null)}>{t('next')}</button></div>
        </div>
      )}
    </Page>
  );
}
