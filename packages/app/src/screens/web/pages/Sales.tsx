// 销售报表（模块 D）：按日/店/机/收银员/类别/产品；日结汇总（GET /pos/sessions?date= 由 POS 模块提供，404 时只显示销售部分）；
// 损耗、周转、库龄、应收账龄、应付到期；每个表格可导出 Excel（服务器按角色过滤成本列）。
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../../../api/client.js';
import { useAuth } from '../../../store/auth.js';
import { errText, fmtMoney, downloadRaw } from './_util.js';
type Tab = 'sales' | 'daily' | 'shrinkage' | 'turnover' | 'aging' | 'ar' | 'ap';
const TABS: [Tab, string, string][] = [['sales', '销售', 'report.sales'], ['daily', '日结汇总', 'report.sales'], ['shrinkage', '损耗', 'report.shrinkage'], ['turnover', '周转', 'report.stock'], ['aging', '库龄', 'report.stock'], ['ar', '应收账龄', 'invoice.manage'], ['ap', '应付到期', 'ap.manage']];
const GROUPS: [string, string][] = [['day', '按日'], ['site', '按店'], ['terminal', '按机'], ['cashier', '按收银员'], ['category', '按类别'], ['product', '按产品']];
const today = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
const daysAgo = (n: number) => { const d = new Date(Date.now() + 8 * 3600_000); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
const cell = (v: any, num?: boolean) => (v == null ? '—' : typeof v === 'boolean' ? (v ? '是' : '') : num ? fmtMoney(v) : String(v));

/** 通用报表表格：columns 来自服务器（已按权限过滤） */
function ReportTable({ rep, testId }: { rep: any; testId?: string }) {
  if (!rep) return null;
  const intKeys = ['count', 'qty', 'movements', 'sold_qty', 'stock_qty', 'days_of_stock', 'max_age_days', 'po_count', 'received_pos', 'on_time', 'late_open', 'ordered_qty', 'received_qty'];
  return <table data-testid={testId}><thead><tr>{rep.columns.map((c: any) => <th key={c.key}>{c.title}</th>)}</tr></thead><tbody>
    {rep.rows.map((r: any, i: number) => <tr key={i}>{rep.columns.map((c: any) => <td key={c.key} className={c.num ? 'r' : ''}>{cell(r[c.key], c.num && !intKeys.includes(c.key))}</td>)}</tr>)}
    {rep.rows.length === 0 && <tr><td colSpan={rep.columns.length} className="note">没有数据</td></tr>}
    {rep.totals && rep.rows.length > 0 && <tr style={{ fontWeight: 700 }}>{rep.columns.map((c: any, i: number) => <td key={c.key}>{i === 0 ? '合计' : cell(rep.totals[c.key], c.num && !intKeys.includes(c.key))}</td>)}</tr>}
  </tbody></table>;
}

export default function Sales() {
  const { has } = useAuth(); const [sp, setSp] = useSearchParams();
  const visible = TABS.filter(([, , p]) => has(p));
  const [tab, setTab] = useState<Tab>((sp.get('tab') as Tab) || visible[0]?.[0] || 'sales');
  const [from, setFrom] = useState(daysAgo(29)); const [to, setTo] = useState(today()); const [group, setGroup] = useState('day'); const [days, setDays] = useState(30); const [date, setDate] = useState(today());
  const [rep, setRep] = useState<any | null>(null); const [daily, setDaily] = useState<any | null>(null); const [sessions, setSessions] = useState<any[] | null>(null); const [aging, setAging] = useState<any | null>(null); const [ap, setAp] = useState<any | null>(null);
  const [msg, setMsg] = useState(''); const [loading, setLoading] = useState(false);
  const fail = (e: any) => setMsg(errText(e));
  const path = (fmt?: string) => {
    const f = fmt ? `&format=${fmt}` : '';
    if (tab === 'sales') return `/reports/sales?from=${from}&to=${to}&group=${group}${f}`;
    if (tab === 'shrinkage') return `/reports/shrinkage?from=${from}&to=${to}${f}`;
    if (tab === 'turnover') return `/reports/turnover?days=${days}${f}`;
    if (tab === 'aging') return `/reports/stock-aging?x=1${f}`;
    if (tab === 'daily') return `/reports/daily-summary?date=${date}${f}`;
    return null;
  };
  useEffect(() => { setSp({ tab }); }, [tab]);
  useEffect(() => {
    let alive = true; setMsg(''); setLoading(true);
    (async () => {
      try {
        if (tab === 'ar') setAging(await api('/ar/aging'));
        else if (tab === 'ap') setAp(await api('/ap/due?days=30'));
        else if (tab === 'daily') {
          const d = await api(path()!); if (!alive) return; setDaily(d.meta); setRep(d);
          try { const s = await api(`/pos/sessions?date=${date}`); setSessions(Array.isArray(s) ? s : s.rows ?? []); } catch (e) { setSessions(e instanceof ApiError && e.status === 404 ? null : []); }
        } else { const r = await api(path()!); if (alive) setRep(r); }
      } catch (e) { if (alive) fail(e); } finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [tab, from, to, group, days, date]);
  const exportXlsx = () => { const p = path('xlsx'); if (p) downloadRaw(p, `${tab}-${today()}.xlsx`).catch(fail); };
  return (
    <div>
      <h1>销售与经营报表</h1>
      {msg && <div className="err" style={{ marginBottom: 8 }}>{msg}</div>}
      <div className="tabs">{visible.map(([k, l]) => <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
      <div className="toolbar">
        {(tab === 'sales' || tab === 'shrinkage') && <><span>从 <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></span><span>到 <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></span><button className="btn btn-ghost" onClick={() => { setFrom(daysAgo(6)); setTo(today()); }}>近 7 天</button><button className="btn btn-ghost" onClick={() => { setFrom(today().slice(0, 8) + '01'); setTo(today()); }}>本月</button></>}
        {tab === 'sales' && <select value={group} onChange={(e) => setGroup(e.target.value)}>{GROUPS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>}
        {tab === 'turnover' && <span>天数 <input type="number" value={days} onChange={(e) => setDays(Number(e.target.value) || 30)} style={{ width: 80 }} /></span>}
        {tab === 'daily' && <span>日期 <input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></span>}
        {path() && <button className="btn btn-primary" onClick={exportXlsx}>导出 Excel</button>}
        {loading && <span className="note">加载中…</span>}
        {rep && rep.can_see_cost === false && tab !== 'ar' && tab !== 'ap' && <span className="note">您的角色看不到成本和毛利列</span>}
      </div>
      {tab === 'sales' && rep && <>
        <div className="cards"><div className="stat"><div className="v">{rep.totals?.count ?? 0}</div><div className="l">单数</div></div><div className="stat"><div className="v">{fmtMoney(rep.totals?.net)}</div><div className="l">净销售 RM</div></div><div className="stat"><div className="v">{fmtMoney(rep.totals?.discount)}</div><div className="l">折扣 RM</div></div><div className="stat"><div className="v">{fmtMoney(rep.totals?.tax)}</div><div className="l">税 RM</div></div>{rep.totals?.gross_profit != null && <div className="stat"><div className="v">{fmtMoney(rep.totals.gross_profit)}</div><div className="l">毛利 RM（{rep.totals.margin_pct}%）</div></div>}</div>
        <ReportTable rep={rep} testId="sales-table" />
      </>}
      {tab === 'daily' && daily && <>
        <div className="cards"><div className="stat"><div className="v">{daily.sales.count}</div><div className="l">销售单数</div></div><div className="stat"><div className="v">{fmtMoney(daily.sales.total)}</div><div className="l">销售额 RM</div></div><div className={`stat ${daily.cash.variance !== 0 ? 'warn' : ''}`}><div className="v">{fmtMoney(daily.cash.variance)}</div><div className="l">现金差 RM（{daily.cash.closed}/{daily.cash.sessions} 班已结）</div></div><div className={`stat ${daily.low_stock > 0 ? 'warn' : ''}`}><div className="v">{daily.low_stock}</div><div className="l">低库存</div></div><div className={`stat ${daily.tickets.open > 0 ? 'warn' : ''}`}><div className="v">{daily.tickets.open}</div><div className="l">未关工单（今日新 {daily.tickets.new_today}）</div></div><div className="stat"><div className="v">{daily.einvoice.valid_today}</div><div className="l">电子发票（排队 {daily.einvoice.queued}，失败 {daily.einvoice.failed}）</div></div><div className={`stat ${daily.ar_overdue > 0 ? 'warn' : ''}`}><div className="v">{fmtMoney(daily.ar_overdue)}</div><div className="l">逾期应收 RM</div></div><div className="stat"><div className="v">{fmtMoney(daily.ap_due_7d.amount)}</div><div className="l">7 天内应付 RM（{daily.ap_due_7d.count} 张）</div></div></div>
        <h2>按店</h2><ReportTable rep={rep} />
        <h2>按付款方式</h2><table><thead><tr><th>方式</th><th>笔数</th><th>金额</th></tr></thead><tbody>{daily.sales.by_method.map((m: any) => <tr key={m.method}><td>{m.method}</td><td>{m.count}</td><td>{fmtMoney(m.amount)}</td></tr>)}{daily.sales.by_method.length === 0 && <tr><td colSpan={3} className="note">没有收款</td></tr>}</tbody></table>
        <h2>收银班次（POS 模块）</h2>
        {sessions === null ? <div className="note">POS 日结接口尚未提供（/pos/sessions），只显示销售部分。</div> : <table><thead><tr><th>店</th><th>机号</th><th>收银员</th><th>开班</th><th>结班</th><th>销售</th><th>预期现金</th><th>实点</th><th>差额</th><th>状态</th></tr></thead><tbody>{sessions.map((s: any) => <tr key={s.id}><td>{s.site_code ?? s.site_id}</td><td>{s.terminal_code}</td><td>{s.cashier_name ?? ''}</td><td>{s.opened_at ? new Date(s.opened_at).toLocaleTimeString('zh-CN') : ''}</td><td>{s.closed_at ? new Date(s.closed_at).toLocaleTimeString('zh-CN') : '—'}</td><td>{fmtMoney(s.sales_total)}</td><td>{fmtMoney(s.expected_cash)}</td><td>{fmtMoney(s.counted_cash)}</td><td className={Number(s.variance) !== 0 ? 'err' : ''}>{fmtMoney(s.variance)}</td><td>{s.status}</td></tr>)}{sessions.length === 0 && <tr><td colSpan={10} className="note">当天没有班次</td></tr>}</tbody></table>}
      </>}
      {tab === 'shrinkage' && rep && <>
        {rep.meta?.by_category?.length > 0 && <div className="cards">{rep.meta.by_category.map((c: any) => <div key={c.category_code} className="stat warn"><div className="v">{c.amount != null ? fmtMoney(c.amount) : c.qty}</div><div className="l">{c.category}{c.amount != null ? ' RM' : ' 件'}</div></div>)}</div>}
        <ReportTable rep={rep} />
      </>}
      {tab === 'turnover' && rep && <><div className="note" style={{ marginBottom: 8 }}>周转次数 = {rep.meta?.days} 天销量 ÷ 平均库存；最差前 10（有库存且周转最低）标记为"是"。</div><ReportTable rep={rep} /></>}
      {tab === 'aging' && rep && <>
        {rep.totals && <div className="cards"><div className="stat"><div className="v">{fmtMoney(rep.totals.v0_30)}</div><div className="l">0-30 天 RM</div></div><div className="stat"><div className="v">{fmtMoney(rep.totals.v31_60)}</div><div className="l">31-60 天 RM</div></div><div className="stat warn"><div className="v">{fmtMoney(rep.totals.v61_90)}</div><div className="l">61-90 天 RM</div></div><div className="stat warn"><div className="v">{fmtMoney(rep.totals.v90p)}</div><div className="l">90+ 天 RM</div></div></div>}
        <ReportTable rep={rep} />
      </>}
      {tab === 'ar' && aging && <>
        <div className="cards"><div className="stat"><div className="v">{fmtMoney(aging.totals.b0_30)}</div><div className="l">0-30 天</div></div><div className="stat"><div className="v">{fmtMoney(aging.totals.b31_60)}</div><div className="l">31-60 天</div></div><div className="stat warn"><div className="v">{fmtMoney(aging.totals.b61_90)}</div><div className="l">61-90 天</div></div><div className="stat warn"><div className="v">{fmtMoney(aging.totals.b90p)}</div><div className="l">90+ 天</div></div><div className="stat"><div className="v">{fmtMoney(aging.totals.total)}</div><div className="l">合计</div></div></div>
        <table><thead><tr><th>客户</th><th>0-30</th><th>31-60</th><th>61-90</th><th>90+</th><th>合计</th><th>发票数</th></tr></thead><tbody>{aging.rows.map((r: any) => <tr key={r.customer_id}><td>{r.code} {r.name}</td><td>{fmtMoney(r.b0_30)}</td><td>{fmtMoney(r.b31_60)}</td><td>{fmtMoney(r.b61_90)}</td><td>{fmtMoney(r.b90p)}</td><td><b>{fmtMoney(r.total)}</b></td><td>{r.invoices}</td></tr>)}{aging.rows.length === 0 && <tr><td colSpan={7} className="note">没有未付发票</td></tr>}</tbody></table>
      </>}
      {tab === 'ap' && ap && <>
        <div className="cards"><div className="stat"><div className="v">{fmtMoney(ap.total)}</div><div className="l">30 天内到期 RM</div></div><div className={`stat ${ap.overdue > 0 ? 'warn' : ''}`}><div className="v">{fmtMoney(ap.overdue)}</div><div className="l">已逾期 RM</div></div></div>
        <table><thead><tr><th>到期</th><th>供应商</th><th>发票号</th><th>采购单</th><th>未付</th><th>状态</th></tr></thead><tbody>{ap.rows.map((r: any) => <tr key={r.id}><td>{r.due_date ? String(r.due_date).slice(0, 10) : '—'}</td><td>{r.supplier_name}</td><td>{r.invoice_no}</td><td>{r.po_no ?? '—'}</td><td>{fmtMoney(r.outstanding)}</td><td>{r.status}</td></tr>)}{ap.rows.length === 0 && <tr><td colSpan={6} className="note">没有到期应付</td></tr>}</tbody></table>
      </>}
    </div>
  );
}
