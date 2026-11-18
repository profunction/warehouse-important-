// 3D 仓库视图：区 → 架 → 层 画成立体货格，按库存量上色，点一格看里面有什么。
// 做法参考开源项目 3d-express-warehouse 和 StockSpace（React Three Fiber，程序化生成，不用模型文件）。
import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Html, ContactShadows } from '@react-three/drei';
import * as THREE from 'three';
import { api } from '../../../api/client.js';
import { useT } from '../../../i18n/index.js';

type Loc = { id: string; zone_id: string; code: string; rack: number; level: number; capacity_boxes: number | null; qty: number; items: number; earliest_expiry: string | null; top: { name_zh?: string; name_ms?: string; name_en?: string; qty: number }[] | null };
type Zone = { id: string; code: string; name_zh?: string; name_ms?: string; name_en?: string; zone_type: string; color: string; capacity_boxes: number | null; sort_order: number };
const C = { paper: '#FAF8F3', hair: '#E3DFD2', ink: '#15201A', green: '#0E3B2B', mint: '#9FD7B6', brass: '#B8894A', red: '#9B2C2C', frame: '#CBC5B6', frameDark: '#9A9486' };
const SLOT = { w: 1.0, h: 0.6, d: 0.8, gap: 0.08 };

function fillOf(l: Loc, zoneMax: number) { if (l.qty <= 0) return 0; const cap = l.capacity_boxes ? l.capacity_boxes * 12 : zoneMax || 1; return Math.min(1.2, l.qty / cap); }
function colorOf(f: number) { if (f <= 0) return C.hair; if (f < 0.5) return C.mint; if (f < 0.9) return C.green; if (f <= 1) return C.brass; return C.red; }

function Rack({ zone, locs, origin, zoneMax, onPick, picked }: { zone: Zone; locs: Loc[]; origin: [number, number, number]; zoneMax: number; onPick: (l: Loc) => void; picked: string | null }) {
  const racks = Math.max(...locs.map((l) => l.rack), 1); const levels = Math.max(...locs.map((l) => l.level), 1);
  const w = racks * (SLOT.w + SLOT.gap); const h = levels * (SLOT.h + SLOT.gap);
  return (
    <group position={origin}>
      {/* 区名牌 */}
      <Html position={[0, h + 0.35, 0]} transform={false} distanceFactor={undefined} style={{ pointerEvents: 'none', whiteSpace: 'nowrap', fontFamily: '"Noto Serif SC", "Fraunces", serif', fontSize: 12, fontWeight: 600, color: C.ink, letterSpacing: '.04em', background: 'rgba(250,248,243,.85)', padding: '2px 8px', border: '1px solid #E3DFD2' }}>{`${zone.code} · ${zone.name_zh ?? zone.name_en ?? ''}`}</Html>
      {/* 立柱和横梁：细线框 */}
      {Array.from({ length: racks + 1 }, (_, i) => <mesh key={'p' + i} position={[i * (SLOT.w + SLOT.gap) - SLOT.gap / 2, h / 2, 0]}><boxGeometry args={[0.05, h, 0.05]} /><meshStandardMaterial color={C.frameDark} /></mesh>)}
      {Array.from({ length: levels + 1 }, (_, j) => <mesh key={'b' + j} position={[w / 2 - SLOT.gap / 2, j * (SLOT.h + SLOT.gap) - SLOT.gap / 2, 0]}><boxGeometry args={[w, 0.025, SLOT.d + 0.06]} /><meshStandardMaterial color={C.frame} roughness={0.9} /></mesh>)}
      {locs.map((l) => {
        const f = fillOf(l, zoneMax); const fh = Math.max(0.05, Math.min(1, f) * (SLOT.h - 0.08));
        const x = (l.rack - 1) * (SLOT.w + SLOT.gap) + SLOT.w / 2; const y = (l.level - 1) * (SLOT.h + SLOT.gap);
        const sel = picked === l.id;
        return (
          <group key={l.id} position={[x, y, 0]} onClick={(e) => { e.stopPropagation(); onPick(l); }} onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'pointer'; }} onPointerOut={() => { document.body.style.cursor = ''; }}>
            {/* 货格底板 */}
            <mesh position={[0, 0.01, 0]}><boxGeometry args={[SLOT.w - 0.06, 0.02, SLOT.d]} /><meshStandardMaterial color={sel ? C.brass : '#EFEBE1'} /></mesh>
            {/* 货物：按占用高度 */}
            {f > 0 && <mesh position={[0, 0.02 + fh / 2, 0]} castShadow><boxGeometry args={[SLOT.w - 0.18, fh, SLOT.d - 0.16]} /><meshStandardMaterial color={colorOf(f)} roughness={0.75} /></mesh>}
            {sel && <mesh position={[0, SLOT.h / 2, 0]}><boxGeometry args={[SLOT.w - 0.02, SLOT.h, SLOT.d + 0.02]} /><meshBasicMaterial color={C.brass} wireframe /></mesh>}
          </group>
        );
      })}
    </group>
  );
}

