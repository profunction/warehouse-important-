import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../../api/client.js';
import { errText, fmtDate } from './_util.js';
const FLAGS: [string, string][] = [['transfers', '调拨'], ['cycle_count', '循环盘点'], ['b2b_invoice', '企业发票'], ['kiosk', '顾客大屏'], ['pandal', 'Pandal 对接'], ['einvoice_consolidated', '合并电子发票'], ['own_pos', '自有 POS']];
export default function AdminCompanies() {
  const nav = useNavigate();
  const [rows, setRows] = useState<any[]>([]); const [msg, setMsg] = useState(''); const [flagsFor, setFlagsFor] = useState<any | null>(null);
  const load = () => api('/admin/companies').then(setRows).catch((e) => setMsg(errText(e)));
  useEffect(() => { void load(); }, []);
  const enter = async (c: any) => { try { const r = await api(`/admin/companies/${c.id}/enter`, { method: 'POST' }); localStorage.setItem('wh.access', r.access_token); location.href = '/w/dashboard'; } catch (e) { setMsg(errText(e)); } };
  const toggle = async (c: any) => { if (!window.confirm(`${c.is_active ? '停用' : '启用'}公司 ${c.name}？`)) return; try { await api(`/admin/companies/${c.id}`, { method: 'PUT', body: { is_active: !c.is_active } }); await load(); } catch (e) { setMsg(errText(e)); } };
  const saveFlags = async () => { try { await api(`/admin/companies/${flagsFor.id}`, { method: 'PUT', body: { feature_flags: flagsFor.feature_flags, plan: flagsFor.plan } }); setFlagsFor(null); await load(); setMsg('已保存'); } catch (e) { setMsg(errText(e)); } };
  const health = (c: any) => { const seen = c.last_device_seen ? Date.now() - new Date(c.last_device_seen).getTime() : Infinity; return Number(c.quarantined) > 0 ? ['#C62828', '有隔离记录'] : seen > 2 * 86400_000 ? ['#F9A825', '两天无设备同步'] : ['#1B8A3A', '正常']; };
  return (
    <div>
      <h1>公司列表</h1>
      <div className="toolbar"><button className="btn btn-primary" onClick={() => nav('/w/admin/wizard')}>+ 开店向导</button><span className={msg === '已保存' ? 'ok' : 'err'}>{msg}</span></div>
      {flagsFor && <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 10, padding: 16, marginBottom: 16 }}>
        <h2>{flagsFor.name} · 模式和功能开关</h2>
        <div className="toolbar"><label>模式 <select value={flagsFor.plan} onChange={(e) => setFlagsFor({ ...flagsFor, plan: e.target.value })}><option value="A">A 小型商店</option><option value="B">B 中型公司</option></select></label></div>
        <div className="toolbar">{FLAGS.map(([k, l]) => <label key={k}><input type="checkbox" checked={!!flagsFor.feature_flags?.[k]} onChange={(e) => setFlagsFor({ ...flagsFor, feature_flags: { ...flagsFor.feature_flags, [k]: e.target.checked } })} style={{ width: 'auto', minHeight: 0 }} /> {l}</label>)}</div>
        <div className="toolbar"><button className="btn btn-primary" onClick={saveFlags}>保存</button><button className="btn btn-ghost" onClick={() => setFlagsFor(null)}>取消</button></div>
      </div>}
      <table><thead><tr><th>健康</th><th>公司</th><th>代码</th><th>模式</th><th>产品</th><th>用户</th><th>7 天移动</th><th>最后设备同步</th><th>隔离</th><th>建立</th><th></th></tr></thead><tbody>
        {rows.map((c) => { const [color, label] = health(c); return <tr key={c.id} style={{ opacity: c.is_active ? 1 : 0.5 }}>
          <td><span className="pill" style={{ background: color }}>{label}</span></td><td>{c.name}</td><td>{c.short_code}</td><td>{c.plan}</td><td>{c.products}</td><td>{c.users}</td><td>{c.movements_7d}</td><td>{fmtDate(c.last_device_seen)}</td><td className={Number(c.quarantined) > 0 ? 'err' : ''}>{c.quarantined}</td><td>{fmtDate(c.created_at)}</td>
          <td style={{ whiteSpace: 'nowrap' }}><button className="btn btn-primary" onClick={() => enter(c)}>进入</button> <button className="btn btn-ghost" onClick={() => setFlagsFor({ id: c.id, name: c.name, plan: c.plan, feature_flags: {} })}>开关</button> <button className="btn btn-ghost" onClick={() => toggle(c)}>{c.is_active ? '停用' : '启用'}</button></td>
        </tr>; })}
        {rows.length === 0 && <tr><td colSpan={11} className="note">还没有公司，用开店向导建第一家。</td></tr>}
      </tbody></table>
      <div className="note" style={{ marginTop: 8 }}>"开关"只会改勾选的项；未勾的保持原值需要先查看。"进入"后以超级管理员身份在该公司操作，所有动作记审计。</div>
    </div>
  );
}
