import { useEffect, useState } from 'react';
import { api } from '../../../api/client.js';
import { useAuth } from '../../../store/auth.js';
import { useT } from '../../../i18n/index.js';
import { errText, fmtDate, fmtQty } from './_util.js';

export default function Reports() {
  const { has } = useAuth(); const { n } = useT();
  const [tab, setTab] = useState<'low' | 'negative' | 'expiring' | 'zones'>('low');
  const [low, setLow] = useState<any[]>([]); const [neg, setNeg] = useState<any[]>([]); const [exp, setExp] = useState<any[]>([]); const [days, setDays] = useState(14); const [zones, setZones] = useState<any[]>([]); const [zc, setZc] = useState<Record<string, any>>({});
  const [log, setLog] = useState<any[]>([]); const [msg, setMsg] = useState(''); const [links, setLinks] = useState<Record<string, any>>({});
  const loadLog = () => api('/export/log').then(setLog).catch(() => {});
  useEffect(() => { api('/stock/low').then(setLow).catch((e) => setMsg(errText(e))); api('/stock/negative').then(setNeg).catch(() => {}); api('/zones').then(async (zs) => { setZones(zs); const m: Record<string, any> = {}; for (const z of zs) { try { m[z.id] = await api(`/zones/${z.id}/contents`); } catch { /* */ } } setZc(m); }).catch(() => {}); void loadLog(); }, []);
  useEffect(() => { api(`/stock/expiring?days=${days}`).then(setExp).catch(() => {}); }, [days]);
  const doExport = async (type: string, filters: any = {}) => { try { const r = await api('/export', { body: { type, filters } }); setLinks({ ...links, [type]: r }); await loadLog(); } catch (e) { setMsg(errText(e)); } };
  const ExportBtn = ({ type, perm, label }: { type: string; perm: string; label: string }) => has(perm) ? <span className="toolbar" style={{ display: 'inline-flex', marginBottom: 0 }}><button className="btn btn-ghost" onClick={() => doExport(type)}>{label}</button>{links[type] && <a className="btn btn-primary" href={links[type].url}>下载（{links[type].row_count} 行，{links[type].columns.length} 列）</a>}</span> : null;
  return (
    <div>
      <h1>报表中心</h1>
      <div className="note" style={{ marginBottom: 10 }}>导出的列按您的角色过滤，没有权限的列（例如成本）在文件里不存在。</div>
      <div className="toolbar"><ExportBtn type="product" perm="export.product" label="导出产品" /><ExportBtn type="stock" perm="export.stock" label="导出库存" /><ExportBtn type="location" perm="export.stock" label="导出位置" /><ExportBtn type="movement" perm="export.movement" label="导出移动记录" /><ExportBtn type="audit" perm="export.audit" label="导出审计日志" /><span className="err">{msg}</span></div>
      <div className="tabs">{([['low', `低库存 (${low.length})`], ['negative', `负库存 (${neg.length})`], ['expiring', `即将到期 (${exp.length})`], ['zones', '区占用']] as const).map(([k, l]) => <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === 'low' && <table><thead><tr><th>货号</th><th>名称</th><th>单位</th><th>总库存</th><th>最低量</th><th>补货量</th></tr></thead><tbody>{low.map((r) => <tr key={r.id}><td>{r.sku}</td><td>{n(r)}</td><td>{r.unit}</td><td className="err">{fmtQty(r.total_qty)}</td><td>{fmtQty(r.min_level)}</td><td>{fmtQty(r.reorder_qty)}</td></tr>)}{low.length === 0 && <tr><td colSpan={6} className="note">没有低库存产品</td></tr>}</tbody></table>}
      {tab === 'negative' && <table><thead><tr><th>货号</th><th>名称</th><th>位置</th><th>数量</th></tr></thead><tbody>{neg.map((r, i) => <tr key={i}><td>{r.sku}</td><td>{n(r)}</td><td>{r.code}</td><td className="err">{fmtQty(r.qty)}</td></tr>)}{neg.length === 0 && <tr><td colSpan={4} className="note">没有负库存</td></tr>}</tbody></table>}
      {tab === 'expiring' && <><div className="toolbar">天数 <input type="number" value={days} onChange={(e) => setDays(Number(e.target.value) || 14)} style={{ width: 80 }} /></div><table><thead><tr><th>货号</th><th>名称</th><th>位置</th><th>到期日</th><th>数量</th></tr></thead><tbody>{exp.map((r, i) => <tr key={i}><td>{r.sku}</td><td>{n(r)}</td><td>{r.code}</td><td>{r.expiry_date}</td><td>{fmtQty(r.qty)}</td></tr>)}{exp.length === 0 && <tr><td colSpan={5} className="note">没有即将到期</td></tr>}</tbody></table></>}
      {tab === 'zones' && <table><thead><tr><th>区</th><th>名称</th><th>品种</th><th>总数量</th><th>约箱数</th><th>容量</th><th>占用</th><th>最早到期</th></tr></thead><tbody>{zones.map((z) => { const c = zc[z.id]; return <tr key={z.id}><td><span className="pill" style={{ background: z.color }}>{z.code}</span></td><td>{z.name_zh ?? ''}</td><td>{c ? new Set(c.rows.map((r: any) => r.product_id)).size : '—'}</td><td>{c ? fmtQty(c.total_qty) : '—'}</td><td>{c ? Math.round(c.boxes) : '—'}</td><td>{c?.capacity_boxes ?? '—'}</td><td>{c?.fill_pct != null ? `${c.fill_pct}%` : '—'}</td><td>{c?.earliest_expiry ?? '—'}</td></tr>; })}</tbody></table>}
      <h2>导出记录</h2>
      <table><thead><tr><th>时间</th><th>谁</th><th>类型</th><th>行数</th><th>列</th></tr></thead><tbody>{log.map((l) => <tr key={l.id}><td>{fmtDate(l.at)}</td><td>{l.user_name}</td><td>{l.export_type}</td><td>{l.row_count}</td><td className="note">{(l.columns_json ?? []).join(', ')}</td></tr>)}</tbody></table>
    </div>
  );
}
