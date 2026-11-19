// C6 工单完整版（模块 E）：列表按状态、详情时间线、评论、拍照上传 /sync/photos、转派、关闭原因、"我去"接单；离线建单走 outbox。
// 导出 useCustomerCallWatcher()：轮询 /tickets/mine?type=CUSTOMER_HELP，发现新的 NEW 呼叫 → 响铃并跳 /m/customer-call?id=（主会话会接到 Home）。
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useT } from '../../i18n/index.js';
import { Icon, I } from '../../ui/icons.js';
import { useAuth } from '../../store/auth.js';
import { Page, TopBar, Confirm } from '../../ui/Shell.js';
import { api, isOnline } from '../../api/client.js';
import { enqueue, uuidv7 } from '../../offline/sync.js';
import { fx } from '../../ui/feedback.js';

const SEEN_KEY = 'wh.cc.seen';
const seen = (): Record<string, number> => { try { return JSON.parse(sessionStorage.getItem(SEEN_KEY) ?? '{}'); } catch { return {}; } };
export function markCallSeen(id: string, dismissed = false) { try { const s = seen(); s[id] = dismissed ? 2 : 1; sessionStorage.setItem(SEEN_KEY, JSON.stringify(s)); } catch { /* */ } }
/** 顾客呼叫监听：10 秒轮询，新 NEW 呼叫 → 响铃 + 跳 S6。挂在 Home 即可。 */
export function useCustomerCallWatcher(intervalMs = 10000) {
  const nav = useNavigate(); const { me } = useAuth(); const [pending, setPending] = useState<any[]>([]); const busy = useRef(false);
  useEffect(() => {
    if (!me) return;
    const check = async () => {
      if (busy.current || !isOnline() || location.pathname.startsWith('/m/customer-call') || location.pathname.startsWith('/kiosk')) return;
      busy.current = true;
      try {
        const list: any[] = await api('/tickets/mine?type=CUSTOMER_HELP'); const open = list.filter((t) => t.status === 'NEW' && Date.now() - new Date(t.created_at).getTime() < 15 * 60_000); setPending(open);   // 15 分钟前的旧呼叫不再弹（已由任务升级给经理）
        const s = seen(); const fresh = open.find((t) => !s[t.id]);
        if (fresh) { markCallSeen(fresh.id); fx.alert(); nav(`/m/customer-call?id=${fresh.id}`); }
      } catch { /* */ } finally { busy.current = false; }
    };
    void check(); const t = setInterval(check, intervalMs); return () => clearInterval(t);
  }, [me?.user.id, intervalMs]);
  return pending;
}

