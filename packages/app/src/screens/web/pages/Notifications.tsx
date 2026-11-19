// 网页：通知。notification 表（Telegram 未配置时审批/日报/提醒都落在这里），标记已读。
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../../api/client.js';
import { errText, fmtDate } from './_util.js';

const TYPE_ZH: Record<string, string> = { APPROVAL: '审批', APPROVAL_DETAIL: '审批明细', DAILY_REPORT: '日报', TICKET_OVERDUE: '工单超期', DELEGATION: '代理', STANDBY: '常备代理', COUNT: '盘点', MESSAGE: '消息', TELEGRAM_LINK: 'Telegram 绑定' };
export default function Notifications() {
  const nav = useNavigate();
  const [rows, setRows] = useState<any[]>([]); const [unread, setUnread] = useState(false); const [msg, setMsg] = useState('');
  const load = async () => { try { setRows(await api(`/notifications?limit=200${unread ? '&unread=true' : ''}`)); } catch (e) { setMsg(errText(e)); } };
  useEffect(() => { void load(); }, [unread]);
  const read = async (n: any) => { if (n.read_at) return; try { await api(`/notifications/${n.id}/read`, { method: 'POST' }); setRows(rows.map((r) => (r.id === n.id ? { ...r, read_at: new Date().toISOString() } : r))); } catch (e) { setMsg(errText(e)); } };
  const readAll = async () => { try { const r = await api('/notifications/read-all', { method: 'POST' }); setMsg(`已标 ${r.count} 条为已读`); await load(); } catch (e) { setMsg(errText(e)); } };
  const go = (n: any) => { void read(n); if (n.ref_type === 'approval_request' && n.ref_id) nav(`/w/approvals?id=${n.ref_id}`); else if (n.ref_type === 'count_session') nav('/w/counts'); else if (n.type === 'TICKET_OVERDUE') nav('/w/tickets'); else if (n.type === 'DELEGATION') nav('/w/delegations'); };
  const unreadCount = rows.filter((r) => !r.read_at).length;
  return (
    <div>
      <h1>通知</h1>
      {msg && <div className={/已/.test(msg) ? 'ok' : 'err'}>{msg}</div>}
      <div className="toolbar">
        <button className={`btn ${unread ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setUnread(!unread)}>只看未读{unreadCount ? `（${unreadCount}）` : ''}</button>
        <button className="btn btn-ghost" onClick={readAll}>全部已读</button>
        <span className="note">Telegram 没有配置时，审批通知、日报、工单提醒会出现在这里；配置后仍会保留副本。</span>
      </div>
      <table><thead><tr><th style={{ width: 170 }}>时间</th><th style={{ width: 110 }}>类型</th><th>内容</th><th style={{ width: 90 }}>渠道</th><th style={{ width: 80 }}></th></tr></thead><tbody>
        {rows.map((n) => <tr key={n.id} style={{ fontWeight: n.read_at ? 400 : 700, cursor: 'pointer' }} onClick={() => go(n)}>
          <td>{fmtDate(n.sent_at)}</td><td><span className="pill" style={{ background: n.read_at ? '#9E9E9E' : '#1565C0' }}>{TYPE_ZH[n.type] ?? n.type}</span></td><td style={{ whiteSpace: 'pre-wrap' }}>{n.text}</td><td className="note">{n.channel}</td>
          <td>{!n.read_at && <button className="btn btn-ghost" onClick={(e) => { e.stopPropagation(); void read(n); }}>已读</button>}</td>
        </tr>)}
        {rows.length === 0 && <tr><td colSpan={5} className="note">没有通知</td></tr>}
      </tbody></table>
    </div>
  );
}
