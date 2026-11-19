// 网页：盘点。会话列表 + 新建/指派 + 差异明细审批（逐行接受/重盘）+ 盘点规则 CRUD（G9）+ 准确率。
import { useEffect, useState } from 'react';
import { api } from '../../../api/client.js';
import { useAuth } from '../../../store/auth.js';
import { errText, fmtDate, fmtMoney, fmtQty, pillColor, STATUS_ZH } from './_util.js';

const CS_ZH: Record<string, string> = { ASSIGNED: '已指派', IN_PROGRESS: '进行中', PENDING_APPROVAL: '待审批', APPROVED: '已批准', RECOUNT: '重盘中', CANCELLED: '已取消' };
const TYPE_ZH: Record<string, string> = { FULL: '全盘', CYCLE: '循环', SPOT: '抽盘' };
const COND_KINDS = [['category_code', '类别代码'], ['min_value', '货值 ≥ RM'], ['negative_stock', '负库存'], ['last_variance_days', '有差异 N 天后']] as const;
const condText = (c: any) => (c?.category_code ? `类别 ${c.category_code}` : c?.min_value != null ? `货值 ≥ RM ${c.min_value}` : c?.negative_stock ? '负库存' : c?.last_variance_days != null ? `有差异 ${c.last_variance_days} 天后` : '全部');
const pill = (s: string) => <span className="pill" style={{ background: s === 'APPROVED' ? '#1B8A3A' : s === 'CANCELLED' ? '#C62828' : s === 'PENDING_APPROVAL' || s === 'RECOUNT' ? '#F9A825' : '#1565C0' }}>{CS_ZH[s] ?? s}</span>;

