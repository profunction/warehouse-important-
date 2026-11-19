// 大屏 API 客户端（不登录）：密钥来自 URL ?key=wh_… 或 localStorage；所有请求带 x-api-key。
// 离线：目录/地图/类别/促销缓存 localStorage；"叫员工"离线排队，恢复后补发（client_id 幂等）。
export type Lang3 = 'zh' | 'ms' | 'en';
const LS = { key: 'wh.kiosk.key', catalog: 'wh.kiosk.catalog', map: 'wh.kiosk.map', cats: 'wh.kiosk.categories', promos: 'wh.kiosk.promotions', help: 'wh.kiosk.helpQueue', since: 'wh.kiosk.since' };
export function kioskKey(): string | null {
  const u = new URLSearchParams(location.search).get('key');
  if (u) { try { localStorage.setItem(LS.key, u); } catch { /* */ } return u; }
  try { return localStorage.getItem(LS.key); } catch { return null; }
}
export const lsGet = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
export const lsSet = (k: string, v: any) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 满了就算 */ } };
export async function kfetch<T = any>(path: string, opts: { method?: string; body?: any; timeoutMs?: number } = {}): Promise<T> {
  const key = kioskKey(); if (!key) throw new Error('NO_KEY');
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 8000);
  try {
    const r = await fetch('/api/v1' + path, { method: opts.method ?? (opts.body ? 'POST' : 'GET'), headers: { 'x-api-key': key, ...(opts.body ? { 'content-type': 'application/json' } : {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined, signal: ctrl.signal });
    if (!r.ok) { let j: any = {}; try { j = await r.json(); } catch { /* */ } const e: any = new Error(j.code ?? String(r.status)); e.status = r.status; e.body = j; throw e; }
    return r.json();
  } finally { clearTimeout(t); }
}
export interface KProduct { id: string; sku: string; name_zh?: string; name_ms?: string; name_en?: string; name_pinyin?: string; photo_url?: string; sell_price: number; category_id: string; barcode?: string; is_active: boolean; updated_at: string }
export interface KMap { site_id: string; version: number; status: string; width: number; height: number; kiosk_x: number; kiosk_y: number; entrance_x: number | null; entrance_y: number | null; walkable_grid?: number[][] | null; elements: any[] }
export const cache = {
  catalog: () => lsGet<KProduct[]>(LS.catalog, []), setCatalog: (v: KProduct[]) => lsSet(LS.catalog, v),
  map: () => lsGet<KMap | null>(LS.map, null), setMap: (v: KMap) => lsSet(LS.map, v),
  cats: () => lsGet<any[]>(LS.cats, []), setCats: (v: any[]) => lsSet(LS.cats, v),
  promos: () => lsGet<any[]>(LS.promos, []), setPromos: (v: any[]) => lsSet(LS.promos, v),
};
/** 增量拉目录：since 之后的变化合并进缓存（含停用的，用 is_active 剔除） */
export async function refreshCatalog() {
  const since = lsGet<string | null>(LS.since, null);
  const r = await kfetch<{ items: KProduct[]; server_time: string }>(`/kiosk/catalog${since ? `?since=${encodeURIComponent(since)}` : ''}`);
  const m = new Map(cache.catalog().map((p) => [p.id, p])); for (const p of r.items) { if (p.is_active) m.set(p.id, p); else m.delete(p.id); }
  const list = [...m.values()]; cache.setCatalog(list); lsSet(LS.since, r.server_time); return list;
}
export async function refreshAll() {
  const [cat, map, cats, promos] = await Promise.allSettled([refreshCatalog(), kfetch<KMap>('/kiosk/map'), kfetch<any[]>('/kiosk/categories'), kfetch<any[]>('/kiosk/promotions')]);
  if (map.status === 'fulfilled') cache.setMap(map.value); if (cats.status === 'fulfilled') cache.setCats(cats.value); if (promos.status === 'fulfilled') cache.setPromos(promos.value);
  return { catalog: cat.status === 'fulfilled' ? cat.value : cache.catalog(), map: cache.map(), cats: cache.cats(), promos: cache.promos() };
}
/** 本地搜索：名称三语 + 拼音 + 条码 */
export function localSearch(list: KProduct[], q: string, limit = 20) {
  const s = q.trim().toLowerCase(); if (!s) return [];
  const hit = (p: KProduct) => [p.name_zh, p.name_ms, p.name_en, p.name_pinyin, p.barcode, p.sku].some((v) => v && v.toLowerCase().includes(s));
  return list.filter(hit).sort((a, b) => (((a.name_zh ?? a.name_en ?? '').toLowerCase().startsWith(s) ? 0 : 1) - ((b.name_zh ?? b.name_en ?? '').toLowerCase().startsWith(s) ? 0 : 1))).slice(0, limit);
}
export const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`);
/** 叫员工（离线排队） */
export async function callHelp(body: { product_id?: string; location_id?: string; note?: string }): Promise<{ ticket_id: string | null; queued: boolean; client_id: string }> {
  const client_id = uuid();
  try { const r = await kfetch<{ ticket_id: string }>('/kiosk/help', { body: { ...body, client_id } }); return { ticket_id: r.ticket_id, queued: false, client_id }; }
  catch { const q = lsGet<any[]>(LS.help, []); q.push({ ...body, client_id, at: Date.now() }); lsSet(LS.help, q); return { ticket_id: null, queued: true, client_id }; }
}
export async function flushHelpQueue(): Promise<Record<string, string>> {
  const q = lsGet<any[]>(LS.help, []); const done: Record<string, string> = {}; const rest: any[] = [];
  for (const it of q) { try { const r = await kfetch<{ ticket_id: string }>('/kiosk/help', { body: it }); done[it.client_id] = r.ticket_id; } catch { rest.push(it); } }
  lsSet(LS.help, rest); return done;
}
/** SSE 订阅（EventSource 不能带 header → 用 fetch 流） */
export function subscribeEvents(onEvent: (name: string, data: any) => void): () => void {
  const key = kioskKey(); if (!key) return () => {};
  let stopped = false; let ctrl: AbortController | null = null;
  const run = async () => {
    while (!stopped) {
      ctrl = new AbortController();
      try {
        const r = await fetch('/api/v1/kiosk/events', { headers: { 'x-api-key': key }, signal: ctrl.signal });
        if (!r.ok || !r.body) throw new Error('sse ' + r.status);
        const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = '';
        for (;;) {
          const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true });
          let i: number; while ((i = buf.indexOf('\n\n')) >= 0) {
            const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
            let ev = 'message', data = ''; for (const line of chunk.split('\n')) { if (line.startsWith('event:')) ev = line.slice(6).trim(); else if (line.startsWith('data:')) data += line.slice(5).trim(); }
            if (data) { try { onEvent(ev, JSON.parse(data)); } catch { /* */ } }
          }
        }
      } catch { /* 断了重连 */ }
      if (!stopped) await new Promise((res) => setTimeout(res, 3000));
    }
  };
  void run();
  return () => { stopped = true; ctrl?.abort(); };
}
/** 本地 A*（离线也能画路线），与服务器 routes/map.ts 同规则 */
export function localRoute(m: KMap, target: { x: number; y: number; w: number; h: number }) {
  const W = m.width, H = m.height; const grid: boolean[][] = Array.from({ length: H }, () => Array(W).fill(true));
  if (m.walkable_grid?.length) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) grid[y][x] = (m.walkable_grid[y]?.[x] ?? 1) !== 0;
  for (const e of m.elements) if (['RACK', 'WALL', 'COUNTER', 'KIOSK'].includes(e.kind)) for (let y = e.y; y < e.y + e.h; y++) for (let x = e.x; x < e.x + e.w; x++) if (y >= 0 && y < H && x >= 0 && x < W) grid[y][x] = false;
  const goals = new Set<string>();
  for (let y = target.y - 1; y <= target.y + target.h; y++) for (let x = target.x - 1; x <= target.x + target.w; x++) { const inside = x >= target.x && x < target.x + target.w && y >= target.y && y < target.y + target.h; if (!inside && x >= 0 && y >= 0 && x < W && y < H && grid[y][x]) goals.add(`${x},${y}`); }
  const start = { x: m.kiosk_x, y: m.kiosk_y }; if (!goals.size) return { found: false, path: [start] };
  const tc = { x: target.x + target.w / 2, y: target.y + target.h / 2 }; const h = (x: number, y: number) => Math.abs(x - tc.x) + Math.abs(y - tc.y);
  const key = (x: number, y: number) => y * W + x; const g = new Map<number, number>(); const prev = new Map<number, number>(); const open: { k: number; f: number }[] = []; const closed = new Set<number>();
  const sk = key(start.x, start.y); g.set(sk, 0); open.push({ k: sk, f: h(start.x, start.y) }); let end = -1;
  while (open.length) {
    open.sort((a, b) => a.f - b.f); const cur = open.shift()!; if (closed.has(cur.k)) continue; closed.add(cur.k);
    const cx = cur.k % W, cy = Math.floor(cur.k / W); if (goals.has(`${cx},${cy}`)) { end = cur.k; break; }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = cx + dx, ny = cy + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H || !grid[ny][nx]) continue; const nk = key(nx, ny); const ng = (g.get(cur.k) ?? 0) + 1; if (ng < (g.get(nk) ?? Infinity)) { g.set(nk, ng); prev.set(nk, cur.k); open.push({ k: nk, f: ng + h(nx, ny) }); } }
  }
  if (end < 0) return { found: false, path: [start] };
  const path: { x: number; y: number }[] = []; let k = end; while (k !== undefined) { path.unshift({ x: k % W, y: Math.floor(k / W) }); if (k === sk) break; k = prev.get(k)!; }
  return { found: true, path };
}
export function findTarget(m: KMap, loc: { location_id: string; zone_id?: string; rack?: number | null }) {
  return m.elements.find((e) => e.location_id === loc.location_id) ?? m.elements.find((e) => e.kind === 'RACK' && e.zone_id === loc.zone_id && loc.rack != null && Number(e.rack) === Number(loc.rack)) ?? m.elements.find((e) => e.zone_id === loc.zone_id && (e.kind === 'RACK' || e.kind === 'ZONE')) ?? null;
}
