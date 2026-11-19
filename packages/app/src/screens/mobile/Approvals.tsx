// M1 待审批清单 + M2 盘点差异明细（逐行接受/重盘）+ 通用批准/退回/拒绝；代理人显示「代 X 批」。需要网络。
// IMPORT 类型要执行表格，手机上只给「去网页」链接。
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '../../i18n/index.js';
import { Icon, I } from '../../ui/icons.js';
import { useAuth } from '../../store/auth.js';
import { DoneScreen, ErrorScreen, Page, TopBar } from '../../ui/Shell.js';
import { api, ApiError } from '../../api/client.js';
import { fx } from '../../ui/feedback.js';

export default function Approvals() {
  const { t, n, lang } = useT(); const { me, has } = useAuth(); const nav = useNavigate();
  const [list, setList] = useState<any[]>([]); const [dels, setDels] = useState<any[]>([]); const [loading, setLoading] = useState(true);
  const [cur, setCur] = useState<any | null>(null); const [lineDec, setLineDec] = useState<Record<string, 'ACCEPT' | 'RECOUNT'>>({}); const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null); const [done, setDone] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const load = async () => { try { const [p, d] = await Promise.all([api('/approvals/pending'), api('/me/delegations')]); setList(p); setDels(d); } catch (e) { setErr(e instanceof ApiError ? e.text(lang) : String(e)); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, []);
  const open = async (a: any) => { fx.tap(); try { const d = await api(`/approvals/${a.id}`); setCur(d); setLineDec({}); setNote(''); } catch (e) { setErr(e instanceof ApiError ? e.text(lang) : String(e)); } };
  const decide = async (decision: 'approve' | 'reject' | 'return') => {
    if (!cur) return; setBusy(true); fx.tap();
    try {
      const line_decisions = Object.entries(lineDec).map(([id, decision]) => ({ id, decision }));
      await api(`/approvals/${cur.id}/decide`, { body: { decision, note: note || undefined, line_decisions: line_decisions.length ? line_decisions : undefined } });
      setDone(decision === 'approve' ? t('approval_approved') : decision === 'reject' ? t('approval_rejected') : t('approval_returned')); setCur(null); await load();
    } catch (e) { setErr(e instanceof ApiError ? e.text(lang) : String(e)); } finally { setBusy(false); }
  };
  const money = (v: any) => (v == null ? '' : `RM ${Number(v).toFixed(2)}`);
  const fmtUntil = (d: string) => new Date(d).toLocaleDateString(lang === 'zh' ? 'zh-CN' : lang === 'ms' ? 'ms-MY' : 'en-MY', { month: 'short', day: 'numeric' });
  if (done) return <DoneScreen title={done} onNext={list.length ? () => setDone(null) : undefined} onHome={() => nav('/m')} />;
  const varLines = cur?.detail?.lines?.filter((l: any) => Number(l.variance_qty) !== 0) ?? [];
  return (
    <Page>
      <TopBar title={cur ? (t('type_' + cur.type) === 'type_' + cur.type ? cur.type_zh : t('type_' + cur.type)) : t('approval_pending_title')} progress={!cur && list.length ? String(list.length) : undefined} onBack={() => (cur ? setCur(null) : nav('/m'))} />
      {err && <ErrorScreen msg={err} onOk={() => setErr(null)} />}
      {!cur && (
        <>
          {dels.map((d) => <div key={d.id} className="overlay-bar bar-alert" style={{ position: 'static' }} data-testid="delegate-banner">★ {t('delegation_you_are', { name: d.delegator_name, until: fmtUntil(d.ends_at) })}</div>)}
          {loading ? <div className="empty">{t('loading')}</div> : list.length === 0 ? <div className="empty"><div className="big"><Icon name={I.Check} size={48} /></div>{t('approval_none')}</div> : (
            <div className="list">
              {list.map((a) => (
                <div key={a.id} className="card" onClick={() => open(a)} data-testid="approval-card">
                  <div className="thumb" style={{ background: a.on_behalf_name ? 'var(--red)' : 'var(--ink)', color: '#fff' }}><Icon name={I.Check} size={28} /></div>
                  <div className="body">
                    <div className="t">{t('type_' + a.type) === 'type_' + a.type ? a.type_zh : t('type_' + a.type)}{a.amount != null && <span style={{ color: 'var(--red)', marginLeft: 8 }}>{money(a.amount)}</span>}</div>
                    <div className="s">{a.requested_by_name} · {a.summary?.title ?? ''}{a.on_behalf_name && <span style={{ color: 'var(--red)', fontWeight: 600 }}> · {t('approval_on_behalf', { name: a.on_behalf_name })}</span>}</div>
                  </div>
                  <div className="status">›</div>
                </div>
              ))}
            </div>
          )}
          <div className="row2" style={{ marginTop: 12 }}>
            {has('movement.adjust') && <button className="btn btn-secondary" onClick={() => nav('/m/adjust')} data-testid="go-adjust"><Icon name={I.Product} size={22} /> {t('adjust_title')}</button>}
            {has('delegation.manage') && <button className="btn btn-secondary" onClick={() => nav('/m/delegation')} data-testid="go-delegation"><Icon name={I.Badge} size={22} /> {t('delegation_title')}</button>}
          </div>
        </>
      )}
      {cur && (
        <>
          <div className="kv"><span className="k">{t('approval_requested_by')}</span><b style={{ fontSize: 22 }}>{cur.requested_by_name}</b></div>
          {cur.amount != null && <div className="kv"><span className="k">{t('count_amount')}</span><b style={{ color: 'var(--red)' }}>{money(cur.amount)}</b></div>}
          {cur.summary?.title && <div className="kv"><span className="k">{t('approval_detail')}</span><span style={{ fontSize: 18, textAlign: 'right' }}>{cur.summary.title}</span></div>}
          {cur.on_behalf_name && <div className="overlay-bar bar-alert" style={{ position: 'static' }}>★ {t('approval_on_behalf', { name: cur.on_behalf_name })}</div>}
          {cur.type === 'COUNT_VARIANCE' && (
            <>
              <div className="section">{t('count_variance_lines', { n: varLines.length })} · {cur.detail?.session?.session_no}</div>
              <div className="instruct" style={{ fontSize: 16, fontWeight: 400, paddingTop: 4 }}><span style={{ fontSize: 16, fontWeight: 400 }}>{t('approval_lines_hint')}</span></div>
              {varLines.map((l: any) => {
                const v = Number(l.variance_qty); const dec = lineDec[l.id] ?? 'ACCEPT';
                return (
                  <div key={l.id} style={{ padding: '14px var(--pad)', borderBottom: '1px solid var(--hair)' }} data-testid="variance-line">
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}><b style={{ fontSize: 20 }}>{n(l)}</b><span className="label-chip">{l.location_code}</span></div>
                    <div style={{ display: 'flex', gap: 16, marginTop: 6, fontSize: 18 }}>
                      <span>{t('count_system')} <b>{Number(l.system_qty)}</b></span><span>{t('count_actual')} <b>{Number(l.counted_qty)}</b></span>
                      <span style={{ color: 'var(--red)' }}>{t('count_diff')} <b>{v > 0 ? '+' : ''}{v}</b></span>{l.variance_amount != null && <span style={{ color: 'var(--red)' }}>{money(l.variance_amount)}</span>}
                    </div>
                    <div className="s" style={{ color: 'var(--muted)', fontSize: 14, marginTop: 4 }}>{t('count_counted_by')}：{l.counted_by_name ?? ''}{l.last_variance_qty != null && ` · ${t('count_last_variance')} ${Number(l.last_variance_qty) > 0 ? '+' : ''}${Number(l.last_variance_qty)}`}</div>
                    <div className="seg" style={{ marginTop: 10 }}>
                      <button className={`btn ${dec === 'ACCEPT' ? 'btn-primary' : 'btn-ghost'}`} style={{ flex: 1 }} onClick={() => setLineDec({ ...lineDec, [l.id]: 'ACCEPT' })}>{t('count_accept')}</button>
                      <button className={`btn ${dec === 'RECOUNT' ? 'btn-danger' : 'btn-ghost'}`} style={{ flex: 1 }} onClick={() => setLineDec({ ...lineDec, [l.id]: 'RECOUNT' })}>{t('count_recount')}</button>
                    </div>
                  </div>
                );
              })}
            </>
          )}
          {cur.type === 'ADJUST' && cur.detail?.adjustment && (() => { const s = cur.detail.adjustment; return (
            <>
              <div className="kv"><span className="k">{t('product_label')}</span><b style={{ fontSize: 22 }}>{s.product_name}</b></div>
              <div className="kv"><span className="k">{t('location_label')}</span><b>{s.location_code}</b></div>
              <div className="kv"><span className="k">{t('qty')}</span><b>{s.current_qty} → {s.new_qty} <span style={{ color: 'var(--red)', fontSize: 20 }}>({s.diff > 0 ? '+' : ''}{s.diff})</span></b></div>
              <div className="kv"><span className="k">{t('adjust_reason')}</span><b style={{ fontSize: 22 }}>{t('reason_' + s.reason)}{s.note ? ` · ${s.note}` : ''}</b></div>
              {s.photo_url && <div style={{ padding: '12px var(--pad)' }}><img src={s.photo_url} alt="" style={{ width: '100%', maxHeight: 280, objectFit: 'contain', background: '#000' }} /></div>}
            </>
          ); })()}
          {cur.type === 'IMPORT' && <div className="confirm-wrap"><div className="empty">{t('approval_use_web')}</div><button className="btn btn-secondary" onClick={() => nav(`/w/import?job=${cur.ref_id}`)}>/w/import ›</button></div>}
          {cur.can_decide && cur.type !== 'IMPORT' && (
            <div className="login" style={{ paddingTop: 10 }}>
              <input placeholder={t('approval_note')} value={note} onChange={(e) => setNote(e.target.value)} data-testid="approval-note" />
              <button className="btn btn-primary btn-xl" disabled={busy} onClick={() => decide('approve')} data-testid="approve-btn"><Icon name={I.Check} size={26} /> {t('approve')}</button>
              <div className="row2" style={{ padding: 0 }}>
                <button className="btn btn-secondary" disabled={busy} onClick={() => decide('return')} data-testid="return-btn">{t('return_back')}</button>
                <button className="btn btn-danger" disabled={busy} onClick={() => decide('reject')} data-testid="reject-btn"><Icon name={I.Close} size={22} /> {t('reject')}</button>
              </div>
            </div>
          )}
          {!cur.can_decide && cur.status === 'PENDING' && cur.requested_by === me?.user.id && <div className="empty">{t('approval_none')}</div>}
        </>
      )}
    </Page>
  );
}
