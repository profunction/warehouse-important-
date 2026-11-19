// 2D 店地图（大屏 D6 和网页 G6 共用）：格子、元素、你在这里（蓝点）、目标货架红闪、绿路线
import type { KMap } from './kioskApi.js';
const KIND_COLOR: Record<string, string> = { ZONE: '#E3F2FD', RACK: '#90A4AE', AISLE: '#FAFAFA', ENTRANCE: '#A5D6A7', KIOSK: '#1565C0', COUNTER: '#FFE082', WALL: '#424242', LABEL: 'transparent' };
export function MapView({ map, path, target, cell, onCellClick, onElementClick, selectedId, showGrid, className, style }: { map: KMap; path?: { x: number; y: number }[]; target?: { x: number; y: number; w: number; h: number } | null; cell?: number; onCellClick?: (x: number, y: number) => void; onElementClick?: (e: any) => void; selectedId?: string | null; showGrid?: boolean; className?: string; style?: any }) {
  const c = cell ?? 24; const W = map.width * c, H = map.height * c;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={className} style={{ width: '100%', height: 'auto', background: '#fff', display: 'block', ...style }} onClick={(e) => { if (!onCellClick) return; const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect(); const x = Math.floor(((e.clientX - r.left) / r.width) * map.width); const y = Math.floor(((e.clientY - r.top) / r.height) * map.height); onCellClick(x, y); }}>
      {showGrid && <g stroke="#eee" strokeWidth={1}>{Array.from({ length: map.width + 1 }, (_, i) => <line key={'v' + i} x1={i * c} y1={0} x2={i * c} y2={H} />)}{Array.from({ length: map.height + 1 }, (_, i) => <line key={'h' + i} x1={0} y1={i * c} x2={W} y2={i * c} />)}</g>}
      {[...map.elements].sort((a, b) => (a.kind === 'ZONE' ? -1 : 1) - (b.kind === 'ZONE' ? -1 : 1)).map((e, i) => (
        <g key={e.id ?? i} onClick={(ev) => { if (onElementClick) { ev.stopPropagation(); onElementClick(e); } }} style={{ cursor: onElementClick ? 'pointer' : 'default' }}>
          <rect x={e.x * c + 1} y={e.y * c + 1} width={e.w * c - 2} height={e.h * c - 2} rx={e.kind === 'ZONE' ? 8 : 3} fill={e.color ?? KIND_COLOR[e.kind] ?? '#ccc'} fillOpacity={e.kind === 'ZONE' ? 0.5 : 1} stroke={selectedId && selectedId === e.id ? '#C62828' : e.kind === 'ZONE' ? (e.color ?? '#90CAF9') : 'none'} strokeWidth={selectedId === e.id ? 3 : 1.5} strokeDasharray={e.kind === 'ZONE' ? '6 4' : undefined} />
          {(e.label || e.location_code || e.zone_code) && <text x={e.x * c + (e.w * c) / 2} y={e.y * c + (e.h * c) / 2} textAnchor="middle" dominantBaseline="middle" fontSize={Math.max(10, c * 0.42)} fontWeight={600} fill={e.kind === 'WALL' || e.kind === 'KIOSK' || e.kind === 'RACK' ? '#fff' : '#333'} style={{ pointerEvents: 'none' }}>{e.label ?? e.location_code ?? e.zone_code}</text>}
        </g>
      ))}
      {path && path.length > 1 && <polyline points={path.map((p) => `${p.x * c + c / 2},${p.y * c + c / 2}`).join(' ')} fill="none" stroke="#1B8A3A" strokeWidth={Math.max(4, c * 0.28)} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={`${c * 0.6} ${c * 0.4}`} className="kiosk-route" />}
      {target && <rect x={target.x * c} y={target.y * c} width={target.w * c} height={target.h * c} rx={4} fill="#C62828" fillOpacity={0.55} stroke="#C62828" strokeWidth={4} className="kiosk-target" />}
      <circle cx={map.kiosk_x * c + c / 2} cy={map.kiosk_y * c + c / 2} r={c * 0.42} fill="#1565C0" stroke="#fff" strokeWidth={3} className="kiosk-here" />
    </svg>
  );
}
