// 模块 B：Telegram 入口。老板在 Telegram 按「批准/拒绝/看明细」→ 这里 → decideApproval；/start <绑定码> 绑定账号；公司设 bot。
// 设计文档没写而这里定下的：
//  - webhook 无登录，校验 header x-telegram-bot-api-secret-token = env TELEGRAM_WEBHOOK_SECRET 或任一公司 settings.telegram_webhook_secret（POST /company/telegram 时自动生成）。
//  - 按钮回调：按审批所属公司 + from.id 找 app_user.telegram_user_id（adminPool 跨公司），构造 RequestCtx 后走审批引擎（代理规则一并生效）。永远回 200 给 Telegram，结果放在 handled/result 里。
//  - 绑定码 6 位数字，15 分钟过期，一次性（表 telegram_link，迁移 013）。
//  - 普通文字先回「请用 App 问机器人」。TODO（第四阶段模块 E）：接 /bot/ask 做自由问答。
//  - POST /company/telegram 调 setWebhook 到 PUBLIC_URL + /api/v1/bot/telegram/webhook，失败不抛，结果放在 webhook 字段。
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomBytes, randomInt } from 'node:crypto';
import { adminPool, withCompany } from '../lib/db.js';
import { requireAuth, requirePerm, loadCtx } from '../lib/auth.js';
import { AppError } from '../lib/errors.js';
import { decideApproval, TYPE_ZH, type ApprovalType } from '../lib/approvals.js';
import { tgAnswerCallback, tgConfig, tgSend } from '../lib/telegram.js';
import { varianceLines } from './counts.js';
import { ADJUST_REASON_ZH } from './approvals.js';

async function secretOk(secret: string | undefined) {
  if (!secret) return false;
  if (process.env.TELEGRAM_WEBHOOK_SECRET && secret === process.env.TELEGRAM_WEBHOOK_SECRET) return true;
  return ((await adminPool.query(`SELECT 1 FROM company WHERE settings->>'telegram_webhook_secret' = $1 LIMIT 1`, [secret])).rowCount ?? 0) > 0;
}
async function userByTelegram(tgUserId: string, companyId?: string) {
  return (await adminPool.query(`SELECT id, company_id, name FROM app_user WHERE telegram_user_id = $1 AND is_active AND ($2::uuid IS NULL OR company_id = $2) ORDER BY updated_at DESC LIMIT 1`, [tgUserId, companyId ?? null])).rows[0];
}
const errZh = (e: any) => (e instanceof AppError ? e.toJSON().message_zh : '系统出错了');

