// 网页端共用小工具
import { api, ApiError } from '../../../api/client.js';
export const fmtDate = (v?: string | null) => (v ? new Date(v).toLocaleString('zh-CN') : '—');
export const fmtMoney = (v: any) => (v == null ? '—' : Number(v).toFixed(2));
export const fmtQty = (v: any) => (v == null ? '—' : String(Number(v)));
export const errText = (e: any) => (e instanceof ApiError ? `${e.text('zh')}${e.body?.detail ? ' · ' + (typeof e.body.detail === 'string' ? e.body.detail : JSON.stringify(e.body.detail)) : ''}` : String(e?.message ?? e));
/** 下载二进制响应（PDF、Excel） */
export async function downloadRaw(path: string, filename: string, opts: { method?: string; body?: any } = {}) {
  const r: Response = await api(path, { ...opts, raw: true });
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export const REASON_ZH: Record<string, string> = { RECEIVE: '收货', PUTAWAY: '上架', REFILL: '补货', TRANSFER_OUT: '调出', TRANSFER_IN: '调入', SALE: '销售', RETURN: '退货', COUNT: '盘点', ADJUST: '调整' };
export const ROLE_ZH: Record<string, string> = { SUPER_ADMIN: '超级管理员', BOSS: '老板', MANAGER: '经理', PURCHASER: '采购员', WAREHOUSE: '库存员', COUNTER: '盘点员', STOCKER: '上架员', CASHIER: '收银员', ACCOUNTS: '会计' };
export const ZONE_TYPE_ZH: Record<string, string> = { RECEIVING: '收货', STORAGE: '存储', SHELF: '货架', BACKROOM: '后仓' };
export const STATUS_ZH: Record<string, string> = { UPLOADED: '已上传', VALIDATING: '验证中', VALIDATED: '已验证', PENDING_APPROVAL: '待审批', APPLYING: '执行中', APPLIED: '已执行', REJECTED: '已拒绝', FAILED: '失败', PENDING: '待批', APPROVED: '已批准', RETURNED: '已退回', NEW: '新建', IN_PROGRESS: '处理中', WAITING: '等待他人', RESOLVED: '已解决', CLOSED: '已关闭', ACTIVE: '正常', OFFLINE: '离线', DISABLED: '已停用' };
export const pillColor = (s: string) => (['APPLIED', 'APPROVED', 'RESOLVED', 'CLOSED', 'ACTIVE', 'OK'].includes(s) ? '#1B8A3A' : ['REJECTED', 'FAILED', 'DISABLED', 'ERROR'].includes(s) ? '#C62828' : ['PENDING_APPROVAL', 'PENDING', 'WARNING', 'OFFLINE', 'WAITING'].includes(s) ? '#F9A825' : '#1565C0');