export default function Counts() {
  const { me, has } = useAuth();
  const [tab, setTab] = useState<'sessions' | 'rules' | 'stats'>('sessions'); const [msg, setMsg] = useState('');
  const [rows, setRows] = useState<any[]>([]); const [status, setStatus] = useState(''); const [sel, setSel] = useState<any | null>(null); const [dec, setDec] = useState<Record<string, string>>({}); const [note, setNote] = useState('');
  const [sites, setSites] = useState<any[]>([]); const [zones, setZones] = useState<any[]>([]); const [people, setPeople] = useState<any[]>([]);
  const [form, setForm] = useState<any | null>(null);
  const [rules, setRules] = useState<any[]>([]); const [ruleForm, setRuleForm] = useState<any | null>(null); const [stats, setStats] = useState<any[]>([]);
  const canCost = has('product.view_cost'); const cycle = !!me?.company.feature_flags?.cycle_count;
  const load = async () => { try { setRows(await api(`/counts${status ? `?status=${status}` : ''}`)); } catch (e) { setMsg(errText(e)); } };
  useEffect(() => { void load(); }, [status]);
  useEffect(() => { api('/sites').then(setSites).catch(() => {}); }, []);
  useEffect(() => { if (tab === 'rules') api('/count-rules').then(setRules).catch((e) => setMsg(errText(e))); if (tab === 'stats') api('/counts/stats').then(setStats).catch((e) => setMsg(errText(e))); }, [tab]);
  const openNew = async () => { const site = me?.site?.id ?? sites[0]?.id ?? ''; setForm({ site_id: site, zone_id: '', codes: '', assigned_to: '', count_type: 'FULL', scheduled_for: new Date().toISOString().slice(0, 10) }); await loadSite(site); };
  const loadSite = async (site: string) => { try { const [z, p] = await Promise.all([api(`/zones?site=${site}`), api(`/counts/assignees?site=${site}`)]); setZones(z); setPeople(p); } catch (e) { setMsg(errText(e)); } };
  const create = async () => {
    try {
      const body: any = { site_id: form.site_id, assigned_to: form.assigned_to, count_type: form.count_type, scheduled_for: form.scheduled_for };
      if (form.zone_id) body.zone_id = form.zone_id; else body.location_codes = form.codes.split(/[\s,，、]+/).filter(Boolean);
      const r = await api('/counts', { body }); setMsg(`已建 ${r.session_no}，${r.location_ids.length} 个货位`); setForm(null); await load();
    } catch (e) { setMsg(errText(e)); }
  };
  const open = async (s: any) => { try { setSel(await api(`/counts/${s.id}`)); setDec({}); setNote(''); } catch (e) { setMsg(errText(e)); } };
  const approve = async (decision: 'approve' | 'reject' | 'return') => {
    if (!sel) return;
    try { const r = await api(`/counts/${sel.id}/approve`, { body: { decision, note: note || undefined, lines: Object.entries(dec).map(([id, d]) => ({ id, decision: d })) } }); setMsg(`${STATUS_ZH[r.approval.status]}${r.recount ? `，重盘会话 ${r.recount.session_no}` : ''}`); await open(sel); await load(); } catch (e) { setMsg(errText(e)); }
  };
  const saveRule = async () => {
    try {
      const cond: any = {}; const v = ruleForm.cond_value;
      if (ruleForm.cond_kind === 'category_code') cond.category_code = v; else if (ruleForm.cond_kind === 'min_value') cond.min_value = Number(v); else if (ruleForm.cond_kind === 'negative_stock') cond.negative_stock = true; else if (ruleForm.cond_kind === 'last_variance_days') cond.last_variance_days = Number(v);
      const body = { name: ruleForm.name, condition: cond, frequency_days: Number(ruleForm.frequency_days), lines_per_day: Number(ruleForm.lines_per_day), is_active: !!ruleForm.is_active };
      if (ruleForm.id) await api(`/count-rules/${ruleForm.id}`, { method: 'PUT', body }); else await api('/count-rules', { body });
      setRuleForm(null); setRules(await api('/count-rules')); setMsg('规则已保存');
    } catch (e) { setMsg(errText(e)); }
  };
  const editRule = (r: any) => { const c = r.condition ?? {}; const kind = c.category_code ? 'category_code' : c.min_value != null ? 'min_value' : c.negative_stock ? 'negative_stock' : c.last_variance_days != null ? 'last_variance_days' : 'min_value'; setRuleForm({ id: r.id, name: r.name, cond_kind: kind, cond_value: c.category_code ?? c.min_value ?? c.last_variance_days ?? '', frequency_days: r.frequency_days, lines_per_day: r.lines_per_day, is_active: r.is_active }); };
  const generate = async () => { try { const r = await api('/counts/generate-cycle', { method: 'POST' }); setMsg(`已生成 ${r.created.length} 个循环盘点会话`); await load(); } catch (e) { setMsg(errText(e)); } };
  const varLines = (sel?.lines ?? []).filter((l: any) => l.variance_qty != null && Number(l.variance_qty) !== 0);
  return (
    <div>
      <h1>盘点</h1>
      {msg && <div className={/已|成功/.test(msg) ? 'ok' : 'err'}>{msg}</div>}
      <div className="tabs">{([['sessions', '盘点会话'], ['rules', '盘点规则'], ['stats', '准确率']] as const).map(([k, v]) => <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{v}</button>)}</div>
      {tab === 'sessions' && (
        <>
          <div className="toolbar">
            {has('count.assign') && <button className="btn btn-primary" onClick={openNew} data-testid="new-count">+ 新建盘点</button>}
            <select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">全部状态</option>{Object.entries(CS_ZH).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            {cycle && has('count.rules') && <button className="btn btn-ghost" onClick={generate}>立即生成循环盘点</button>}
          </div>
          {form && (
            <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 10, padding: 16, marginBottom: 16 }}>
              <h2>新建盘点（指派）</h2>
              <div className="form">
                <label>站点<select value={form.site_id} onChange={async (e) => { setForm({ ...form, site_id: e.target.value, zone_id: '', assigned_to: '' }); await loadSite(e.target.value); }}>{sites.map((s) => <option key={s.id} value={s.id}>{s.code} {s.name}</option>)}</select></label>
                <label>区（整区）<select value={form.zone_id} onChange={(e) => setForm({ ...form, zone_id: e.target.value })}><option value="">— 不按区，用下面货位 —</option>{zones.filter((z) => z.zone_type !== 'RECEIVING').map((z) => <option key={z.id} value={z.id}>{z.code} {z.name_zh ?? ''}（{z.location_count} 货位）</option>)}</select></label>
                <label>货位代码（逗号分隔）<input value={form.codes} disabled={!!form.zone_id} onChange={(e) => setForm({ ...form, codes: e.target.value })} placeholder="A-01-1, A-01-2" data-testid="count-codes" /></label>
                <label>指派给<select value={form.assigned_to} onChange={(e) => setForm({ ...form, assigned_to: e.target.value })} data-testid="count-assignee"><option value="">选人</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}（{p.role_code}）</option>)}</select></label>
                <label>类型<select value={form.count_type} onChange={(e) => setForm({ ...form, count_type: e.target.value })}>{Object.entries(TYPE_ZH).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                <label>日期<input type="date" value={form.scheduled_for} onChange={(e) => setForm({ ...form, scheduled_for: e.target.value })} /></label>
              </div>
              <div className="toolbar" style={{ marginTop: 10 }}><button className="btn btn-primary" disabled={!form.assigned_to || (!form.zone_id && !form.codes.trim())} onClick={create} data-testid="count-create">建立并指派</button><button className="btn btn-ghost" onClick={() => setForm(null)}>取消</button></div>
              <div className="note">指派时不拍快照；盘点员按「开始」时才锁定系统量，盘点员看不到系统量。</div>
            </div>
          )}
          <table><thead><tr><th>编号</th><th>类型</th><th>状态</th><th>站点/区</th><th>货位</th><th>盘点员</th><th>日期</th><th>差异行</th>{canCost && <th>净金额</th>}<th>审批</th></tr></thead><tbody>
            {rows.map((s) => <tr key={s.id} onClick={() => open(s)} style={{ cursor: 'pointer' }} data-testid="count-row">
              <td>{s.session_no}{s.parent_session_id ? <span className="note"> 重盘</span> : ''}</td><td>{TYPE_ZH[s.count_type]}</td><td>{pill(s.status)}</td><td>{s.site_code}{s.zone_code ? ` / ${s.zone_code}` : ''}</td><td>{s.done_count}/{s.location_count}</td><td>{s.assigned_to_name}</td><td>{String(s.scheduled_for).slice(0, 10)}</td><td>{s.variance_lines}/{s.lines_count}</td>{canCost && <td>{fmtMoney(s.variance_amount)}</td>}<td>{s.approval_status ? <span className="pill" style={{ background: pillColor(s.approval_status) }}>{STATUS_ZH[s.approval_status]}</span> : ''}</td>
            </tr>)}
            {rows.length === 0 && <tr><td colSpan={10} className="note">没有盘点会话</td></tr>}
          </tbody></table>
          {sel && (
            <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 10, padding: 16, marginTop: 16 }}>
              <h2>{sel.session_no} {pill(sel.status)} <span className="note">{TYPE_ZH[sel.count_type]} · {sel.assigned_to_name} · {String(sel.scheduled_for).slice(0, 10)}{sel.note ? ` · ${sel.note}` : ''}</span></h2>
              <div className="toolbar">{sel.locations.map((l: any) => <span key={l.id} className="pill" style={{ background: l.done ? '#1B8A3A' : '#9E9E9E' }}>{l.code} {l.done ? (l.is_empty ? '空' : '✓') : `${l.lines_count}`}</span>)}{sel.children?.map((c: any) => <span key={c.id} className="note">重盘 → {c.session_no}（{CS_ZH[c.status]}）</span>)}</div>
              <table><thead><tr><th>货位</th><th>产品</th>{sel.lines[0]?.system_qty != null && <><th>系统</th></>}<th>实数</th>{sel.lines[0]?.variance_qty !== undefined && <><th>差</th><th>金额</th><th>谁数</th><th>上次差异</th><th>决定</th></>}</tr></thead><tbody>
                {sel.lines.map((l: any) => { const v = l.variance_qty == null ? null : Number(l.variance_qty); return (
                  <tr key={l.id} style={v ? { color: 'var(--red)' } : undefined}>
                    <td>{l.location_code ?? ''}</td><td>{l.name_zh ?? l.name_en ?? l.sku}</td>{l.system_qty != null && <td>{fmtQty(l.system_qty)}</td>}<td>{fmtQty(l.counted_qty)}</td>
                    {l.variance_qty !== undefined && <><td>{v == null ? '—' : (v > 0 ? '+' : '') + v}</td><td>{fmtMoney(l.variance_amount)}</td><td>{l.counted_by_name ?? ''}</td><td>{l.last_variance_qty == null ? '—' : fmtQty(l.last_variance_qty)}</td>
                      <td>{v ? (sel.status === 'PENDING_APPROVAL' && has('count.approve') ? <select value={dec[l.id] ?? 'ACCEPT'} onChange={(e) => setDec({ ...dec, [l.id]: e.target.value })}><option value="ACCEPT">接受</option><option value="RECOUNT">重盘</option></select> : (l.decision === 'RECOUNT' ? '重盘' : l.decision === 'ACCEPT' ? '接受' : '')) : ''}</td></>}
                  </tr>); })}
              </tbody></table>
              {sel.status === 'PENDING_APPROVAL' && has('count.approve') && (
                <div className="toolbar" style={{ marginTop: 10 }}>
                  <input placeholder="备注" value={note} onChange={(e) => setNote(e.target.value)} style={{ width: 280 }} />
                  <button className="btn btn-primary" onClick={() => approve('approve')} data-testid="count-approve">批准（{varLines.length} 行差异）</button>
                  <button className="btn btn-ghost" onClick={() => approve('return')}>退回重数</button>
                  <button className="btn btn-danger" onClick={() => approve('reject')}>拒绝</button>
                </div>
              )}
              <div className="toolbar" style={{ marginTop: 10 }}><button className="btn btn-ghost" onClick={() => setSel(null)}>关闭</button></div>
            </div>
          )}
        </>
      )}
      {tab === 'rules' && (
        <>
          <div className="toolbar">{has('count.rules') && <button className="btn btn-primary" onClick={() => setRuleForm({ name: '', cond_kind: 'min_value', cond_value: '', frequency_days: 30, lines_per_day: 20, is_active: true })}>+ 新规则</button>}{cycle ? <span className="note">每天 06:00 按规则生成循环盘点（负库存立即、有差异 3 天后、高价值每周、普通每月），每人每天不超过「每人每天货位数」。</span> : <span className="note">本公司未开启循环盘点功能（feature_flags.cycle_count）。</span>}</div>
          {ruleForm && (
            <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 10, padding: 16, marginBottom: 16 }}>
              <div className="form">
                <label>名称<input value={ruleForm.name} onChange={(e) => setRuleForm({ ...ruleForm, name: e.target.value })} /></label>
                <label>条件<select value={ruleForm.cond_kind} onChange={(e) => setRuleForm({ ...ruleForm, cond_kind: e.target.value })}>{COND_KINDS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                {ruleForm.cond_kind !== 'negative_stock' && <label>条件值<input value={ruleForm.cond_value} onChange={(e) => setRuleForm({ ...ruleForm, cond_value: e.target.value })} placeholder={ruleForm.cond_kind === 'category_code' ? 'BEV' : '数字'} /></label>}
                <label>频率（天）<input type="number" value={ruleForm.frequency_days} onChange={(e) => setRuleForm({ ...ruleForm, frequency_days: e.target.value })} /></label>
                <label>每人每天货位数<input type="number" value={ruleForm.lines_per_day} onChange={(e) => setRuleForm({ ...ruleForm, lines_per_day: e.target.value })} /></label>
                <label>启用<select value={ruleForm.is_active ? '1' : '0'} onChange={(e) => setRuleForm({ ...ruleForm, is_active: e.target.value === '1' })}><option value="1">是</option><option value="0">否</option></select></label>
              </div>
              <div className="toolbar" style={{ marginTop: 10 }}><button className="btn btn-primary" disabled={!ruleForm.name} onClick={saveRule}>保存</button><button className="btn btn-ghost" onClick={() => setRuleForm(null)}>取消</button></div>
            </div>
          )}
          <table><thead><tr><th>名称</th><th>条件</th><th>频率</th><th>每人每天</th><th>启用</th><th>30 天会话</th><th></th></tr></thead><tbody>
            {rules.map((r) => <tr key={r.id}><td>{r.name}</td><td>{condText(r.condition)}</td><td>{r.frequency_days} 天</td><td>{r.lines_per_day}</td><td>{r.is_active ? '✓' : '—'}</td><td>{r.sessions_30d}</td><td>{has('count.rules') && <button className="btn btn-ghost" onClick={() => editRule(r)}>编辑</button>}</td></tr>)}
            {rules.length === 0 && <tr><td colSpan={7} className="note">没有规则</td></tr>}
          </tbody></table>
        </>
      )}
      {tab === 'stats' && (
        <table><thead><tr><th>盘点员</th><th>会话</th><th>行数</th><th>差异行</th><th>准确率</th>{canCost && <th>毛差异金额</th>}</tr></thead><tbody>
          {stats.map((s) => <tr key={s.user_id}><td>{s.name}</td><td>{s.sessions}</td><td>{s.lines}</td><td>{s.variance_lines}</td><td><b style={{ color: Number(s.accuracy_pct) >= 95 ? '#1B8A3A' : '#C62828' }}>{s.accuracy_pct == null ? '—' : `${Number(s.accuracy_pct)}%`}</b></td>{canCost && <td>{fmtMoney(s.gross_amount)}</td>}</tr>)}
          {stats.length === 0 && <tr><td colSpan={6} className="note">30 天内没有提交的盘点</td></tr>}
        </tbody></table>
      )}
      <div className="note" style={{ marginTop: 12 }}>最近更新 {fmtDate(new Date().toISOString())}</div>
    </div>
  );
}
