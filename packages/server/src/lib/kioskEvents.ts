// 大屏实时事件（模块 E）。设计：
// - 事件来源两路：① 数据库触发器（migrations/013）在 shelf_assignment / product 写入时 pg_notify('kiosk', json)，
//   这样 routes/stock.ts 不用改；② 服务器自己发（map.published、help.accepted）走 publishKioskEvent → 本地 emit + pg_notify（多进程也能收到）。
// - 服务器用一条专用 pg.Client 连接 LISTEN kiosk（不占 adminPool），收到后 emit 到进程内 EventEmitter。
// - GET /kiosk/events 用 Fastify reply.raw 做 SSE（不用 WebSocket，省依赖；大屏前端 EventSource 自带重连）。
// - 自己发出的通知带 pid，LISTEN 收到时跳过，避免本进程重复推送。
import pg from 'pg';
import { EventEmitter } from 'node:events';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from './config.js';
import { adminPool } from './db.js';

export type KioskEventName = 'shelf.updated' | 'map.published' | 'help.accepted' | 'price.updated';
export interface KioskEvent { event: KioskEventName; company_id: string; site_id?: string | null; [k: string]: any }

export const kioskBus = new EventEmitter();
kioskBus.setMaxListeners(500);

let listener: pg.Client | null = null;
let starting: Promise<void> | null = null;
export async function startKioskListener() {
  if (listener) return;
  if (starting) return starting;
  starting = (async () => {
    const c = new pg.Client({ connectionString: `postgres://${config.adminUser}:${config.adminPass}@${config.dbHost}:${config.dbPort}/${config.dbName}` });
    await c.connect();
    await c.query('LISTEN kiosk');
    c.on('notification', (n) => {
      if (!n.payload) return;
      try { const ev = JSON.parse(n.payload); if (ev.pid === process.pid) return; kioskBus.emit('event', ev); } catch { /* 坏消息忽略 */ }
    });
    c.on('error', (e) => { console.error('kiosk listener error', e.message); listener = null; });
    listener = c;
  })().finally(() => { starting = null; });
  return starting;
}
export async function stopKioskListener() { const c = listener; listener = null; if (c) await c.end().catch(() => {}); }

/** 服务器侧发事件：本进程立即 emit，同时 pg_notify 让其他进程的 SSE 也收到 */
export async function publishKioskEvent(ev: KioskEvent) {
  const full = { ...ev, at: new Date().toISOString() };
  kioskBus.emit('event', full);
  try { await adminPool.query(`SELECT pg_notify('kiosk', $1)`, [JSON.stringify({ ...full, pid: process.pid })]); } catch (e: any) { console.error('pg_notify failed', e.message); }
}

/** SSE 处理器：按 api key 的公司/站点过滤 */
export async function sseHandler(req: FastifyRequest, reply: FastifyReply) {
  const key = req.apiKey!;
  await startKioskListener().catch((e) => console.error('kiosk listener start failed', e.message));
  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no', 'access-control-allow-origin': '*' });
  res.write(`event: hello\ndata: ${JSON.stringify({ site_id: key.siteId, at: new Date().toISOString() })}\n\n`);
  const onEvent = (ev: KioskEvent) => {
    if (ev.company_id !== key.companyId) return;
    if (ev.site_id && key.siteId && ev.site_id !== key.siteId) return;
    res.write(`event: ${ev.event}\ndata: ${JSON.stringify(ev)}\n\n`);
  };
  kioskBus.on('event', onEvent);
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* */ } }, 25000);
  const cleanup = () => { clearInterval(ping); kioskBus.off('event', onEvent); try { res.end(); } catch { /* */ } };
  req.raw.on('close', cleanup); req.raw.on('error', cleanup);
}
