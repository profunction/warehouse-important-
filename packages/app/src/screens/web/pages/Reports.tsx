// 报表中心（模块 D 改版）：导航到销售/经营各报表（Sales.tsx）+ 会计导出 + 保留原有库存报表（低库存、负库存、到期、区占用）和导出记录。
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../api/client.js';
import { useAuth } from '../../../store/auth.js';
import { useT } from '../../../i18n/index.js';
import { errText, fmtDate, fmtQty, downloadRaw } from './_util.js';
const lastMonth = () => { const d = new Date(Date.now() + 8 * 3600_000); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); };
const CENTER: { tab: string; title: string; desc: string; perm: string }[] = [
  { tab: 'sales', title: '销售报表', desc: '按日 / 店 / 机 / 收银员 / 类别 / 产品，毛利', perm: 'report.sales' },
  { tab: 'daily', title: '日结汇总', desc: '当天销售、现金差、低库存、工单、电子发票', perm: 'report.sales' },
  { tab: 'shrinkage', title: '损耗报表', desc: '盘点差异和手动调整到损坏区，按产品 / 类别', perm: 'report.shrinkage' },
  { tab: 'turnover', title: '周转报表', desc: '30 天销量 ÷ 平均库存，最差前 10', perm: 'report.stock' },
  { tab: 'aging', title: '库龄报表', desc: '按最后移动时间 30 / 60 / 90+ 天库存金额', perm: 'report.stock' },
  { tab: 'ar', title: '应收账龄', desc: '客户未付发票 0-30 / 31-60 / 61-90 / 90+', perm: 'invoice.manage' },
  { tab: 'ap', title: '应付到期', desc: '30 天内到期和逾期的供应商发票', perm: 'ap.manage' },
];

