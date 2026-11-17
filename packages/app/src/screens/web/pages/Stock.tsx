import { useEffect, useState } from 'react';
import { api } from '../../../api/client.js';
import { useT } from '../../../i18n/index.js';
import { errText, fmtQty, ZONE_TYPE_ZH } from './_util.js';

export default function Stock() {
  const { n } = useT();
  const [tab, setTab] = useState<'product' | 'location' | 'zone'>('product');
  const [msg, setMsg] = useState('');
  // 按产品
  const [q, setQ] = useState(''); const [cands, setCands] = useState<any[]>([]); const [prod, setProd] = useState<any | null>(null); const [byProd, setByProd] = useState<any[]>([]);
  useEffect(() => { if (tab !== 'product' || q.length < 1) { setCands([]); return; } const h = setTimeout(() => api(`/products?search=${encodeURIComponent(q)}&limit=20`).then(setCands).catch(() => {}), 250); return () => clearTimeout(h); }, [q, tab]);
  const pick = async (p: any) => { setProd(p); setCands([]); try { setByProd(await api(`/stock/by-product/${p.id}`)); } catch (e) { setMsg(errText(e)); } };
  // 按位置
  const [zones, setZones] = useState<any[]>([]); const [zoneId, setZoneId] = useState(''); const [locs, setLocs] = useState<any[]>([]); const [locId, setLocId] = useState(''); const [byLoc, setByLoc] = useState<any[]>([]);
  useEffect(() => { api('/zones').then(setZones).catch(() => {}); }, []);
  useEffect(() => { if (!zoneId) { setLocs([]); return; } api(`/locations?zone=${zoneId}`).then(setLocs).catch(() => {}); }, [zoneId]);
  useEffect(() => { if (!locId) { setByLoc([]); return; } api(`/stock/by-location/${locId}`).then(setByLoc).catch((e) => setMsg(errText(e))); }, [locId]);
  // 按区
  const [zc, setZc] = useState<any | null>(null); const [zcZone, setZcZone] = useState('');
  useEffect(() => { if (!zcZone) { setZc(null); return; } api(`/zones/${zcZone}/contents`).then(setZc).catch((e) => setMsg(errText(e))); }, [zcZone]);
  return (
    <div>
      <h1>库存查询</h1>
      <div className="tabs">{(['product', 'location', 'zone'] as const).map((k) => <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{k === 'product' ? '按产品' : k === 'location' ? '按位置' : '按区'}</button>)}</div>
      {msg && <div className="err">{msg}</div>}
      {tab === 'product' && (
        <div>
          <div className="toolbar"><input placeholder="输入产品名、拼音或条码" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 360 }} /></div>
          {cands.length > 0 && <table style={{ maxWidth: 700, marginBottom: 12 }}><tbody>{cands.map((p) => <tr key={p.id} onClick={() => pick(p)} style={{ cursor: 'pointer' }}><td>{p.sku}</td><td>{p.barcode}</td><td>{n(p)}</td><td>总 {fmtQty(p.total_qty)}</td></tr>)}</tbody></table>}
          {prod && <>
            <h2>{n(prod)} · {prod.sku} · 总库存 {fmtQty(byProd.reduce((a, r) => a + Number(r.qty), 0))}</h2>
            <table><thead><tr><th>位置</th><th>区</th><th>数量</th><th>最早到期</th></tr></thead><tbody>{byProd.map((r) => <tr key={r.location_id}><td>{r.code}</td><td>{r.zone_code}</td><td>{fmtQty(r.qty)}</td><td>{r.earliest_expiry ?? '—'}</td></tr>)}{byProd.length === 0 && <tr><td colSpan={4} className="note">无库存</td></tr>}</tbody></table>
          </>}
        </div>
      )}
      {tab === 'location' && (
        <div>
          <div className="toolbar">
            <select value={zoneId} onChange={(e) => { setZoneId(e.target.value); setLocId(''); }}><option value="">选区</option>{zones.map((z) => <option key={z.id} value={z.id}>{z.code} {z.name_zh ?? ''} ({ZONE_TYPE_ZH[z.zone_type]})</option>)}</select>
            <select value={locId} onChange={(e) => setLocId(e.target.value)} disabled={!zoneId}><option value="">选位置</option>{locs.map((l) => <option key={l.id} value={l.id}>{l.code}</option>)}</select>
          </div>
          {locId && <table><thead><tr><th>货号</th><th>条码</th><th>名称</th><th>单位</th><th>数量</th><th>最早到期</th></tr></thead><tbody>{byLoc.map((r) => <tr key={r.product_id}><td>{r.sku}</td><td>{r.barcode}</td><td>{n(r)}</td><td>{r.unit}</td><td>{fmtQty(r.qty)}</td><td>{r.earliest_expiry ?? '—'}</td></tr>)}{byLoc.length === 0 && <tr><td colSpan={6} className="note">这个位置是空的</td></tr>}</tbody></table>}
        </div>
      )}
      {tab === 'zone' && (
        <div>
          <div className="cards">
            {zones.map((z) => <div key={z.id} className="stat" style={{ cursor: 'pointer', borderLeft: `6px solid ${z.color}`, outline: zcZone === z.id ? '2px solid var(--blue)' : 'none' }} onClick={() => setZcZone(z.id)}><div className="v">{z.code}</div><div className="l">{z.name_zh ?? ''} · {ZONE_TYPE_ZH[z.zone_type]} · {z.location_count} 货位</div></div>)}
          </div>
          {zc && <>
            <h2>{zc.zone.code} {zc.zone.name_zh ?? ''} · 总数量 {fmtQty(zc.total_qty)} · 约 {Math.round(zc.boxes)} 箱{zc.fill_pct != null && ` · 占用 ${zc.fill_pct}%`}{zc.earliest_expiry && ` · 最早到期 ${zc.earliest_expiry}`}</h2>
            <table><thead><tr><th>位置</th><th>货号</th><th>名称</th><th>单位</th><th>数量</th><th>最早到期</th></tr></thead><tbody>{zc.rows.map((r: any, i: number) => <tr key={i}><td>{r.location_code}</td><td>{r.sku}</td><td>{n(r)}</td><td>{r.unit}</td><td>{fmtQty(r.qty)}</td><td>{r.earliest_expiry ?? '—'}</td></tr>)}{zc.rows.length === 0 && <tr><td colSpan={6} className="note">这个区是空的</td></tr>}</tbody></table>
          </>}
        </div>
      )}
    </div>
  );
}
