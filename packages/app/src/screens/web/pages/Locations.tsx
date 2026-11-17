import { useEffect, useState } from 'react';
import { api } from '../../../api/client.js';
import { useAuth } from '../../../store/auth.js';
import { downloadRaw, errText, fmtDate, ZONE_TYPE_ZH } from './_util.js';

const emptyZone = { site_id: '', code: '', name_zh: '', zone_type: 'STORAGE', color: '#1565C0', allowed_category_ids: [] as string[], racks: 6, levels: 4, allowed_is_hard: false };
export default function Locations() {
  const { me, has } = useAuth();
  const [sites, setSites] = useState<any[]>([]); const [siteId, setSiteId] = useState(''); const [zones, setZones] = useState<any[]>([]); const [cats, setCats] = useState<any[]>([]);
  const [sel, setSel] = useState<any | null>(null); const [locs, setLocs] = useState<any[]>([]); const [msg, setMsg] = useState(''); const [editZone, setEditZone] = useState<any | null>(null); const [newSite, setNewSite] = useState<any | null>(null);
  const canManage = has('location.manage');
  const loadZones = async (sid: string) => { try { setZones(await api(`/zones?site=${sid}`)); } catch (e) { setMsg(errText(e)); } };
  useEffect(() => { api('/sites').then((s) => { setSites(s); const first = me?.site?.id ?? s[0]?.id ?? ''; setSiteId(first); }).catch((e) => setMsg(errText(e))); api('/categories').then(setCats).catch(() => {}); }, []);
  useEffect(() => { if (siteId) void loadZones(siteId); }, [siteId]);
  const openZone = async (z: any) => { setSel(z); try { setLocs(await api(`/locations?zone=${z.id}`)); } catch (e) { setMsg(errText(e)); } };
  const labels = async (z: any) => { try { await downloadRaw('/locations/labels', `labels-${z.code}.pdf`, { method: 'POST', body: { zone_id: z.id, size: z.zone_type === 'BACKROOM' ? '100x50' : '70x40' } }); if (sel?.id === z.id) await openZone(z); } catch (e) { setMsg(errText(e)); } };
  const saveZone = async () => {
    setMsg('');
    try {
      if (editZone.id) await api(`/zones/${editZone.id}`, { method: 'PUT', body: { name_zh: editZone.name_zh, color: editZone.color, allowed_is_hard: editZone.allowed_is_hard, allowed_category_ids: editZone.allowed_category_ids, racks: Number(editZone.racks), levels: Number(editZone.levels) } });
      else await api('/zones', { body: { ...editZone, site_id: siteId, racks: Number(editZone.racks), levels: Number(editZone.levels) } });
      setEditZone(null); await loadZones(siteId); if (sel) await openZone(sel);
      setMsg('已保存');
    } catch (e: any) { setMsg(e?.code === 'LOCATION_HAS_STOCK' ? `货位 ${editZone.code}-${String(e.body?.detail?.rack).padStart(2, '0')}-${e.body?.detail?.level} 里还有库存，不能删。请先把货移走。` : errText(e)); }
  };
  const startEdit = async (z: any) => {
    try { const ls: any[] = await api(`/locations?zone=${z.id}`); setEditZone({ ...z, racks: Math.max(1, ...ls.map((l) => Number(l.rack) || 0)), levels: Math.max(1, ...ls.map((l) => Number(l.level) || 0)), allowed_category_ids: z.allowed_category_ids ?? [] }); } catch (e) { setMsg(errText(e)); }
  };
  const saveSite = async () => { try { await api('/sites', { body: newSite }); setNewSite(null); setSites(await api('/sites')); setMsg('站点已建'); } catch (e) { setMsg(errText(e)); } };
  const toggleCat = (id: string) => setEditZone({ ...editZone, allowed_category_ids: editZone.allowed_category_ids.includes(id) ? editZone.allowed_category_ids.filter((x: string) => x !== id) : [...editZone.allowed_category_ids, id] });
  return (
    <div>
      <h1>位置和区管理</h1>
      <div className="toolbar">
        <select value={siteId} onChange={(e) => { setSiteId(e.target.value); setSel(null); }}>{sites.map((s) => <option key={s.id} value={s.id}>{s.code} {s.name} ({s.type === 'SHOP' ? '店' : '仓库'})</option>)}</select>
        {canManage && me?.company.plan === 'B' && <button className="btn btn-ghost" onClick={() => setNewSite({ code: '', name: '', type: 'SHOP' })}>+ 新站点</button>}
        {canManage && me?.company.plan === 'B' && <button className="btn btn-primary" onClick={() => setEditZone({ ...emptyZone, site_id: siteId })}>+ 新区</button>}
        <span className={msg.includes('不能') || msg.includes('错') ? 'err' : 'note'}>{msg}</span>
      </div>
      {me?.company.plan === 'A' && <div className="note" style={{ marginBottom: 10 }}>A 模式的区由模板固定，可以改每个区的架数、层数、颜色和允许类别，不能加区删区。</div>}
      {newSite && <div className="form" style={{ marginBottom: 14 }}><label>代码（2-10 位大写）<input value={newSite.code} onChange={(e) => setNewSite({ ...newSite, code: e.target.value.toUpperCase() })} /></label><label>名称<input value={newSite.name} onChange={(e) => setNewSite({ ...newSite, name: e.target.value })} /></label><label>类型<select value={newSite.type} onChange={(e) => setNewSite({ ...newSite, type: e.target.value })}><option value="SHOP">商店</option><option value="WAREHOUSE">仓库</option></select></label><label>&nbsp;<span><button className="btn btn-primary" onClick={saveSite}>建立</button> <button className="btn btn-ghost" onClick={() => setNewSite(null)}>取消</button></span></label></div>}
      {editZone && (
        <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 10, padding: 16, marginBottom: 16 }}>
          <h2>{editZone.id ? `编辑区 ${editZone.code}` : '新区'}</h2>
          <div className="form">
            {!editZone.id && <label>区代码（1-3 位）<input value={editZone.code} onChange={(e) => setEditZone({ ...editZone, code: e.target.value.toUpperCase() })} maxLength={3} /></label>}
            <label>名称<input value={editZone.name_zh ?? ''} onChange={(e) => setEditZone({ ...editZone, name_zh: e.target.value })} /></label>
            {!editZone.id && <label>类型<select value={editZone.zone_type} onChange={(e) => setEditZone({ ...editZone, zone_type: e.target.value })}>{Object.entries(ZONE_TYPE_ZH).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>}
            <label>颜色<input type="color" value={editZone.color} onChange={(e) => setEditZone({ ...editZone, color: e.target.value })} /></label>
            <label>架数（1-99）<input type="number" min={1} max={99} value={editZone.racks} onChange={(e) => setEditZone({ ...editZone, racks: e.target.value })} /></label>
            <label>层数（1-9）<input type="number" min={1} max={9} value={editZone.levels} onChange={(e) => setEditZone({ ...editZone, levels: e.target.value })} /></label>
            <label><input type="checkbox" checked={!!editZone.allowed_is_hard} onChange={(e) => setEditZone({ ...editZone, allowed_is_hard: e.target.checked })} style={{ width: 'auto', minHeight: 0 }} /> 允许类别为硬限制（不符合类别的产品不能放入）</label>
          </div>
          <div style={{ marginTop: 10 }}>允许类别：{cats.map((c) => <label key={c.id} style={{ display: 'inline-flex', gap: 4, marginRight: 12 }}><input type="checkbox" checked={editZone.allowed_category_ids.includes(c.id)} onChange={() => toggleCat(c.id)} style={{ width: 'auto', minHeight: 0 }} />{c.name_zh ?? c.code}</label>)}</div>
          <div className="toolbar" style={{ marginTop: 12 }}><button className="btn btn-primary" onClick={saveZone}>保存</button><button className="btn btn-ghost" onClick={() => setEditZone(null)}>取消</button></div>
        </div>
      )}
      <table>
        <thead><tr><th>区</th><th>名称</th><th>类型</th><th>允许类别</th><th>货位数</th><th>硬限制</th><th></th></tr></thead>
        <tbody>{zones.map((z) => <tr key={z.id} style={{ background: sel?.id === z.id ? '#EEF6FF' : undefined }}>
          <td><span className="pill" style={{ background: z.color }}>{z.code}</span></td><td>{z.name_zh ?? ''}</td><td>{ZONE_TYPE_ZH[z.zone_type]}</td><td>{(z.allowed_category_ids ?? []).map((id: string) => cats.find((c) => c.id === id)?.name_zh ?? '').filter(Boolean).join('、') || '全部'}</td><td>{z.location_count}</td><td>{z.allowed_is_hard ? '是' : '否'}</td>
          <td style={{ whiteSpace: 'nowrap' }}><button className="btn btn-ghost" onClick={() => openZone(z)}>货位</button> {has('label.print') && <button className="btn btn-ghost" onClick={() => labels(z)}>打印标签</button>} {canManage && <button className="btn btn-ghost" onClick={() => startEdit(z)}>编辑</button>}</td>
        </tr>)}</tbody>
      </table>
      {sel && <>
        <h2>{sel.code} 的货位（{locs.length}）</h2>
        <div className="note" style={{ marginBottom: 8 }}>编辑区时填的架数和层数会重排货位。有库存的货位不能删。</div>
        <table><thead><tr><th>代码</th><th>架</th><th>层</th><th>标签打印</th></tr></thead><tbody>{locs.map((l) => <tr key={l.id}><td>{l.code}</td><td>{l.rack}</td><td>{l.level}</td><td>{l.qr_printed_at ? fmtDate(l.qr_printed_at) : <span className="err">未打印</span>}</td></tr>)}</tbody></table>
      </>}
    </div>
  );
}
