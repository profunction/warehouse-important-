// G12 知识库与机器人（模块 E）：知识库 CRUD 三语、未回答的机器人问题 → 回答并存入知识库、命中统计、机器人查询清单。
import { useEffect, useState } from 'react';
import { api } from '../../../api/client.js';
import { errText, fmtDate } from './_util.js';

const EMPTY = { screen_ref: '', question_zh: '', question_ms: '', question_en: '', answer_zh: '', answer_ms: '', answer_en: '', keywords: '', role_codes: [] as string[], is_active: true, conversation_id: null as string | null };
export default function Knowledge() {
  const [tab, setTab] = useState<'kb' | 'unanswered' | 'stats' | 'queries'>('kb');
  const [rows, setRows] = useState<any[]>([]); const [form, setForm] = useState<any | null>(null); const [msg, setMsg] = useState(''); const [q, setQ] = useState('');
  const [convs, setConvs] = useState<any[]>([]); const [stats, setStats] = useState<any>(null); const [queries, setQueries] = useState<any[]>([]); const [test, setTest] = useState(''); const [testAns, setTestAns] = useState<any>(null);
  const load = async () => { try { setRows(await api('/knowledge?all=true')); if (tab === 'unanswered') setConvs(await api('/bot/conversations?unanswered=true')); if (tab === 'stats') setStats(await api('/bot/stats')); if (tab === 'queries') setQueries(await api('/bot/queries')); } catch (e) { setMsg(errText(e)); } };
  useEffect(() => { void load(); }, [tab]);
  const save = async () => {
    try { const b = { ...form, screen_ref: form.screen_ref || null, keywords: form.keywords || null }; if (form.id) await api(`/knowledge/${form.id}`, { method: 'PUT', body: b }); else await api('/knowledge', { body: b }); setForm(null); setMsg('已保存' + (form.conversation_id ? '，已通知提问者' : '')); await load(); } catch (e) { setMsg(errText(e)); }
  };
  const del = async (id: string) => { if (!window.confirm('停用这条知识？')) return; try { await api(`/knowledge/${id}`, { method: 'DELETE' }); await load(); } catch (e) { setMsg(errText(e)); } };
  const ask = async () => { if (!test.trim()) return; try { setTestAns(await api('/bot/ask', { body: { text: test } })); } catch (e) { setMsg(errText(e)); } };
  const shown = rows.filter((r) => !q || JSON.stringify(r).toLowerCase().includes(q.toLowerCase()));
  const F = (k: string, label: string, textarea = false) => <label style={textarea ? { gridColumn: '1 / -1' } : undefined}>{label}{textarea ? <textarea rows={3} value={form[k] ?? ''} onChange={(e) => setForm({ ...form, [k]: e.target.value })} style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }} /> : <input value={form[k] ?? ''} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />}</label>;
  return (
    <div>
      <h1>知识库与机器人</h1>
      {msg && <div className={msg.startsWith('已') ? 'ok' : 'err'} style={{ marginBottom: 8 }}>{msg}</div>}
      <div className="tabs"><button className={tab === 'kb' ? 'active' : ''} onClick={() => setTab('kb')}>知识库（{rows.length}）</button><button className={tab === 'unanswered' ? 'active' : ''} onClick={() => setTab('unanswered')}>未回答的问题</button><button className={tab === 'stats' ? 'active' : ''} onClick={() => setTab('stats')}>命中统计</button><button className={tab === 'queries' ? 'active' : ''} onClick={() => setTab('queries')}>机器人查询清单</button></div>
      {form && <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 10, padding: 16, marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>{form.id ? '修改' : '新增'}知识{form.conversation_id && <span className="note">（回答员工提问，保存后通知提问者并关闭工单）</span>}</h2>
        <div className="form">
          {F('question_zh', '问题（中）')}{F('question_ms', 'Soalan (MS)')}{F('question_en', 'Question (EN)')}
          {F('answer_zh', '答案（中）', true)}{F('answer_ms', 'Jawapan (MS)', true)}{F('answer_en', 'Answer (EN)', true)}
          {F('screen_ref', '屏幕编号（如 W3、C4；回答附"去这个屏幕"）')}{F('keywords', '关键词（空格分隔，帮助匹配）')}
          <label>限定角色（空=所有）<input value={(form.role_codes ?? []).join(' ')} onChange={(e) => setForm({ ...form, role_codes: e.target.value.toUpperCase().split(/\s+/).filter(Boolean) })} placeholder="STOCKER WAREHOUSE" /></label>
          <label>&nbsp;<span><button className="btn btn-primary" onClick={save}>保存</button> <button className="btn btn-ghost" onClick={() => setForm(null)}>取消</button></span></label>
        </div>
      </div>}
      {tab === 'kb' && <>
        <div className="toolbar"><button className="btn btn-primary" onClick={() => setForm({ ...EMPTY })}>＋ 新知识</button><input placeholder="搜索" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 260 }} /><span className="note">系统 SOP（灰）不能改，可以新增本公司的同名问题覆盖</span></div>
        <table><thead><tr><th>屏幕</th><th>问题</th><th>答案（中）</th><th>角色</th><th>命中</th><th>来源</th><th></th></tr></thead><tbody>
          {shown.map((r) => <tr key={r.id} style={{ opacity: r.is_active ? 1 : .5, color: r.is_system ? 'var(--muted)' : undefined }}><td>{r.screen_ref ?? ''}</td><td>{r.question_zh ?? r.question_en}<div className="note">{[r.question_ms, r.question_en].filter(Boolean).join(' · ')}</div></td><td style={{ maxWidth: 360 }}>{r.answer_zh ?? r.answer_en}</td><td>{(r.role_codes ?? []).join(' ') || '全部'}</td><td>{r.hit_count ?? 0}</td><td>{r.is_system ? '系统' : r.source_ticket_id ? '工单' : '本公司'}</td><td style={{ whiteSpace: 'nowrap' }}>{!r.is_system && <><button className="btn btn-ghost" onClick={() => setForm({ ...r })}>改</button> <button className="btn btn-danger" onClick={() => del(r.id)}>停用</button></>}</td></tr>)}
        </tbody></table>
      </>}
      {tab === 'unanswered' && <>
        <div className="note" style={{ marginBottom: 8 }}>机器人答不了的问题，已开工单给经理。点"回答"写入知识库：提问者会收到通知，工单自动解决，下次同样问题机器人直接回答。</div>
        <table><thead><tr><th>时间</th><th>谁</th><th>问题</th><th>意图</th><th>工单</th><th></th></tr></thead><tbody>
          {convs.map((c) => <tr key={c.id}><td>{fmtDate(c.at)}</td><td>{c.user_name}</td><td>{c.question_text}</td><td>{c.intent}{c.query_code ? ` · ${c.query_code}` : ''}</td><td>{c.ticket_no ? `#${c.ticket_no} ${c.ticket_status}` : '—'}</td><td><button className="btn btn-primary" onClick={() => setForm({ ...EMPTY, question_zh: c.question_text, conversation_id: c.id })}>回答</button></td></tr>)}
          {!convs.length && <tr><td colSpan={6} className="note">没有未回答的问题</td></tr>}
        </tbody></table>
        <h2>试问机器人</h2>
        <div className="toolbar"><input value={test} onChange={(e) => setTest(e.target.value)} placeholder="例如：可乐放哪里" style={{ width: 320 }} onKeyDown={(e) => e.key === 'Enter' && ask()} /><button className="btn btn-ghost" onClick={ask}>问</button></div>
        {testAns && <pre>{JSON.stringify({ intent: testAns.intent, query_code: testAns.query_code, answer: testAns.answer, screen_ref: testAns.screen_ref, answered: testAns.answered }, null, 1)}</pre>}
      </>}
      {tab === 'stats' && stats && <>
        <div className="cards">
          <div className="stat"><div className="v">{stats.conversations.total}</div><div className="l">问答总数</div></div>
          <div className="stat"><div className="v">{stats.conversations.answered}</div><div className="l">已回答</div></div>
          <div className={`stat ${stats.conversations.unanswered ? 'warn' : ''}`}><div className="v">{stats.conversations.unanswered}</div><div className="l">未回答</div></div>
          <div className="stat"><div className="v">{stats.conversations.data}</div><div className="l">数据问题</div></div>
          <div className="stat"><div className="v">{stats.conversations.howto}</div><div className="l">操作问题</div></div>
          <div className="stat"><div className="v">{stats.conversations.last_7d}</div><div className="l">近 7 天</div></div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <div><h2>常问查询</h2><table><thead><tr><th>查询</th><th>次数</th></tr></thead><tbody>{stats.top_queries.map((r: any) => <tr key={r.query_code}><td>{r.query_code}</td><td>{r.n}</td></tr>)}</tbody></table></div>
          <div><h2>知识命中</h2><table><thead><tr><th>问题</th><th>屏幕</th><th>命中</th></tr></thead><tbody>{stats.top_knowledge.map((r: any) => <tr key={r.id}><td>{r.question_zh ?? r.question_en}</td><td>{r.screen_ref ?? ''}</td><td>{r.hit_count}</td></tr>)}</tbody></table></div>
        </div>
      </>}
      {tab === 'queries' && <>
        <div className="note" style={{ marginBottom: 8 }}>机器人只能跑这些固定只读查询（LLM 只选查询填参数，不写 SQL）。清单按你的角色过滤。</div>
        <table><thead><tr><th>代码</th><th>问法</th><th>参数</th><th>需要权限</th><th>例子</th></tr></thead><tbody>
          {queries.map((r) => <tr key={r.code}><td><code>{r.code}</code></td><td>{r.description_zh}<div className="note">{r.description_ms} · {r.description_en}</div></td><td>{(r.params_json ?? []).map((p: any) => p.name).join(', ') || '—'}</td><td>{r.required_permission ?? '所有'}</td><td>{(r.examples ?? []).join('；')}</td></tr>)}
        </tbody></table>
      </>}
    </div>
  );
}
