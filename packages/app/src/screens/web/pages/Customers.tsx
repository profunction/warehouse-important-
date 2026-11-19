// 客户与应收（模块 D）：客户 CRUD、信用额、发票列表与手动开票、收款、对账单下载/发送、账龄。
import { useEffect, useState } from 'react';
import { api } from '../../../api/client.js';
import { useAuth } from '../../../store/auth.js';
import { errText, fmtDate, fmtMoney, downloadRaw, pillColor } from './_util.js';
const INV_ZH: Record<string, string> = { UNPAID: '未付', PARTIAL: '部分付', PAID: '已付', OVERDUE: '逾期', CANCELLED: '已取消' };
const invColor = (s: string) => (s === 'PAID' ? '#1B8A3A' : s === 'OVERDUE' ? '#C62828' : s === 'PARTIAL' ? '#F9A825' : s === 'CANCELLED' ? '#9E9E9E' : '#1565C0');
const thisMonth = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 7);
const emptyCust = { name: '', code: '', tin: '', brn: '', email: '', phone: '', credit_terms_days: 30, credit_limit: 0 };

export default function Customers() {
  const { has } = useAuth();
  const [tab, setTab] = useState<'customers' | 'invoices' | 'aging'>('customers');
  const [q, setQ] = useState(''); const [rows, setRows] = useState<any[]>([]); const [sel, setSel] = useState<any | null>(null);
  const [form, setForm] = useState<any | null>(null); const [msg, setMsg] = useState(''); const [ok, setOk] = useState('');
  const [invoices, setInvoices] = useState<any[]>([]); const [invStatus, setInvStatus] = useState(''); const [aging, setAging] = useState<any | null>(null);
  const [newInv, setNewInv] = useState<any | null>(null); const [pay, setPay] = useState<any | null>(null); const [month, setMonth] = useState(thisMonth());
  const say = (t: string) => { setOk(t); setMsg(''); setTimeout(() => setOk(''), 4000); };
  const fail = (e: any) => { setMsg(errText(e)); setOk(''); };
  const load = async () => { try { setRows(await api(`/customers?search=${encodeURIComponent(q)}`)); } catch (e) { fail(e); } };
  const open = async (id: string) => { try { setSel(await api(`/customers/${id}`)); } catch (e) { fail(e); } };
  const loadInv = async () => { try { setInvoices(await api(`/invoices${invStatus ? `?status=${invStatus}` : ''}`)); } catch (e) { fail(e); } };
  useEffect(() => { void load(); }, []);
  useEffect(() => { if (tab === 'invoices') void loadInv(); if (tab === 'aging') api('/ar/aging').then(setAging).catch(fail); }, [tab, invStatus]);
  const saveCust = async () => {
    try {
      const body = { ...form, code: form.code || undefined, tin: form.tin || null, brn: form.brn || null, email: form.email || null, phone: form.phone || null, credit_terms_days: Number(form.credit_terms_days), credit_limit: Number(form.credit_limit) };
      if (form.id) await api(`/customers/${form.id}`, { method: 'PUT', body }); else await api('/customers', { body });
      setForm(null); say('已保存'); await load(); if (form.id) await open(form.id);
    } catch (e) { fail(e); }
  };
  const createInvoice = async () => {
    try {
      const lines = newInv.lines.filter((l: any) => l.description && Number(l.qty) > 0).map((l: any) => ({ description: l.description, qty: Number(l.qty), unit_price: Number(l.unit_price) }));
      const r = await api('/invoices', { body: { customer_id: sel.id, lines, note: newInv.note || undefined } });
      setNewInv(null); say(`已开票 ${r.invoice_no}，合计 RM ${fmtMoney(r.total)}`); await open(sel.id); await load();
    } catch (e) { fail(e); }
  };
  const doPay = async () => {
    try { const r = await api(`/invoices/${pay.invoice.id}/payments`, { body: { amount: Number(pay.amount), method: pay.method, reference: pay.reference || null } }); setPay(null); say(`已收款，发票${INV_ZH[r.invoice.status]}`); if (sel) await open(sel.id); await load(); if (tab === 'invoices') await loadInv(); } catch (e) { fail(e); }
  };
  const sendStatement = async () => { try { const r = await api(`/customers/${sel.id}/statement/send`, { body: { month } }); say(`对账单已生成并发送（期末 RM ${fmtMoney(r.closing_balance)}）`); await open(sel.id); } catch (e) { fail(e); } };
  const canManage = has('customer.manage'); const canInvoice = has('invoice.manage');
  const custTotal = rows.reduce((s, r) => s + Number(r.balance), 0), overdueTotal = rows.reduce((s, r) => s + Number(r.overdue_amount), 0);
  return (
    <div>
      <h1>客户与应收</h1>
      {msg && <div className="err" style={{ marginBottom: 8 }}>{msg}</div>}{ok && <div className="ok" style={{ marginBottom: 8 }}>{ok}</div>}
      <div className="cards"><div className="stat"><div className="v">{rows.length}</div><div className="l">客户</div></div><div className="stat"><div className="v">{fmtMoney(custTotal)}</div><div className="l">应收余额 RM</div></div><div className={`stat ${overdueTotal > 0 ? 'warn' : ''}`}><div className="v">{fmtMoney(overdueTotal)}</div><div className="l">逾期 RM</div></div></div>
      <div className="tabs">{([['customers', '客户'], ['invoices', '发票'], ['aging', '账龄']] as const).map(([k, l]) => <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === 'customers' && <>
        <div className="toolbar"><input placeholder="搜索名称 / 代码 / 电话 / TIN" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} style={{ width: 280 }} /><button className="btn btn-ghost" onClick={load}>搜索</button>{canManage && <button className="btn btn-primary" data-testid="new-customer" onClick={() => setForm({ ...emptyCust })}>新客户</button>}</div>
        {form && <div className="form" style={{ marginBottom: 16 }} data-testid="customer-form">
          <label>名称<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label>代码（留空自动）<input value={form.code ?? ''} onChange={(e) => setForm({ ...form, code: e.target.value })} /></label>
          <label>TIN<input value={form.tin ?? ''} onChange={(e) => setForm({ ...form, tin: e.target.value })} /></label>
          <label>BRN 注册号<input value={form.brn ?? ''} onChange={(e) => setForm({ ...form, brn: e.target.value })} /></label>
          <label>电邮<input value={form.email ?? ''} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
          <label>电话<input value={form.phone ?? ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
          <label>信用期（天）<input type="number" value={form.credit_terms_days} onChange={(e) => setForm({ ...form, credit_terms_days: e.target.value })} /></label>
          <label>信用额 RM（0 = 不限）<input type="number" value={form.credit_limit} onChange={(e) => setForm({ ...form, credit_limit: e.target.value })} /></label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'end' }}><button className="btn btn-primary" onClick={saveCust} disabled={!form.name}>保存</button><button className="btn btn-ghost" onClick={() => setForm(null)}>取消</button></div>
        </div>}
        <table><thead><tr><th>代码</th><th>名称</th><th>TIN</th><th>电话</th><th>信用期</th><th>信用额</th><th>余额</th><th>逾期</th><th>未付发票</th></tr></thead><tbody>
          {rows.map((r) => <tr key={r.id} onClick={() => open(r.id)} style={{ cursor: 'pointer', fontWeight: sel?.id === r.id ? 700 : 400 }}><td>{r.code}</td><td>{r.name}</td><td>{r.tin ?? ''}</td><td>{r.phone ?? ''}</td><td>{r.credit_terms_days} 天</td><td>{Number(r.credit_limit) > 0 ? fmtMoney(r.credit_limit) : '不限'}</td><td>{fmtMoney(r.balance)}</td><td className={Number(r.overdue_amount) > 0 ? 'err' : ''}>{fmtMoney(r.overdue_amount)}</td><td>{r.open_invoices}</td></tr>)}
          {rows.length === 0 && <tr><td colSpan={9} className="note">没有客户</td></tr>}
        </tbody></table>
        {sel && <div style={{ marginTop: 20, border: '1px solid var(--border)', borderRadius: 10, padding: 16, background: '#fff' }} data-testid="customer-detail">
          <h2>{sel.code} · {sel.name} <span className="note">余额 RM {fmtMoney(sel.balance)} · 逾期 RM {fmtMoney(sel.overdue_amount)}</span></h2>
          <div className="toolbar">
            {canManage && <button className="btn btn-ghost" onClick={() => setForm({ ...sel })}>编辑</button>}
            {canInvoice && <button className="btn btn-primary" data-testid="new-invoice" onClick={() => setNewInv({ lines: [{ description: '', qty: 1, unit_price: 0 }], note: '' })}>手动开票</button>}
            <span>对账单月份 <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></span>
            <button className="btn btn-ghost" onClick={() => downloadRaw(`/customers/${sel.id}/statement?month=${month}&format=pdf`, `statement-${sel.code}-${month}.pdf`).catch(fail)}>下载对账单 PDF</button>
            {has('statement.send') && <button className="btn btn-ghost" onClick={sendStatement}>发送对账单</button>}
            <button className="btn btn-ghost" onClick={() => setSel(null)}>关闭</button>
          </div>
          {newInv && <div style={{ marginBottom: 12 }} data-testid="invoice-form">
            <table><thead><tr><th>项目说明</th><th style={{ width: 100 }}>数量</th><th style={{ width: 120 }}>单价（不含税）</th><th style={{ width: 60 }}></th></tr></thead><tbody>
              {newInv.lines.map((l: any, i: number) => <tr key={i}><td><input value={l.description} data-testid={`line-desc-${i}`} onChange={(e) => { const ls = [...newInv.lines]; ls[i] = { ...l, description: e.target.value }; setNewInv({ ...newInv, lines: ls }); }} style={{ width: '100%' }} /></td><td><input type="number" value={l.qty} data-testid={`line-qty-${i}`} onChange={(e) => { const ls = [...newInv.lines]; ls[i] = { ...l, qty: e.target.value }; setNewInv({ ...newInv, lines: ls }); }} style={{ width: 80 }} /></td><td><input type="number" value={l.unit_price} data-testid={`line-price-${i}`} onChange={(e) => { const ls = [...newInv.lines]; ls[i] = { ...l, unit_price: e.target.value }; setNewInv({ ...newInv, lines: ls }); }} style={{ width: 100 }} /></td><td><button className="btn btn-ghost" onClick={() => setNewInv({ ...newInv, lines: newInv.lines.filter((_: any, j: number) => j !== i) })}>删</button></td></tr>)}
            </tbody></table>
            <div className="toolbar" style={{ marginTop: 8 }}><button className="btn btn-ghost" onClick={() => setNewInv({ ...newInv, lines: [...newInv.lines, { description: '', qty: 1, unit_price: 0 }] })}>加一行</button><input placeholder="备注" value={newInv.note} onChange={(e) => setNewInv({ ...newInv, note: e.target.value })} style={{ width: 240 }} /><span className="note">合计 RM {fmtMoney(newInv.lines.reduce((s: number, l: any) => s + Number(l.qty) * Number(l.unit_price), 0))}（税按默认税码另加）</span><button className="btn btn-primary" data-testid="invoice-submit" onClick={createInvoice}>开票</button><button className="btn btn-ghost" onClick={() => setNewInv(null)}>取消</button></div>
          </div>}
          <InvoiceTable rows={sel.invoices} onPay={canInvoice ? (inv) => setPay({ invoice: inv, amount: Number(inv.outstanding), method: 'BANK_TRANSFER', reference: '' }) : undefined} />
          {pay && <PayForm pay={pay} setPay={setPay} onSubmit={doPay} />}
          <h2>收款记录</h2>
          <table><thead><tr><th>时间</th><th>发票</th><th>方式</th><th>参考</th><th>金额</th><th>收款人</th></tr></thead><tbody>{sel.payments.map((p: any) => <tr key={p.id}><td>{fmtDate(p.received_at)}</td><td>{p.invoice_no}</td><td>{p.method}</td><td>{p.reference ?? ''}</td><td>{fmtMoney(p.amount)}</td><td>{p.received_by_name ?? ''}</td></tr>)}{sel.payments.length === 0 && <tr><td colSpan={6} className="note">没有收款</td></tr>}</tbody></table>
          {sel.statements?.length > 0 && <><h2>对账单</h2><table><thead><tr><th>期间</th><th>期初</th><th>期末</th><th>发送时间</th><th></th></tr></thead><tbody>{sel.statements.map((s: any) => <tr key={s.id}><td>{String(s.period_start).slice(0, 7)}</td><td>{fmtMoney(s.opening_balance)}</td><td>{fmtMoney(s.closing_balance)}</td><td>{fmtDate(s.sent_at)}</td><td>{s.pdf_url && <a href={s.pdf_url} target="_blank" rel="noreferrer">PDF</a>}</td></tr>)}</tbody></table></>}
        </div>}
      </>}
      {tab === 'invoices' && <>
        <div className="toolbar"><select value={invStatus} onChange={(e) => setInvStatus(e.target.value)}><option value="">全部状态</option>{Object.entries(INV_ZH).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <InvoiceTable rows={invoices} showCustomer onPay={canInvoice ? (inv) => setPay({ invoice: inv, amount: Number(inv.outstanding), method: 'BANK_TRANSFER', reference: '' }) : undefined} />
        {pay && <PayForm pay={pay} setPay={setPay} onSubmit={doPay} />}
      </>}
      {tab === 'aging' && aging && <>
        <div className="cards"><div className="stat"><div className="v">{fmtMoney(aging.totals.b0_30)}</div><div className="l">0-30 天</div></div><div className="stat"><div className="v">{fmtMoney(aging.totals.b31_60)}</div><div className="l">31-60 天</div></div><div className="stat warn"><div className="v">{fmtMoney(aging.totals.b61_90)}</div><div className="l">61-90 天</div></div><div className="stat warn"><div className="v">{fmtMoney(aging.totals.b90p)}</div><div className="l">90+ 天</div></div><div className="stat"><div className="v">{fmtMoney(aging.totals.total)}</div><div className="l">合计</div></div></div>
        <table><thead><tr><th>代码</th><th>客户</th><th>电话</th><th>0-30</th><th>31-60</th><th>61-90</th><th>90+</th><th>合计</th><th>发票数</th><th>最久（天）</th></tr></thead><tbody>
          {aging.rows.map((r: any) => <tr key={r.customer_id}><td>{r.code}</td><td>{r.name}</td><td>{r.phone ?? ''}</td><td>{fmtMoney(r.b0_30)}</td><td>{fmtMoney(r.b31_60)}</td><td className={Number(r.b61_90) > 0 ? 'err' : ''}>{fmtMoney(r.b61_90)}</td><td className={Number(r.b90p) > 0 ? 'err' : ''}>{fmtMoney(r.b90p)}</td><td><b>{fmtMoney(r.total)}</b></td><td>{r.invoices}</td><td>{r.max_days > 0 ? r.max_days : '—'}</td></tr>)}
          {aging.rows.length === 0 && <tr><td colSpan={10} className="note">没有未付发票</td></tr>}
        </tbody></table>
      </>}
    </div>
  );
}
function InvoiceTable({ rows, showCustomer, onPay }: { rows: any[]; showCustomer?: boolean; onPay?: (inv: any) => void }) {
  return <table data-testid="invoice-table"><thead><tr><th>发票号</th>{showCustomer && <th>客户</th>}<th>开票日</th><th>到期日</th><th>金额</th><th>已付</th><th>未付</th><th>状态</th><th>电子发票</th><th></th></tr></thead><tbody>
    {rows.map((i) => <tr key={i.id}><td>{i.invoice_no}</td>{showCustomer && <td>{i.customer_name}</td>}<td>{String(i.issue_date).slice(0, 10)}</td><td>{String(i.due_date).slice(0, 10)}</td><td>{fmtMoney(i.total)}</td><td>{fmtMoney(i.paid_amount)}</td><td>{fmtMoney(i.outstanding ?? Number(i.total) - Number(i.paid_amount))}</td><td><span className="pill" style={{ background: invColor(i.status) }}>{INV_ZH[i.status] ?? i.status}</span></td><td>{i.einvoice_status ? <span className="pill" style={{ background: pillColor(i.einvoice_status === 'VALID' ? 'OK' : i.einvoice_status) }}>{i.einvoice_status}</span> : <span className="note">—</span>}</td>
      <td style={{ whiteSpace: 'nowrap' }}><button className="btn btn-ghost" onClick={() => downloadRaw(`/invoices/${i.id}/pdf`, `${i.invoice_no}.pdf`)}>PDF</button> {onPay && !['PAID', 'CANCELLED'].includes(i.status) && <button className="btn btn-primary" data-testid={`pay-${i.invoice_no}`} onClick={() => onPay(i)}>收款</button>}</td></tr>)}
    {rows.length === 0 && <tr><td colSpan={10} className="note">没有发票</td></tr>}
  </tbody></table>;
}
function PayForm({ pay, setPay, onSubmit }: { pay: any; setPay: (p: any) => void; onSubmit: () => void }) {
  return <div className="toolbar" style={{ background: '#F3F4F6', padding: 10, borderRadius: 8 }} data-testid="pay-form">
    <b>收款 {pay.invoice.invoice_no}</b><span className="note">未付 RM {fmtMoney(pay.invoice.outstanding ?? Number(pay.invoice.total) - Number(pay.invoice.paid_amount))}</span>
    <input type="number" step="0.01" value={pay.amount} data-testid="pay-amount" onChange={(e) => setPay({ ...pay, amount: e.target.value })} style={{ width: 120 }} />
    <select value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>{['BANK_TRANSFER', 'CASH', 'CHEQUE', 'CARD', 'EWALLET'].map((m) => <option key={m}>{m}</option>)}</select>
    <input placeholder="参考号" value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} style={{ width: 160 }} />
    <button className="btn btn-primary" data-testid="pay-submit" onClick={onSubmit}>确认收款</button><button className="btn btn-ghost" onClick={() => setPay(null)}>取消</button>
  </div>;
}