export async function telegramRoutes(app: FastifyInstance) {
  // ---------- Webhook（无登录） ----------
  app.post('/bot/telegram/webhook', async (req) => {
    if (!(await secretOk(req.headers['x-telegram-bot-api-secret-token'] as string | undefined))) throw new AppError(403, 'FORBIDDEN');
    const u: any = req.body ?? {};
    try {
      if (u.callback_query) return await handleCallback(u.callback_query);
      if (u.message?.text) return await handleMessage(u.message);
      return { ok: true, handled: 'ignored' };
    } catch (e: any) {
      console.error('telegram webhook', e?.message);
      return { ok: true, handled: 'error', error: e instanceof AppError ? e.code : 'INTERNAL' };
    }
  });
  async function handleCallback(cb: any) {
    const m = /^apr:([0-9a-f-]{36}):(approve|reject|detail)$/.exec(String(cb.data ?? ''));
    const tgUid = String(cb.from?.id ?? '');
    const chatId = String(cb.message?.chat?.id ?? cb.from?.id ?? '');
    if (!m) return { ok: true, handled: 'unknown_callback' };
    const [, id, action] = m;
    const a = (await adminPool.query(`SELECT id, company_id, type, status, amount, summary, ref_id, requested_by FROM approval_request WHERE id = $1`, [id])).rows[0];
    if (!a) return { ok: true, handled: 'not_found' };
    const cfg = await tgConfig(a.company_id);
    const answer = (text: string) => (cfg.token && cb.id ? tgAnswerCallback(cfg.token, String(cb.id), text) : Promise.resolve());
    const user = await userByTelegram(tgUid, a.company_id);
    if (!user) { await answer('请先在 App 设置里绑定 Telegram'); return { ok: true, handled: 'unbound' }; }
    const ctx = await loadCtx({ uid: user.id, cid: a.company_id, sid: null, typ: 'access' }, null);
    if (action === 'detail') {
      const text = await withCompany({ companyId: a.company_id, userId: user.id }, async (tx) => {
        const req = (await tx.query(`SELECT name FROM app_user WHERE id = $1`, [a.requested_by])).rows[0];
        const lines = [`<b>${TYPE_ZH[a.type as ApprovalType] ?? a.type}</b> · ${a.status}`, `发起人：${req?.name ?? ''}`];
        if (a.amount != null) lines.push(`金额：RM ${Number(a.amount).toFixed(2)}`);
        if (a.summary?.title) lines.push(String(a.summary.title));
        if (a.type === 'COUNT_VARIANCE') {
          const v = (await varianceLines(tx, ctx, a.ref_id)).filter((l: any) => Number(l.variance_qty) !== 0).slice(0, 15);
          for (const l of v) lines.push(`${l.location_code} ${l.name_zh ?? l.name_en ?? l.sku}：系统 ${Number(l.system_qty)} 实数 ${Number(l.counted_qty)} 差 ${Number(l.variance_qty) > 0 ? '+' : ''}${Number(l.variance_qty)}（RM ${Number(l.variance_amount ?? 0).toFixed(2)}）`);
        }
        if (a.type === 'ADJUST' && a.summary) lines.push(`原因：${ADJUST_REASON_ZH[a.summary.reason] ?? a.summary.reason}${a.summary.note ? ` · ${a.summary.note}` : ''}`);
        return lines.join('\n');
      });
      await tgSend(a.company_id, text, undefined, { chatId, type: 'APPROVAL_DETAIL', refType: 'approval_request', refId: a.id });
      await answer('已发送明细');
      return { ok: true, handled: 'detail' };
    }
    try {
      const r = await withCompany({ companyId: a.company_id, userId: user.id }, (tx) => decideApproval(tx, ctx, a.id, action as 'approve' | 'reject', 'Telegram'));
      await answer(action === 'approve' ? '已批准' : '已拒绝');
      return { ok: true, handled: action, result: r.status, on_behalf_of: r.on_behalf_of };
    } catch (e: any) {
      await answer(errZh(e));
      return { ok: true, handled: action, error: e instanceof AppError ? e.code : 'INTERNAL' };
    }
  }
  async function handleMessage(msg: any) {
    const text = String(msg.text ?? '').trim();
    const tgUid = String(msg.from?.id ?? ''); const chatId = String(msg.chat?.id ?? tgUid);
    const start = /^\/start(?:@\w+)?\s+(\d{6})$/.exec(text);
    if (start) {
      const link = (await adminPool.query(`SELECT * FROM telegram_link WHERE code = $1 AND used_at IS NULL AND expires_at > now()`, [start[1]])).rows[0];
      if (!link) return { ok: true, handled: 'bad_code' };
      await adminPool.query(`UPDATE app_user SET telegram_user_id = $2 WHERE id = $1`, [link.user_id, tgUid]);
      await adminPool.query(`UPDATE telegram_link SET used_at = now() WHERE code = $1`, [start[1]]);
      const name = (await adminPool.query(`SELECT name FROM app_user WHERE id = $1`, [link.user_id])).rows[0]?.name;
      await tgSend(link.company_id, `✅ 已绑定：${name}。审批通知会发到这里。`, undefined, { chatId, type: 'TELEGRAM_LINK', refType: 'app_user', refId: link.user_id });
      return { ok: true, handled: 'linked', user_id: link.user_id };
    }
    const user = await userByTelegram(tgUid);
    if (user) await tgSend(user.company_id, '请用 App 的「问」按钮问机器人；审批请按消息里的按钮。', undefined, { chatId, type: 'MESSAGE' });   // TODO 模块 E：/bot/ask
    return { ok: true, handled: user ? 'echo' : 'unbound' };
  }

  // ---------- 登录后的接口 ----------
  app.register(async (api) => {
    api.addHook('preHandler', requireAuth);
    const cx = (req: any) => ({ companyId: req.ctx.companyId, userId: req.ctx.userId, deviceId: req.ctx.deviceId });
    api.get('/me/telegram-link', async (req) => {
      const u = (await adminPool.query(`SELECT telegram_user_id FROM app_user WHERE id = $1`, [req.ctx.userId])).rows[0];
      const c = (await adminPool.query(`SELECT settings->>'telegram_bot_username' AS bot FROM company WHERE id = $1`, [req.ctx.companyId])).rows[0];
      return { bound: !!u?.telegram_user_id, bot_username: c?.bot ?? null };
    });
    api.post('/me/telegram-link', async (req) => withCompany(cx(req), async (tx) => {
      let code = '';
      for (let i = 0; i < 5; i++) { code = String(randomInt(0, 1_000_000)).padStart(6, '0'); const r = await tx.query(`INSERT INTO telegram_link (code, company_id, user_id, expires_at) VALUES ($1,$2,$3, now() + interval '15 minutes') ON CONFLICT (code) DO NOTHING RETURNING code`, [code, req.ctx.companyId, req.ctx.userId]); if (r.rowCount) break; code = ''; }
      if (!code) throw new AppError(500, 'INTERNAL', 'code');
      const bot = (await tx.query(`SELECT settings->>'telegram_bot_username' AS bot FROM company WHERE id = $1`, [req.ctx.companyId])).rows[0]?.bot ?? null;
      return { code, expires_in_sec: 900, bot_username: bot, deep_link: bot ? `https://t.me/${bot}?start=${code}` : null, instruction: `在 Telegram 打开机器人，发送：/start ${code}` };
    }));
    api.post('/me/telegram-unlink', async (req) => { await adminPool.query(`UPDATE app_user SET telegram_user_id = NULL WHERE id = $1`, [req.ctx.userId]); return { ok: true }; });

    api.get('/company/telegram', { preHandler: requirePerm('settings.edit', 'integration.edit') }, async (req) => {
      const c = (await adminPool.query(`SELECT telegram_chat_id, settings FROM company WHERE id = $1`, [req.ctx.companyId])).rows[0];
      const tok: string | null = c?.settings?.telegram_bot_token ?? null;
      return { configured: !!(tok || process.env.TELEGRAM_BOT_TOKEN) && !!c?.telegram_chat_id, bot_token_masked: tok ? `${tok.slice(0, 4)}…${tok.slice(-4)}` : (process.env.TELEGRAM_BOT_TOKEN ? '(环境变量)' : null), chat_id: c?.telegram_chat_id ?? null, bot_username: c?.settings?.telegram_bot_username ?? null, webhook_url: `${(process.env.PUBLIC_URL ?? '').replace(/\/$/, '')}/api/v1/bot/telegram/webhook`, webhook_set_at: c?.settings?.telegram_webhook_set_at ?? null, has_secret: !!c?.settings?.telegram_webhook_secret };
    });
    api.post('/company/telegram', { preHandler: requirePerm('settings.edit', 'integration.edit') }, async (req) => {
      const b = z.object({ bot_token: z.string().min(10).optional().nullable(), chat_id: z.string().min(1).optional().nullable(), bot_username: z.string().optional().nullable() }).parse(req.body);
      const cur = (await adminPool.query(`SELECT settings FROM company WHERE id = $1`, [req.ctx.companyId])).rows[0]?.settings ?? {};
      const secret: string = cur.telegram_webhook_secret ?? randomBytes(16).toString('hex');
      const patch: Record<string, any> = { telegram_webhook_secret: secret };
      if (b.bot_token !== undefined) patch.telegram_bot_token = b.bot_token;
      if (b.bot_username !== undefined) patch.telegram_bot_username = b.bot_username?.replace(/^@/, '') ?? null;
      const token = b.bot_token ?? cur.telegram_bot_token ?? process.env.TELEGRAM_BOT_TOKEN ?? null;
      const webhook: { set: boolean; url: string; error?: string } = { set: false, url: `${(process.env.PUBLIC_URL ?? '').replace(/\/$/, '')}/api/v1/bot/telegram/webhook` };
      if (token && process.env.PUBLIC_URL) {
        try {
          const r = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: webhook.url, secret_token: secret, allowed_updates: ['message', 'callback_query'] }), signal: AbortSignal.timeout(10000) });
          const j: any = await r.json().catch(() => ({}));
          if (j.ok) { webhook.set = true; patch.telegram_webhook_set_at = new Date().toISOString(); } else webhook.error = j.description ?? String(r.status);
          if (!patch.telegram_bot_username) { const me = await fetch(`https://api.telegram.org/bot${token}/getMe`, { signal: AbortSignal.timeout(10000) }); const mj: any = await me.json().catch(() => ({})); if (mj.ok) patch.telegram_bot_username = mj.result.username; }
        } catch (e: any) { webhook.error = e.message; }
      } else if (token) webhook.error = 'PUBLIC_URL not set';
      await withCompany(cx(req), (tx) => tx.query(`UPDATE company SET settings = settings || $2::jsonb, telegram_chat_id = COALESCE($3, telegram_chat_id) WHERE id = $1`, [req.ctx.companyId, JSON.stringify(patch), b.chat_id ?? null]));
      return { ok: true, webhook, bot_username: patch.telegram_bot_username ?? cur.telegram_bot_username ?? null };
    });
  });
}