export default function Reports() {
  const { has } = useAuth(); const { n } = useT();
  const [tab, setTab] = useState<'low' | 'negative' | 'expiring' | 'zones' | 'otif'>('low');
  const [low, setLow] = useState<any[]>([]); const [neg, setNeg] = useState<any[]>([]); const [exp, setExp] = useState<any[]>([]); const [days, setDays] = useState(14); const [zones, setZones] = useState<any[]>([]); const [zc, setZc] = useState<Record<string, any>>({}); const [otif, setOtif] = useState<any | null>(null);
  const [log, setLog] = useState<any[]>([]); const [msg, setMsg] = useState(''); const [links, setLinks] = useState<Record<string, any>>({});
  const [month, setMonth] = useState(lastMonth()); const [fmt, setFmt] = useState<'sqlaccount' | 'autocount' | 'csv'>('sqlaccount');
  const loadLog = () => api('/export/log').then(setLog).catch(() => {});
  useEffect(() => { api('/stock/low').then(setLow).catch((e) => setMsg(errText(e))); api('/stock/negative').then(setNeg).catch(() => {}); api('/zones').then(async (zs) => { setZones(zs); const m: Record<string, any> = {}; for (const z of zs) { try { m[z.id] = await api(`/zones/${z.id}/contents`); } catch { /* */ } } setZc(m); }).catch(() => {}); void loadLog(); }, []);
  useEffect(() => { api(`/stock/expiring?days=${days}`).then(setExp).catch(() => {}); }, [days]);
  useEffect(() => { if (tab === 'otif' && !otif) api('/reports/supplier-otif').then(setOtif).catch((e) => setMsg(errText(e))); }, [tab]);
  const doExport = async (type: string, filters: any = {}) => { try { const r = await api('/export', { body: { type, filters } }); setLinks({ ...links, [type]: r }); await loadLog(); } catch (e) { setMsg(errText(e)); } };
  const ExportBtn = ({ type, perm, label }: { type: string; perm: string; label: string }) => has(perm) ? <span className="toolbar" style={{ display: 'inline-flex', marginBottom: 0 }}><button className="btn btn-ghost" onClick={() => doExport(type)}>{label}</button>{links[type] && <a className="btn btn-primary" href={links[type].url}>下载（{links[type].row_count} 行，{links[type].columns.length} 列）</a>}</span> : null;
  const canAcc = has('report.sales') || has('export.sales') || has('period.lock');
  return (
    <div>
      <h1>报表中心</h1>
      <div className="note" style={{ marginBottom: 10 }}>导出的列按您的角色过滤，没有权限的列（例如成本）在文件里不存在。</div>
      <div className="cards" data-testid="report-center">{CENTER.filter((c) => has(c.perm)).map((c) => <Link key={c.tab} className="stat" to={`/w/sales?tab=${c.tab}`} style={{ textDecoration: 'none', color: 'inherit' }}><div className="v" style={{ fontSize: 20 }}>{c.title}</div><div className="l" style={{ textTransform: 'none', letterSpacing: 0 }}>{c.desc}</div></Link>)}</div>
      {canAcc && <div className="toolbar" style={{ background: '#F3F4F6', padding: 10, borderRadius: 8 }}>
        <b>会计导出</b><span className="note">销售 / 收款 / 采购 / 付款日记账 + 库存金额，按会计软件导入模板</span>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        <select value={fmt} onChange={(e) => setFmt(e.target.value as any)}><option value="sqlaccount">SQL Account（xlsx）</option><option value="autocount">AutoCount（xlsx）</option><option value="csv">通用 CSV（借贷分录）</option></select>
        <button className="btn btn-primary" onClick={() => downloadRaw(`/reports/accounting-export?month=${month}&format=${fmt}`, `accounting-${month}-${fmt}.${fmt === 'csv' ? 'csv' : 'xlsx'}`).then(loadLog).catch((e) => setMsg(errText(e)))}>下载</button>
      </div>}
      <h2>主数据与库存导出</h2>
      <div className="toolbar"><ExportBtn type="product" perm="export.product" label="导出产品" /><ExportBtn type="stock" perm="export.stock" label="导出库存" /><ExportBtn type="location" perm="export.stock" label="导出位置" /><ExportBtn type="movement" perm="export.movement" label="导出移动记录" /><ExportBtn type="audit" perm="export.audit" label="导出审计日志" /><span className="err">{msg}</span></div>
      <h2>库存报表</h2>
      <div className="tabs">{([['low', `低库存 (${low.length})`], ['negative', `负库存 (${neg.length})`], ['expiring', `即将到期 (${exp.length})`], ['zones', '区占用'], ['otif', '供应商准时率']] as const).map(([k, l]) => <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === 'low' && <table><thead><tr><th>货号</th><th>名称</th><th>单位</th><th>总库存</th><th>最低量</th><th>补货量</th></tr></thead><tbody>{low.map((r) => <tr key={r.id}><td>{r.sku}</td><td>{n(r)}</td><td>{r.unit}</td><td className="err">{fmtQty(r.total_qty)}</td><td>{fmtQty(r.min_level)}</td><td>{fmtQty(r.reorder_qty)}</td></tr>)}{low.length === 0 && <tr><td colSpan={6} className="note">没有低库存产品</td></tr>}</tbody></table>}
      {tab === 'negative' && <table><thead><tr><th>货号</th><th>名称</th><th>位置</th><th>数量</th></tr></thead><tbody>{neg.map((r, i) => <tr key={i}><td>{r.sku}</td><td>{n(r)}</td><td>{r.code}</td><td className="err">{fmtQty(r.qty)}</td></tr>)}{neg.length === 0 && <tr><td colSpan={4} className="note">没有负库存</td></tr>}</tbody></table>}
      {tab === 'expiring' && <><div className="toolbar">天数 <input type="number" value={days} onChange={(e) => setDays(Number(e.target.value) || 14)} style={{ width: 80 }} /></div><table><thead><tr><th>货号</th><th>名称</th><th>位置</th><th>到期日</th><th>数量</th></tr></thead><tbody>{exp.map((r, i) => <tr key={i}><td>{r.sku}</td><td>{n(r)}</td><td>{r.code}</td><td>{r.expiry_date}</td><td>{fmtQty(r.qty)}</td></tr>)}{exp.length === 0 && <tr><td colSpan={5} className="note">没有即将到期</td></tr>}</tbody></table></>}
      {tab === 'zones' && <table><thead><tr><th>区</th><th>名称</th><th>品种</th><th>总数量</th><th>约箱数</th><th>容量</th><th>占用</th><th>最早到期</th></tr></thead><tbody>{zones.map((z) => { const c = zc[z.id]; return <tr key={z.id}><td><span className="pill" style={{ background: z.color }}>{z.code}</span></td><td>{z.name_zh ?? ''}</td><td>{c ? new Set(c.rows.map((r: any) => r.product_id)).size : '—'}</td><td>{c ? fmtQty(c.total_qty) : '—'}</td><td>{c ? Math.round(c.boxes) : '—'}</td><td>{c?.capacity_boxes ?? '—'}</td><td>{c?.fill_pct != null ? `${c.fill_pct}%` : '—'}</td><td>{c?.earliest_expiry ?? '—'}</td></tr>; })}</tbody></table>}
      {tab === 'otif' && <>
        <div className="toolbar"><span className="note">近 90 天采购单：预计到货日 vs 首张完成收货单；少货率 = (订购 − 实收) ÷ 订购</span><button className="btn btn-ghost" onClick={() => downloadRaw('/reports/supplier-otif?format=xlsx', 'supplier-otif.xlsx').catch((e) => setMsg(errText(e)))}>导出 Excel</button></div>
        {otif && <table><thead><tr>{otif.columns.map((c: any) => <th key={c.key}>{c.title}</th>)}</tr></thead><tbody>{otif.rows.map((r: any, i: number) => <tr key={i}>{otif.columns.map((c: any) => <td key={c.key}>{r[c.key] ?? '—'}</td>)}</tr>)}{otif.rows.length === 0 && <tr><td colSpan={otif.columns.length} className="note">没有采购单</td></tr>}</tbody></table>}
      </>}
      <h2>导出记录</h2>
      <table><thead><tr><th>时间</th><th>谁</th><th>类型</th><th>行数</th><th>列</th></tr></thead><tbody>{log.map((l) => <tr key={l.id}><td>{fmtDate(l.at)}</td><td>{l.user_name}</td><td>{l.export_type}</td><td>{l.row_count}</td><td className="note">{(l.columns_json ?? []).join(', ')}</td></tr>)}</tbody></table>
    </div>
  );
}
