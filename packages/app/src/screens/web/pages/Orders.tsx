// 网页 B1：订货建议预审（改数量、换供应商、删行、备注、送审 / 老板直接批）+ 采购单列表 / 详情 / PDF / Excel / 发送 / 取消 + 手动新 PO
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../../api/client.js';
import { useT } from '../../../i18n/index.js';
import { useAuth } from '../../../store/auth.js';
import { downloadRaw, errText, fmtDate, fmtMoney, fmtQty, pillColor } from './_util.js';

const PST: Record<string, string> = { PENDING_REVIEW: '待预审', PENDING_APPROVAL: '待老板审批', APPROVED: '已批准', REJECTED: '已拒绝', RETURNED: '已退回' };
const POST: Record<string, string> = { DRAFT: '草稿', PENDING_APPROVAL: '待审批', SENT: '已发出', PARTIAL: '部分收货', RECEIVED: '已收齐', CLOSED: '已关闭', CANCELLED: '已取消' };
const pc = (s: string) => (['APPROVED', 'RECEIVED', 'SENT'].includes(s) ? '#1B8A3A' : s === 'PARTIAL' ? '#1565C0' : pillColor(s));
const Pill = ({ s, map }: { s: string; map: Record<string, string> }) => <span className="pill" style={{ background: pc(s) }}>{map[s] ?? s}</span>;

