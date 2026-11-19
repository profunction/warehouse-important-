// 离线同步实体处理器注册表：各模块注册自己的实体（count_line、grn_line、sale …），sync/push 按 entity 分发。
import type { Tx } from './db.js';
import type { RequestCtx } from './auth.js';
export type SyncHandler = (tx: Tx, ctx: RequestCtx, clientId: string, payload: any, deviceId: string) => Promise<string>;
const handlers = new Map<string, SyncHandler>();
export function registerSyncHandler(entity: string, h: SyncHandler) { handlers.set(entity, h); }
export function getSyncHandler(entity: string) { return handlers.get(entity); }
