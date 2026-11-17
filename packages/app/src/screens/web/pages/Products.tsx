import { useEffect, useState } from 'react';
import { api } from '../../../api/client.js';
import { useAuth } from '../../../store/auth.js';
import { useT } from '../../../i18n/index.js';
import { errText, fmtDate, fmtMoney, fmtQty } from './_util.js';

const empty = { name_zh: '', name_ms: '', name_en: '', category_id: '', unit: 'PCS', plu_code: '', cost_price: '', sell_price: '', tax_code_id: '', min_level: '', reorder_qty: '', reorder_days: '7', default_supplier_id: '', default_location_id: '', shelf_life_days: '', barcode: '', photo_url: '' };
export default function Products() {
  const { has } = useAuth(); const { n } = useT();
  const [rows, setRows] = useState<any[]>([]); const [search, setSearch] = useState(''); const [showAll, setShowAll] = useState(false); const [offset, setOffset] = useState(0);
  const [cats, setCats] = useState<any[]>([]); const [taxes, setTaxes] = useState<any[]>([]); const [sups, setSups] = useState<any[]>([]); const [locs, setLocs] = useState<any[]>([]);
  const [editing, setEditing] = useState<any | null>(null); const [form, setForm] = useState<any>(empty); const [detail, setDetail] = useState<any | null>(null); const [msg, setMsg] = useState(''); const [newBc, setNewBc] = useState({ barcode: '', pack_qty: '1', barcode_type: 'UNIT' });
  const canCost = has('product.view_cost'); const canEdit = has('product.edit');
  const load = async () => { try { setRows(await api(`/products?search=${encodeURIComponent(search)}&limit=100&offset=${offset}${showAll ? '&active=all' : ''}`)); } catch (e) { setMsg(errText(e)); } };
  useEffect(() => { void load(); }, [search, showAll, offset]);
  useEffect(() => { Promise.all([api('/categories'), api('/tax-codes'), api('/suppliers').catch(() => []), api('/locations')]).then(([c, t, s, l]) => { setCats(c); setTaxes(t); setSups(s); setLocs(l); }).catch(() => {}); }, []);
  const openNew = () => { setEditing({}); setForm({ ...empty, tax_code_id: taxes.find((t) => t.is_default)?.id ?? '' }); setDetail(null); };
  const openEdit = async (p: any) => { const d = await api(`/products/${p.id}`); setDetail(d); setEditing(d); setForm({ ...empty, ...Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v ?? ''])) }); };
  const num = (v: any) => (v === '' || v == null ? undefined : Number(v));
  const save = async () => {
    setMsg('');
    const body: any = { name_zh: form.name_zh || null, name_ms: form.name_ms || null, name_en: form.name_en || null, category_id: form.category_id, unit: form.unit, is_weighed: form.unit === 'KG', plu_code: form.plu_code || null, sell_price: num(form.sell_price), tax_code_id: form.tax_code_id || undefined, min_level: num(form.min_level), reorder_qty: num(form.reorder_qty), reorder_days: num(form.reorder_days), default_supplier_id: form.default_supplier_id || null, default_location_id: form.default_location_id || null, shelf_life_days: num(form.shelf_life_days) ?? null, photo_url: form.photo_url || null };
    if (canCost && has('cost.edit')) body.cost_price = num(form.cost_price);
    try {
      if (editing?.id) { await api(`/products/${editing.id}`, { method: 'PUT', body }); setMsg('已保存'); }
      else { if (form.barcode) body.barcode = form.barcode; const r = await api('/products', { body }); setMsg(`已新建 ${r.sku}`); }
      setEditing(null); await load();
    } catch (e) { setMsg(errText(e)); }
  };
  const toggleActive = async (p: any) => { if (!window.confirm(`${p.is_active ? '停用' : '启用'} ${n(p)}？`)) return; try { await api(`/products/${p.id}`, { method: 'PUT', body: { is_active: !p.is_active } }); await load(); } catch (e) { setMsg(errText(e)); } };
  const addBarcode = async () => { try { await api(`/products/${editing.id}/barcodes`, { body: { barcode: newBc.barcode, pack_qty: Number(newBc.pack_qty) || 1, barcode_type: newBc.barcode_type } }); setNewBc({ barcode: '', pack_qty: '1', barcode_type: 'UNIT' }); await openEdit(editing); } catch (e) { setMsg(errText(e)); } };
  const delBarcode = async (b: any) => { if (!window.confirm(`删除条码 ${b.barcode}？`)) return; try { await api(`/products/${editing.id}/barcodes/${b.id}`, { method: 'DELETE' }); await openEdit(editing); } catch (e) { setMsg(errText(e)); } };
  const F = (k: string, label: string, type = 'text', extra: any = {}) => <label>{label}<input type={type} value={form[k] ?? ''} onChange={(e) => setForm({ ...form, [k]: e.target.value })} {...extra} /></label>;
  return (
    <div>
      <h1>产品管理</h1>
      <div className="toolbar">
        <input placeholder="搜索名称、拼音、条码、货号" value={search} onChange={(e) => { setOffset(0); setSearch(e.target.value); }} style={{ width: 320 }} />
        <label><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} style={{ width: 'auto', minHeight: 0 }} /> 含停用</label>
        {canEdit && <button className="btn btn-primary" onClick={openNew}>+ 新建产品</button>}
        <span className="note">{msg}</span>
      </div>
      {editing && (
        <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 10, padding: 16, marginBottom: 16 }}>
          <h2>{editing.id ? `编辑 ${editing.sku}` : '新建产品'}</h2>
          <div className="form">
            {F('name_zh', '中文名')}{F('name_ms', '马来文名')}{F('name_en', '英文名')}
            <label>类别<select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}><option value="">请选</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name_zh ?? c.code}</option>)}</select></label>
            <label>单位<select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}><option value="PCS">件</option><option value="KG">公斤（称重）</option></select></label>
            {form.unit === 'KG' && F('plu_code', '称重 PLU（5 位）', 'text', { maxLength: 5 })}
            {canCost && F('cost_price', '成本价', 'number', { step: '0.01', disabled: !has('cost.edit') })}
            {F('sell_price', '售价', 'number', { step: '0.01', disabled: !!editing.id && !has('price.edit') })}
            <label>税码<select value={form.tax_code_id} onChange={(e) => setForm({ ...form, tax_code_id: e.target.value })}>{taxes.map((t) => <option key={t.id} value={t.id}>{t.code} ({Number(t.rate)}%)</option>)}</select></label>
            {F('min_level', '最低量', 'number', { disabled: !!editing.id && !has('minlevel.edit') })}{F('reorder_qty', '补货量', 'number', { disabled: !!editing.id && !has('minlevel.edit') })}{F('reorder_days', '补货天数', 'number')}
            <label>默认供应商<select value={form.default_supplier_id} onChange={(e) => setForm({ ...form, default_supplier_id: e.target.value })}><option value="">无</option>{sups.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
            <label>默认后仓位置<select value={form.default_location_id} onChange={(e) => setForm({ ...form, default_location_id: e.target.value })}><option value="">无</option>{locs.filter((l) => !l.is_virtual).map((l) => <option key={l.id} value={l.id}>{l.code}</option>)}</select></label>
            {F('shelf_life_days', '保质期天数', 'number')}{F('photo_url', '照片 URL')}
            {!editing.id && F('barcode', '主条码（8 到 14 位）')}
          </div>
          <div className="toolbar" style={{ marginTop: 12 }}><button className="btn btn-primary" onClick={save} disabled={!form.category_id || !form.sell_price || form.min_level === '' || form.reorder_qty === ''}>保存</button><button className="btn btn-ghost" onClick={() => setEditing(null)}>取消</button></div>
          {detail && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
              <div>
                <h2>条码</h2>
                <table><thead><tr><th>条码</th><th>类型</th><th>换算</th><th></th></tr></thead><tbody>
                  {detail.barcodes.map((b: any) => <tr key={b.id}><td>{b.barcode}{b.is_primary && ' ★'}</td><td>{b.barcode_type}</td><td>{fmtQty(b.pack_qty)}</td><td>{!b.is_primary && canEdit && <button className="btn btn-ghost" onClick={() => delBarcode(b)}>删</button>}</td></tr>)}
                </tbody></table>
                {has('barcode.add') && <div className="toolbar" style={{ marginTop: 8 }}><input placeholder="新条码" value={newBc.barcode} onChange={(e) => setNewBc({ ...newBc, barcode: e.target.value })} /><select value={newBc.barcode_type} onChange={(e) => setNewBc({ ...newBc, barcode_type: e.target.value })}><option value="UNIT">单件</option><option value="CASE">箱</option></select>{newBc.barcode_type === 'CASE' && <input type="number" placeholder="每箱数量" value={newBc.pack_qty} onChange={(e) => setNewBc({ ...newBc, pack_qty: e.target.value })} style={{ width: 100 }} />}<button className="btn btn-ghost" onClick={addBarcode} disabled={!/^[0-9]{8,14}$/.test(newBc.barcode)}>加条码</button></div>}
              </div>
              <div>
                <h2>价格历史</h2>
                <table><thead><tr><th>时间</th>{canCost && <th>成本</th>}<th>售价</th><th>来源</th></tr></thead><tbody>
                  {detail.price_history.map((h: any, i: number) => <tr key={i}><td>{fmtDate(h.effective_from)}</td>{canCost && <td>{fmtMoney(h.cost_price)}</td>}<td>{fmtMoney(h.sell_price)}</td><td>{h.source}</td></tr>)}
                </tbody></table>
              </div>
            </div>
          )}
        </div>
      )}
      <table>
        <thead><tr><th>货号</th><th>主条码</th><th>名称</th><th>类别</th><th>单位</th>{canCost && <th>成本</th>}<th>售价</th><th>最低量</th><th>总库存</th><th>状态</th><th></th></tr></thead>
        <tbody>
          {rows.map((p) => <tr key={p.id} style={{ opacity: p.is_active ? 1 : 0.5 }}>
            <td>{p.sku}</td><td>{p.barcode ?? '—'}</td><td>{n(p)}</td><td>{cats.find((c) => c.id === p.category_id)?.name_zh ?? ''}</td><td>{p.unit === 'KG' ? '公斤' : '件'}</td>{canCost && <td>{fmtMoney(p.cost_price)}</td>}<td>{fmtMoney(p.sell_price)}</td><td>{fmtQty(p.min_level)}</td><td>{fmtQty(p.total_qty)}</td>
            <td>{p.is_active ? <span className="ok">启用</span> : <span className="err">停用</span>}</td>
            <td style={{ whiteSpace: 'nowrap' }}>{canEdit && <><button className="btn btn-ghost" onClick={() => openEdit(p)}>编辑</button> <button className="btn btn-ghost" onClick={() => toggleActive(p)}>{p.is_active ? '停用' : '启用'}</button></>}</td>
          </tr>)}
          {rows.length === 0 && <tr><td colSpan={11} className="note">没有产品</td></tr>}
        </tbody>
      </table>
      <div className="toolbar" style={{ marginTop: 10 }}><button className="btn btn-ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 100))}>上一页</button><button className="btn btn-ghost" disabled={rows.length < 100} onClick={() => setOffset(offset + 100)}>下一页</button><span className="note">每页 100</span></div>
    </div>
  );
}
