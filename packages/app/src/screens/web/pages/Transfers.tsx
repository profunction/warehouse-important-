// 网页：调拨列表、批准（改数量）、状态时间线、差异、箱贴
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../../api/client.js';
import { useT } from '../../../i18n/index.js';
import { useAuth } from '../../../store/auth.js';
import { downloadRaw, errText, fmtDate, fmtQty, pillColor } from './_util.js';

const TST: Record<string, string> = { REQUESTED: '待批', APPROVED: '待拣货', PICKING: '拣货中', IN_TRANSIT: '运输中', RECEIVED: '已收货', CLOSED: '已关闭', REJECTED: '已拒绝', CANCELLED: '已取消' };
const tc = (s: string) => (['RECEIVED', 'CLOSED'].includes(s) ? '#1B8A3A' : s === 'REQUESTED' ? '#F9A825' : ['REJECTED', 'CANCELLED'].includes(s) ? '#C62828' : pillColor(s));

export default function Transfers() {
  const { n } = useT(); const { has } = useAuth();
  const [sp, setSp] = useSearchParams();
  const [list, setList] = useState<any[]>([]); const [st, setSt] = useState('REQUESTED,APPROVED,PICKING,IN_TRANSIT'); const [t, setT] = useState<any>(null); const [msg, setMsg] = useState(''); const [ok, setOk] = useState('');
  const [qtys, setQtys] = useState<Record<string, number>>({}); const [sites, setSites] = useState<any[]>([]); const [nf, setNf] = useState({ from_site_id: '', to_site_id: '', note: '' }); const [nl, setNl] = useState<{ product: any; requested_qty: number | '' }[]>([]); const [q, setQ] = useState(''); const [cands, setCands] = useState<any[]>([]); const [showNew, setShowNew] = useState(false);
  const fail = (e: any) => { setMsg(errText(e)); setOk(''); }; const flash = (s: string) => { setOk(s); setMsg(''); setTimeout(() => setOk(''), 4000); };
  const load = () => api(`/transfers?status=${st}`).then(setList).catch(fail);
  useEffect(() => { void load(); }, [st]);
  useEffect(() => { api('/sites').then(setSites).catch(() => {}); }, []);
  const open = async (id: string) => { try { const d = await api(`/transfers/${id}`); setT(d); const m: Record<string, number> = {}; for (const l of d.lines) m[l.id] = Number(l.approved_qty ?? l.requested_qty); setQtys(m); } catch (e) { fail(e); } };
  useEffect(() => { const id = sp.get('id'); if (id) void open(id); }, [sp.get('id')]);
  useEffect(() => { if (!showNew || q.length < 1) { setCands([]); return; } const h = setTimeout(() => api(`/products?search=${encodeURIComponent(q)}&limit=10`).then(setCands).catch(() => {}), 250); return () => clearTimeout(h); }, [q, showNew]);
  const decide = async (decision: string) => {
    const note = decision === 'approve' ? undefined : prompt('备注（可空）') ?? undefined;
    try { const r = await api(`/transfers/${t.id}/decide`, { body: { decision, note, lines: decision === 'approve' ? Object.entries(qtys).map(([id, approved_qty]) => ({ id, approved_qty })) : undefined } }); setT(r); flash(decision === 'approve' ? '已批准，拣货单已生成' : decision === 'reject' ? '已拒绝' : '已退回'); void load(); } catch (e) { fail(e); }
  };
  const cancel = async () => { if (!confirm(`取消 ${t.transfer_no}？`)) return; try { setT(await api(`/transfers/${t.id}/cancel`, { body: {} })); flash('已取消'); void load(); } catch (e) { fail(e); } };
  const create = async () => {
    if (!nf.to_site_id || !nl.length) { setMsg('请选目的站点并至少加一个产品'); return; }
    try { const r = await api('/transfers', { body: { from_site_id: nf.from_site_id || null, to_site_id: nf.to_site_id, note: nf.note || null, lines: nl.map((l) => ({ product_id: l.product.id, requested_qty: l.requested_qty === '' ? null : Number(l.requested_qty) })) } }); setNl([]); setShowNew(false); flash(`已申请 ${r.transfer_no}`); void load(); const qq = new URLSearchParams(sp); qq.set('id', r.id); setSp(qq); } catch (e) { fail(e); }
  };
  const timeline = (x: any) => [['申请', x.created_at, x.requested_by_name], ['批准', x.approved_at, x.approved_by_name], ['发运', x.dispatched_at, x.dispatched_by_name], ['收货', x.received_at, x.received_by_name]] as [string, string | null, string | null][];
  const canApprove = has('transfer.approve');
  return (
    <div>
      <h1>调拨</h1>
      {msg && <div className="err">{msg}</div>}{ok && <div className="note" style={{ color: '#1B8A3A', fontWeight: 600 }}>{ok}</div>}
      <div className="toolbar">
        <select value={st} onChange={(e) => setSt(e.target.value)}><option value="REQUESTED,APPROVED,PICKING,IN_TRANSIT">进行中</option>{Object.entries(TST).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        {(has('transfer.request') || canApprove) && <button className="btn" onClick={() => setShowNew(!showNew)}>{showNew ? '收起' : '新申请'}</button>}
      </div>
      {showNew && (
        <div style={{ marginBottom: 16 }}>
          <div className="form" style={{ maxWidth: 900 }}>
            <label>从（仓库）<select value={nf.from_site_id} onChange={(e) => setNf({ ...nf, from_site_id: e.target.value })}><option value="">自动（第一个仓库）</option>{sites.filter((s) => s.type === 'WAREHOUSE').map((s) => <option key={s.id} value={s.id}>{s.code} {s.name}</option>)}</select></label>
            <label>到（店）<select value={nf.to_site_id} onChange={(e) => setNf({ ...nf, to_site_id: e.target.value })}><option value="">选站点</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.code} {s.name}</option>)}</select></label>
            <label>备注<input value={nf.note} onChange={(e) => setNf({ ...nf, note: e.target.value })} /></label>
          </div>
          <div className="toolbar" style={{ position: 'relative' }}>
            <input placeholder="搜产品" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 360 }} />
            {cands.length > 0 && <table style={{ position: 'absolute', top: 44, left: 0, zIndex: 5, background: '#fff', maxWidth: 600, boxShadow: '0 6px 20px rgba(0,0,0,.15)' }}><tbody>{cands.map((p) => <tr key={p.id} onClick={() => { setCands([]); setQ(''); if (!nl.some((l) => l.product.id === p.id)) setNl([...nl, { product: p, requested_qty: '' }]); }} style={{ cursor: 'pointer' }}><td>{p.sku}</td><td>{n(p)}</td><td>库存 {fmtQty(p.total_qty)}</td></tr>)}</tbody></table>}
          </div>
          <table><thead><tr><th>货号</th><th>产品</th><th>数量（空 = 按最低量补）</th><th></th></tr></thead><tbody>
            {nl.map((l, i) => <tr key={l.product.id}><td>{l.product.sku}</td><td>{n(l.product)}</td><td><input type="number" min={1} value={l.requested_qty} placeholder="自动" style={{ width: 100 }} onChange={(e) => { const c = [...nl]; c[i] = { ...l, requested_qty: e.target.value === '' ? '' : Number(e.target.value) }; setNl(c); }} /></td><td><button className="btn" onClick={() => setNl(nl.filter((_, j) => j !== i))}>删</button></td></tr>)}
          </tbody></table>
          <div className="toolbar"><button className="btn btn-primary" disabled={!nl.length || !nf.to_site_id} onClick={create}>送出申请</button></div>
        </div>
      )}
      <table><thead><tr><th>单号</th><th>从</th><th>到</th><th>状态</th><th>行数</th><th>数量</th><th>已拣</th><th>已收</th><th>申请人</th><th>要求时间</th><th>建立</th></tr></thead><tbody>
        {list.map((x) => <tr key={x.id} onClick={() => { const qq = new URLSearchParams(sp); qq.set('id', x.id); setSp(qq); }} style={{ cursor: 'pointer', fontWeight: t?.id === x.id ? 600 : 400 }}><td>{x.transfer_no}</td><td>{x.from_site_code}</td><td>{x.to_site_code}</td><td><span className="pill" style={{ background: tc(x.status) }}>{TST[x.status] ?? x.status}</span></td><td>{x.line_count}</td><td>{fmtQty(x.qty_total)}</td><td>{fmtQty(x.picked_total)}</td><td>{fmtQty(x.received_total)}</td><td>{x.requested_by_name}</td><td>{x.required_at ? fmtDate(x.required_at) : '—'}</td><td>{fmtDate(x.created_at)}</td></tr>)}
        {list.length === 0 && <tr><td colSpan={11} className="note">没有调拨</td></tr>}
      </tbody></table>
      {t && (
        <div style={{ marginTop: 16 }}>
          <h2>{t.transfer_no} · {t.from_site_name} → {t.to_site_name} · <span className="pill" style={{ background: tc(t.status) }}>{TST[t.status] ?? t.status}</span></h2>
          <div className="cards">{timeline(t).map(([label, at, who]) => <div key={label} className="stat" style={{ opacity: at ? 1 : 0.4 }}><div className="v" style={{ fontSize: 18 }}>{label}</div><div className="l">{at ? `${fmtDate(at)} · ${who ?? ''}` : '—'}</div></div>)}</div>
          {t.note && <p className="note">备注：{t.note}</p>}{t.tickets?.length > 0 && <p className="note">工单：{t.tickets.map((k: any) => `${k.title}（${k.status}）`).join('；')}</p>}
          <div className="toolbar">
            {t.status === 'REQUESTED' && canApprove && <><button className="btn btn-primary" onClick={() => decide('approve')} data-testid="approve-transfer">批准（按下面数量）</button><button className="btn" onClick={() => decide('return')}>退回</button><button className="btn" onClick={() => decide('reject')}>拒绝</button></>}
            {['REQUESTED', 'APPROVED'].includes(t.status) && (canApprove || has('transfer.request')) && <button className="btn" onClick={cancel}>取消</button>}
            {['PICKING', 'IN_TRANSIT', 'RECEIVED'].includes(t.status) && <button className="btn" onClick={() => downloadRaw(`/transfers/${t.id}/labels?n=${Math.max(1, Math.ceil(Number(t.lines.reduce((a: number, l: any) => a + Number(l.picked_qty), 0)) / 12))}`, `${t.transfer_no}-labels.pdf`).catch(fail)}>箱贴 PDF</button>}
            <span className="note">二维码 {t.qr}</span>
          </div>
          <table><thead><tr><th>货号</th><th>产品</th><th>店现有</th><th>仓库现有</th><th>申请</th><th>批准</th><th>拣货位</th><th>已拣</th><th>已收</th><th>差异</th></tr></thead><tbody>
            {t.lines.map((l: any) => { const diff = Number(l.received_qty) - Number(l.picked_qty); return (
              <tr key={l.id}><td>{l.sku}</td><td>{n(l)}</td><td>{fmtQty(l.to_site_qty)}</td><td>{fmtQty(l.from_site_qty)}</td><td>{fmtQty(l.requested_qty)}</td>
                <td>{t.status === 'REQUESTED' && canApprove ? <input type="number" min={0} value={qtys[l.id] ?? ''} style={{ width: 90 }} onChange={(e) => setQtys({ ...qtys, [l.id]: Number(e.target.value) })} data-testid="approved-qty" /> : fmtQty(l.approved_qty)}</td>
                <td>{l.pick_location_code ?? '—'}{l.pick_location_code && ` (${fmtQty(l.pick_location_qty)})`}</td><td>{fmtQty(l.picked_qty)}</td><td>{fmtQty(l.received_qty)}</td>
                <td style={{ color: diff !== 0 && ['RECEIVED', 'CLOSED'].includes(t.status) ? '#C62828' : undefined, fontWeight: diff !== 0 ? 600 : 400 }}>{['RECEIVED', 'CLOSED'].includes(t.status) && diff !== 0 ? (diff > 0 ? `+${diff}` : diff) : ''}</td></tr>
            ); })}
          </tbody></table>
        </div>
      )}
    </div>
  );
}