function Scene({ zones, locations, onPick, picked }: { zones: Zone[]; locations: Loc[]; onPick: (l: Loc) => void; picked: string | null }) {
  // 布局：区按 4 个一排摆成网格，每排之间留走道
  const { layout, width, depth } = useMemo(() => {
    const rows: { zone: Zone; locs: Loc[]; origin: [number, number, number]; zoneMax: number; w: number }[] = [];
    const items = zones.map((zone) => ({ zone, locs: locations.filter((l) => l.zone_id === zone.id) })).filter((x) => x.locs.length);
    const perRow = Math.max(2, Math.ceil(Math.sqrt(items.length)));
    let x = 0, z = 0, rowW = 0, maxW = 0; const aisle = 1.4, rowGap = 2.2;
    items.forEach((it, i) => {
      const racks = Math.max(...it.locs.map((l) => l.rack), 1); const w = racks * (SLOT.w + SLOT.gap);
      if (i > 0 && i % perRow === 0) { maxW = Math.max(maxW, rowW); x = 0; rowW = 0; z -= SLOT.d + rowGap; }
      rows.push({ zone: it.zone, locs: it.locs, origin: [x, 0, z], zoneMax: Math.max(...it.locs.map((l) => l.qty), 1), w });
      x += w + aisle; rowW = x - aisle;
    });
    maxW = Math.max(maxW, rowW, 4);
    return { layout: rows, width: maxW, depth: Math.abs(z) + SLOT.d };
  }, [zones, locations]);
  return (
    <group position={[-width / 2, 0, depth / 2]}>
      <ambientLight intensity={0.9} />
      <directionalLight position={[6, 10, 6]} intensity={1.1} castShadow />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[width / 2, -0.01, -depth / 2 + SLOT.d / 2]} receiveShadow><planeGeometry args={[width + 6, depth + 6]} /><meshStandardMaterial color="#F3F0E8" /></mesh>
      <gridHelper args={[Math.max(width, depth) + 6, Math.round(Math.max(width, depth)) + 6, '#E3DFD2', '#ECE8DD']} position={[width / 2, 0, -depth / 2 + SLOT.d / 2]} />
      {layout.map((r) => <Rack key={r.zone.id} {...r} onPick={onPick} picked={picked} />)}
      <ContactShadows position={[width / 2, 0, -depth / 2 + SLOT.d / 2]} opacity={0.25} scale={Math.max(width, depth) + 6} blur={2.5} far={4} />
    </group>
  );
}

function AutoRotate({ on, size }: { on: boolean; size: number }) {
  const ref = useRef<any>(null);
  useFrame((_, dt) => { if (on && ref.current) { ref.current.setAzimuthalAngle(ref.current.getAzimuthalAngle() + dt * 0.06); ref.current.update(); } });
  return <OrbitControls ref={ref} makeDefault target={[0, 0.8, 0]} enableDamping dampingFactor={0.08} minPolarAngle={0.35} maxPolarAngle={1.3} minDistance={3} maxDistance={size * 4} />;
}

