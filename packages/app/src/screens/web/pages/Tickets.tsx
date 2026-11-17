import { useEffect, useState } from 'react';
import { api } from '../../../api/client.js';
import { useAuth } from '../../../store/auth.js';
import { errText, fmtDate, pillColor, STATUS_ZH } from './_util.js';
const TYPE_ZH: Record<string, string> = { COUNT_VARIANCE: '盘点差异', RECEIVE_VARIANCE: '收货差异', TRANSFER_VARIANCE: '调拨差异', NEGATIVE_STOCK: '负库存', CUSTOMER_HELP: '顾客呼叫', BOT_UNANSWERED: '机器人答不了', DEVICE: '设备', UNKNOWN_BARCODE: '未知条码', OVERDUE_AR: '逾期应收', SYNC_QUARANTINE: '同步隔离', MANUAL: '手动', RECEIVE_DAMAGE: '收货损坏' };
const COLS = ['NEW', 'IN_PROGRESS', 'WAITING', 'RESOLVED', 'CLOSED'];
export default function Tickets() {
  const { has } = useAuth();
  const [rows, setRows] = useState<any[]>([]); const [q, setQ] = useState<any[]>([]); const [sel, setSel] = useState<any | null>(null); const [msg, setMsg] = useState(''); const [text, setText] = useState('');
  const load = async () => { try { setRows(await api('/tickets')); if (has('ticket.manage')) setQ(await api('/sync/quarantine')); } catch (e) { setMsg(errText(e)); } };
  useEffect(() => { void load(); }, []);
  const openT = async (t: any) => { try { setSel(await api(`/tickets/${t.id}`)); } catch (e) { setMsg(errText(e)); } };
  const move = async (t: any, status: string) => { try { await api(`/tickets/${t.id}/events`, { body: { event: 'STATUS', status, text: text || undefined } }); setText(''); await load(); if (sel?.id === t.id) await openT(t); } catch (e) { setMsg(errText(e)); } };
  const comment = async () => { if (!sel || !text) return; try { await api(`/tickets/${sel.id}/events`, { body: { event: 'COMMENT', text } }); setText(''); await openT(sel); } catch (e) { setMsg(errText(e)); } };
  const qAct = async (id: string, a: 'retry' | 'discard') => { if (a === 'discard' && !window.confirm('丢弃这条隔离记录？库存不会变。')) return; try { await api(`/sync/quarantine/${id}/${a}`, { method: 'POST' }); await load(); setMsg(a === 'retry' ? '已重试并写入' : '已丢弃'); } catch (e) { setMsg(errText(e)); } };
  const overdue = (t: any) => t.deadline_at && new Date(t.deadline_at) < new Date() && !['RESOLVED', 'CLOSED'].includes(t.status);
  return (
    <div>
      <h1>工单</h1>
      {msg && <div className={msg.includes('已') ? 'ok' : 'err'}>{msg}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginBottom: 16 }}>
        {COLS.map((c) => <div key={c} style={{ background: '#F3F4F6', borderRadius: 8, padding: 8, minHeight: 120 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>{STATUS_ZH[c]} ({rows.filter((t) => t.status === c).length})</div>
          {rows.filter((t) => t.status === c).map((t) => <div key={t.id} onClick={() => openT(t)} style={{ background: '#fff', border: `1px solid ${overdue(t) ? 'var(--red)' : 'var(--border)'}`, borderRadius: 6, padding: 8, marginBottom: 6, cursor: 'pointer', fontSize: 13 }}>
            <div><span className="pill" style={{ background: pillColor(t.priority === 'URGENT' || t.priority === 'HIGH' ? 'ERROR' : 'OK') }}>{TYPE_ZH[t.type] ?? t.type}</span> #{t.ticket_no}</div>
            <div style={{ fontWeight: 600 }}>{t.title}</div>
            <div className="note">{t.owner_name ?? t.owner_role_code ?? ''} · 期限 {fmtDate(t.deadline_at)}{overdue(t) && <b className="err"> 超期</b>}</div>
          </div>)}
        </div>)}
      </div>
      {sel && <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 10, padding: 16, marginBottom: 16 }}>
        <h2>#{sel.ticket_no} {sel.title} <span className="pill" style={{ background: pillColor(sel.status) }}>{STATUS_ZH[sel.status]}</span></h2>
        <div className="note">{TYPE_ZH[sel.type] ?? sel.type} · 建立 {fmtDate(sel.created_at)} · 期限 {fmtDate(sel.deadline_at)}{sel.resolution ? ` · 处理：${sel.resolution}` : ''}</div>
        <table style={{ marginTop: 8 }}><tbody>{sel.events.map((e: any) => <tr key={e.id}><td style={{ width: 160 }}>{fmtDate(e.at)}</td><td style={{ width: 100 }}>{e.user_name ?? '系统'}</td><td>{e.event}</td><td>{e.text ?? ''}{e.photo_url && <a href={e.photo_url} target="_blank" rel="noreferrer"> 照片</a>}</td></tr>)}</tbody></table>
        <div className="toolbar" style={{ marginTop: 10 }}>
          <input placeholder="评论或处理说明" value={text} onChange={(e) => setText(e.target.value)} style={{ width: 320 }} />
          <button className="btn btn-ghost" onClick={comment}>评论</button>
          {COLS.filter((c) => c !== sel.status).map((c) => <button key={c} className={`btn ${c === 'RESOLVED' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => move(sel, c)}>→ {STATUS_ZH[c]}</button>)}
          <button className="btn btn-ghost" onClick={() => setSel(null)}>关闭</button>
        </div>
      </div>}
      {has('ticket.manage') && <>
        <h2>同步隔离记录（{q.length}）</h2>
        <div className="note" style={{ marginBottom: 6 }}>手机上传时被服务器拒绝的记录。修好原因后（例如重新启用产品）按"重试"，或确认不需要后"丢弃"。</div>
        <table><thead><tr><th>时间</th><th>谁</th><th>设备</th><th>类型</th><th>原因</th><th>内容</th><th></th></tr></thead><tbody>
          {q.map((r) => <tr key={r.id}><td>{fmtDate(r.created_at)}</td><td>{r.user_name}</td><td>{r.device_name}</td><td>{r.entity}</td><td className="err">{r.reason_code}<div className="note">{r.reason_message}</div></td><td><pre style={{ maxHeight: 80 }}>{JSON.stringify(r.payload)}</pre></td><td style={{ whiteSpace: 'nowrap' }}><button className="btn btn-primary" onClick={() => qAct(r.id, 'retry')}>重试</button> <button className="btn btn-danger" onClick={() => qAct(r.id, 'discard')}>丢弃</button></td></tr>)}
          {q.length === 0 && <tr><td colSpan={7} className="note">没有隔离记录</td></tr>}
        </tbody></table>
      </>}
    </div>
  );
}
