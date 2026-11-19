// 硬件桥接客户端：连本机 wh-bridge（ws://127.0.0.1:9123）。命令 print / drawer / scale / status。
// 协议：请求 { id, cmd, ...参数 }，响应 { id, ok, result?, error? }；桥接主动推 { event: 'status', ... }。
// 断线静默：自动每 5 秒重连；没有桥接时所有命令立即 resolve null（页面照常工作，打印落到控制台）。
// 地址可在 localStorage 'wh.bridge' 覆盖（例如安卓平板连收银电脑的 ws://192.168.1.10:9123）。
export type BridgeStatus = { connected: boolean; printer?: string | null; scale?: string | null; drawer?: string | null; simulate?: boolean };
type Pending = { resolve: (v: any) => void; timer: any };
const listeners = new Set<(s: BridgeStatus) => void>();
let status: BridgeStatus = { connected: false };
let ws: WebSocket | null = null; let seq = 0; let retry: any = null; let started = false;
const pending = new Map<number, Pending>();
const url = () => { try { return localStorage.getItem('wh.bridge') || 'ws://127.0.0.1:9123'; } catch { return 'ws://127.0.0.1:9123'; } };
const emit = () => listeners.forEach((f) => f({ ...status }));
function connect() {
  if (typeof WebSocket === 'undefined') return;
  try { ws = new WebSocket(url()); } catch { schedule(); return; }
  ws.onopen = () => { status = { ...status, connected: true }; emit(); void send('status', {}, 3000).then((r) => { if (r) { status = { connected: true, ...r }; emit(); } }); };
  ws.onclose = () => { status = { connected: false }; emit(); ws = null; for (const [, p] of pending) { clearTimeout(p.timer); p.resolve(null); } pending.clear(); schedule(); };
  ws.onerror = () => { /* 静默，onclose 会重连 */ };
  ws.onmessage = (ev) => {
    let m: any; try { m = JSON.parse(String(ev.data)); } catch { return; }
    if (m.id != null && pending.has(m.id)) { const p = pending.get(m.id)!; clearTimeout(p.timer); pending.delete(m.id); p.resolve(m.ok ? (m.result ?? true) : null); }
    else if (m.event === 'status') { status = { connected: true, ...m }; delete (status as any).event; emit(); }
  };
}
function schedule() { clearTimeout(retry); retry = setTimeout(connect, 5000); }
export function startBridge() { if (started) return; started = true; connect(); }
export function subscribeBridge(fn: (s: BridgeStatus) => void) { listeners.add(fn); fn({ ...status }); return () => { listeners.delete(fn); }; }
export const bridgeStatus = () => ({ ...status });
/** 发命令；未连接或超时返回 null */
export function send(cmd: 'print' | 'drawer' | 'scale' | 'status' | 'beep', payload: Record<string, any> = {}, timeoutMs = 8000): Promise<any> {
  return new Promise((resolve) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return resolve(null);
    const id = ++seq;
    const timer = setTimeout(() => { pending.delete(id); resolve(null); }, timeoutMs);
    pending.set(id, { resolve, timer });
    try { ws.send(JSON.stringify({ id, cmd, ...payload })); } catch { clearTimeout(timer); pending.delete(id); resolve(null); }
  });
}
export const bridge = {
  start: startBridge, subscribe: subscribeBridge, status: bridgeStatus,
  /** 打印：优先 ESC/POS（base64），否则纯文本（桥接按 32 列打） */
  print: (text: string, escposBase64?: string | null, opts: { openDrawer?: boolean } = {}) => send('print', { text, escpos: escposBase64 ?? null, open_drawer: !!opts.openDrawer }, 15000),
  drawer: () => send('drawer', {}, 5000),
  /** 读秤：返回 { weight_kg, stable } 或 null */
  scale: (): Promise<{ weight_kg: number; stable: boolean } | null> => send('scale', {}, 4000),
  ping: () => send('status', {}, 3000),
};
