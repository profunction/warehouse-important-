// C5 机器人（模块 E）：文字输入、按住说话（MediaRecorder → /bot/ask audio；服务器回"请打字"也优雅处理）、
// 回答附"去这个屏幕"按钮（按 screen_ref 跳转）、建议问法 chips、离线时本地从 Dexie knowledge_article 按关键词匹配。
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '../../i18n/index.js';
import { Icon, I } from '../../ui/icons.js';
import { Page, TopBar } from '../../ui/Shell.js';
import { db } from '../../offline/db.js';
import { api, isOnline } from '../../api/client.js';
import { fx } from '../../ui/feedback.js';

type Msg = { id: number; who: 'me' | 'bot'; text: string; screen_ref?: string | null; rows?: any[]; conversation_id?: string; answered?: boolean; ticket_id?: string | null; denied?: boolean };
/** screen_ref → 路由（文档屏幕编号；没有精确对应的按首字母落到模块首页） */
export function screenRoute(ref?: string | null): string | null {
  if (!ref) return null; const r = ref.toUpperCase();
  const exact: Record<string, string> = { C1: '/m/settings', C4: '/m/lookup', C6: '/m/tickets', C7: '/m/approvals', C8: '/m/outbox', S1: '/m/refill', S3: '/m/assign-shelf', S6: '/m/customer-call', W1: '/m/receive', W3: '/m/receive', W4: '/m/receive', W2: '/m/putaway', K1: '/m/pick', K2: '/m/receive-transfer', T3: '/m/lookup', G2: '/w/products', G6: '/w/map', G12: '/w/knowledge', M1: '/m/count', O1: '/m/orders' };
  if (exact[r]) return exact[r];
  const byLetter: Record<string, string> = { C: '/m', S: '/m/refill', W: '/m/receive', K: '/m/pick', T: '/m', G: '/w/dashboard', M: '/m/count', O: '/m/orders', P: '/pos', A: '/m/approvals', D: '/kiosk' };
  return byLetter[r[0]] ?? null;
}
const STOP = ['怎么', '怎样', '如何', '什么', '办', '的', '了', '吗', '呢', '我', 'cara', 'macam', 'mana', 'bagaimana', 'apa', 'saya', 'how', 'do', 'to', 'the', 'what', 'is', 'my', 'i'];
function localTokens(q: string) { let t = q.toLowerCase(); for (const s of STOP) t = t.split(s).join(' '); const out = new Set<string>(); for (const seg of t.split(/[\s？?！!。，,]+/).filter(Boolean)) { if (/[一-鿿]/.test(seg)) { out.add(seg); for (let i = 0; i < seg.length - 1; i++) out.add(seg.slice(i, i + 2)); } else if (seg.length >= 2) out.add(seg); } return [...out]; }

