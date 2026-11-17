// C6 我的工单 + 开工单
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '../../i18n/index.js';
import { Icon, I } from '../../ui/icons.js';
import { useAuth } from '../../store/auth.js';
import { Page, TopBar } from '../../ui/Shell.js';
import { api, isOnline } from '../../api/client.js';
import { enqueue, uuidv7 } from '../../offline/sync.js';
import { fx } from '../../ui/feedback.js';
export default function Tickets() {
  const { t } = useT(); const { me } = useAuth(); const nav = useNavigate(); const [list, setList] = useState<any[]>([]); const [open, setOpen] = useState<any>(null); const [creating, setCreating] = useState(false); const [text, setText] = useState(''); const [title, setTitle] = useState('');
  const load = async () => { if (isOnline()) try { setList(await api('/tickets/mine')); } catch { /* */ } };
  useEffect(() => { void load(); }, []);
  const create = async () => {
    if (!title.trim() || !me) return;
    if (isOnline()) { try { await api('/tickets', { body: { type: 'MANUAL', title, text } }); } catch { await enqueue({ client_id: uuidv7(), entity: 'ticket', op: 'insert', user_id: me.user.id, summary: title, payload: { type: 'MANUAL', title, text } }); } }
    else await enqueue({ client_id: uuidv7(), entity: 'ticket', op: 'insert', user_id: me.user.id, summary: title, payload: { type: 'MANUAL', title, text } });
    fx.done(); setCreating(false); setTitle(''); setText(''); await load();
  };
  const resolve = async (id: string) => { await api(`/tickets/${id}/events`, { body: { event: 'STATUS', status: 'RESOLVED', text: text || null } }); fx.done(); setOpen(null); setText(''); await load(); };
  const color = (s: string) => (s === 'NEW' ? 'var(--red)' : s === 'IN_PROGRESS' ? 'var(--yellow)' : 'var(--green)');
  return (
    <Page>
      <TopBar title={t('my_tickets')} onBack={() => (open || creating ? (setOpen(null), setCreating(false)) : nav('/m'))} />
      {creating ? (
        <div className="login">
          <input placeholder={t('describe')} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          <textarea rows={3} placeholder={t('describe')} value={text} onChange={(e) => setText(e.target.value)} />
          <button className="btn btn-primary btn-xl" disabled={!title.trim()} onClick={create}><Icon name={I.Check} size={26} /> {t('new_ticket')}</button>
        </div>
      ) : open ? (
        <div>
          <div className="prod-head"><div className="thumb"><Icon name={I.Ticket} size={32} /></div><div><div className="n">{open.title}</div><div className="b">#{open.ticket_no} · {open.type} · {open.deadline_at ? new Date(open.deadline_at).toLocaleDateString() : ''}</div></div></div>
          <div className="login"><textarea rows={3} placeholder={t('describe')} value={text} onChange={(e) => setText(e.target.value)} /><button className="btn btn-primary btn-xl" onClick={() => resolve(open.id)}><Icon name={I.Check} size={26} /> {t('resolved')}</button></div>
        </div>
      ) : (
        <>
          {list.length === 0 ? <div className="empty"><div className="big"><Icon name={I.Check} size={48} /></div>{t('none_pending')}</div> : <div className="list">{list.map((tk) => <div key={tk.id} className="card" onClick={() => setOpen(tk)}><div className="thumb"><Icon name={I.Ticket} size={32} /></div><div className="body"><div className="t">{tk.title}</div><div className="s">#{tk.ticket_no} · {tk.deadline_at ? new Date(tk.deadline_at).toLocaleDateString() : ''}</div></div><div className="status"><span className="dot" style={{ background: color(tk.status) }} />{tk.status}</div></div>)}</div>}
          <div className="confirm-wrap"><button className="btn btn-secondary" onClick={() => setCreating(true)}>＋ {t('new_ticket')}</button></div>
        </>
      )}
    </Page>
  );
}
