// Telegram：老板审批按钮、日报、提醒。没有配置 bot token 时写入 notification 表（测试和未绑定公司），不抛错。
import { adminPool } from './db.js';

export type TgButton = { text: string; callback_data?: string; url?: string };
export interface TgConfig { token: string | null; chatId: string | null }

export async function tgConfig(companyId: string): Promise<TgConfig> {
  const c = (await adminPool.query(`SELECT telegram_chat_id, settings FROM company WHERE id = $1`, [companyId])).rows[0];
  const token = process.env.TELEGRAM_BOT_TOKEN || c?.settings?.telegram_bot_token || null;
  return { token: token || null, chatId: c?.telegram_chat_id || c?.settings?.telegram_chat_id || null };
}

async function tgApi(token: string, method: string, body: any) {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  const j: any = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error(`telegram ${method}: ${j.description ?? r.status}`);
  return j.result;
}

/** 给公司老板群/老板发消息。返回 message_id（没配置时返回 null，并写 notification 给 BOSS 角色用户）。 */
export async function tgSend(companyId: string, text: string, buttons?: TgButton[][], opts: { chatId?: string; type?: string; refType?: string; refId?: string } = {}): Promise<string | null> {
  const cfg = await tgConfig(companyId);
  const chatId = opts.chatId ?? cfg.chatId;
  if (cfg.token && chatId) {
    try {
      const r = await tgApi(cfg.token, 'sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', reply_markup: buttons ? { inline_keyboard: buttons } : undefined });
      return String(r.message_id);
    } catch (e: any) { console.error('telegram send failed', e.message); }
  }
  // 未配置：记到通知表，网页端"通知"页可看；也方便测试断言
  await adminPool.query(
    `INSERT INTO notification (company_id, user_id, channel, type, ref_type, ref_id, text)
     SELECT $1, u.id, 'TELEGRAM', $2, $3, $4, $5 FROM app_user u JOIN user_site_role usr ON usr.user_id = u.id JOIN role r ON r.id = usr.role_id
     WHERE u.company_id = $1 AND r.code = 'BOSS' AND u.is_active GROUP BY u.id`,
    [companyId, opts.type ?? 'MESSAGE', opts.refType ?? null, opts.refId ?? null, text.replace(/<[^>]+>/g, '')]);
  return null;
}

export async function tgSendToUser(companyId: string, userId: string, text: string, buttons?: TgButton[][], type = 'MESSAGE') {
  const u = (await adminPool.query(`SELECT telegram_user_id FROM app_user WHERE id = $1`, [userId])).rows[0];
  const cfg = await tgConfig(companyId);
  if (cfg.token && u?.telegram_user_id) {
    try { const r = await tgApi(cfg.token, 'sendMessage', { chat_id: u.telegram_user_id, text, parse_mode: 'HTML', reply_markup: buttons ? { inline_keyboard: buttons } : undefined }); return String(r.message_id); } catch (e: any) { console.error('telegram send failed', e.message); }
  }
  await adminPool.query(`INSERT INTO notification (company_id, user_id, channel, type, text) VALUES ($1,$2,'TELEGRAM',$3,$4)`, [companyId, userId, type, text.replace(/<[^>]+>/g, '')]);
  return null;
}

export async function tgEdit(companyId: string, messageId: string, text: string, buttons?: TgButton[][], chatId?: string) {
  const cfg = await tgConfig(companyId); const cid = chatId ?? cfg.chatId;
  if (!cfg.token || !cid) return;
  try { await tgApi(cfg.token, 'editMessageText', { chat_id: cid, message_id: Number(messageId), text, parse_mode: 'HTML', reply_markup: buttons ? { inline_keyboard: buttons } : { inline_keyboard: [] } }); } catch (e: any) { console.error('telegram edit failed', e.message); }
}
export async function tgAnswerCallback(token: string, callbackQueryId: string, text: string) {
  try { await tgApi(token, 'answerCallbackQuery', { callback_query_id: callbackQueryId, text }); } catch { /* ignore */ }
}
export async function tgSendDocument(companyId: string, filePath: string, caption: string, filename: string, chatId?: string) {
  const cfg = await tgConfig(companyId); const cid = chatId ?? cfg.chatId;
  if (!cfg.token || !cid) return null;
  try {
    const { readFile } = await import('node:fs/promises');
    const fd = new FormData(); fd.append('chat_id', cid); fd.append('caption', caption); fd.append('document', new Blob([await readFile(filePath)]), filename);
    const r = await fetch(`https://api.telegram.org/bot${cfg.token}/sendDocument`, { method: 'POST', body: fd, signal: AbortSignal.timeout(30000) });
    const j: any = await r.json(); return j.ok ? String(j.result.message_id) : null;
  } catch (e: any) { console.error('telegram document failed', e.message); return null; }
}