const STATUSES = ['NEW', 'IN_PROGRESS', 'WAITING', 'RESOLVED', 'CLOSED'];
const REASONS = ['FIXED', 'NOT_AN_ISSUE', 'DUPLICATE', 'CUSTOMER_LEFT', 'HANDLED_OTHER', 'CANNOT_REPRODUCE', 'OTHER'];
export default function Tickets() {
  const { t, lang } = useT(); const { me, has } = useAuth(); const nav = useNavigate(); const [sp, setSp] = useSearchParams();
  const [list, setList] = useState<any[]>([]); const [open, setOpen] = useState<any>(null); const [creating, setCreating] = useState(false); const [text, setText] = useState(''); const [title, setTitle] = useState(''); const [filter, setFilter] = useState<string>('OPEN'); const [err, setErr] = useState('');
  const [closing, setClosing] = useState(false); const [reason, setReason] = useState('FIXED'); const [assigning, setAssigning] = useState(false); const [users, setUsers] = useState<any[]>([]); const [uploading, setUploading] = useState(false); const [confirmAccept, setConfirmAccept] = useState(false);
  const errText = (e: any) => (e?.text ? e.text(lang) : String(e?.message ?? e));
  const load = async () => { if (!isOnline()) return; try { setList(await api('/tickets/mine')); } catch (e) { setErr(errText(e)); } };
  const openT = async (tk: any) => { try { setOpen(await api(`/tickets/${tk.id}`)); setText(''); setClosing(false); setAssigning(false); } catch (e) { setErr(errText(e)); } };
  useEffect(() => { void load(); const id = sp.get('id'); if (id) void openT({ id }); }, []);
  const create = async () => {
    if (!title.trim() || !me) return;
    const payload = { type: 'MANUAL', title, text };
    if (isOnline()) { try { await api('/tickets', { body: { ...payload, client_id: uuidv7() } }); } catch { await enqueue({ client_id: uuidv7(), entity: 'ticket', op: 'insert', user_id: me.user.id, summary: title, payload }); } }
    else await enqueue({ client_id: uuidv7(), entity: 'ticket', op: 'insert', user_id: me.user.id, summary: title, payload });
    fx.done(); setCreating(false); setTitle(''); setText(''); await load();
  };
  const act = async (fn: () => Promise<any>, ok = true) => { try { await fn(); if (ok) fx.done(); await load(); if (open) await openT(open); } catch (e) { setErr(errText(e)); fx.error(); } };
  const comment = () => act(() => api(`/tickets/${open.id}/events`, { body: { event: 'COMMENT', text } }));
  const status = (s: string) => act(() => api(`/tickets/${open.id}/events`, { body: { event: 'STATUS', status: s, text: text || undefined } }));
  const accept = () => act(() => api(`/tickets/${open.id}/accept`, { method: 'POST' }));
  const close = () => act(() => api(`/tickets/${open.id}/close`, { body: { reason_code: reason, text: text || undefined } }));
  const assign = (uid: string) => act(() => api(`/tickets/${open.id}/assign`, { body: { owner_id: uid } }));
  const photo = async (file: File | null) => { if (!file) return; setUploading(true); try { const fd = new FormData(); fd.append('file', file); const r = await api('/sync/photos', { body: fd }); await api(`/tickets/${open.id}/events`, { body: { event: 'PHOTO', photo_url: r.url, text: text || undefined } }); fx.scanOk(); await openT(open); } catch (e) { setErr(errText(e)); } finally { setUploading(false); } };
  const loadUsers = async () => { setAssigning(true); try { setUsers(await api('/users')); } catch { setUsers([]); } };
  const color = (s: string) => (s === 'NEW' ? 'var(--red)' : s === 'IN_PROGRESS' ? 'var(--yellow)' : s === 'WAITING' ? 'var(--muted)' : 'var(--green)');
  const overdue = (tk: any) => tk.deadline_at && new Date(tk.deadline_at) < new Date() && !['RESOLVED', 'CLOSED'].includes(tk.status);
  const fmt = (v?: string) => (v ? new Date(v).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-MY', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
  const shown = list.filter((tk) => filter === 'OPEN' ? !['RESOLVED', 'CLOSED'].includes(tk.status) : filter === 'ALL' ? true : tk.status === filter);
  const tlabel = (ty: string) => t(`type_${ty}`) === `type_${ty}` ? ty : t(`type_${ty}`);
  const mineOrManage = open && (has('ticket.manage') || open.owner_id === me?.user.id || open.created_by === me?.user.id);

  return (
    <Page>
      <TopBar title={t('my_tickets')} onBack={() => (open || creating ? (setOpen(null), setCreating(false), setSp({})) : nav('/m'))} />
      {err && <div style={{ margin: '8px var(--pad)', padding: 12, background: 'var(--red)', color: '#fff', borderRadius: 10 }} onClick={() => setErr('')}>{err}</div>}
      {creating ? (
        <div className="login">
          <input placeholder={t('describe')} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          <textarea rows={3} placeholder={t('describe')} value={text} onChange={(e) => setText(e.target.value)} />
          <button className="btn btn-primary btn-xl" disabled={!title.trim()} onClick={create}><Icon name={I.Check} size={26} /> {t('new_ticket')}</button>
          {!isOnline() && <div style={{ color: 'var(--muted)' }}>{t('tk_offline_later')}</div>}
        </div>
      ) : open ? (
        <div style={{ flex: 1, overflow: 'auto' }} data-testid="ticket-detail">
          <div className="prod-head"><div className="thumb"><Icon name={I.Ticket} size={32} /></div><div><div className="n">{open.title}</div><div className="b">#{open.ticket_no} · {tlabel(open.type)} · <span style={{ color: color(open.status) }}>{t(`tk_${open.status.toLowerCase()}`)}</span></div><div className="b">{t('tk_owner')}: {open.owner_name ?? open.owner_role_code ?? '—'} · {t('tk_deadline')}: {fmt(open.deadline_at)}{overdue(open) && <b style={{ color: 'var(--red)' }}> {t('tk_overdue')}</b>}</div></div></div>
          {open.type === 'CUSTOMER_HELP' && open.status === 'NEW' && <div className="confirm-wrap"><button className="btn btn-primary btn-xl" style={{ background: 'var(--red)' }} onClick={() => setConfirmAccept(true)} data-testid="ticket-accept"><Icon name={I.Check} size={28} /> {t('tk_accept')}</button></div>}
          <div className="section">{t('tk_timeline')}</div>
          <div className="list">{open.events.map((e: any) => <div key={e.id} className="card" style={{ cursor: 'default', minHeight: 0, padding: '12px 2px', flexDirection: 'column', alignItems: 'stretch', gap: 4 }}><div className="s">{fmt(e.at)} · {e.user_name ?? t('tk_system')} · {e.event}</div>{e.text && <div className="t" style={{ whiteSpace: 'pre-wrap' }}>{e.text}</div>}{e.photo_url && <img src={e.photo_url} alt="" style={{ width: '100%', borderRadius: 10, marginTop: 6 }} />}</div>)}</div>
          {!['CLOSED'].includes(open.status) && <div className="login" style={{ gap: 10 }}>
            <textarea rows={2} placeholder={t('tk_comment')} value={text} onChange={(e) => setText(e.target.value)} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <button className="btn btn-secondary" disabled={!text.trim()} onClick={comment}>{t('tk_comment')}</button>
              <label className="btn btn-ghost" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}><Icon name={I.Camera} size={22} /> {uploading ? t('tk_uploading') : t('tk_photo')}<input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={(e) => photo(e.target.files?.[0] ?? null)} /></label>
              {open.status === 'NEW' && open.type !== 'CUSTOMER_HELP' && <button className="btn btn-secondary" onClick={() => status('IN_PROGRESS')}>{t('tk_accept')}</button>}
              {open.status === 'IN_PROGRESS' && <button className="btn btn-ghost" onClick={() => status('WAITING')}>{t('tk_waiting')}</button>}
              {open.status !== 'RESOLVED' && mineOrManage && <button className="btn btn-primary" onClick={() => status('RESOLVED')}>{t('resolved')}</button>}
              {has('ticket.manage') && <button className="btn btn-ghost" onClick={loadUsers}>{t('tk_assign')}</button>}
              {mineOrManage && <button className="btn btn-ghost" onClick={() => setClosing(!closing)}>{t('tk_close')}</button>}
            </div>
            {assigning && <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><div style={{ color: 'var(--muted)' }}>{t('tk_pick_person')}</div>{users.map((u) => <button key={u.id} className="btn btn-ghost" style={{ minHeight: 56 }} onClick={() => assign(u.id)}>{u.name} <span style={{ color: 'var(--muted)', fontSize: 14 }}>{(u.roles ?? []).map((r: any) => r.role_code ?? r).join('/')}</span></button>)}{!users.length && <div className="empty">—</div>}</div>}
            {closing && <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><div style={{ color: 'var(--muted)' }}>{t('tk_close_reason')}</div>{REASONS.map((r) => <button key={r} className={`btn ${reason === r ? 'btn-secondary' : 'btn-ghost'}`} style={{ minHeight: 52 }} onClick={() => setReason(r)}>{t(`reason_${r}`)}</button>)}<button className="btn btn-danger btn-xl" onClick={close}>{t('tk_close')}</button></div>}
          </div>}
          {confirmAccept && <Confirm msg={t('cc_i_go') + '?'} okText={t('cc_i_go')} onOk={() => { setConfirmAccept(false); void accept(); }} onCancel={() => setConfirmAccept(false)} />}
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 6, padding: '8px var(--pad)', overflowX: 'auto' }}>{['OPEN', ...STATUSES, 'ALL'].map((s) => <button key={s} className={`btn ${filter === s ? 'btn-secondary' : 'btn-ghost'}`} style={{ minHeight: 44, fontSize: 15, padding: '0 12px', whiteSpace: 'nowrap' }} onClick={() => setFilter(s)}>{s === 'OPEN' ? t('tk_mine') : s === 'ALL' ? t('tk_all') : t(`tk_${s.toLowerCase()}`)}</button>)}</div>
          {shown.length === 0 ? <div className="empty"><div className="big"><Icon name={I.Check} size={48} /></div>{t('none_pending')}</div> : <div className="list">{shown.map((tk) => <div key={tk.id} className="card" onClick={() => openT(tk)} data-testid="ticket-row"><div className="thumb" style={{ color: tk.type === 'CUSTOMER_HELP' ? 'var(--red)' : undefined }}><Icon name={tk.type === 'CUSTOMER_HELP' ? I.Shop : I.Ticket} size={32} /></div><div className="body"><div className="t">{tk.title}</div><div className="s">#{tk.ticket_no} · {tlabel(tk.type)} · {fmt(tk.deadline_at)}{overdue(tk) ? ` · ${t('tk_overdue')}` : ''}</div></div><div className="status"><span className="dot" style={{ background: color(tk.status) }} />{t(`tk_${tk.status.toLowerCase()}`)}</div></div>)}</div>}
          <div className="confirm-wrap"><button className="btn btn-secondary" onClick={() => setCreating(true)}>＋ {t('new_ticket')}</button></div>
        </>
      )}
    </Page>
  );
}
