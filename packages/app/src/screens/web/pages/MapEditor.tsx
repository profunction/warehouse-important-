// G6 店地图编辑器（模块 E）：画布 40×30 格，放置/拖动 区·货架·走道·入口·大屏·收银台·墙·标签，绑定 zone/location，保存草稿、发布到大屏；
// 右侧属性；促销管理 tab（promotion CRUD）；大屏密钥入口（/w/integrations）。
// 操作：左边选工具 → 点格子放置；点元素选中 → 拖动移动；属性面板改尺寸/绑定；Delete 键删除。
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../../api/client.js';
import { useAuth } from '../../../store/auth.js';
import { errText, fmtDate, fmtMoney } from './_util.js';
import { MapView } from '../../kiosk/MapView.js';
import type { KMap } from '../../kiosk/kioskApi.js';

const KINDS: { kind: string; label: string; w: number; h: number; color?: string }[] = [
  { kind: 'ZONE', label: '区（背景）', w: 6, h: 4 }, { kind: 'RACK', label: '货架', w: 1, h: 3 }, { kind: 'AISLE', label: '走道', w: 1, h: 4 }, { kind: 'ENTRANCE', label: '入口', w: 2, h: 1 },
  { kind: 'KIOSK', label: '大屏（您在这里）', w: 1, h: 1 }, { kind: 'COUNTER', label: '收银台', w: 3, h: 1 }, { kind: 'WALL', label: '墙', w: 1, h: 6 }, { kind: 'LABEL', label: '文字', w: 2, h: 1 },
];
const lid = () => `tmp-${Math.random().toString(36).slice(2, 9)}`;

