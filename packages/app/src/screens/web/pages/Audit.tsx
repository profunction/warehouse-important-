import { useEffect, useState } from 'react';
import { api } from '../../../api/client.js';
import { errText, fmtDate } from './_util.js';
const TABLES = ['product', 'barcode', 'category', 'supplier', 'location', 'zone', 'site', 'app_user', 'user_site_role', 'role_permission', 'device', 'import_job', 'approval_request', 'shelf_assignment', 'ticket', 'company'];
export default function Audit() {
  const [f, setF] = useState({ table: '', from: '', to: '' }); const [rows, setRows] = useState<any[]>([]); const [offset, setOffset] = useState(0); const [open, setOpen] = useState<string | null>(null); const [msg, setMsg] = useState('');
  useEffect(() => { const qs = new URLSearchParams({ limit: '100', offset: String(offset) }); if (f.table) qs.set('table', f.table); if (f.from) qs.set('from', new Date(f.from).toISOString()); if (f.to) qs.set('to', new Date(f.to).toISOString()); api(`/audit?${qs}`).then(setRows).catch((e) => setMsg(errText(e))); }, [f, offset]);
  return (
    <div>
      <h1>审计日志</h1>
      <div className="toolbar">
        <select value={f.table} onChange={(e) => { setOffset(0); setF({ ...f, table: e.target.value }); }}><option value="">全部表</option>{TABLES.map((t) => <option key={t} value={t}>{t}</option>)}<option value="export">导出</option></select>
        <input type="date" value={f.from} onChange={(e) => { setOffset(0); setF({ ...f, from: e.target.value }); }} /> 到 <input type="date" value={f.to} onChange={(e) => { setOffset(0); setF({ ...f, to: e.target.value }); }} />
        <span className="err">{msg}</span>
      </div>
      <table><thead><tr><th>时间</th><th>用户</th><th>动作</th><th>表</th><th>行</th><th>改动列</th><th></th></tr></thead><tbody>
        {rows.map((a) => <>
          <tr key={a.id}><td>{fmtDate(a.at)}</td><td>{a.user_name ?? '系统'}</td><td>{a.action}</td><td>{a.table_name}</td><td className="note">{a.row_id ? String(a.row_id).slice(0, 8) : ''}</td><td>{(a.changed_columns ?? []).join(', ')}</td><td><button className="btn btn-ghost" onClick={() => setOpen(open === a.id ? null : a.id)}>{open === a.id ? '收起' : '前后值'}</button></td></tr>
          {open === a.id && <tr key={a.id + 'd'}><td colSpan={7}><div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}><div><b>之前</b><pre>{JSON.stringify(a.before_json, null, 1) ?? '—'}</pre></div><div><b>之后</b><pre>{JSON.stringify(a.after_json, null, 1) ?? '—'}</pre></div></div></td></tr>}
        </>)}
        {rows.length === 0 && <tr><td colSpan={7} className="note">没有记录</td></tr>}
      </tbody></table>
      <div className="toolbar" style={{ marginTop: 10 }}><button className="btn btn-ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 100))}>上一页</button><button className="btn btn-ghost" disabled={rows.length < 100} onClick={() => setOffset(offset + 100)}>下一页</button></div>
    </div>
  );
}
