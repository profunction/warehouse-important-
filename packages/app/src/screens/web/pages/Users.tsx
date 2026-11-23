import { useEffect, useState } from 'react';
import { api } from '../../../api/client.js';
import { useAuth } from '../../../store/auth.js';
import { downloadRaw, errText, ROLE_ZH } from './_util.js';

export default function Users() {
  const { me, has } = useAuth();
  const [rows, setRows] = useState<any[]>([]); const [roles, setRoles] = useState<any[]>([]); const [sites, setSites] = useState<any[]>([]); const [msg, setMsg] = useState('');
  const [form, setForm] = useState<any | null>(null); const [created, setCreated] = useState<any | null>(null); const [showPerms, setShowPerms] = useState<string | null>(null);
  const canManage = has('user.manage');
  const [joins, setJoins] = useState<any[]>([]); const [joinPick, setJoinPick] = useState<Record<string, { role_code: string; site_id: string }>>({});
  const loadJoins = async () => { if (!canManage) return; try { setJoins(await api('/join-requests')); } catch { /* 旧服务器没有这个接口 */ } };
  const approveJoin = async (j: any) => { const pick = joinPick[j.id] ?? { role_code: j.role_code, site_id: me?.site?.id ?? sites[0]?.id ?? '' }; try { await api(`/join-requests/${j.id}/approve`, { body: { role_code: pick.role_code, site_id: pick.site_id || null } }); setMsg(`${j.name} 已加入，可以用手机号和自己设的 PIN 登录`); await Promise.all([load(), loadJoins()]); } catch (e) { setMsg(errText(e)); } };
  const rejectJoin = async (j: any) => { if (!window.confirm(`拒绝 ${j.name} 的申请？`)) return; try { await api(`/join-requests/${j.id}/reject`, { body: {} }); await loadJoins(); } catch (e) { setMsg(errText(e)); } };
  const load = async () => { try { setRows(await api('/users')); } catch (e) { setMsg(errText(e)); } };
  useEffect(() => { void load(); void loadJoins(); api('/roles').then(setRoles).catch(() => {}); api('/sites').then(setSites).catch(() => {}); }, []);
  const openNew = () => { setForm({ name: '', phone: '', email: '', language: 'zh', roles: [{ role_code: 'WAREHOUSE', site_id: me?.site?.id ?? sites[0]?.id ?? null }] }); setCreated(null); };
  const openEdit = (u: any) => { setForm({ id: u.id, name: u.name, phone: u.phone ?? '', email: u.email ?? '', language: u.language, is_active: u.is_active, roles: u.roles.map((r: any) => ({ role_code: r.role_code, site_id: r.site_id })) }); setCreated(null); };
  const save = async () => {
    setMsg('');
    const body: any = { name: form.name, phone: form.phone || null, email: form.email || null, language: form.language, roles: form.roles.filter((r: any) => r.role_code) };
    try {
      if (form.id) { await api(`/users/${form.id}`, { method: 'PUT', body: { ...body, is_active: form.is_active } }); setMsg('已保存'); setForm(null); }
      else { const r = await api('/users', { body }); setCreated({ ...r, name: form.name }); setForm(null); }
      await load();
    } catch (e) { setMsg(errText(e)); }
  };
  const resetPin = async (u: any) => { if (!window.confirm(`重置 ${u.name} 的 PIN？旧 PIN 立即失效。`)) return; try { const r = await api(`/users/${u.id}/reset-pin`, { method: 'POST' }); setCreated({ name: u.name, pin: r.pin, badge_code: u.badge_code, reset: true }); } catch (e) { setMsg(errText(e)); } };
  const toggle = async (u: any) => { if (!window.confirm(`${u.is_active ? '停用' : '启用'} ${u.name}？`)) return; try { await api(`/users/${u.id}`, { method: 'PUT', body: { is_active: !u.is_active } }); await load(); } catch (e) { setMsg(errText(e)); } };
  const badge = async (u: any) => { try { await downloadRaw(`/users/${u.id}/badge`, `badge-${u.name}.pdf`, { method: 'POST' }); } catch (e) { setMsg(errText(e)); } };
  const setRole = (i: number, k: string, v: any) => { const rs = [...form.roles]; rs[i] = { ...rs[i], [k]: v || null }; setForm({ ...form, roles: rs }); };
  return (
    <div>
      <h1>用户管理</h1>
      {joins.length > 0 && <div style={{ border: '1px solid var(--brass)', borderRadius: 12, padding: '14px 16px', marginBottom: 18, background: '#fff' }} data-testid="join-panel">
        <h2 style={{ marginTop: 0 }}>员工申请加入（{joins.length}）</h2>
        <table><thead><tr><th>名字</th><th>手机</th><th>申请时间</th><th>备注</th><th>岗位</th><th>站点</th><th></th></tr></thead><tbody>
          {joins.map((j) => { const pick = joinPick[j.id] ?? { role_code: j.role_code, site_id: me?.site?.id ?? sites[0]?.id ?? '' }; const setPick = (k: string, v: string) => setJoinPick({ ...joinPick, [j.id]: { ...pick, [k]: v } }); return (
            <tr key={j.id} data-testid="join-row"><td>{j.name}</td><td>{j.phone}</td><td>{new Date(j.created_at).toLocaleString('zh-CN')}</td><td>{j.note ?? ''}</td>
              <td><select value={pick.role_code} onChange={(e) => setPick('role_code', e.target.value)}>{roles.filter((r: any) => !['BOSS', 'SUPER_ADMIN'].includes(r.code)).map((r: any) => <option key={r.code} value={r.code}>{ROLE_ZH[r.code] ?? r.code}</option>)}</select></td>
              <td><select value={pick.site_id} onChange={(e) => setPick('site_id', e.target.value)}>{sites.map((s2: any) => <option key={s2.id} value={s2.id}>{s2.code} {s2.name}</option>)}</select></td>
              <td style={{ whiteSpace: 'nowrap' }}><button className="btn btn-primary" onClick={() => void approveJoin(j)} data-testid="join-approve">批准</button> <button className="btn btn-ghost" onClick={() => void rejectJoin(j)}>拒绝</button></td></tr>); })}
        </tbody></table>
        <div className="note" style={{ marginTop: 6 }}>员工在登录页点"员工申请加入"，填公司代码 {me?.company.short_code}。批准后他用自己设的手机号和 PIN 登录。</div>
      </div>}
      <div className="toolbar">{canManage && <button className="btn btn-primary" onClick={openNew}>+ 加员工</button>}<span className="note">{msg}</span></div>
      {created && (
        <div style={{ background: '#FFF8E1', border: '2px solid var(--yellow)', borderRadius: 10, padding: 16, marginBottom: 16 }}>
          <h2>{created.reset ? 'PIN 已重置' : '员工已建立'}：{created.name}</h2>
          <div style={{ fontSize: 48, fontWeight: 800, letterSpacing: 8 }}>{created.pin}</div>
          <div className="err">这个 PIN 只显示这一次，请马上告诉员工或写在员工卡背面。关掉就看不到了。</div>
          {created.badge_code && <div className="note">员工卡二维码内容：USR:{me?.company.short_code}:{created.badge_code}（打印员工卡即含此码）</div>}
          <div className="toolbar" style={{ marginTop: 10 }}>{created.id && <button className="btn btn-ghost" onClick={() => badge({ id: created.id, name: created.name })}>打印员工卡</button>}<button className="btn btn-primary" onClick={() => setCreated(null)}>我已记下</button></div>
        </div>
      )}
      {form && (
        <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 10, padding: 16, marginBottom: 16 }}>
          <h2>{form.id ? '编辑员工' : '新员工'}</h2>
          <div className="form">
            <label>姓名<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label>手机<input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
            <label>电邮（经理以上）<input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
            <label>语言<select value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })}><option value="zh">中文</option><option value="ms">Bahasa Melayu</option><option value="en">English</option></select></label>
            {form.id && <label>状态<select value={form.is_active ? '1' : '0'} onChange={(e) => setForm({ ...form, is_active: e.target.value === '1' })}><option value="1">启用</option><option value="0">停用</option></select></label>}
          </div>
          <h2>角色（按站点）</h2>
          {form.roles.map((r: any, i: number) => <div key={i} className="toolbar">
            <select value={r.role_code} onChange={(e) => setRole(i, 'role_code', e.target.value)}><option value="">选角色</option>{roles.filter((x) => x.code !== 'SUPER_ADMIN').map((x) => <option key={x.code} value={x.code}>{ROLE_ZH[x.code] ?? x.code}</option>)}</select>
            <select value={r.site_id ?? ''} onChange={(e) => setRole(i, 'site_id', e.target.value)}><option value="">全公司</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.code} {s.name}</option>)}</select>
            <button className="btn btn-ghost" onClick={() => setForm({ ...form, roles: form.roles.filter((_: any, j: number) => j !== i) })}>移除</button>
          </div>)}
          <div className="toolbar"><button className="btn btn-ghost" onClick={() => setForm({ ...form, roles: [...form.roles, { role_code: '', site_id: me?.site?.id ?? null }] })}>+ 加角色</button><button className="btn btn-primary" onClick={save} disabled={!form.name || !form.roles.some((r: any) => r.role_code)}>保存</button><button className="btn btn-ghost" onClick={() => setForm(null)}>取消</button></div>
          <div className="note">新员工的 6 位 PIN 由系统生成，保存后只显示一次。</div>
        </div>
      )}
      <table>
        <thead><tr><th>姓名</th><th>手机</th><th>电邮</th><th>语言</th><th>角色</th><th>状态</th><th></th></tr></thead>
        <tbody>{rows.map((u) => <tr key={u.id} style={{ opacity: u.is_active ? 1 : 0.5 }}>
          <td>{u.name}{u.is_super_admin && ' (超管)'}</td><td>{u.phone ?? ''}</td><td>{u.email ?? ''}</td><td>{u.language}</td>
          <td>{u.roles.map((r: any, i: number) => <span key={i} className="pill" style={{ background: '#1565C0', marginRight: 4 }}>{ROLE_ZH[r.role_code] ?? r.role_code}{r.site_code ? ` @${r.site_code}` : ''}</span>)}</td>
          <td>{u.is_active ? <span className="ok">启用</span> : <span className="err">停用</span>}</td>
          <td style={{ whiteSpace: 'nowrap' }}>{canManage && <><button className="btn btn-ghost" onClick={() => openEdit(u)}>编辑</button> <button className="btn btn-ghost" onClick={() => badge(u)}>员工卡</button> <button className="btn btn-ghost" onClick={() => toggle(u)}>{u.is_active ? '停用' : '启用'}</button> </>}{has('user.reset_pin') && <button className="btn btn-ghost" onClick={() => resetPin(u)}>重置 PIN</button>}</td>
        </tr>)}</tbody>
      </table>
      <h2>角色权限 <span className="note">（由系统统一维护，公司不能改）</span></h2>
      <div className="toolbar">{roles.map((r) => <button key={r.code} className={`btn ${showPerms === r.code ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setShowPerms(showPerms === r.code ? null : r.code)}>{ROLE_ZH[r.code] ?? r.code}</button>)}</div>
      {showPerms && <pre style={{ maxHeight: 300 }}>{(roles.find((r) => r.code === showPerms)?.permissions ?? []).map((p: any) => `${p.code}${p.condition ? '  ' + JSON.stringify(p.condition) : ''}`).sort().join('\n')}</pre>}
    </div>
  );
}
