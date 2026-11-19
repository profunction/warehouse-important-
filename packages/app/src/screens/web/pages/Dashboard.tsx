// 仪表板（按 Stitch 网页稿）：标题行 → 五格指标条 → 快捷动作条 → 左库存清单 / 右待办与流水
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../api/client.js';
import { useAuth } from '../../../store/auth.js';
import { useT } from '../../../i18n/index.js';
import { Icon } from '../../../ui/icons.js';
import { ScanLine, Boxes, FileSpreadsheet, Download, Printer, PackagePlus, ArchiveRestore, RefreshCw, ArrowLeftRight, ClipboardCheck, SlidersHorizontal, Smartphone } from 'lucide-react';
import { fmtMoney, fmtQty, REASON_ZH } from './_util.js';
const REASON_ICON: Record<string, any> = { RECEIVE: PackagePlus, PUTAWAY: ArchiveRestore, REFILL: RefreshCw, TRANSFER_OUT: ArrowLeftRight, TRANSFER_IN: ArrowLeftRight, COUNT: ClipboardCheck, ADJUST: SlidersHorizontal };
const APPROVAL_ZH: Record<string, string> = { IMPORT: 'Excel 导入', ADJUST: '手动调整', COUNT_VARIANCE: '盘点差异', RETURN: '退货', TRANSFER: '调拨', ORDER: '订货', ROLE: '角色变更' };
export default function Dashboard() {
  const { me, has } = useAuth(); const { n } = useT();
  const [d, setD] = useState<any>(null); const [at, setAt] = useState<Date | null>(null);
  const [tab, setTab] = useState<'all' | 'low' | 'negative'>('all'); const [q, setQ] = useState('');
  const [all, setAll] = useState<any[]>([]); const [low, setLow] = useState<any[]>([]); const [neg, setNeg] = useState<any[]>([]);
  const [appr, setAppr] = useState<any[]>([]); const [mov, setMov] = useState<any[]>([]);
  const canStock = has('stock.view'); const canMov = has('movement.view') || has('movement.view_all'); const canAppr = has('approval.decide');
  useEffect(() => {
    api('/dashboard').then((x) => { setD(x); setAt(new Date()); }).catch(() => setD({}));
    if (canStock) { api('/products?limit=8').then(setAll).catch(() => {}); api('/stock/low').then(setLow).catch(() => {}); api('/stock/negative').then(setNeg).catch(() => {}); }
    if (canAppr) api('/approvals').then((r: any[]) => setAppr(r.filter((a) => a.status === 'PENDING').slice(0, 2))).catch(() => {});
    if (canMov) api('/movements?limit=4').then(setMov).catch(() => {});
  }, [canStock, canAppr, canMov]);
  const rows = useMemo(() => {
    const src = tab === 'low' ? low.map((r) => ({ ...r, status: 'LOW' })) : tab === 'negative' ? neg.map((r) => ({ ...r, status: 'NEG', total_qty: r.qty })) : all.map((r) => ({ ...r, status: Number(r.total_qty) < 0 ? 'NEG' : Number(r.total_qty) < Number(r.min_level ?? 0) ? 'LOW' : 'OK' }));
    const t = q.trim().toLowerCase();
    return t ? src.filter((r) => `${r.name_zh ?? ''} ${r.name_en ?? ''} ${r.sku ?? ''} ${r.barcode ?? ''} ${r.code ?? ''}`.toLowerCase().includes(t)) : src;
  }, [tab, q, all, low, neg]);
  if (!d) return <div>加载中…</div>;
  const site = me?.site?.name ?? me?.company.name;
  const pill = (s: string) => s === 'NEG' ? <span className="pill-soft red">负库存</span> : s === 'LOW' ? <span className="pill-soft amber">需补货</span> : <span className="pill-soft green">充足</span>;
  return (
    <div className="dash">
      <div className="titlerow">
        <div>
          <div className="ctx">仓店实时作业总览 <em>/</em> {site} · 实时账实映射</div>
          <h1>库存中枢与营运动态</h1>
        </div>
        <div className="live"><i />数据更新于 {at ? at.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '—'}</div>
      </div>
      <section className="panel metrics">
        <div className="m"><span className="l">在库商品种类 (SKUs)</span><div className="v">{d.product_count ?? '—'}<small>款</small></div><span className="s ok">● 编码校验正常</span></div>
        <div className="m"><span className="l">实时账面总库存</span><div className="v">{d.total_qty != null ? Number(d.total_qty).toLocaleString('en-MY') : '—'}<small>件</small></div><span className="s">{d.stock_value != null ? <>总值 <b>RM {Number(d.stock_value).toLocaleString('en-MY', { maximumFractionDigits: 0 })}</b></> : '成本仅老板可见'}</span></div>
        <div className="m"><span className="l">今日移动笔数</span><div className="v ok">{d.movements_today ?? 0}<small>笔</small></div><span className="s">{d.labels_unprinted > 0 ? `${d.labels_unprinted} 个货位还没打印标签` : '货位标签已全部打印'}</span></div>
        <div className="m"><span className="l">安全水位警戒</span><div className="v amber">{d.low_stock ?? 0}<small>款</small>{Number(d.low_stock) > 0 && <span className="pill-soft amber">急需补货</span>}</div><span className="s">{d.expiring_14d > 0 ? `含 ${d.expiring_14d} 批 14 天内到期` : '无临期批次'}</span></div>
        <div className="m"><span className="l">负库存异常 (账实差)</span><div className={`v ${Number(d.negative_stock) > 0 ? 'red' : 'ok'}`}>{d.negative_stock ?? 0}<small>款</small>{Number(d.negative_stock) > 0 ? <span className="pill-soft red">需处理</span> : <span className="pill-soft green">无差异平账</span>}</div><span className={`s ${Number(d.negative_stock) > 0 ? '' : 'ok'}`}>{Number(d.negative_stock) > 0 ? '已自动开工单' : '全通道校验通过'}</span></div>
      </section>
      <section className="panel todos">
        {([
          ['待审批', d.pending_approvals, '/w/approvals', 'approval.decide', '单'],
          ['待处理导入', d.pending_imports, '/w/import', 'import.upload', '个'],
          ['未关工单', d.open_tickets, '/w/tickets', 'ticket.view_all', '张'],
          ['设备离线', d.devices_offline, '/w/devices', 'device.view', '台'],
          ['未打印标签', d.labels_unprinted, '/w/locations', 'location.manage', '个货位'],
          ['14 天内到期', d.expiring_14d, '/w/stock', 'stock.view', '批'],
          ['今日移动', d.movements_today, '/w/movements', 'movement.view', '笔'],
          ['低库存', d.low_stock, '/w/stock', 'stock.view', '款'],
        ] as [string, any, string, string, string][]).map(([l, v, to, perm, unit]) => {
          const warn = Number(v) > 0 && !['今日移动'].includes(l);
          const inner = <><span className="l">{l}</span><div className={`v ${warn ? 'amber' : ''}`}>{v ?? '—'}<small>{unit}</small></div></>;
          return has(perm) || (perm === 'movement.view' && canMov) ? <Link key={l} className="todo" to={to}>{inner}</Link> : <div key={l} className="todo">{inner}</div>;
        })}
      </section>
      <section className="actions">
        <div className="l">
          <a className="act primary" href="/m"><Icon name={ScanLine} size={20} />扫码 / 快速收货</a>
          {canStock && <Link className="act" to="/w/stock"><Icon name={Boxes} size={20} />库存查询</Link>}
          {has('import.upload') && <Link className="act" to="/w/import"><Icon name={FileSpreadsheet} size={20} />Excel 导入</Link>}
        </div>
        <div className="r">
          {has('report.stock') && <Link className="act quiet" to="/w/reports"><Icon name={Download} size={18} />导出报表 (Excel)</Link>}
          {(has('location.manage') || canStock) && <Link className="act quiet icon" to="/w/locations" title="打印货位签"><Icon name={Printer} size={20} /></Link>}
        </div>
      </section>
      <div className="cols">
        <section className="panel ledger">
          <div className="head">
            <div><h2>实时库存与货位清单</h2><p>主货位、暂存区与补货批次联动追踪</p></div>
            <div className="chips">
              <button className={tab === 'all' ? 'on' : ''} onClick={() => setTab('all')}>最近更新</button>
              <button className={tab === 'low' ? 'on' : ''} onClick={() => setTab('low')}>需补货{low.length > 0 && <b>{low.length}</b>}</button>
              <button className={tab === 'negative' ? 'on' : ''} onClick={() => setTab('negative')}>负库存{neg.length > 0 && <b className="red">{neg.length}</b>}</button>
            </div>
          </div>
          <input className="filter" placeholder="快速过滤品名、货号、条码（如 9556001234567、可乐、A-03）" value={q} onChange={(e) => setQ(e.target.value)} />
          <table>
            <thead><tr><th>商品信息 (Product / SKU)</th><th>{tab === 'negative' ? '货位' : '最低量'}</th><th className="r">账面在库</th><th className="r">售价 / 成本</th><th className="c">状态</th><th className="r">快捷操作</th></tr></thead>
            <tbody>
              {rows.map((r, i) => <tr key={r.id ?? `${r.sku}-${r.code}-${i}`}>
                <td><div className="prod"><span className="thumb"><Icon name={Boxes} size={20} /></span><div><b>{n(r)}</b><small>{r.barcode ?? '—'} · {r.sku}</small></div></div></td>
                <td>{tab === 'negative' ? <b>{r.code}</b> : <>{fmtQty(r.min_level ?? 0)} {r.unit ?? ''}</>}</td>
                <td className="r"><b className={r.status === 'NEG' ? 'red' : r.status === 'LOW' ? 'amber' : ''}>{fmtQty(r.total_qty)} <small>{r.unit ?? ''}</small></b>{r.pack_qty > 1 && <small className="sub ok">约 {Math.floor(Number(r.total_qty) / Number(r.pack_qty))} 箱 ({r.pack_qty}/箱)</small>}{r.status === 'LOW' && <small className="sub amber">低于警戒 {fmtQty(r.min_level)}</small>}</td>
                <td className="r">{r.sell_price != null ? <><b>RM {fmtMoney(r.sell_price)}</b>{r.cost_price != null && <small className="sub">RM {fmtMoney(r.cost_price)}</small>}</> : '—'}</td>
                <td className="c">{pill(r.status)}</td>
                <td className="r"><Link className="mini" to={`/w/stock?q=${encodeURIComponent(r.barcode ?? r.sku ?? '')}`}>查货位</Link>{r.status === 'LOW' && has('import.upload') && <Link className="mini amber" to="/w/import">补货</Link>}</td>
              </tr>)}
              {rows.length === 0 && <tr><td colSpan={6} className="note">{tab === 'low' ? '没有低于警戒的商品' : tab === 'negative' ? '没有负库存' : '还没有商品，先去 Excel 导入'}</td></tr>}
            </tbody>
          </table>
          <div className="foot"><span>显示 {rows.length} 款{tab === 'all' && d.product_count ? `（共 ${d.product_count} 款）` : ''}</span>{canStock && <Link to="/w/stock">完整库存查询 →</Link>}</div>
        </section>
        <div className="sidecol">
          {canAppr && <section className="panel">
            <div className="head"><div><h3>待审批</h3><p>导入、调整、盘点差异</p></div><span className="count">{d.pending_approvals ?? 0} 单待办</span></div>
            {appr.map((a) => <div key={a.id} className="task">
              <div className="row"><div><div className="code">{APPROVAL_ZH[a.type] ?? a.type}<span className="tag">待批</span></div><div className="who">{a.requested_by_name} · {new Date(a.created_at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div></div></div>
              <div className="row end"><Link className="mini primary" to="/w/approvals">去审批</Link></div>
            </div>)}
            {appr.length === 0 && <div className="note">没有待审批的事项</div>}
          </section>}
          {canMov && <section className="panel">
            <div className="head"><h3>最近出入库流水</h3><span className="muted">记录只增不改</span></div>
            {mov.map((m) => { const Ic = REASON_ICON[m.reason] ?? ArrowLeftRight; return <div key={m.id} className="act-row">
              <span className={`dot ${m.reason === 'RECEIVE' ? 'ok' : m.reason === 'ADJUST' ? 'amber' : ''}`}><Icon name={Ic} size={16} /></span>
              <div><div className="row"><b>{REASON_ZH[m.reason] ?? m.reason} · {n(m)}</b><small>{new Date(m.performed_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</small></div><p>{fmtQty(m.qty)} {m.unit ?? ''} · {m.from_code} → {m.to_code}</p><small>操作员: <b>{m.by_name}</b></small></div>
            </div>; })}
            {mov.length === 0 && <div className="note">今天还没有移动记录</div>}
            <Link className="more" to="/w/movements">查看完整出入库记录 →</Link>
          </section>}
          <section className="panel status"><span className="ic"><Icon name={Smartphone} size={18} /></span><div><b>设备在线状态</b><small>{Number(d.devices_offline) > 0 ? `${d.devices_offline} 台超过 2 小时未同步` : '全部设备 2 小时内有同步'}</small></div><i className={Number(d.devices_offline) > 0 ? 'amber' : 'ok'} /></section>
        </div>
      </div>
    </div>
  );
}
