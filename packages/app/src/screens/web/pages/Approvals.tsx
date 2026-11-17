import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../../api/client.js';
import { errText, fmtDate, pillColor, STATUS_ZH } from './_util.js';
const TYPE_ZH: Record<string, string> = { IMPORT: 'Excel 导入', ORDER: '订货', COUNT_VARIANCE: '盘点差异', RETURN: '退货', PO_PRICE_CHANGE: '采购价变更', ADJUST: '手动调整', TRANSFER: '调拨', PAYMENT: '付款', PRICE_CHANGE: '改价' };
export default function Approvals() {
  const nav = useNavigate();
  const [pending, setPending] = useState<any[]>([]); const [all, setAll] = useState<any[]>([]); const [msg, setMsg] = useState('');
  useEffect(() => { api('/approvals/pending').then(setPending).catch((e) => setMsg(errText(e))); api('/approvals').then(setAll).catch(() => {}); }, []);
  const open = (a: any) => { if (a.type === 'IMPORT') nav(`/w/import?job=${a.ref_id}`); };
  const Summary = ({ s }: { s: any }) => <span className="note">{s ? Object.entries(s).map(([k, v]: any) => `${k}: ${v.total ?? ''}${v.error ? ` 错 ${v.error}` : ''}`).join(' · ') : ''}</span>;
  return (
    <div>
      <h1>审批</h1>
      {msg && <div className="err">{msg}</div>}
      <h2>等我批的（{pending.length}）</h2>
      <table><thead><tr><th>时间</th><th>类型</th><th>发起人</th><th>摘要</th><th></th></tr></thead><tbody>
        {pending.map((a) => <tr key={a.id}><td>{fmtDate(a.created_at)}</td><td>{TYPE_ZH[a.type] ?? a.type}</td><td>{a.requested_by_name}</td><td><Summary s={a.summary} /></td><td><button className="btn btn-primary" onClick={() => open(a)}>去处理</button></td></tr>)}
        {pending.length === 0 && <tr><td colSpan={5} className="note">没有待批的事项</td></tr>}
      </tbody></table>
      <h2>全部记录</h2>
      <table><thead><tr><th>时间</th><th>类型</th><th>发起人</th><th>状态</th><th>审批人</th><th>决定时间</th><th>备注</th></tr></thead><tbody>
        {all.map((a) => <tr key={a.id}><td>{fmtDate(a.created_at)}</td><td>{TYPE_ZH[a.type] ?? a.type}</td><td>{a.requested_by_name}</td><td><span className="pill" style={{ background: pillColor(a.status) }}>{STATUS_ZH[a.status] ?? a.status}</span></td><td>{a.approver_name ?? ''}{a.on_behalf_of ? '（代批）' : ''}</td><td>{fmtDate(a.decided_at)}</td><td>{a.decision_note ?? ''}</td></tr>)}
      </tbody></table>
    </div>
  );
}
