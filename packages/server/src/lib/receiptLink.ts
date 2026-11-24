// 收据上的二维码：顾客用手机扫，自己填电子发票资料。链接带短签名，别人不能猜别的收据号去改。
import { createHmac } from 'node:crypto';
import { config } from './config.js';
export const receiptToken = (companyId: string, receiptNo: string) => createHmac('sha256', config.fileTokenSecret).update(`einv:${companyId}:${receiptNo}`).digest('hex').slice(0, 12);
/** 公网地址：环境变量 PUBLIC_URL 优先，其次收银机最近一次用的地址（localhost 不算，顾客手机打不开） */
export function publicBase(settings: any): string | null {
  const u = (process.env.PUBLIC_URL || settings?.public_url || '').replace(/\/$/, '');
  if (!u || /\/\/(localhost|127\.|0\.0\.0\.0)/.test(u)) return null;
  return u;
}
export function receiptUrl(base: string | null, shortCode: string, companyId: string, receiptNo: string) {
  if (!base) return null;
  return `${base}/e/${shortCode}/${encodeURIComponent(receiptNo)}?t=${receiptToken(companyId, receiptNo)}`;
}