export default function Warehouse3D() {
  const { n } = useT();
  const [data, setData] = useState<{ site: string; sites: any[]; zones: Zone[]; locations: Loc[] } | null>(null);
  const [site, setSite] = useState<string>(''); const [picked, setPicked] = useState<Loc | null>(null); const [rotate, setRotate] = useState(true); const [err, setErr] = useState('');
  useEffect(() => { api(`/stock/zone-map${site ? `?site=${site}` : ''}`).then((d) => { setData(d); if (!site && d.site) setSite(d.site); }).catch((e) => setErr(e?.text?.('zh') ?? '加载失败')); }, [site]);
  const sceneSize = useMemo(() => { if (!data) return 12; const items = data.zones.filter((z) => data.locations.some((l) => l.zone_id === z.id)); const perRow = Math.max(2, Math.ceil(Math.sqrt(items.length))); const avgW = items.length ? items.reduce((a, z) => a + Math.max(...data.locations.filter((l) => l.zone_id === z.id).map((l) => l.rack), 1) * 1.08, 0) / items.length : 4; return Math.max(perRow * (avgW + 1.4), Math.ceil(items.length / perRow) * 3, 8); }, [data]);
  const stats = useMemo(() => { if (!data) return null; const ls = data.locations; const used = ls.filter((l) => l.qty > 0).length; return { total: ls.length, used, empty: ls.length - used, items: ls.reduce((a, l) => a + Number(l.items), 0) }; }, [data]);
  return (
    <div style={{ display: 'grid', gridTemplateRows: 'auto 1fr', height: 'calc(100vh - 56px)', minHeight: 560 }}>
      <div>
        <h1 style={{ marginBottom: 10 }}>3D 仓库</h1>
        <div className="toolbar">
          <select value={site} onChange={(e) => { setSite(e.target.value); setPicked(null); }}>{(data?.sites ?? []).map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</select>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}><input type="checkbox" checked={rotate} onChange={(e) => setRotate(e.target.checked)} style={{ width: 'auto', minHeight: 0 }} /> 自动旋转</label>
          {stats && <span className="note">{stats.total} 个货位 · {stats.used} 有货 · {stats.empty} 空 · {stats.items} 个品项</span>}
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 14, fontSize: 12, color: 'var(--muted)' }}>{[['空', C.hair], ['少于一半', C.mint], ['正常', C.green], ['快满', C.brass], ['超载', C.red]].map(([l, c]) => <span key={l} style={{ display: 'flex', gap: 5, alignItems: 'center' }}><i style={{ width: 12, height: 12, background: c, display: 'inline-block', border: '1px solid #0002' }} />{l}</span>)}</span>
          {err && <span className="err">{err}</span>}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: picked ? '1fr 300px' : '1fr', gap: 18, minHeight: 0 }}>
        <div style={{ background: '#F3F0E8', border: '1px solid var(--hair)', minHeight: 480 }}>
          {data && (
            <Canvas shadows camera={{ position: [sceneSize * 0.55, sceneSize * 0.5, sceneSize * 0.75], fov: 36, near: 0.1, far: 500 }} dpr={[1, 2]} onPointerMissed={() => setPicked(null)} style={{ background: C.paper }}>
              <color attach="background" args={[C.paper]} />
              <Scene zones={data.zones} locations={data.locations} onPick={(l) => { setPicked(l); setRotate(false); }} picked={picked?.id ?? null} />
              <AutoRotate on={rotate} size={sceneSize} />
            </Canvas>
          )}
        </div>
        {picked && (
          <div style={{ borderLeft: '1px solid var(--hair)', paddingLeft: 18, overflow: 'auto' }}>
            <div className="label">货位</div>
            <div style={{ fontFamily: 'var(--serif)', fontSize: 34, margin: '6px 0 2px' }}>{picked.code}</div>
            <div className="note">{data?.zones.find((z) => z.id === picked.zone_id)?.name_zh} · 架 {picked.rack} 层 {picked.level}</div>
            <div style={{ display: 'flex', gap: 24, margin: '16px 0', borderTop: '1px solid var(--hair)', borderBottom: '1px solid var(--hair)', padding: '12px 0' }}>
              <div><div className="label">数量</div><div style={{ fontFamily: 'var(--serif)', fontSize: 28 }}>{Number(picked.qty)}</div></div>
              <div><div className="label">品项</div><div style={{ fontFamily: 'var(--serif)', fontSize: 28 }}>{Number(picked.items)}</div></div>
              {picked.earliest_expiry && <div><div className="label">最早到期</div><div style={{ fontFamily: 'var(--serif)', fontSize: 20 }}>{picked.earliest_expiry}</div></div>}
            </div>
            {(picked.top ?? []).length === 0 ? <div className="note">空货位</div> : (picked.top ?? []).map((p, i) => <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--hair)' }}><span>{n(p)}</span><b style={{ fontFamily: 'var(--serif)', fontWeight: 400, fontSize: 20 }}>{Number(p.qty)}</b></div>)}
            <a className="btn btn-ghost" style={{ marginTop: 14 }} href={`/w/stock`}>看完整清单</a>
          </div>
        )}
      </div>
    </div>
  );
}