export default function Help() {
  const { t, lang } = useT(); const nav = useNavigate();
  const [msgs, setMsgs] = useState<Msg[]>([{ id: 0, who: 'bot', text: '' }]);
  const [text, setText] = useState(''); const [busy, setBusy] = useState(false); const [chips, setChips] = useState<string[]>([]); const [recording, setRecording] = useState(false); const [showSop, setShowSop] = useState(false); const [sop, setSop] = useState<any[]>([]);
  const rec = useRef<MediaRecorder | null>(null); const chunks = useRef<Blob[]>([]); const listRef = useRef<HTMLDivElement>(null); const seq = useRef(1);
  const L = (o: any, k: string) => o?.[`${k}_${lang}`] ?? o?.[`${k}_zh`] ?? o?.[`${k}_en`] ?? '';
  useEffect(() => { setMsgs([{ id: 0, who: 'bot', text: t('bot_hello') }]); }, [lang]);
  useEffect(() => {
    (async () => {
      const rows = await db.knowledge_article.toArray(); setSop(rows);
      if (isOnline()) { try { const qs = await api('/bot/queries'); const ex = qs.flatMap((q: any) => (Array.isArray(q.examples) ? q.examples.slice(0, 1) : [])).filter(Boolean); setChips(ex.slice(0, 8)); } catch { /* */ } }
      if (!chips.length) setChips(['可乐放哪里', '今天要补什么', '我有什么工单', '怎么收货', '忘记 PIN 怎么办']);
    })();
  }, []);
  useEffect(() => { listRef.current?.scrollTo({ top: 1e9, behavior: 'smooth' }); }, [msgs]);
  const push = (m: Omit<Msg, 'id'>) => setMsgs((s) => [...s, { ...m, id: seq.current++ }]);

  const ask = async (q: string) => {
    const s = q.trim(); if (!s || busy) return; setText(''); push({ who: 'me', text: s }); setBusy(true); fx.tap();
    try {
      if (isOnline()) {
        const r = await api('/bot/ask', { body: { text: s, language: lang } });
        push({ who: 'bot', text: r.answer, screen_ref: r.screen_ref, rows: r.rows, conversation_id: r.conversation_id, answered: r.answered, ticket_id: r.ticket_id, denied: r.denied });
        if (!r.answered) fx.alert(); else fx.scanOk();
      } else {
        const toks = localTokens(s); const rows = (sop.length ? sop : await db.knowledge_article.toArray()).map((k: any) => { const hay = `${k.question_zh ?? ''} ${k.question_ms ?? ''} ${k.question_en ?? ''} ${k.keywords ?? ''}`.toLowerCase(); const hit = toks.filter((x) => hay.includes(x)).length; return { k, hit }; }).filter((x) => x.hit >= 1 && x.hit * 2 >= toks.length).sort((a, b) => b.hit - a.hit);
        if (rows.length) push({ who: 'bot', text: `${t('bot_offline_hint')}\n${L(rows[0].k, 'answer')}`, screen_ref: rows[0].k.screen_ref, answered: true });
        else push({ who: 'bot', text: `${t('bot_offline_hint')}\n${t('bot_no_local')}`, answered: false });
      }
    } catch (e: any) { push({ who: 'bot', text: e?.text ? e.text(lang) : String(e?.message ?? e), answered: false }); fx.error(); }
    finally { setBusy(false); }
  };
  const startRec = async () => {
    if (recording || busy) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); const mr = new MediaRecorder(stream); chunks.current = [];
      mr.ondataavailable = (e) => chunks.current.push(e.data);
      mr.onstop = async () => {
        stream.getTracks().forEach((tr) => tr.stop()); setRecording(false);
        const blob = new Blob(chunks.current, { type: mr.mimeType || 'audio/webm' }); if (blob.size < 500) return;
        push({ who: 'me', text: '🎤' }); setBusy(true);
        try { const fd = new FormData(); fd.append('audio', blob, 'q.webm'); fd.append('language', lang); const r = await api('/bot/ask', { body: fd }); push({ who: 'bot', text: r.answer, screen_ref: r.screen_ref, rows: r.rows, conversation_id: r.conversation_id, answered: r.answered }); if (r.needs_text) fx.error(); }
        catch (e: any) { push({ who: 'bot', text: e?.text ? e.text(lang) : t('bot_mic_denied') }); } finally { setBusy(false); }
      };
      rec.current = mr; mr.start(); setRecording(true); fx.tap();
    } catch { push({ who: 'bot', text: t('bot_mic_denied') }); }
  };
  const stopRec = () => { if (rec.current && rec.current.state !== 'inactive') rec.current.stop(); };
  const escalate = async (m: Msg) => { try { await api('/bot/escalate', { body: { conversation_id: m.conversation_id, text: msgs.find((x) => x.id === m.id - 1)?.text ?? '?' } }); push({ who: 'bot', text: t('bot_escalated') }); fx.done(); } catch (e: any) { push({ who: 'bot', text: e?.text ? e.text(lang) : 'error' }); } };

  return (
    <Page>
      <TopBar title={t('bot_title')} onBack={() => nav('/m')} />
      {showSop ? (
        <div className="list" style={{ flex: 1, overflow: 'auto' }}>{sop.map((i: any) => <div key={i.id} className="card" style={{ flexDirection: 'column', alignItems: 'stretch' }} onClick={() => { setShowSop(false); void ask(L(i, 'question')); }}><div className="t">{L(i, 'question')}</div><div className="s">{i.screen_ref ?? ''}</div></div>)}</div>
      ) : (
        <div ref={listRef} style={{ flex: 1, overflow: 'auto', padding: '12px var(--pad)', display: 'flex', flexDirection: 'column', gap: 12 }} data-testid="bot-chat">
          {msgs.map((m) => (
            <div key={m.id} style={{ alignSelf: m.who === 'me' ? 'flex-end' : 'flex-start', maxWidth: '88%' }}>
              <div style={{ background: m.who === 'me' ? 'var(--green)' : m.denied ? 'var(--red)' : '#fff', color: m.who === 'me' || m.denied ? '#fff' : 'var(--fg)', padding: '14px 16px', borderRadius: 16, fontSize: 'var(--fs-body)', whiteSpace: 'pre-wrap', boxShadow: '0 2px 8px rgba(0,0,0,.06)' }} data-testid={m.who === 'bot' ? 'bot-answer' : undefined}>{m.text}</div>
              {m.who === 'bot' && m.rows && m.rows.length > 1 && m.rows[0]?.question_zh && <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 6 }}>{m.rows.slice(1).map((r: any) => <button key={r.id} className="btn btn-ghost" style={{ minHeight: 44, fontSize: 16 }} onClick={() => ask(L(r, 'question'))}>{L(r, 'question')}</button>)}</div>}
              {m.who === 'bot' && screenRoute(m.screen_ref) && <button className="btn btn-secondary" style={{ marginTop: 8, minHeight: 56 }} onClick={() => nav(screenRoute(m.screen_ref)!)} data-testid="bot-go">→ {t('bot_go_screen')} {m.screen_ref}</button>}
              {m.who === 'bot' && m.answered === false && m.conversation_id && !m.ticket_id && <button className="btn btn-ghost" style={{ marginTop: 8, minHeight: 56 }} onClick={() => escalate(m)}><Icon name={I.Ticket} size={22} /> {t('bot_escalate')}</button>}
            </div>
          ))}
          {busy && <div style={{ color: 'var(--muted)' }}>{t('bot_thinking')}</div>}
          {msgs.length <= 1 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}><div style={{ width: '100%', color: 'var(--muted)', fontSize: 'var(--fs-small)' }}>{t('bot_try_ask')}</div>{chips.map((c) => <button key={c} className="btn btn-ghost" style={{ minHeight: 48, fontSize: 17 }} onClick={() => ask(c)}>{c}</button>)}</div>}
        </div>
      )}
      <div style={{ padding: '10px var(--pad) 16px', display: 'flex', flexDirection: 'column', gap: 10, borderTop: '1px solid var(--hair)', background: 'var(--paper)' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={t('bot_placeholder')} style={{ flex: 1, minHeight: 60, fontSize: 'var(--fs-body)', padding: '0 14px', border: '1px solid var(--stroke)', borderRadius: 12 }} onKeyDown={(e) => { if (e.key === 'Enter') void ask(text); }} data-testid="bot-input" />
          <button className="btn btn-primary" style={{ minWidth: 92 }} disabled={!text.trim() || busy} onClick={() => ask(text)} data-testid="bot-send">{t('bot_send')}</button>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className={`btn ${recording ? 'btn-danger' : 'btn-secondary'}`} style={{ flex: 1, minHeight: 72 }} onPointerDown={startRec} onPointerUp={stopRec} onPointerLeave={stopRec} onContextMenu={(e) => e.preventDefault()}><Icon name={I.Mic} size={26} /> {recording ? t('bot_release') : t('bot_hold_talk')}</button>
          <button className="btn btn-ghost" style={{ minHeight: 72 }} onClick={() => setShowSop(!showSop)}><Icon name={I.Help} size={24} /> {showSop ? t('back') : t('bot_sop_list')}</button>
        </div>
      </div>
    </Page>
  );
}
