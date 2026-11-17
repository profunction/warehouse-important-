import { useEffect, useState } from 'react';
import { api } from '../../../api/client.js';
import { useAuth } from '../../../store/auth.js';
import { useT } from '../../../i18n/index.js';
import { errText, fmtDate, fmtQty, REASON_ZH } from './_util.js';

export default function Movements() {
  const { has } = useAuth(); const { n } = useT();
  const [f, setF] = useState({ reason: '', from: '', to: '', user: '' }); const [rows, setRows] = useState<any[]>([]); const [offset, setOffset] = useState(0); const [msg, setMsg] = useState(''); const [users, setUsers] = useState<any[]>([]); const [exp, setExp] = useState<any | null>(null);
  useEffect(() => { if (has('user.manage') || has('user.reset_pin')) api('/users').then(setUsers).catch(() => {}); }, []);
  const load = async () => {
    const qs = new URLSearchParams({ limit: '100', offset: String(offset) }); if (f.reason) qs.set('reason', f.reason); if (f.from) qs.set('from', new Date(f.from).toISOString()); if (f.to) qs.set('to', new Date(f.to).toISOString()); if (f.user) qs.set('user', f.user);
    try { setRows(await api(`/movements?${qs}`)); setMsg(''); } catch (e) { setMsg(errText(e)); }
  };
  useEffect(() => { void load(); }, [f, offset]);
  const doExport = async () => { try { setExp(await api('/export', { body: { type: 'movement', filters: { reason: f.reason || null, from: f.from ? new Date(f.from).toISOString() : null, to: f.to ? new Date(f.to).toISOString() : null } } })); } catch (e) { setMsg(errText(e)); } };
  const canCost = has('product.view_cost');
  return (
    <div>
      <h1>移动记录</h1>
      <div className="toolbar">
        <select value={f.reason} onChange={(e) => { setOffset(0); setF({ ...f, reason: e.target.value }); }}><option value="">全部原因</option>{Object.entries(REASON_ZH).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <input type="date" value={f.from} onChange={(e) => { setOffset(0); setF({ ...f, from: e.target.value }); }} /> 到 <input type="date" value={f.to} onChange={(e) => { setOffset(0); setF({ ...f, to: e.target.value }); }} />
        {users.length > 0 && <select value={f.user} onChange={(e) => { setOffset(0); setF({ ...f, user: e.target.value }); }}><option value="">全部人</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>}
        {has('export.movement') && <button className="btn btn-ghost" onClick={doExport}>导出 Excel</button>}
        {exp && <a className="btn btn-primary" href={exp.url}>下载（{exp.row_count} 行）</a>}
        <span className="err">{msg}</span>
      </div>
      <table>
        <thead><tr><th>时间</th><th>原因</th><th>货号</th><th>产品</th><th>从</th><th>到</th><th>数量</th>{canCost && <th>单位成本</th>}<th>操作人</th><th>来源</th><th>备注</th><th>上传时间</th></tr></thead>
        <tbody>{rows.map((m) => <tr key={m.id}><td>{fmtDate(m.performed_at)}</td><td>{REASON_ZH[m.reason] ?? m.reason}</td><td>{m.sku}</td><td>{n(m)}</td><td>{m.from_code}</td><td>{m.to_code}</td><td>{fmtQty(m.qty)}</td>{canCost && <td>{Number(m.unit_cost).toFixed(2)}</td>}<td>{m.by_name}</td><td>{m.ref_type ?? ''}</td><td>{m.note ?? ''}</td><td>{fmtDate(m.synced_at)}</td></tr>)}{rows.length === 0 && <tr><td colSpan={12} className="note">没有记录</td></tr>}</tbody>
      </table>
      <div className="toolbar" style={{ marginTop: 10 }}><button className="btn btn-ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 100))}>上一页</button><button className="btn btn-ghost" disabled={rows.length < 100} onClick={() => setOffset(offset + 100)}>下一页</button><span className="note">只读。账本不可修改，写错请插入反向移动。</span></div>
    </div>
  );
}
