// 同步客户端：拉取增量、推送 outbox、在线状态、事件
import { api, ApiError, APP_VERSION, tokens, isOnline } from '../api/client.js';
import { db, kvGet, kvSet, type OutboxItem } from './db.js';
import { SYNC_ENTITIES } from '@wh/shared';

export type SyncState = { online: boolean; pending: number; rejected: number; lastPull: string | null; lastPush: string | null; syncing: boolean; justSynced: boolean; clockSkew: number | null; quarantinedRecently: number };
const state: SyncState = { online: isOnline(), pending: 0, rejected: 0, lastPull: null, lastPush: null, syncing: false, justSynced: false, clockSkew: null, quarantinedRecently: 0 };
const listeners = new Set<(s: SyncState) => void>();
export const subscribe = (fn: (s: SyncState) => void) => { listeners.add(fn); fn(state); return () => { listeners.delete(fn); }; };
const emit = () => listeners.forEach((f) => f({ ...state }));
export const getState = () => ({ ...state });
export const uuidv7 = () => {
  const ts = Date.now(); const b = new Uint8Array(16); crypto.getRandomValues(b);
  b[0] = ts / 2 ** 40; b[1] = ts / 2 ** 32; b[2] = ts / 2 ** 24; b[3] = ts / 2 ** 16; b[4] = ts / 2 ** 8; b[5] = ts;
  b[6] = (b[6] & 0x0f) | 0x70; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

async function refreshCounts() {
  state.pending = await db.outbox.where('status').anyOf('pending', 'sending').count();
  state.rejected = await db.outbox.where('status').equals('rejected').count();
}
export async function enqueue(item: Omit<OutboxItem, 'seq' | 'created_at' | 'status'>) {
  const seq = (await kvGet('outbox.seq', 0)) + 1; await kvSet('outbox.seq', seq);
  await db.outbox.put({ ...item, seq, created_at: new Date().toISOString(), status: 'pending' });
  await refreshCounts(); emit();
  void push();
  return item.client_id;
}

let pulling = false;
export async function pull(full = false): Promise<boolean> {
  if (!tokens.access || !isOnline() || pulling) return false;
  pulling = true;
  try {
    let cursor = full ? '' : await kvGet<string>('sync.cursor', '');
    if (full) await Promise.all([db.product.clear(), db.barcode.clear(), db.location.clear(), db.zone.clear(), db.stock.clear(), db.shelf_assignment.clear(), db.category.clear(), db.knowledge_article.clear()]);
    for (let i = 0; i < 50; i++) {
      const r = await api(`/sync/pull?entities=${SYNC_ENTITIES.join(',')}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { timeoutMs: 60000 });
      const d = r.data as Record<string, any[]>;
      await db.transaction('rw', [db.product, db.barcode, db.location, db.zone, db.stock, db.shelf_assignment, db.category, db.knowledge_article], async () => {
        if (d.product?.length) await db.product.bulkPut(d.product);
        if (d.barcode?.length) await db.barcode.bulkPut(d.barcode);
        if (d.location?.length) await db.location.bulkPut(d.location);
        if (d.zone?.length) await db.zone.bulkPut(d.zone);
        if (d.category?.length) await db.category.bulkPut(d.category);
        if (d.shelf_assignment?.length) await db.shelf_assignment.bulkPut(d.shelf_assignment);
        if (d.knowledge_article?.length) await db.knowledge_article.bulkPut(d.knowledge_article);
        if (d.stock?.length) await db.stock.bulkPut(d.stock.map((s: any) => ({ key: s.product_id + s.location_id, product_id: s.product_id, location_id: s.location_id, qty: Number(s.qty), earliest_expiry: s.earliest_expiry })));
      });
      cursor = r.cursor; await kvSet('sync.cursor', cursor);
      await kvSet('sync.settings', r.settings); await kvSet('sync.feature_flags', r.feature_flags);
      if (!r.has_more) break;
    }
    state.lastPull = new Date().toISOString(); await kvSet('sync.lastPull', state.lastPull);
    emit(); return true;
  } catch (e) { if (e instanceof ApiError && e.status === 401) { /* 交给全局 */ } return false; }
  finally { pulling = false; }
}

let pushing = false; let retryTimer: any = null; let backoff = 0;
const BACKOFF = [5, 30, 120, 600, 1800];
export async function push(): Promise<void> {
  if (!tokens.access || !tokens.device || !isOnline() || pushing) return;
  const items = await db.outbox.where('status').equals('pending').sortBy('seq');
  if (!items.length) return;
  pushing = true; state.syncing = true; emit();
  try {
    const batch = items.slice(0, 200);
    await db.outbox.bulkPut(batch.map((i) => ({ ...i, status: 'sending' as const })));
    const r = await api('/sync/push', { body: { batch_id: uuidv7(), device_id: tokens.device, app_version: APP_VERSION, device_time: new Date().toISOString(), pending_count: items.length, items: batch.map(({ client_id, entity, op, seq, payload }) => ({ client_id, entity, op, seq, payload })) }, timeoutMs: 30000 });
    state.clockSkew = r.clock_skew_seconds ?? null;
    let quarantined = 0;
    for (const res of r.results as any[]) {
      if (res.status === 'applied' || res.status === 'duplicate') await db.outbox.delete(res.client_id);
      else if (res.status === 'quarantined') { await db.outbox.delete(res.client_id); quarantined++; }
      else await db.outbox.update(res.client_id, { status: 'rejected', error: { code: res.code, message_zh: res.message_zh, message_ms: res.message_ms, message_en: res.message_en } });
    }
    state.quarantinedRecently += quarantined;
    state.lastPush = new Date().toISOString(); backoff = 0;
    state.justSynced = true; setTimeout(() => { state.justSynced = false; emit(); }, 2000);
    await refreshCounts(); emit();
    void pull();
    if (items.length > batch.length) { pushing = false; return push(); }
  } catch (e) {
    await db.outbox.where('status').equals('sending').modify({ status: 'pending' });
    if (e instanceof ApiError && (e.status === 426 || e.status === 423)) { /* 版本或设备问题，由 UI 提示 */ }
    const delay = (e instanceof ApiError && e.status === 503 ? 60 : BACKOFF[Math.min(backoff++, BACKOFF.length - 1)]) * 1000;
    clearTimeout(retryTimer); retryTimer = setTimeout(() => void push(), delay);
  } finally { pushing = false; state.syncing = false; await refreshCounts(); emit(); }
}
export async function retryRejected(clientId: string, newPayload?: any) {
  await db.outbox.update(clientId, { status: 'pending', error: undefined, ...(newPayload ? { payload: newPayload } : {}) }); await refreshCounts(); emit(); void push();
}
export async function deleteRejected(clientId: string) { await db.outbox.delete(clientId); await refreshCounts(); emit(); }
export async function clearLocal() { await Promise.all(db.tables.filter((t) => t.name !== 'outbox').map((t) => t.clear())); }

let started = false;
export async function start() {
  if (started) return; started = true;
  state.lastPull = await kvGet('sync.lastPull', null); await refreshCounts(); emit();
  window.addEventListener('online', () => { state.online = true; emit(); void push(); void pull(); });
  window.addEventListener('offline', () => { state.online = false; emit(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { void push(); void pull(); } });
  setInterval(() => { if (document.visibilityState === 'visible') void pull(); }, 60_000);
  setInterval(() => void push(), 30_000);
  void pull(); void push();
}
export const isStale = () => !!state.lastPull && Date.now() - new Date(state.lastPull).getTime() > 24 * 3600_000;
