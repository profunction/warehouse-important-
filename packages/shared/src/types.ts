export type HomeButton = { screen: string; icon: string; color: string };
export interface MeResponse {
  user: { id: string; name: string; language: 'zh' | 'ms' | 'en'; font_scale: number; photo_url: string | null; is_super_admin: boolean };
  company: { id: string; name: string; short_code: string; plan: 'A' | 'B'; settings: Record<string, unknown>; feature_flags: Record<string, boolean> };
  site: { id: string; code: string; name: string; type: 'WAREHOUSE' | 'SHOP' } | null;
  sites: { id: string; code: string; name: string; type: string; roles: string[] }[];
  roles: string[];
  permissions: Record<string, Record<string, unknown> | null>;
  home_buttons: HomeButton[];
}
export interface SyncPushItem {
  client_id: string;
  entity: 'movement' | 'shelf_assignment' | 'ticket';
  op: 'insert' | 'upsert';
  seq: number;
  payload: Record<string, unknown>;
}
export interface SyncPushRequest {
  batch_id: string;
  device_id: string;
  app_version: string;
  device_time: string;
  pending_count?: number;
  items: SyncPushItem[];
}
export type SyncItemStatus = 'applied' | 'duplicate' | 'rejected' | 'quarantined';
export interface SyncPushResult {
  client_id: string;
  status: SyncItemStatus;
  server_id?: string;
  code?: string;
  message_zh?: string; message_ms?: string; message_en?: string;
  ticket_id?: string;
}
export const SYNC_ENTITIES = ['product', 'barcode', 'category', 'tax_code', 'supplier', 'zone', 'location', 'stock', 'shelf_assignment', 'knowledge_article'] as const;
export type SyncEntity = typeof SYNC_ENTITIES[number];
