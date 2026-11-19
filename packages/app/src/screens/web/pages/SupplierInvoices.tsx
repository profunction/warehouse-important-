// 供应商发票与应付（模块 D）：录入（选 PO）、三方匹配结果、差异处理、付款（超门槛审批）、到期应付。
import { useEffect, useState } from 'react';
import { api } from '../../../api/client.js';
import { useAuth } from '../../../store/auth.js';
import { errText, fmtDate, fmtMoney, fmtQty } from './_util.js';
const ST_ZH: Record<string, string> = { PENDING_MATCH: '待匹配', VARIANCE: '有差异', PAYABLE: '可付款', PARTIAL: '部分付', PAID: '已付', CANCELLED: '已取消' };
const stColor = (s: string) => (s === 'PAID' ? '#1B8A3A' : s === 'VARIANCE' ? '#C62828' : s === 'PAYABLE' || s === 'PARTIAL' ? '#1565C0' : '#9E9E9E');

export default function SupplierInvoices() {
  const { has } = useAuth();
  const [tab, setTab] = useState<'list' | 'due'>('list');
  const [status, setStatus] = useState(''); const [rows, setRows] = useState<any[]>([]); const [due, setDue] = useState<any | null>(null);
  const [suppliers, setSuppliers] = useState<any[]>([]); const [pos, setPos] = useState<any[]>([]);
  const [form, setForm] = useState<any | null>(null); const [match, setMatch] = useState<any | null>(null); const [pay, setPay] = useState<any | null>(null); const [resolve, setResolve] = useState<any | null>(null);
  const [msg, setMsg] = useState(''); const [ok, setOk] = useState('');
  const say = (t: string) => { setOk(t); setMsg(''); setTimeout(() => setOk(''), 5000); }; const fail = (e: any) => { setMsg(errText(e)); setOk(''); };
  const load = async () => { try { setRows(await api(`/supplier-invoices${status ? `?status=${status}` : ''}`)); if (tab === 'due') setDue(await api('/ap/due?days=30')); } catch (e) { fail(e); } };
  useEffect(() => { void load(); }, [status, tab]);
  useEffect(() => { api('/suppliers').then(setSuppliers).catch(() => {}); api('/purchase-orders').then((r: any) => setPos(Array.isArray(r) ? r : r.rows ?? [])).catch(() => setPos([])); }, []);
  const openMatch = async (id: string) => { try { setMatch(await api(`/supplier-invoices/${id}/match`)); } catch (e) { fail(e); } };
  const save = async () => {
    try {
      const r = await api('/supplier-invoices', { body: { supplier_id: form.supplier_id, po_id: form.po_id || null, invoice_no: form.invoice_no, invoice_date: form.invoice_date || undefined, due_date: form.due_date || undefined, amount: Number(form.amount), photo_url: form.photo_url || null, note: form.note || null } });
      setForm(null); say(r.status === 'VARIANCE' ? `已录入：有差异 RM ${fmtMoney(r.match?.variance_amount)}，已开工单给采购员` : `已录入：${ST_ZH[r.status]}`); await load(); if (r.po_id) await openMatch(r.id);
    } catch (e) { fail(e); }
  };
  const doResolve = async () => { try { const r = await api(`/supplier-invoices/${resolve.id}/resolve`, { body: { action: resolve.action, note: resolve.note || undefined } }); setResolve(null); say(resolve.action === 'PO_PRICE_CHANGE' ? '已送老板审批 PO 改价' : `已处理：${ST_ZH[r.status]}`); await load(); setMatch(null); } catch (e) { fail(e); } };
  const doPay = async () => {
    try { const r = await api(`/supplier-invoices/${pay.id}/payments`, { body: { amount: Number(pay.amount), method: pay.method, reference: pay.reference || null } }); setPay(null); say(r.status === 'PENDING_APPROVAL' ? `超过付款门槛 RM ${fmtMoney(r.threshold)}，已送老板审批` : `已付款：${ST_ZH[r.invoice.status]}`); await load(); } catch (e) { fail(e); }
  };
  const canResolve = has('ap.manage') || has('ap.approve') || has('receive.variance');
  return (
    <div>
      <h1>供应商发票与应付</h1>
      {msg && <div className="err" style={{ marginBottom: 8 }}>{msg}</div>}{ok && <div className="ok" style={{ marginBottom: 8 }}>{ok}</div>}
      <div className="tabs"><button className={tab === 'list' ? 'active' : ''} onClick={() => setTab('list')}>发票</button><button className={tab === 'due' ? 'active' : ''} onClick={() => setTab('due')}>到期应付</button></div>
      {tab === 'list' && <>
        <div className="toolbar">
          <select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">全部状态</option>{Object.entries(ST_ZH).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          {has('ap.manage') && <button className="btn btn-primary" onClick={() => setForm({ supplier_id: suppliers[0]?.id ?? '', po_id: '', invoice_no: '', invoice_date: '', due_date: '', amount: '', photo_url: '', note: '' })}>录入供应商发票</button>}
          <span className="note">录入后系统自动做三方匹配：PO 单价 × 收货实收 对比发票金额。</span>
        </div>
        {form && <div className="form" style={{ marginBottom: 16 }}>
          <label>供应商<select value={form.supplier_id} onChange={(e) => setForm({ ...form, supplier_id: e.target.value, po_id: '' })}>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          <label>采购单<select value={form.po_id} onChange={(e) => setForm({ ...form, po_id: e.target.value })}><option value="">（无，不匹配）</option>{pos.filter((p) => !form.supplier_id || p.supplier_id === form.supplier_id).map((p) => <option key={p.id} value={p.id}>{p.po_no} · RM {fmtMoney(p.total_amount)} · {p.status}</option>)}</select></label>
          <label>发票号<input value={form.invoice_no} onChange={(e) => setForm({ ...form, invoice_no: e.target.value })} /></label>
          <label>发票日期<input type="date" value={form.invoice_date} onChange={(e) => setForm({ ...form, invoice_date: e.target.value })} /></label>
          <label>到期日（留空按供应商账期）<input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></label>
          <label>金额 RM<input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></label>
          <label>照片链接<input value={form.photo_url} onChange={(e) => setForm({ ...form, photo_url: e.target.value })} /></label>
          <label>备注<input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'end' }}><button className="btn btn-primary" onClick={save} disabled={!form.supplier_id || !form.invoice_no || !form.amount}>录入并匹配</button><button className="btn btn-ghost" onClick={() => setForm(null)}>取消</button></div>
        </div>}
        <table><thead><tr><th>发票号</th><th>供应商</th><th>采购单</th><th>收货单</th><th>日期</th><th>到期</th><th>金额</th><th>匹配额</th><th>差异</th><th>已付</th><th>状态</th><th>审批</th><th></th></tr></thead><tbody>
          {rows.map((r) => <tr key={r.id}><td>{r.invoice_no}</td><td>{r.supplier_name}</td><td>{r.po_no ?? '—'}</td><td>{r.grn_nos ?? '—'}</td><td>{String(r.invoice_date).slice(0, 10)}</td><td>{r.due_date ? String(r.due_date).slice(0, 10) : '—'}</td><td>{fmtMoney(r.amount)}</td><td>{fmtMoney(r.matched_amount)}</td><td className={Number(r.variance_amount) !== 0 ? 'err' : ''}>{fmtMoney(r.variance_amount)}</td><td>{fmtMoney(r.paid_amount)}</td><td><span className="pill" style={{ background: stColor(r.status) }}>{ST_ZH[r.status]}</span></td><td>{r.approval_status === 'PENDING' ? <span className="pill" style={{ background: '#F9A825' }}>待批</span> : ''}</td>
            <td style={{ whiteSpace: 'nowrap' }}>{r.po_id && <button className="btn btn-ghost" onClick={() => openMatch(r.id)}>匹配明细</button>} {r.status === 'VARIANCE' && canResolve && !r.approval_status && <button className="btn btn-primary" onClick={() => setResolve({ id: r.id, action: 'ACCEPT', note: '' })}>处理差异</button>} {['PAYABLE', 'PARTIAL'].includes(r.status) && has('ap.pay') && r.approval_status !== 'PENDING' && <button className="btn btn-primary" onClick={() => setPay({ id: r.id, invoice_no: r.invoice_no, amount: Number(r.outstanding), method: 'BANK_TRANSFER', reference: '' })}>付款</button>}</td></tr>)}
          {rows.length === 0 && <tr><td colSpan={13} className="note">没有供应商发票</td></tr>}
        </tbody></table>
        {resolve && <div className="toolbar" style={{ background: '#F3F4F6', padding: 10, borderRadius: 8, marginTop: 10 }}>
          <b>处理差异</b>
          <select value={resolve.action} onChange={(e) => setResolve({ ...resolve, action: e.target.value })}><option value="ACCEPT">接受差异，按发票付</option><option value="CREDIT_NOTE">要 Credit Note，按匹配额付</option><option value="PO_PRICE_CHANGE">改 PO 价（老板批）</option></select>
          <input placeholder="说明" value={resolve.note} onChange={(e) => setResolve({ ...resolve, note: e.target.value })} style={{ width: 240 }} />
          <button className="btn btn-primary" onClick={doResolve}>确认</button><button className="btn btn-ghost" onClick={() => setResolve(null)}>取消</button>
        </div>}
        {pay && <div className="toolbar" style={{ background: '#F3F4F6', padding: 10, borderRadius: 8, marginTop: 10 }}>
          <b>付款 {pay.invoice_no}</b>
          <input type="number" step="0.01" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} style={{ width: 120 }} />
          <select value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>{['BANK_TRANSFER', 'CASH', 'CHEQUE', 'CARD', 'EWALLET'].map((m) => <option key={m}>{m}</option>)}</select>
          <input placeholder="参考号 / 支票号" value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} style={{ width: 160 }} />
          <button className="btn btn-primary" onClick={doPay}>确认付款</button><button className="btn btn-ghost" onClick={() => setPay(null)}>取消</button>
        </div>}
        {match && <div style={{ marginTop: 20, border: '1px solid var(--border)', borderRadius: 10, padding: 16, background: '#fff' }}>
          <h2>三方匹配 · {match.invoice.invoice_no} · PO {match.invoice.po_no} <span className={match.ok ? 'ok' : 'err'}>{match.ok ? '一致' : `差异 RM ${fmtMoney(match.variance_amount)}`}</span> <span className="note">容差 RM {fmtMoney(match.tolerance)} · 匹配额 RM {fmtMoney(match.matched_amount)}</span> <button className="btn btn-ghost" onClick={() => setMatch(null)}>关闭</button></h2>
          <table><thead><tr><th>#</th><th>货号</th><th>产品</th><th>订购</th><th>PO 单价</th><th>实收</th><th>应付（PO×实收）</th><th>发票数量</th><th>发票单价</th><th>发票金额</th><th>差异</th><th>收货单</th></tr></thead><tbody>
            {match.lines.map((l: any) => <tr key={l.id}><td>{l.line_no}</td><td>{l.sku}</td><td>{l.product_name}</td><td>{fmtQty(l.ordered_qty)}</td><td>{fmtMoney(l.po_unit_cost)}</td><td>{fmtQty(l.received_qty)}</td><td>{fmtMoney(l.expected_amount)}</td><td>{Number(l.invoiced_qty) > 0 ? fmtQty(l.invoiced_qty) : '—'}</td><td>{Number(l.invoiced_qty) > 0 ? fmtMoney(l.invoiced_unit_cost) : '—'}</td><td>{Number(l.invoiced_qty) > 0 ? fmtMoney(l.invoiced_amount) : '—'}</td><td className={Number(l.variance_amount) !== 0 ? 'err' : ''}>{fmtMoney(l.variance_amount)}</td><td className="note">{(l.grns ?? []).map((g: any) => `${g.grn_no}: ${fmtQty(g.received_qty)}`).join('; ')}</td></tr>)}
          </tbody></table>
          {match.invoice.resolution && <div className="note" style={{ marginTop: 6 }}>处理：{match.invoice.resolution}</div>}
        </div>}
      </>}
      {tab === 'due' && due && <>
        <div className="cards"><div className="stat"><div className="v">{fmtMoney(due.total)}</div><div className="l">30 天内到期 RM</div></div><div className={`stat ${due.overdue > 0 ? 'warn' : ''}`}><div className="v">{fmtMoney(due.overdue)}</div><div className="l">已逾期 RM</div></div><div className="stat"><div className="v">{due.rows.length}</div><div className="l">张发票</div></div></div>
        <table><thead><tr><th>到期</th><th>供应商</th><th>发票号</th><th>采购单</th><th>金额</th><th>已付</th><th>未付</th><th>状态</th></tr></thead><tbody>
          {due.rows.map((r: any) => <tr key={r.id}><td className={r.due_date && new Date(r.due_date) < new Date() ? 'err' : ''}>{r.due_date ? String(r.due_date).slice(0, 10) : '—'}</td><td>{r.supplier_name}</td><td>{r.invoice_no}</td><td>{r.po_no ?? '—'}</td><td>{fmtMoney(r.amount)}</td><td>{fmtMoney(r.paid_amount)}</td><td><b>{fmtMoney(r.outstanding)}</b></td><td><span className="pill" style={{ background: stColor(r.status) }}>{ST_ZH[r.status]}</span></td></tr>)}
          {due.rows.length === 0 && <tr><td colSpan={8} className="note">30 天内没有到期应付</td></tr>}
        </tbody></table>
        <div className="note" style={{ marginTop: 8 }}>最后更新 {fmtDate(new Date().toISOString())}</div>
      </>}
    </div>
  );
}
