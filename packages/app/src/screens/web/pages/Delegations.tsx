// 网页：代理（老板不在时授权他人代批）。列表、指定、撤销。
import { useEffect, useState } from 'react';
import { api } from '../../../api/client.js';
import { useAuth } from '../../../store/auth.js';
import { errText, fmtDate, fmtMoney, ROLE_ZH } from './_util.js';

const TYPE_ZH: Record<string, string> = { ORDER: '订货', COUNT_VARIANCE: '盘点差异', RETURN: '退货', ADJUST: '手动调整', TRANSFER: '调拨', PAYMENT: '供应商付款', IMPORT: 'Excel 导入', PRICE_CHANGE: '改售价' };
const DS_ZH: Record<string, string> = { ACTIVE: '生效中', EXPIRED: '已到期', REVOKED: '已撤销' };
const day = (d: Date) => d.toISOString().slice(0, 10);
export default function Delegations() {
  const { me, has, isBoss } = useAuth();
  const [rows, setRows] = useState<any[]>([]); const [users, setUsers] = useState<any[]>([]); const [msg, setMsg] = useState(''); const [form, setForm] = useState<any | null>(null);
  const load = async () => { try { setRows(await api('/delegations')); } catch (e) { setMsg(errText(e)); } };
  useEffect(() => { void load(); api('/users').then((u) => setUsers(u.filter((x: any) => x.is_active && !x.is_super_admin))).catch(() => {}); }, []);
  const openNew = () => setForm({ delegate_id: '', delegator_id: me?.user.id ?? '', scope: [] as string[], starts: day(new Date()), ends: day(new Date(Date.now() + 7 * 86400_000)), per_item_limit: '', daily_limit: '', is_standby: false, note: '' });
  const save = async () => {
    try {
      await api('/delegations', { body: { delegate_id: form.delegate_id, delegator_id: form.delegator_id || undefined, scope_types: form.scope, starts_at: new Date(form.starts + 'T00:00:00').toISOString(), ends_at: new Date(form.ends + 'T23:59:59').toISOString(), per_item_limit: form.per_item_limit ? Number(form.per_item_limit) : null, daily_limit: form.daily_limit ? Number(form.daily_limit) : null, is_standby: form.is_standby, note: form.note || null } });
      setMsg('代理已设定，已通知代理人'); setForm(null); await load();
    } catch (e) { setMsg(errText(e)); }
  };
  const revoke = async (d: any) => { if (!window.confirm(`撤销 ${d.delegate_name} 的代理？`)) return; try { await api(`/delegations/${d.id}/revoke`, { method: 'POST' }); setMsg('已撤销'); await load(); } catch (e) { setMsg(errText(e)); } };
  const canPick = (u: any) => (me?.company.plan === 'A' ? true : !isBoss || u.roles?.some((r: any) => ['MANAGER', 'ACCOUNTS'].includes(r.role_code)));
  const candidates = users.filter((u) => u.id !== (form?.delegator_id || me?.user.id));
  return (
    <div>
      <h1>代理</h1>
      {msg && <div className={/已/.test(msg) ? 'ok' : 'err'}>{msg}</div>}
      <div className="toolbar">{has('delegation.manage') && <button className="btn btn-primary" onClick={openNew}>+ 指定代理</button>}<span className="note">有时限（最长 30 天）、范围、金额上限；代批记录都标明「由 X 代 Y 批准」。代理人不能再指定别人、不能改自己的代理。</span></div>
      {form && (
        <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 10, padding: 16, marginBottom: 16 }}>
          <div className="form">
            {isBoss && <label>被代理人<select value={form.delegator_id} onChange={(e) => setForm({ ...form, delegator_id: e.target.value })}>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>}
            <label>代理人<select value={form.delegate_id} onChange={(e) => setForm({ ...form, delegate_id: e.target.value })}><option value="">选人</option>{candidates.map((u) => <option key={u.id} value={u.id}>{u.name}（{(u.roles ?? []).map((r: any) => ROLE_ZH[r.role_code] ?? r.role_code).join('/')}）{canPick(u) ? '' : ' · 建议经理/会计'}</option>)}</select></label>
            <label>从<input type="date" value={form.starts} onChange={(e) => setForm({ ...form, starts: e.target.value })} /></label>
            <label>到<input type="date" value={form.ends} min={form.starts} onChange={(e) => setForm({ ...form, ends: e.target.value })} /></label>
            <label>单笔上限 RM（留空 = 用老板权限）<input type="number" value={form.per_item_limit} onChange={(e) => setForm({ ...form, per_item_limit: e.target.value })} /></label>
            <label>每日累计上限 RM<input type="number" value={form.daily_limit} onChange={(e) => setForm({ ...form, daily_limit: e.target.value })} /></label>
            <label>备注<input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
            <label>常备代理<select value={form.is_standby ? '1' : '0'} onChange={(e) => setForm({ ...form, is_standby: e.target.value === '1' })}><option value="0">否</option><option value="1">是（审批超 24 小时无人处理才转给他）</option></select></label>
          </div>
          <div className="toolbar" style={{ marginTop: 10 }}>范围：{Object.entries(TYPE_ZH).map(([k, v]) => <label key={k} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><input type="checkbox" checked={form.scope.includes(k)} onChange={(e) => setForm({ ...form, scope: e.target.checked ? [...form.scope, k] : form.scope.filter((x: string) => x !== k) })} />{v}</label>)}<span className="note">（都不勾 = 全部）</span></div>
          {(form.scope.includes('ORDER') || form.scope.includes('PAYMENT')) && <div className="err">注意：勾选订货或付款后，此人将看到采购金额。</div>}
          <div className="toolbar" style={{ marginTop: 10 }}><button className="btn btn-primary" disabled={!form.delegate_id || !form.ends} onClick={save}>确认指定</button><button className="btn btn-ghost" onClick={() => setForm(null)}>取消</button></div>
        </div>
      )}
      <table><thead><tr><th>被代理人</th><th>代理人</th><th>范围</th><th>从</th><th>到</th><th>单笔</th><th>每日</th><th>常备</th><th>已代批</th><th>状态</th><th></th></tr></thead><tbody>
        {rows.map((d) => <tr key={d.id}>
          <td>{d.delegator_name}</td><td>{d.delegate_name}</td><td>{d.scope_types?.length ? d.scope_types.map((s: string) => TYPE_ZH[s] ?? s).join('、') : '全部'}</td><td>{fmtDate(d.starts_at)}</td><td>{fmtDate(d.ends_at)}</td><td>{fmtMoney(d.per_item_limit)}</td><td>{fmtMoney(d.daily_limit)}</td><td>{d.is_standby ? '★' : ''}</td><td>{d.used_count}{Number(d.used_today) ? ` · 今日 RM ${fmtMoney(d.used_today)}` : ''}</td>
          <td><span className="pill" style={{ background: d.status === 'ACTIVE' ? '#1B8A3A' : d.status === 'REVOKED' ? '#C62828' : '#9E9E9E' }}>{DS_ZH[d.status] ?? d.status}</span></td>
          <td>{d.status === 'ACTIVE' && (d.delegator_id === me?.user.id || isBoss) && <button className="btn btn-danger" onClick={() => revoke(d)}>撤销</button>}</td>
        </tr>)}
        {rows.length === 0 && <tr><td colSpan={11} className="note">没有代理记录</td></tr>}
      </tbody></table>
    </div>
  );
}
