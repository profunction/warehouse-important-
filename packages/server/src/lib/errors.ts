import { ERROR_MESSAGES } from '@wh/shared';
export class AppError extends Error {
  constructor(public status: number, public code: string, public detail?: unknown) { super(code); }
  toJSON() {
    const m = ERROR_MESSAGES[this.code] ?? ERROR_MESSAGES.INTERNAL;
    return { code: this.code, message_zh: m.zh, message_ms: m.ms, message_en: m.en, detail: this.detail };
  }
}
export const unauthorized = () => new AppError(401, 'UNAUTHORIZED');
export const forbidden = (detail?: unknown) => new AppError(403, 'FORBIDDEN', detail);
export const notFound = (code = 'NOT_FOUND') => new AppError(404, code);
export const badRequest = (code = 'VALIDATION', detail?: unknown) => new AppError(400, code, detail);
/** 把数据库触发器抛出的错误翻译成 AppError */
export function fromDbError(e: any): AppError {
  const m = String(e?.message ?? '');
  const codes = ['LOCATION_NOT_FOUND','LOCATION_INACTIVE','PRODUCT_NOT_FOUND','PRODUCT_INACTIVE','COMPANY_MISMATCH','REASON_DISABLED','PERMISSION_DENIED','CATEGORY_NOT_ALLOWED_IN_ZONE','INSUFFICIENT_STOCK','CROSS_SITE_NOT_ALLOWED','SHELF_ASSIGNMENT_NEEDS_SHOP_SHELF','TRANSFER_NEEDS_TRANSIT'];
  for (const c of codes) if (m.startsWith(c)) return new AppError(c === 'PERMISSION_DENIED' ? 403 : 400, c, m);
  if (e?.code === '23505') return new AppError(409, 'DUPLICATE', e.detail);
  if (e?.code === '23514' || e?.code === '22P02' || e?.code === '23502') return new AppError(400, 'VALIDATION', e.message);
  if (e?.code === '23503') return new AppError(400, 'NOT_FOUND', e.detail);
  if (m.includes('不能批准自己')) return new AppError(400, 'APPROVAL_SELF');
  if (m.includes('不可修改')) return new AppError(400, 'VALIDATION', m);
  if (process.env.NODE_ENV === 'test') console.error('DBERR', e?.code, m.slice(0, 300));
  return new AppError(500, 'INTERNAL', m);
}