export default function MapEditor() {
  const { me } = useAuth();
  const [tab, setTab] = useState<'map' | 'promo' | 'keys'>('map');
  const [siteId, setSiteId] = useState<string>(me?.site?.id ?? me?.sites?.[0]?.id ?? '');
  const [map, setMap] = useState<KMap | null>(null); const [zones, setZones] = useState<any[]>([]); const [locs, setLocs] = useState<any[]>([]);
  const [tool, setTool] = useState<string | null>(null); const [selId, setSelId] = useState<string | null>(null); const [msg, setMsg] = useState(''); const [dirty, setDirty] = useState(false);
  const [route, setRoute] = useState<any>(null); const [routeTo, setRouteTo] = useState(''); const [cell] = useState(22);
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null); const wrap = useRef<HTMLDivElement>(null);
  const [promos, setPromos] = useState<any[]>([]); const [promoForm, setPromoForm] = useState<any | null>(null); const [products, setProducts] = useState<any[]>([]); const [keys, setKeys] = useState<any[]>([]);

  const load = async () => {
    if (!siteId) return;
    try { const [m, z, l] = await Promise.all([api(`/sites/${siteId}/map`), api(`/zones?site=${siteId}`), api(`/locations?site=${siteId}`)]); setMap({ ...m, elements: m.elements.map((e: any) => ({ ...e, id: e.id ?? lid() })) }); setZones(z); setLocs(l); setDirty(false); setRoute(null); } catch (e) { setMsg(errText(e)); }
  };
  useEffect(() => { void load(); }, [siteId]);
  useEffect(() => { if (tab === 'promo') { void api('/promotions?all=true').then(setPromos).catch((e) => setMsg(errText(e))); void api('/products?limit=500').then((r) => setProducts(Array.isArray(r) ? r : r.items ?? [])).catch(() => {}); } if (tab === 'keys') void api('/api-keys').then((r) => setKeys(r.filter((k: any) => k.scope === 'KIOSK'))).catch(() => setKeys([])); }, [tab]);
  useEffect(() => { const onKey = (e: KeyboardEvent) => { if ((e.key === 'Delete' || e.key === 'Backspace') && selId && (document.activeElement?.tagName ?? '') !== 'INPUT') { removeSel(); } }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); });

  const sel = useMemo(() => map?.elements.find((e) => e.id === selId) ?? null, [map, selId]);
  const update = (patch: Partial<KMap>) => { setMap((m) => (m ? { ...m, ...patch } : m)); setDirty(true); };
  const updateEl = (id: string, patch: any) => { setMap((m) => (m ? { ...m, elements: m.elements.map((e) => (e.id === id ? { ...e, ...patch } : e)) } : m)); setDirty(true); };
  const removeSel = () => { if (!selId) return; setMap((m) => (m ? { ...m, elements: m.elements.filter((e) => e.id !== selId) } : m)); setSelId(null); setDirty(true); };
  const cellAt = (ev: React.PointerEvent) => { const svg = wrap.current?.querySelector('svg'); if (!svg || !map) return null; const r = svg.getBoundingClientRect(); return { x: Math.max(0, Math.min(map.width - 1, Math.floor(((ev.clientX - r.left) / r.width) * map.width))), y: Math.max(0, Math.min(map.height - 1, Math.floor(((ev.clientY - r.top) / r.height) * map.height))) }; };
  const place = (x: number, y: number) => {
    if (!map) return;
    if (tool) {
      const k = KINDS.find((k) => k.kind === tool)!; const id = lid();
      const el: any = { id, kind: tool, x, y, w: k.w, h: k.h, rotation: 0, label: tool === 'LABEL' ? '文字' : null };
      let elements = map.elements; if (tool === 'KIOSK') { elements = elements.filter((e) => e.kind !== 'KIOSK'); update({ kiosk_x: x, kiosk_y: y }); } if (tool === 'ENTRANCE') update({ entrance_x: x, entrance_y: y });
      setMap((m) => (m ? { ...m, elements: [...elements, el] } : m)); setSelId(id); setDirty(true); setTool(null);
    } else if (sel) updateEl(sel.id, { x, y });
  };
  const onPointerMove = (ev: React.PointerEvent) => { if (!drag.current) return; const c = cellAt(ev); if (!c) return; const e = map?.elements.find((x) => x.id === drag.current!.id); if (e && (e.x !== c.x - drag.current.dx || e.y !== c.y - drag.current.dy)) { const nx = Math.max(0, c.x - drag.current.dx), ny = Math.max(0, c.y - drag.current.dy); updateEl(e.id, { x: nx, y: ny }); if (e.kind === 'KIOSK') update({ kiosk_x: nx, kiosk_y: ny }); } };
  const onPointerDown = (ev: React.PointerEvent) => { const c = cellAt(ev); if (!c || !map || tool) return; const hit = [...map.elements].reverse().find((e) => c.x >= e.x && c.x < e.x + e.w && c.y >= e.y && c.y < e.y + e.h && e.kind !== 'ZONE') ?? map.elements.find((e) => c.x >= e.x && c.x < e.x + e.w && c.y >= e.y && c.y < e.y + e.h); if (hit) { setSelId(hit.id); drag.current = { id: hit.id, dx: c.x - hit.x, dy: c.y - hit.y }; } };
  const onPointerUp = () => { drag.current = null; };
  const save = async () => { if (!map) return; try { const body = { width: map.width, height: map.height, kiosk: { x: map.kiosk_x, y: map.kiosk_y }, entrance: map.entrance_x != null ? { x: map.entrance_x, y: map.entrance_y } : null, elements: map.elements.map(({ id, location_code, zone_code, ...e }: any) => ({ ...e, id: id?.startsWith('tmp-') ? undefined : id })) }; const r = await api(`/sites/${siteId}/map`, { method: 'PUT', body }); setMap({ ...r, elements: r.elements.map((e: any) => ({ ...e, id: e.id ?? lid() })) }); setDirty(false); setMsg(`已保存草稿 v${r.version}`); } catch (e) { setMsg(errText(e)); } };
  const publish = async () => { if (dirty) await save(); try { const r = await api(`/sites/${siteId}/map/publish`, { method: 'POST' }); setMsg(`已发布 v${r.version}，大屏 2 秒内更新`); await load(); } catch (e) { setMsg(errText(e)); } };
  const preview = async () => { if (!routeTo) return; try { setRoute(await api(`/sites/${siteId}/map/route?to=${routeTo}`)); } catch (e) { setMsg(errText(e)); } };
  const savePromo = async () => { try { const b = { ...promoForm, promo_price: promoForm.promo_price === '' || promoForm.promo_price == null ? null : Number(promoForm.promo_price), site_id: promoForm.site_id || null, product_id: promoForm.product_id || null, ends_on: promoForm.ends_on || null }; if (promoForm.id) await api(`/promotions/${promoForm.id}`, { method: 'PUT', body: b }); else await api('/promotions', { body: b }); setPromoForm(null); setPromos(await api('/promotions?all=true')); setMsg('已保存'); } catch (e) { setMsg(errText(e)); } };
  const delPromo = async (id: string) => { if (!window.confirm('删除这条促销？')) return; try { await api(`/promotions/${id}`, { method: 'DELETE' }); setPromos(await api('/promotions?all=true')); } catch (e) { setMsg(errText(e)); } };

  return (
    <div>
      <h1>店地图与大屏</h1>
      {msg && <div className={/已|成功/.test(msg) ? 'ok' : 'err'} style={{ marginBottom: 8 }}>{msg}</div>}
      <div className="tabs"><button className={tab === 'map' ? 'active' : ''} onClick={() => setTab('map')}>地图编辑器</button><button className={tab === 'promo' ? 'active' : ''} onClick={() => setTab('promo')}>促销管理</button><button className={tab === 'keys' ? 'active' : ''} onClick={() => setTab('keys')}>大屏密钥</button></div>
      {tab === 'map' && <>
        <div className="toolbar">
          <select value={siteId} onChange={(e) => setSiteId(e.target.value)}>{(me?.sites ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}（{s.code}）</option>)}</select>
          {map && <span className="pill" style={{ background: map.status === 'PUBLISHED' ? '#1B8A3A' : map.status === 'DRAFT' ? '#F9A825' : '#9E9E9E' }}>{map.status === 'NONE' ? '尚无地图' : `${map.status === 'DRAFT' ? '草稿' : '已发布'} v${map.version}`}</span>}
          {map && <label className="note">宽 <input type="number" value={map.width} min={5} max={200} style={{ width: 60 }} onChange={(e) => update({ width: Number(e.target.value) })} /> 高 <input type="number" value={map.height} min={5} max={200} style={{ width: 60 }} onChange={(e) => update({ height: Number(e.target.value) })} /></label>}
          <button className="btn btn-ghost" onClick={save} disabled={!map}>保存草稿{dirty ? ' *' : ''}</button>
          <button className="btn btn-primary" onClick={publish} disabled={!map} data-testid="map-publish">发布到大屏</button>
          <select value={routeTo} onChange={(e) => setRouteTo(e.target.value)}><option value="">预览路线到…</option>{locs.map((l) => <option key={l.id} value={l.id}>{l.code}</option>)}</select>
          <button className="btn btn-ghost" onClick={preview} disabled={!routeTo}>画路线</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr 300px', gap: 14 }}>
          <div>
            <div className="note" style={{ marginBottom: 6 }}>工具（选后点格子放置）</div>
            {KINDS.map((k) => <button key={k.kind} className={`btn ${tool === k.kind ? 'btn-primary' : 'btn-ghost'}`} style={{ width: '100%', marginBottom: 6, justifyContent: 'flex-start' }} onClick={() => { setTool(tool === k.kind ? null : k.kind); setSelId(null); }} data-testid={`tool-${k.kind}`}>{k.label}</button>)}
            <div className="note" style={{ marginTop: 10 }}>点元素选中后可拖动；Delete 删除。货架绑定货位后大屏能画路线；没有精确绑定时按区+排号匹配。</div>
          </div>
          <div ref={wrap} style={{ border: '1px solid var(--border)', background: '#fff', overflow: 'auto', maxHeight: '72vh', cursor: tool ? 'crosshair' : 'default' }} onPointerMove={onPointerMove} onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerLeave={onPointerUp} data-testid="map-canvas">
            {map ? <MapView map={map} cell={cell} showGrid selectedId={selId} onCellClick={(x, y) => place(x, y)} path={route?.path} target={route?.target} style={{ minWidth: map.width * cell, width: map.width * cell }} /> : <div className="note" style={{ padding: 20 }}>选择站点</div>}
          </div>
          <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
            <h2 style={{ marginTop: 0 }}>属性</h2>
            {sel ? <div className="form" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <label>类型<span>{KINDS.find((k) => k.kind === sel.kind)?.label ?? sel.kind}</span></label>
              <label>标签<input value={sel.label ?? ''} onChange={(e) => updateEl(sel.id, { label: e.target.value || null })} /></label>
              <label>X<input type="number" value={sel.x} onChange={(e) => updateEl(sel.id, { x: Number(e.target.value) })} /></label><label>Y<input type="number" value={sel.y} onChange={(e) => updateEl(sel.id, { y: Number(e.target.value) })} /></label>
              <label>宽<input type="number" min={1} value={sel.w} onChange={(e) => updateEl(sel.id, { w: Math.max(1, Number(e.target.value)) })} /></label><label>高<input type="number" min={1} value={sel.h} onChange={(e) => updateEl(sel.id, { h: Math.max(1, Number(e.target.value)) })} /></label>
              <label>颜色<input type="color" value={sel.color ?? '#90A4AE'} onChange={(e) => updateEl(sel.id, { color: e.target.value })} /></label>
              {(sel.kind === 'ZONE' || sel.kind === 'RACK') && <label>绑定区<select value={sel.zone_id ?? ''} onChange={(e) => { const z = zones.find((z) => z.id === e.target.value); updateEl(sel.id, { zone_id: e.target.value || null, color: sel.kind === 'ZONE' && z ? z.color : sel.color, label: sel.label ?? z?.code ?? null }); }}><option value="">—</option>{zones.map((z) => <option key={z.id} value={z.id}>{z.code} {z.name_zh ?? ''}</option>)}</select></label>}
              {sel.kind === 'RACK' && <label>排号<input type="number" value={sel.rack ?? ''} onChange={(e) => updateEl(sel.id, { rack: e.target.value ? Number(e.target.value) : null })} /></label>}
              {sel.kind === 'RACK' && <label style={{ gridColumn: '1 / -1' }}>绑定货位<select value={sel.location_id ?? ''} onChange={(e) => { const l = locs.find((l) => l.id === e.target.value); updateEl(sel.id, { location_id: e.target.value || null, zone_id: l?.zone_id ?? sel.zone_id, rack: l?.rack ?? sel.rack, label: sel.label ?? l?.code ?? null }); }}><option value="">—</option>{locs.filter((l) => !sel.zone_id || l.zone_id === sel.zone_id).map((l) => <option key={l.id} value={l.id}>{l.code}</option>)}</select></label>}
              <label style={{ gridColumn: '1 / -1' }}>&nbsp;<span><button className="btn btn-danger" onClick={removeSel}>删除元素</button></span></label>
            </div> : <div className="note">{tool ? `在画布上点一格放置「${KINDS.find((k) => k.kind === tool)?.label}」` : '点击画布上的元素'}</div>}
            {map && <div className="note" style={{ marginTop: 14 }}>大屏位置 ({map.kiosk_x},{map.kiosk_y}) · 入口 {map.entrance_x != null ? `(${map.entrance_x},${map.entrance_y})` : '—'} · 元素 {map.elements.length}{route && <> · 路线 {route.found ? `${route.path.length} 格` : '不通'}</>}</div>}
          </div>
        </div>
      </>}
      {tab === 'promo' && <>
        <div className="toolbar"><button className="btn btn-primary" onClick={() => setPromoForm({ site_id: siteId, product_id: '', title_zh: '', title_ms: '', title_en: '', promo_price: '', image_url: '', starts_on: new Date().toISOString().slice(0, 10), ends_on: '', sort_order: 0, is_active: true })}>＋ 新促销</button><span className="note">大屏待机轮播；站点留空 = 所有店</span></div>
        {promoForm && <div className="form" style={{ marginBottom: 16 }}>
          <label>站点<select value={promoForm.site_id ?? ''} onChange={(e) => setPromoForm({ ...promoForm, site_id: e.target.value })}><option value="">全部</option>{(me?.sites ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          <label>产品<select value={promoForm.product_id ?? ''} onChange={(e) => setPromoForm({ ...promoForm, product_id: e.target.value })}><option value="">—</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name_zh ?? p.name_en}</option>)}</select></label>
          <label>标题（中）<input value={promoForm.title_zh ?? ''} onChange={(e) => setPromoForm({ ...promoForm, title_zh: e.target.value })} /></label><label>Tajuk (MS)<input value={promoForm.title_ms ?? ''} onChange={(e) => setPromoForm({ ...promoForm, title_ms: e.target.value })} /></label><label>Title (EN)<input value={promoForm.title_en ?? ''} onChange={(e) => setPromoForm({ ...promoForm, title_en: e.target.value })} /></label>
          <label>促销价<input type="number" step="0.01" value={promoForm.promo_price ?? ''} onChange={(e) => setPromoForm({ ...promoForm, promo_price: e.target.value })} /></label><label>图片 URL<input value={promoForm.image_url ?? ''} onChange={(e) => setPromoForm({ ...promoForm, image_url: e.target.value })} /></label>
          <label>开始<input type="date" value={promoForm.starts_on ?? ''} onChange={(e) => setPromoForm({ ...promoForm, starts_on: e.target.value })} /></label><label>结束<input type="date" value={promoForm.ends_on ?? ''} onChange={(e) => setPromoForm({ ...promoForm, ends_on: e.target.value })} /></label>
          <label>排序<input type="number" value={promoForm.sort_order ?? 0} onChange={(e) => setPromoForm({ ...promoForm, sort_order: Number(e.target.value) })} /></label><label>启用<select value={promoForm.is_active ? '1' : '0'} onChange={(e) => setPromoForm({ ...promoForm, is_active: e.target.value === '1' })}><option value="1">是</option><option value="0">否</option></select></label>
          <label>&nbsp;<span><button className="btn btn-primary" onClick={savePromo}>保存</button> <button className="btn btn-ghost" onClick={() => setPromoForm(null)}>取消</button></span></label>
        </div>}
        <table><thead><tr><th>标题</th><th>产品</th><th>促销价</th><th>原价</th><th>期间</th><th>启用</th><th></th></tr></thead><tbody>
          {promos.map((p) => <tr key={p.id}><td>{p.title_zh ?? p.title_en ?? '—'}</td><td>{p.product_name_zh ?? p.product_name_en ?? '—'}</td><td>{fmtMoney(p.promo_price)}</td><td>{fmtMoney(p.sell_price)}</td><td>{String(p.starts_on).slice(0, 10)} ~ {p.ends_on ? String(p.ends_on).slice(0, 10) : '不限'}</td><td>{p.is_active ? '是' : '否'}</td><td><button className="btn btn-ghost" onClick={() => setPromoForm({ ...p, starts_on: String(p.starts_on).slice(0, 10), ends_on: p.ends_on ? String(p.ends_on).slice(0, 10) : '' })}>改</button> <button className="btn btn-danger" onClick={() => delPromo(p.id)}>删</button></td></tr>)}
          {!promos.length && <tr><td colSpan={7} className="note">还没有促销</td></tr>}
        </tbody></table>
      </>}
      {tab === 'keys' && <div>
        <p>大屏用「设备密钥」登录（不用员工账号），每台大屏一把，绑定站点。到 <a href="/w/integrations">对接与密钥</a> 生成 scope = KIOSK 的密钥，然后在大屏浏览器打开：</p>
        <pre>{location.origin}/kiosk?key=wh_xxxxxxxx.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx</pre>
        <p className="note">密钥只显示一次；大屏会把它存在本机。大屏只能访问 /kiosk 只读接口：没有成本、数量、仓库位置。</p>
        <table><thead><tr><th>名称</th><th>站点</th><th>前缀</th><th>最后使用</th><th>状态</th></tr></thead><tbody>
          {keys.map((k) => <tr key={k.id}><td>{k.name}</td><td>{k.site_code ?? '—'}</td><td>wh_{k.key_prefix}…</td><td>{fmtDate(k.last_used_at)}</td><td>{k.is_active ? '启用' : '停用'}</td></tr>)}
          {!keys.length && <tr><td colSpan={5} className="note">还没有大屏密钥（或没有权限查看）</td></tr>}
        </tbody></table>
      </div>}
    </div>
  );
}
