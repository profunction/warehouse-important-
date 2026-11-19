// 工单网页完整版（模块 E）：看板三列、筛选类型/站点/负责人、详情抽屉时间线照片、转派改期关闭原因、统计（按类型/关闭原因/超期率）；同步隔离记录保留。
import { useEffect, useState } from 'react';
import { api } from '../../../api/client.js';
import { useAuth } from '../../../store/auth.js';
import { errText, fmtDate, pillColor, STATUS_ZH } from './_util.js';
const TYPE_ZH: Record<string, string> = { COUNT_VARIANCE: '盘点差异', RECEIVE_VARIANCE: '收货差异', TRANSFER_VARIANCE: '调拨差异', NEGATIVE_STOCK: '负库存', CUSTOMER_HELP: '顾客呼叫', BOT_UNANSWERED: '机器人答不了', DEVICE: '设备', UNKNOWN_BARCODE: '未知条码', OVERDUE_AR: '逾期应收', SYNC_QUARANTINE: '同步隔离', MANUAL: '手动', RECEIVE_DAMAGE: '收货损坏' };
const REASON_ZH: Record<string, string> = { FIXED: '已处理', NOT_AN_ISSUE: '不是问题', DUPLICATE: '重复', CUSTOMER_LEFT: '顾客已走', HANDLED_OTHER: '别人处理了', CANNOT_REPRODUCE: '查不出', OTHER: '其他', UNSPECIFIED: '未填' };
const BOARD: { key: string; title: string; statuses: string[] }[] = [{ key: 'todo', title: '待处理', statuses: ['NEW'] }, { key: 'doing', title: '处理中 / 等待', statuses: ['IN_PROGRESS', 'WAITING'] }, { key: 'done', title: '已解决 / 已关闭', statuses: ['RESOLVED', 'CLOSED'] }];
export default function Tickets() {
  const { has, me } = useAuth();
  const [rows, setRows] = useState<any[]>([]); const [q, setQ] = useState<any[]>([]); const [sel, setSel] = useState<any | null>(null); const [msg, setMsg] = useState(''); const [text, setText] = useState('');
  const [fType, setFType] = useState(''); const [fSite, setFSite] = useState(''); const [fOwner, setFOwner] = useState(''); const [showClosed, setShowClosed] = useState(false); const [users, setUsers] = useState<any[]>([]); const [stats, setStats] = useState<any>(null); const [tab, setTab] = useState<'board' | 'stats' | 'quarantine'>('board');
  const [assignTo, setAssignTo] = useState(''); const [deadline, setDeadline] = useState(''); const [reason, setReason] = useState('FIXED');
  const load = async () => {
    try {
      const p = new URLSearchParams(); if (fType) p.set('type', fType); if (fSite) p.set('site', fSite); if (fOwner) p.set('owner', fOwner); if (!showClosed) p.set('open', 'true');
      setRows(await api(`/tickets?${p.toString()}`)); if (has('ticket.manage')) { try { setQ(await api('/sync/quarantine')); } catch { /* */ } }
      if (tab === 'stats') setStats(await api('/tickets/stats?days=90'));
    } catch (e) { setMsg(errText(e)); }
  };
  useEffect(() => { void load(); }, [fType, fSite, fOwner, showClosed, tab]);
  useEffect(() => { if (has('user.manage') || has('user.reset_pin')) void api('/users').then(setUsers).catch(() => {}); }, []);
  const openT = async (t: any) => { try { const d = await api(`/tickets/${t.id}`); setSel(d); setAssignTo(d.owner_id ?? ''); setDeadline(d.deadline_at ? new Date(d.deadline_at).toISOString().slice(0, 16) : ''); } catch (e) { setMsg(errText(e)); } };
  const after = async (ok = '已更新') => { setText(''); setMsg(ok); await load(); if (sel) await openT(sel); };
  const move = async (status: string) => { try { await api(`/tickets/${sel.id}/events`, { body: { event: 'STATUS', status, text: text || undefined } }); await after(); } catch (e) { setMsg(errText(e)); } };
  const comment = async () => { if (!text) return; try { await api(`/tickets/${sel.id}/events`, { body: { event: 'COMMENT', text } }); await after('已评论'); } catch (e) { setMsg(errText(e)); } };
  const assign = async () => { try { await api(`/tickets/${sel.id}/assign`, { body: { owner_id: assignTo || null, deadline_at: deadline ? new Date(deadline).toISOString() : undefined, text: text || undefined } }); await after('已转派'); } catch (e) { setMsg(errText(e)); } };
  const close = async () => { try { await api(`/tickets/${sel.id}/close`, { body: { reason_code: reason, text: text || undefined } }); await after('已关闭'); } catch (e) { setMsg(errText(e)); } };
  const photo = async (file: File | null) => { if (!file || !sel) return; try { const fd = new FormData(); fd.append('file', file); const r = await api('/sync/photos', { body: fd }); await api(`/tickets/${sel.id}/events`, { body: { event: 'PHOTO', photo_url: r.url, text: text || undefined } }); await after('已上传照片'); } catch (e) { setMsg(errText(e)); } };
  const qAct = async (id: string, a: 'retry' | 'discard') => { if (a === 'discard' && !window.confirm('丢弃这条隔离记录？库存不会变。')) return; try { await api(`/sync/quarantine/${id}/${a}`, { method: 'POST' }); await load(); setMsg(a === 'retry' ? '已重试并写入' : '已丢弃'); } catch (e) { setMsg(errText(e)); } };
  const overdue = (t: any) => t.deadline_at && new Date(t.deadline_at) < new Date() && !['RESOLVED', 'CLOSED'].includes(t.status);
  const card = (t: any) => <div key={t.id} onClick={() => openT(t)} style={{ background: '#fff', border: `1px solid ${overdue(t) ? 'var(--red)' : 'var(--border)'}`, borderLeft: `4px solid ${t.type === 'CUSTOMER_HELP' ? 'var(--red)' : t.priority === 'URGENT' || t.priority === 'HIGH' ? '#EF6C00' : 'var(--border)'}`, borderRadius: 6, padding: 8, marginBottom: 6, cursor: 'pointer', fontSize: 13 }} data-testid="ticket-card">
    <div><span className="pill" style={{ background: pillColor(t.status) }}>{STATUS_ZH[t.status]}</span> <span className="note">{TYPE_ZH[t.type] ?? t.type} · #{t.ticket_no}</span></div>
    <div style={{ fontWeight: 600, marginTop: 4 }}>{t.title}</div>
    <div className="note">{t.owner_name ?? t.owner_role_code ?? '—'} · 期限 {fmtDate(t.deadline_at)}{overdue(t) && <b className="err"> 超期</b>}</div>
  </div>;
  return (
    <div>
      <h1>工单</h1>
      {msg && <div className={msg.startsWith('已') ? 'ok' : 'err'} style={{ marginBottom: 8 }}>{msg}</div>}
      <div className="tabs"><button className={tab === 'board' ? 'active' : ''} onClick={() => setTab('board')}>看板</button><button className={tab === 'stats' ? 'active' : ''} onClick={() => setTab('stats')}>统计</button>{has('ticket.manage') && <button className={tab === 'quarantine' ? 'active' : ''} onClick={() => setTab('quarantine')}>同步隔离（{q.length}）</button>}</div>
      {tab === 'board' && <>
        <div className="toolbar">
          <select value={fType} onChange={(e) => setFType(e.target.value)}><option value="">所有类型</option>{Object.entries(TYPE_ZH).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <select value={fSite} onChange={(e) => setFSite(e.target.value)}><option value="">所有站点</option>{(me?.sites ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <select value={fOwner} onChange={(e) => setFOwner(e.target.value)}><option value="">所有负责人</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
          <label className="note"><input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> 含已解决/关闭</label>
          <span className="note">{rows.length} 张 · 超期 {rows.filter(overdue).length}</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: sel ? '1fr 1fr 1fr 420px' : 'repeat(3, 1fr)', gap: 10 }}>
          {BOARD.map((c) => <div key={c.key} style={{ background: '#F3F4F6', borderRadius: 8, padding: 8, minHeight: 200 }}><div style={{ fontWeight: 700, marginBottom: 6 }}>{c.title}（{rows.filter((t) => c.statuses.includes(t.status)).length}）</div>{rows.filter((t) => c.statuses.includes(t.status)).map(card)}</div>)}
          {sel && <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 10, padding: 14, maxHeight: '80vh', overflow: 'auto' }} data-testid="ticket-drawer">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}><h2 style={{ margin: 0 }}>#{sel.ticket_no} {sel.title}</h2><button className="btn btn-ghost" onClick={() => setSel(null)}>×</button></div>
            <div className="note" style={{ margin: '6px 0' }}><span className="pill" style={{ background: pillColor(sel.status) }}>{STATUS_ZH[sel.status]}</span> {TYPE_ZH[sel.type] ?? sel.type} · {sel.priority} · 建立 {fmtDate(sel.created_at)} by {sel.created_by_name ?? '系统'} · 负责 {sel.owner_name ?? sel.owner_role_code ?? '—'} · 期限 {fmtDate(sel.deadline_at)}{overdue(sel) && <b className="err"> 超期</b>}{sel.close_reason ? ` · 关闭原因：${REASON_ZH[sel.close_reason] ?? sel.close_reason}` : ''}{sel.resolution ? ` · ${sel.resolution}` : ''}</div>
            <div style={{ display: 'grid', gap: 6, margin: '10px 0' }}>{sel.events.map((e: any) => <div key={e.id} style={{ borderLeft: '2px solid var(--border)', paddingLeft: 10 }}><div className="note">{fmtDate(e.at)} · {e.user_name ?? '系统'} · {e.event}</div>{e.text && <div style={{ whiteSpace: 'pre-wrap' }}>{e.text}</div>}{e.photo_url && <a href={e.photo_url} target="_blank" rel="noreferrer"><img src={e.photo_url} alt="" style={{ maxWidth: 200, borderRadius: 6, marginTop: 4 }} /></a>}</div>)}</div>
            <textarea rows={2} placeholder="评论 / 处理说明" value={text} onChange={(e) => setText(e.target.value)} style={{ width: '100%' }} />
            <div className="toolbar" style={{ marginTop: 8 }}>
              <button className="btn btn-ghost" onClick={comment}>评论</button>
              <label className="btn btn-ghost">照片<input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => photo(e.target.files?.[0] ?? null)} /></label>
              {['NEW', 'IN_PROGRESS', 'WAITING', 'RESOLVED'].filter((s) => s !== sel.status).map((s) => <button key={s} className={`btn ${s === 'RESOLVED' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => move(s)}>→ {STATUS_ZH[s]}</button>)}
            </div>
            {has('ticket.manage') && <div className="form" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 8 }}>
              <label>转派给<select value={assignTo} onChange={(e) => setAssignTo(e.target.value)}><option value="">（按角色 {sel.owner_role_code ?? '—'}）</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
              <label>改期<input type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} /></label>
              <label>&nbsp;<span><button className="btn btn-ghost" onClick={assign}>转派 / 改期</button></span></label>
              <label>关闭原因<select value={reason} onChange={(e) => setReason(e.target.value)}>{Object.entries(REASON_ZH).filter(([k]) => k !== 'UNSPECIFIED').map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label>&nbsp;<span><button className="btn btn-danger" onClick={close} disabled={sel.status === 'CLOSED'}>关闭工单</button></span></label>
            </div>}
          </div>}
        </div>
      </>}
      {tab === 'stats' && stats && <>
        <div className="cards"><div className="stat"><div className="v">{stats.total}</div><div className="l">{stats.days} 天工单</div></div><div className={`stat ${stats.overdue_rate > 20 ? 'warn' : ''}`}><div className="v">{stats.overdue_rate}%</div><div className="l">超期率</div></div><div className="stat"><div className="v">{stats.by_type.reduce((a: number, r: any) => a + r.open, 0)}</div><div className="l">未关闭</div></div></div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <div><h2>按类型</h2><table><thead><tr><th>类型</th><th>总数</th><th>未关</th><th>超期未关</th><th>超期关闭</th><th>平均小时</th></tr></thead><tbody>{stats.by_type.map((r: any) => <tr key={r.type}><td>{TYPE_ZH[r.type] ?? r.type}</td><td>{r.total}</td><td>{r.open}</td><td className={r.overdue_open ? 'err' : ''}>{r.overdue_open}</td><td>{r.closed_late}</td><td>{r.avg_hours ?? '—'}</td></tr>)}</tbody></table></div>
          <div><h2>关闭原因</h2><table><thead><tr><th>类型</th><th>原因</th><th>数量</th></tr></thead><tbody>{stats.close_reasons.map((r: any, i: number) => <tr key={i}><td>{TYPE_ZH[r.type] ?? r.type}</td><td>{REASON_ZH[r.close_reason] ?? r.close_reason}</td><td>{r.n}</td></tr>)}{!stats.close_reasons.length && <tr><td colSpan={3} className="note">还没有关闭的工单</td></tr>}</tbody></table></div>
        </div>
      </>}
      {tab === 'quarantine' && has('ticket.manage') && <>
        <div className="note" style={{ marginBottom: 6 }}>手机上传时被服务器拒绝的记录。修好原因后按"重试"，或确认不需要后"丢弃"。</div>
        <table><thead><tr><th>时间</th><th>谁</th><th>设备</th><th>类型</th><th>原因</th><th>内容</th><th></th></tr></thead><tbody>
          {q.map((r) => <tr key={r.id}><td>{fmtDate(r.created_at)}</td><td>{r.user_name}</td><td>{r.device_name}</td><td>{r.entity}</td><td className="err">{r.reason_code}<div className="note">{r.reason_message}</div></td><td><pre style={{ maxHeight: 80 }}>{JSON.stringify(r.payload)}</pre></td><td style={{ whiteSpace: 'nowrap' }}><button className="btn btn-primary" onClick={() => qAct(r.id, 'retry')}>重试</button> <button className="btn btn-danger" onClick={() => qAct(r.id, 'discard')}>丢弃</button></td></tr>)}
          {q.length === 0 && <tr><td colSpan={7} className="note">没有隔离记录</td></tr>}
        </tbody></table>
      </>}
    </div>
  );
}