export default function Orders() {
  const { n } = useT(); const { has, me } = useAuth();
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get('tab') as 'proposals' | 'pos' | 'new') ?? 'proposals';
  const setTab = (t: string) => { const q = new URLSearchParams(sp); q.set('tab', t); q.delete('id'); setSp(q); };
  const [msg, setMsg] = useState(''); const [ok, setOk] = useState('');
  const canReview = has('order.review') || has('order.approve'); const canApprove = has('order.approve'); const canCost = has('product.view_cost');
  const flash = (s: string) => { setOk(s); setMsg(''); setTimeout(() => setOk(''), 4000); };
  const fail = (e: any) => { setMsg(errText(e)); setOk(''); };

  // ---------- 建议 ----------
  const [props, setProps] = useState<any[]>([]); const [pst, setPst] = useState('PENDING_REVIEW,PENDING_APPROVAL,RETURNED'); const [prop, setProp] = useState<any>(null); const [suppliers, setSuppliers] = useState<any[]>([]); const [note, setNote] = useState('');
  const loadProps = () => api(`/order-proposals?status=${pst}`).then(setProps).catch(fail);
  useEffect(() => { if (tab === 'proposals') void loadProps(); }, [tab, pst]);
  useEffect(() => { api('/suppliers').then(setSuppliers).catch(() => {}); }, []);
  const openProp = async (id: string) => { try { const d = await api(`/order-proposals/${id}`); setProp(d); setNote(d.note ?? ''); } catch (e) { fail(e); } };
  useEffect(() => { const id = sp.get('id'); if (tab === 'proposals' && id) void openProp(id); }, [tab, sp.get('id')]);
  const editable = prop && ['PENDING_REVIEW', 'RETURNED'].includes(prop.status) && canReview || prop?.status === 'PENDING_APPROVAL' && canApprove;
  const patchLine = async (l: any, patch: any) => { try { setProp(await api(`/order-proposals/${prop.id}/lines`, { method: 'PUT', body: { lines: [{ id: l.id, ...patch }] } })); } catch (e) { fail(e); } };
  const saveNote = async () => { try { setProp(await api(`/order-proposals/${prop.id}/lines`, { method: 'PUT', body: { note, lines: [] } })); flash('备注已保存'); } catch (e) { fail(e); } };
  const submit = async () => { try { setProp(await api(`/order-proposals/${prop.id}/submit`, { body: {} })); flash('已送老板审批，Telegram 已通知'); void loadProps(); } catch (e) { fail(e); } };
  const decide = async (decision: string) => { const note2 = decision === 'approve' ? undefined : prompt('备注（可空）') ?? undefined; try { const r = await api(`/order-proposals/${prop.id}/approve`, { body: { decision, note: note2 } }); setProp(r); flash(decision === 'approve' ? `已批准，生成 ${r.purchase_orders.length} 张采购单` : decision === 'reject' ? '已拒绝' : '已退回采购员'); void loadProps(); } catch (e) { fail(e); } };
  const generate = async () => { try { const r = await api('/order-proposals/generate', { body: {} }); if (!r.proposal) { flash('没有低于最低量的产品'); return; } await loadProps(); await openProp(r.proposal.id); } catch (e) { fail(e); } };
  const groupBySupplier = (lines: any[]) => { const g = new Map<string, any[]>(); for (const l of lines) { const k = l.supplier_name ?? '未指定供应商'; if (!g.has(k)) g.set(k, []); g.get(k)!.push(l); } return [...g.entries()]; };

  // ---------- PO ----------
  const [pos, setPos] = useState<any[]>([]); const [poSt, setPoSt] = useState(''); const [poSup, setPoSup] = useState(''); const [po, setPo] = useState<any>(null);
  const loadPos = () => api(`/purchase-orders?${poSt ? `status=${poSt}&` : ''}${poSup ? `supplier=${poSup}` : ''}`).then(setPos).catch(fail);
  useEffect(() => { if (tab === 'pos') void loadPos(); }, [tab, poSt, poSup]);
  const openPo = async (id: string) => { try { setPo(await api(`/purchase-orders/${id}`)); } catch (e) { fail(e); } };
  useEffect(() => { const id = sp.get('id'); if (tab === 'pos' && id) void openPo(id); }, [tab, sp.get('id')]);
  const sendPo = async (via: string) => { try { setPo(await api(`/purchase-orders/${po.id}/send`, { body: { via } })); flash(`已记录发送（${via}）`); void loadPos(); } catch (e) { fail(e); } };
  const cancelPo = async () => { if (!confirm(`取消 ${po.po_no}？`)) return; try { setPo(await api(`/purchase-orders/${po.id}/cancel`, { body: {} })); flash('已取消'); void loadPos(); } catch (e) { fail(e); } };
  const approvePo = async (decision: string) => { try { setPo(await api(`/purchase-orders/${po.id}/approve`, { body: { decision } })); flash(decision === 'approve' ? '已批准并发出' : '已拒绝'); void loadPos(); } catch (e) { fail(e); } };

  // ---------- 新 PO ----------
  const [sites, setSites] = useState<any[]>([]); const [nf, setNf] = useState<{ supplier_id: string; deliver_to_site_id: string; expected_date: string; note: string }>({ supplier_id: '', deliver_to_site_id: '', expected_date: '', note: '' });
  const [nl, setNl] = useState<{ product: any; qty: number; unit_cost: number }[]>([]); const [q, setQ] = useState(''); const [cands, setCands] = useState<any[]>([]); const [saving, setSaving] = useState(false);
  useEffect(() => { if (tab === 'new') { api('/sites').then(setSites).catch(() => {}); if (!nf.deliver_to_site_id && me?.site) setNf((f) => ({ ...f, deliver_to_site_id: me.site!.id })); } }, [tab]);
  useEffect(() => { if (tab !== 'new' || q.length < 1) { setCands([]); return; } const h = setTimeout(() => api(`/products?search=${encodeURIComponent(q)}&limit=10`).then(setCands).catch(() => {}), 250); return () => clearTimeout(h); }, [q, tab]);
  const addCand = (p: any) => { setCands([]); setQ(''); if (nl.some((l) => l.product.id === p.id)) return; setNl([...nl, { product: p, qty: Number(p.reorder_qty) || 1, unit_cost: Number(p.cost_price ?? 0) }]); if (!nf.supplier_id && p.default_supplier_id) setNf({ ...nf, supplier_id: p.default_supplier_id }); };
  const createPo = async () => {
    if (!nf.supplier_id || !nl.length) { setMsg('请选供应商并至少加一行产品'); return; } setSaving(true);
    try {
      const r = await api('/purchase-orders', { body: { supplier_id: nf.supplier_id, deliver_to_site_id: nf.deliver_to_site_id || null, expected_date: nf.expected_date || null, note: nf.note || null, lines: nl.map((l) => ({ product_id: l.product.id, qty: l.qty, unit_cost: canCost ? l.unit_cost : undefined })) } });
      setNl([]); setNf({ supplier_id: '', deliver_to_site_id: nf.deliver_to_site_id, expected_date: '', note: '' }); flash(`已建采购单 ${r.po_no}（${POST[r.status] ?? r.status}）`);
      const qq = new URLSearchParams(sp); qq.set('tab', 'pos'); qq.set('id', r.id); setSp(qq);
    } catch (e) { fail(e); } finally { setSaving(false); }
  };
  const total = nl.reduce((a, l) => a + l.qty * l.unit_cost, 0);

  return (
    <div data-testid="orders-page">
      <h1>订货与采购单</h1>
      <div className="tabs">
        <button className={tab === 'proposals' ? 'active' : ''} onClick={() => setTab('proposals')} data-testid="tab-proposals">订货建议</button>
        <button className={tab === 'pos' ? 'active' : ''} onClick={() => setTab('pos')} data-testid="tab-pos">采购单</button>
        {(has('po.create') || canApprove) && <button className={tab === 'new' ? 'active' : ''} onClick={() => setTab('new')} data-testid="tab-new">新采购单</button>}
      </div>
      {msg && <div className="err">{msg}</div>}{ok && <div className="note" style={{ color: '#1B8A3A', fontWeight: 600 }}>{ok}</div>}

      {tab === 'proposals' && (
        <div>
          <div className="toolbar">
            <select value={pst} onChange={(e) => setPst(e.target.value)}><option value="PENDING_REVIEW,PENDING_APPROVAL,RETURNED">未完成</option><option value="PENDING_REVIEW">待预审</option><option value="PENDING_APPROVAL">待老板审批</option><option value="APPROVED">已批准</option><option value="REJECTED,RETURNED">已拒绝 / 退回</option></select>
            {canReview && <button className="btn" onClick={generate}>现在生成建议</button>}
          </div>
          <table><thead><tr><th>日期</th><th>来源</th><th>状态</th><th>行数</th>{canCost && <th>金额</th>}<th>PO</th><th>预审人</th></tr></thead><tbody>
            {props.map((p) => <tr key={p.id} onClick={() => { const qq = new URLSearchParams(sp); qq.set('id', p.id); setSp(qq); }} style={{ cursor: 'pointer', fontWeight: prop?.id === p.id ? 600 : 400 }}><td>{String(p.proposal_date).slice(0, 10)}</td><td>{p.source === 'AUTO' ? '自动' : '手动'}</td><td><Pill s={p.status} map={PST} /></td><td>{p.line_count}</td>{canCost && <td>{fmtMoney(p.total_amount)}</td>}<td>{p.po_count}</td><td>{p.reviewed_by_name ?? '—'}</td></tr>)}
            {props.length === 0 && <tr><td colSpan={7} className="note">没有建议</td></tr>}
          </tbody></table>
          {prop && (
            <div style={{ marginTop: 16 }}>
              <h2>{String(prop.proposal_date).slice(0, 10)} 建议 · <Pill s={prop.status} map={PST} /> · {prop.line_count} 项{canCost && ` · 合计 RM ${fmtMoney(prop.total_amount)}`}</h2>
              {groupBySupplier(prop.lines).map(([sup, ls]) => (
                <div key={sup}>
                  <h3 style={{ margin: '12px 0 4px' }}>{sup}{canCost && ` · RM ${fmtMoney(ls.filter((l: any) => !l.is_removed).reduce((a: number, l: any) => a + Number(l.amount ?? 0), 0))}`}{ls[0]?.min_order_amount > 0 && ` · 起订 RM ${fmtMoney(ls[0].min_order_amount)}`}</h3>
                  <table><thead><tr><th>货号</th><th>产品</th><th>现有</th><th>最低</th><th>日均销量</th><th>建议</th><th>最终数量</th>{canCost && <th>单价</th>}{canCost && <th>金额</th>}<th>供应商</th><th>备注</th><th></th></tr></thead><tbody>
                    {ls.map((l: any) => (
                      <tr key={l.id} style={{ opacity: l.is_removed ? 0.45 : 1, textDecoration: l.is_removed ? 'line-through' : 'none' }}>
                        <td>{l.sku}</td><td>{n(l)}{l.case_qty > 1 && <span className="note"> 箱规 {fmtQty(l.case_qty)}</span>}</td><td>{fmtQty(l.current_qty)}</td><td>{fmtQty(l.min_level)}</td><td>{fmtQty(l.avg_daily_sales)}</td><td>{fmtQty(l.suggested_qty)}</td>
                        <td>{editable ? <input type="number" min={0} defaultValue={Number(l.final_qty)} style={{ width: 90 }} onBlur={(e) => Number(e.target.value) !== Number(l.final_qty) && patchLine(l, { final_qty: Number(e.target.value) })} data-testid="final-qty" /> : fmtQty(l.final_qty)}</td>
                        {canCost && <td>{fmtMoney(l.unit_cost)}</td>}{canCost && <td>{fmtMoney(l.amount)}</td>}
                        <td>{editable ? <select value={l.supplier_id ?? ''} onChange={(e) => patchLine(l, { supplier_id: e.target.value || null })}><option value="">未指定</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select> : (l.supplier_name ?? '—')}</td>
                        <td>{editable ? <input defaultValue={l.note ?? ''} style={{ width: 120 }} onBlur={(e) => e.target.value !== (l.note ?? '') && patchLine(l, { note: e.target.value })} /> : (l.note ?? '')}</td>
                        <td>{editable && <button className="btn" onClick={() => patchLine(l, { is_removed: !l.is_removed })}>{l.is_removed ? '恢复' : '删'}</button>}</td>
                      </tr>
                    ))}
                  </tbody></table>
                </div>
              ))}
              {editable && <div className="toolbar" style={{ marginTop: 12 }}><input placeholder="给老板的备注" value={note} onChange={(e) => setNote(e.target.value)} style={{ width: 360 }} /><button className="btn" onClick={saveNote}>保存备注</button></div>}
              {!editable && prop.note && <p className="note">备注：{prop.note}</p>}
              <div className="toolbar" style={{ marginTop: 12 }}>
                {['PENDING_REVIEW', 'RETURNED'].includes(prop.status) && canReview && !canApprove && <button className="btn btn-primary" onClick={submit} data-testid="submit-proposal">送老板审批</button>}
                {['PENDING_REVIEW', 'PENDING_APPROVAL', 'RETURNED'].includes(prop.status) && canApprove && <><button className="btn btn-primary" onClick={() => decide('approve')} data-testid="approve-proposal">批准并生成采购单</button><button className="btn" onClick={() => decide('return')}>退回采购员</button><button className="btn" onClick={() => decide('reject')}>拒绝</button></>}
              </div>
              {prop.purchase_orders?.length > 0 && <><h3>生成的采购单</h3><table><thead><tr><th>PO</th><th>状态</th>{canCost && <th>金额</th>}<th>文件</th></tr></thead><tbody>{prop.purchase_orders.map((p: any) => <tr key={p.id}><td><a href="#" onClick={(e) => { e.preventDefault(); const qq = new URLSearchParams(sp); qq.set('tab', 'pos'); qq.set('id', p.id); setSp(qq); }}>{p.po_no}</a></td><td><Pill s={p.status} map={POST} /></td>{canCost && <td>{fmtMoney(p.total_amount)}</td>}<td>{p.pdf_url && <a href={p.pdf_url} target="_blank" rel="noreferrer">PDF</a>} {p.xlsx_url && <a href={p.xlsx_url}>Excel</a>}</td></tr>)}</tbody></table></>}
            </div>
          )}
        </div>
      )}

      {tab === 'pos' && (
        <div>
          <div className="toolbar">
            <select value={poSt} onChange={(e) => setPoSt(e.target.value)}><option value="">全部状态</option>{Object.entries(POST).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            <select value={poSup} onChange={(e) => setPoSup(e.target.value)}><option value="">全部供应商</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          </div>
          <table data-testid="po-table"><thead><tr><th>PO 号</th><th>供应商</th><th>送到</th><th>状态</th><th>行数</th><th>已收/订</th>{canCost && <th>金额</th>}<th>预计到货</th><th>发送</th><th>建立</th></tr></thead><tbody>
            {pos.map((p) => <tr key={p.id} onClick={() => { const qq = new URLSearchParams(sp); qq.set('id', p.id); setSp(qq); }} style={{ cursor: 'pointer', fontWeight: po?.id === p.id ? 600 : 400 }}><td>{p.po_no}</td><td>{p.supplier_name}</td><td>{p.site_code ?? '—'}</td><td><Pill s={p.status} map={POST} /></td><td>{p.line_count}</td><td>{fmtQty(p.received_total)} / {fmtQty(p.ordered_total)}</td>{canCost && <td>{fmtMoney(p.total_amount)}</td>}<td>{p.expected_date ? String(p.expected_date).slice(0, 10) : '—'}</td><td>{p.sent_via ? `${p.sent_via} ${fmtDate(p.sent_at)}` : '—'}</td><td>{fmtDate(p.created_at)}</td></tr>)}
            {pos.length === 0 && <tr><td colSpan={10} className="note">没有采购单</td></tr>}
          </tbody></table>
          {po && (
            <div style={{ marginTop: 16 }} data-testid="po-detail">
              <h2>{po.po_no} · {po.supplier_name} · <Pill s={po.status} map={POST} />{canCost && ` · RM ${fmtMoney(po.total_amount)}`}</h2>
              <p className="note">送到 {po.site_code ?? '—'} · 预计到货 {po.expected_date ? String(po.expected_date).slice(0, 10) : '—'} · 建立 {fmtDate(po.created_at)}{po.sent_at && ` · 发送 ${po.sent_via} ${fmtDate(po.sent_at)}`}{po.note && ` · 备注 ${po.note}`}{po.approval && ` · 审批 ${po.approval.status}`}</p>
              <div className="toolbar">
                {has('po.view') && <><button className="btn" onClick={() => downloadRaw(`/purchase-orders/${po.id}/pdf`, `${po.po_no}.pdf`).catch(fail)} data-testid="po-pdf">PDF</button><button className="btn" onClick={() => downloadRaw(`/purchase-orders/${po.id}/xlsx`, `${po.po_no}.xlsx`).catch(fail)}>Excel</button></>}
                {(has('po.send') || canApprove) && !['CANCELLED', 'PENDING_APPROVAL'].includes(po.status) && <><button className="btn" onClick={() => sendPo('TELEGRAM')}>发 Telegram</button><button className="btn" onClick={() => sendPo('EMAIL')}>记为已电邮</button><button className="btn" onClick={() => sendPo('WHATSAPP')}>记为已 WhatsApp</button></>}
                {po.status === 'PENDING_APPROVAL' && canApprove && <><button className="btn btn-primary" onClick={() => approvePo('approve')}>批准并发出</button><button className="btn" onClick={() => approvePo('reject')}>拒绝</button></>}
                {(has('po.cancel') || canApprove) && ['DRAFT', 'PENDING_APPROVAL', 'SENT'].includes(po.status) && Number(po.received_total) === 0 && <button className="btn" onClick={cancelPo} data-testid="po-cancel">取消采购单</button>}
              </div>
              <table><thead><tr><th>#</th><th>货号</th><th>条码</th><th>产品</th><th>单位</th><th>订购</th><th>已收</th><th>损坏</th>{canCost && <th>单价</th>}{canCost && <th>金额</th>}</tr></thead><tbody>
                {po.lines.map((l: any) => <tr key={l.id}><td>{l.line_no}</td><td>{l.sku}</td><td>{l.barcode}</td><td>{n(l)}</td><td>{l.unit}</td><td>{fmtQty(l.ordered_qty)}</td><td style={{ color: Number(l.received_qty) >= Number(l.ordered_qty) ? '#1B8A3A' : Number(l.received_qty) > 0 ? '#F9A825' : undefined }}>{fmtQty(l.received_qty)}</td><td>{Number(l.damaged_qty) ? fmtQty(l.damaged_qty) : ''}</td>{canCost && <td>{fmtMoney(l.unit_cost)}</td>}{canCost && <td>{fmtMoney(l.amount)}</td>}</tr>)}
              </tbody></table>
              {po.receipts?.length > 0 && <><h3>收货记录</h3><table><thead><tr><th>GRN</th><th>状态</th><th>收货人</th><th>开始</th><th>完成</th><th>少</th><th>多</th><th>损坏</th></tr></thead><tbody>{po.receipts.map((g: any) => <tr key={g.id}><td>{g.grn_no}</td><td>{g.status}</td><td>{g.received_by_name}</td><td>{fmtDate(g.started_at)}</td><td>{fmtDate(g.completed_at)}</td><td>{g.short_count}</td><td>{g.over_count}</td><td>{g.damaged_count}</td></tr>)}</tbody></table></>}
            </div>
          )}
        </div>
      )}

      {tab === 'new' && (
        <div>
          <div className="form" style={{ maxWidth: 900 }}>
            <label>供应商<select value={nf.supplier_id} onChange={(e) => setNf({ ...nf, supplier_id: e.target.value })} data-testid="new-supplier"><option value="">选供应商</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
            <label>送到站点<select value={nf.deliver_to_site_id} onChange={(e) => setNf({ ...nf, deliver_to_site_id: e.target.value })}><option value="">—</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.code} {s.name}</option>)}</select></label>
            <label>预计到货<input type="date" value={nf.expected_date} onChange={(e) => setNf({ ...nf, expected_date: e.target.value })} /></label>
            <label>备注<input value={nf.note} onChange={(e) => setNf({ ...nf, note: e.target.value })} /></label>
          </div>
          <div className="toolbar" style={{ position: 'relative' }}>
            <input placeholder="搜产品（名称、拼音、条码）" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 360 }} data-testid="new-search" />
            {cands.length > 0 && <table style={{ position: 'absolute', top: 44, left: 0, zIndex: 5, background: '#fff', maxWidth: 700, boxShadow: '0 6px 20px rgba(0,0,0,.15)' }}><tbody>{cands.map((p) => <tr key={p.id} onClick={() => addCand(p)} style={{ cursor: 'pointer' }} data-testid="new-cand"><td>{p.sku}</td><td>{p.barcode}</td><td>{n(p)}</td><td>库存 {fmtQty(p.total_qty)}</td>{canCost && <td>成本 {fmtMoney(p.cost_price)}</td>}</tr>)}</tbody></table>}
          </div>
          <table data-testid="new-lines"><thead><tr><th>货号</th><th>产品</th><th>数量</th>{canCost && <th>单价</th>}{canCost && <th>金额</th>}<th></th></tr></thead><tbody>
            {nl.map((l, i) => <tr key={l.product.id}><td>{l.product.sku}</td><td>{n(l.product)}</td><td><input type="number" min={1} value={l.qty} style={{ width: 90 }} onChange={(e) => { const c = [...nl]; c[i] = { ...l, qty: Number(e.target.value) }; setNl(c); }} data-testid="new-qty" /></td>{canCost && <td><input type="number" min={0} step="0.01" value={l.unit_cost} style={{ width: 90 }} onChange={(e) => { const c = [...nl]; c[i] = { ...l, unit_cost: Number(e.target.value) }; setNl(c); }} /></td>}{canCost && <td>{fmtMoney(l.qty * l.unit_cost)}</td>}<td><button className="btn" onClick={() => setNl(nl.filter((_, j) => j !== i))}>删</button></td></tr>)}
            {nl.length === 0 && <tr><td colSpan={6} className="note">搜产品加到采购单</td></tr>}
          </tbody></table>
          <div className="toolbar" style={{ marginTop: 12 }}>
            {canCost && <span>合计 RM {fmtMoney(total)}</span>}
            <button className="btn btn-primary" disabled={saving || !nl.length || !nf.supplier_id} onClick={createPo} data-testid="create-po">{canApprove ? '建立并发出' : '建立并送审'}</button>
          </div>
        </div>
      )}
    </div>
  );
}
