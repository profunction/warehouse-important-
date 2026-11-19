// 网页：通用审批。等我批的（含代理标记）+ 详情（盘点差异逐行接受/重盘、手动调整明细）+ 批准/退回/拒绝 + 历史筛选。IMPORT 仍跳导入页。
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../../api/client.js';
import { useAuth } from '../../../store/auth.js';
import { errText, fmtDate, fmtMoney, fmtQty, pillColor, STATUS_ZH } from './_util.js';
const TYPE_ZH: Record<string, string> = { IMPORT: 'Excel 导入', ORDER: '订货', COUNT_VARIANCE: '盘点差异', RETURN: '退货', PO_PRICE_CHANGE: '采购价变更', ADJUST: '手动调整', TRANSFER: '调拨', PAYMENT: '付款', PRICE_CHANGE: '改价', PO: '采购单', VOID_SALE: '作废销售', SUPPLIER_INVOICE: '供应商发票', DISCOUNT: '折扣' };
const REASON_ZH: Record<string, string> = { DAMAGED: '损坏', EXPIRED: '过期', SAMPLE: '试吃/样品', MISCOUNT: '数错', OTHER: '其他' };
export default function Approvals() {
  const nav = useNavigate(); const [sp] = useSearchParams(); const { me } = useAuth();
  const [pending, setPending] = useState<any[]>([]); const [all, setAll] = useState<any[]>([]); const [msg, setMsg] = useState('');
  const [fStatus, setFStatus] = useState(''); const [fType, setFType] = useState('');
  const [sel, setSel] = useState<any | null>(null); const [dec, setDec] = useState<Record<string, string>>({}); const [note, setNote] = useState('');
  const load = async () => { try { setPending(await api('/approvals/pending')); setAll(await api(`/approvals?limit=200${fStatus ? `&status=${fStatus}` : ''}${fType ? `&type=${fType}` : ''}`)); } catch (e) { setMsg(errText(e)); } };
  useEffect(() => { void load(); }, [fStatus, fType]);
  useEffect(() => { const id = sp.get('id'); if (id) void open({ id }); }, []);
  const open = async (a: any) => { if (a.type === 'IMPORT') { nav(`/w/import?job=${a.ref_id}`); return; } try { const d = await api(`/approvals/${a.id}`); if (d.type === 'IMPORT') { nav(`/w/import?job=${d.ref_id}`); return; } setSel(d); setDec({}); setNote(''); } catch (e) { setMsg(errText(e)); } };
  const decide = async (decision: 'approve' | 'reject' | 'return') => {
    if (!sel) return;
    try { const lines = Object.entries(dec).map(([id, d]) => ({ id, decision: d })); const r = await api(`/approvals/${sel.id}/decide`, { body: { decision, note: note || undefined, line_decisions: lines.length ? lines : undefined } }); setMsg(`${TYPE_ZH[r.type] ?? r.type}：${STATUS_ZH[r.status]}${r.on_behalf_of ? '（代批）' : ''}`); setSel(null); await load(); } catch (e) { setMsg(errText(e)); }
  };
  const Summary = ({ a }: { a: any }) => <span className="note">{a.summary?.title ?? (a.type === 'IMPORT' && a.summary ? Object.entries(a.summary).map(([k, v]: any) => `${k}: ${v.total ?? ''}${v.error ? ` 错 ${v.error}` : ''}`).join(' · ') : '')}</span>;
  const varLines = (sel?.detail?.lines ?? []).filter((l: any) => Number(l.variance_qty) !== 0);
  return (
    <div>
      <h1>审批</h1>
      {msg && <div className={/已/.test(msg) ? 'ok' : 'err'}>{msg}</div>}
      <h2>等我批的（{pending.length}）</h2>
      <table><thead><tr><th>时间</th><th>类型</th><th>发起人</th><th>金额</th><th>摘要</th><th></th></tr></thead><tbody>
        {pending.map((a) => <tr key={a.id}><td>{fmtDate(a.created_at)}</td><td>{TYPE_ZH[a.type] ?? a.type}{a.on_behalf_name && <span className="pill" style={{ background: '#C62828', marginLeft: 6 }}>代 {a.on_behalf_name} 批</span>}</td><td>{a.requested_by_name}</td><td>{fmtMoney(a.amount)}</td><td><Summary a={a} /></td><td><button className="btn btn-primary" onClick={() => open(a)} data-testid="approval-open">去处理</button></td></tr>)}
        {pending.length === 0 && <tr><td colSpan={6} className="note">没有待批的事项</td></tr>}
      </tbody></table>
      {sel && (
        <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 10, padding: 16, marginBottom: 16 }}>
          <h2>{TYPE_ZH[sel.type] ?? sel.type} <span className="pill" style={{ background: pillColor(sel.status) }}>{STATUS_ZH[sel.status]}</span> <span className="note">{sel.requested_by_name} · {fmtDate(sel.created_at)}{sel.amount != null ? ` · RM ${fmtMoney(sel.amount)}` : ''}{sel.on_behalf_name ? ` · 代 ${sel.on_behalf_name} 批` : ''}</span></h2>
          {sel.summary?.title && <div style={{ marginBottom: 8 }}>{sel.summary.title}</div>}
          {sel.type === 'COUNT_VARIANCE' && (
            <>
              <div className="note">{sel.detail?.session?.session_no} · {sel.detail?.session?.assigned_to_name} · {varLines.length} 行差异。每行选接受或重盘，再按批准。</div>
              <table style={{ marginTop: 8 }}><thead><tr><th>货位</th><th>产品</th><th>系统</th><th>实数</th><th>差</th><th>金额</th><th>谁数</th><th>上次差异</th><th>决定</th></tr></thead><tbody>
                {varLines.map((l: any) => { const v = Number(l.variance_qty); return <tr key={l.id} style={{ color: 'var(--red)' }}><td>{l.location_code}</td><td>{l.name_zh ?? l.name_en ?? l.sku}</td><td>{fmtQty(l.system_qty)}</td><td>{fmtQty(l.counted_qty)}</td><td>{(v > 0 ? '+' : '') + v}</td><td>{fmtMoney(l.variance_amount)}</td><td>{l.counted_by_name ?? ''}</td><td>{l.last_variance_qty == null ? '—' : fmtQty(l.last_variance_qty)}</td><td>{sel.can_decide ? <select value={dec[l.id] ?? 'ACCEPT'} onChange={(e) => setDec({ ...dec, [l.id]: e.target.value })}><option value="ACCEPT">接受</option><option value="RECOUNT">重盘</option></select> : (l.decision ?? '')}</td></tr>; })}
                {varLines.length === 0 && <tr><td colSpan={9} className="note">没有可看的差异行</td></tr>}
              </tbody></table>
            </>
          )}
          {sel.type === 'ADJUST' && sel.detail?.adjustment && (() => { const s = sel.detail.adjustment; return (
            <table style={{ marginTop: 8 }}><tbody>
              <tr><td>产品</td><td>{s.product_name}（{s.sku}）</td></tr><tr><td>货位</td><td>{s.location_code}</td></tr><tr><td>数量</td><td>{s.current_qty} → {s.new_qty}（{s.diff > 0 ? '+' : ''}{s.diff}）</td></tr><tr><td>原因</td><td>{REASON_ZH[s.reason] ?? s.reason}{s.note ? ` · ${s.note}` : ''}</td></tr>
              {s.photo_url && <tr><td>照片</td><td><img src={s.photo_url} alt="" style={{ maxWidth: 360, maxHeight: 240 }} /></td></tr>}
            </tbody></table>
          ); })()}
          {sel.status !== 'PENDING' && <div className="note" style={{ marginTop: 8 }}>审批人：{sel.approver_name ?? ''}{sel.on_behalf_of_name ? `（代 ${sel.on_behalf_of_name}）` : ''} · {fmtDate(sel.decided_at)}{sel.decision_note ? ` · ${sel.decision_note}` : ''}</div>}
          {sel.status === 'PENDING' && !sel.can_decide && <div className="note" style={{ marginTop: 8 }}>{sel.requested_by === me?.user.id ? '不能批自己发起的' : '你没有这项审批的权限'}</div>}
          <div className="toolbar" style={{ marginTop: 10 }}>
            {sel.can_decide && <><input placeholder="备注（可选）" value={note} onChange={(e) => setNote(e.target.value)} style={{ width: 280 }} /><button className="btn btn-primary" onClick={() => decide('approve')} data-testid="approve-btn">批准</button><button className="btn btn-ghost" onClick={() => decide('return')}>退回</button><button className="btn btn-danger" onClick={() => decide('reject')}>拒绝</button></>}
            <button className="btn btn-ghost" onClick={() => setSel(null)}>关闭</button>
          </div>
        </div>
      )}
      <h2>全部记录</h2>
      <div className="toolbar">
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)}><option value="">全部状态</option>{['PENDING', 'APPROVED', 'REJECTED', 'RETURNED'].map((s) => <option key={s} value={s}>{STATUS_ZH[s]}</option>)}</select>
        <select value={fType} onChange={(e) => setFType(e.target.value)}><option value="">全部类型</option>{Object.entries(TYPE_ZH).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      </div>
      <table><thead><tr><th>时间</th><th>类型</th><th>发起人</th><th>金额</th><th>状态</th><th>审批人</th><th>决定时间</th><th>备注</th></tr></thead><tbody>
        {all.map((a) => <tr key={a.id} onClick={() => open(a)} style={{ cursor: 'pointer' }}><td>{fmtDate(a.created_at)}</td><td>{TYPE_ZH[a.type] ?? a.type}</td><td>{a.requested_by_name}</td><td>{fmtMoney(a.amount)}</td><td><span className="pill" style={{ background: pillColor(a.status) }}>{STATUS_ZH[a.status] ?? a.status}</span></td><td>{a.approver_name ?? ''}{a.on_behalf_name ? `（代 ${a.on_behalf_name}）` : ''}</td><td>{fmtDate(a.decided_at)}</td><td>{a.decision_note ?? ''}</td></tr>)}
        {all.length === 0 && <tr><td colSpan={8} className="note">没有记录</td></tr>}
      </tbody></table>
    </div>
  );
}
