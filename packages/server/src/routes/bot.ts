// AI 机器人（模块 E，第十二组）+ 知识库 CRUD（原 admin.ts 的 GET /knowledge 搬到这里）。
// 流程（B10）：文字/语音 → 分类（lib/botIntent）→ DATA：lib/botQueries 固定查询（权限不够回"您的角色不能看这个"，不开工单）；
// HOWTO/OTHER：knowledge_article 三语分词 + ILIKE 匹配（hit_count++）；答不出 → BOT_UNANSWERED 工单给经理（A 模式老板）1 天，回"已转给主管"。
// 每次问答写 bot_conversation。主管 POST /knowledge 带 conversation_id 回答后：conversation 标 answered、工单 RESOLVED、tgSendToUser 提问者。
// 导出 answerQuestion(ctx, text, opts) 供 Telegram（模块 B 的 telegram.ts）以后调用。
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withCompany, type Tx } from '../lib/db.js';
import { requireAuth, requirePerm, hasPerm, type RequestCtx } from '../lib/auth.js';
import { AppError, notFound } from '../lib/errors.js';
import { tgSendToUser } from '../lib/telegram.js';
import { BOT_QUERIES, canRunQuery, runQuery, L, type Lang } from '../lib/botQueries.js';
import { classify, detectLanguage, transcribeAudio } from '../lib/botIntent.js';
import { deadlineFor, defaultRoleFor } from '../lib/ticketJobs.js';

const STOP = new Set(['怎么', '怎样', '如何', '什么', '为什么', '可以', '能不能', '是不是', '要不要', '办', '的', '了', '吗', '呢', '我', '要', '是', '在', '有', '个', '这个', '那个', '一下', '请问', 'cara', 'macam', 'mana', 'bagaimana', 'apa', 'saya', 'nak', 'boleh', 'yang', 'untuk', 'dengan', 'itu', 'ini', 'ada', 'tak', 'tidak', 'kenapa', 'how', 'do', 'does', 'to', 'the', 'a', 'an', 'i', 'my', 'is', 'are', 'what', 'why', 'can', 'should', 'if', 'it', 'of', 'in', 'on', 'for', 'and', 'or', 'me', 'we', 'you']);
/** 分词：中文去停用词后两字词 + 整词；拉丁按空格，≥2 字母 */
export function tokenize(text: string): string[] {
  const out = new Set<string>();
  let t = text.toLowerCase().replace(/[？?！!。，,、：:；;（）()\[\]"'“”]/g, ' ');
  for (const w of [...STOP].filter((s) => /[一-鿿]/.test(s))) t = t.split(w).join(' ');
  for (const seg of t.split(/\s+/).filter(Boolean)) {
    if (/[一-鿿]/.test(seg)) {
      const cj = seg.replace(/[^一-鿿]/g, ''); const rest = seg.replace(/[一-鿿]/g, ' ').trim();
      if (cj.length <= 2) { if (cj) out.add(cj); } else { out.add(cj); for (let i = 0; i < cj.length - 1; i++) out.add(cj.slice(i, i + 2)); }
      for (const r of rest.split(/\s+/)) if (r.length >= 2 && !STOP.has(r)) out.add(r);
    } else if (seg.length >= 2 && !STOP.has(seg)) out.add(seg);
  }
  return [...out];
}
/** 知识库匹配：候选 ILIKE 任一词，再按命中词数打分（问题/关键词命中算 2 分，答案算 1 分），要求 ≥2 分且 ≥ 一半词命中 */
export async function searchKnowledge(tx: Tx, ctx: RequestCtx, text: string, limit = 5) {
  const toks = tokenize(text); if (!toks.length) return [];
  const pats = toks.map((t) => `%${t}%`);
  const rows = (await tx.query(
    `SELECT k.* FROM knowledge_article k WHERE k.is_active AND (k.role_codes IS NULL OR k.role_codes = '{}' OR k.role_codes && $2::text[] OR $3)
       AND EXISTS (SELECT 1 FROM unnest($1::text[]) pt WHERE k.question_zh ILIKE pt OR k.question_ms ILIKE pt OR k.question_en ILIKE pt OR k.keywords ILIKE pt OR k.answer_zh ILIKE pt OR k.answer_ms ILIKE pt OR k.answer_en ILIKE pt)
     ORDER BY k.company_id NULLS LAST LIMIT 100`, [pats, ctx.roles, ctx.isSuperAdmin])).rows;
  const scored = rows.map((k) => {
    const q = `${k.question_zh ?? ''} ${k.question_ms ?? ''} ${k.question_en ?? ''} ${k.keywords ?? ''}`.toLowerCase(); const a = `${k.answer_zh ?? ''} ${k.answer_ms ?? ''} ${k.answer_en ?? ''}`.toLowerCase();
    let score = 0, hit = 0; for (const t of toks) { if (q.includes(t)) { score += 2; hit++; } else if (a.includes(t)) { score += 1; hit++; } }
    return { k, score, hit };
  }).filter((s) => s.score >= 2 && s.hit * 2 >= toks.length).sort((a, b) => b.score - a.score || (a.k.company_id ? -1 : 1));
  return scored.slice(0, limit).map((s) => ({ ...s.k, score: s.score }));
}

export interface AnswerOpts { channel?: 'APP' | 'TELEGRAM'; language?: Lang; audioUrl?: string }
export interface Answer { conversation_id: string; intent: string; query_code?: string; params?: any; answer: string; rows?: any[]; screen_ref?: string | null; knowledge_id?: string | null; ticket_id?: string | null; answered: boolean; language: Lang; denied?: boolean }

async function escalate(tx: Tx, ctx: RequestCtx, text: string, convId: string) {
  const role = defaultRoleFor('BOT_UNANSWERED', ctx.plan);
  const mgr = (await tx.query(`SELECT u.id FROM app_user u JOIN user_site_role usr ON usr.user_id = u.id JOIN role r ON r.id = usr.role_id WHERE u.is_active AND r.code = $1 AND (usr.site_id IS NULL OR $2::uuid IS NULL OR usr.site_id = $2) ORDER BY usr.site_id NULLS LAST LIMIT 1`, [role, ctx.siteId])).rows[0];
  const t = (await tx.query(`INSERT INTO ticket (company_id, site_id, type, title, ref_type, ref_id, owner_id, owner_role_code, priority, deadline_at) VALUES ($1,$2,'BOT_UNANSWERED',$3,'bot_conversation',$4,$5,$6,'NORMAL',$7) RETURNING *`, [ctx.companyId, ctx.siteId, `机器人答不了：${text.slice(0, 80)}`, convId, mgr?.id ?? null, role, deadlineFor('BOT_UNANSWERED')])).rows[0];
  await tx.query(`INSERT INTO ticket_event (company_id, ticket_id, user_id, event, text) VALUES ($1,$2,$3,'CREATED',$4)`, [ctx.companyId, t.id, ctx.userId, `${ctx.name} 问：${text}`]);
  return { ticket: t, managerId: mgr?.id ?? null };
}

/** 核心问答。App 和 Telegram 共用。 */
export async function answerQuestion(ctx: RequestCtx, text: string, opts: AnswerOpts = {}): Promise<Answer> {
  const q = text.trim(); if (!q) throw new AppError(400, 'VALIDATION', 'text required');
  const allowed = Object.keys(BOT_QUERIES).filter((c) => canRunQuery(ctx, c));
  const cls = await classify(q, Object.keys(BOT_QUERIES));
  const lang: Lang = opts.language ?? cls.language ?? detectLanguage(q);
  const r = await withCompany({ companyId: ctx.companyId, userId: ctx.userId }, async (tx) => {
    const conv = (await tx.query(`INSERT INTO bot_conversation (company_id, user_id, channel, question_text, question_audio_url, detected_language, intent, query_code, params) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`, [ctx.companyId, ctx.userId, opts.channel ?? 'APP', q, opts.audioUrl ?? null, lang, cls.intent, cls.query_code ?? null, JSON.stringify(cls.params ?? {})])).rows[0];
    const done = async (a: Omit<Answer, 'conversation_id' | 'language'>) => {
      await tx.query(`UPDATE bot_conversation SET answer_text = $2, answered = $3, ticket_id = $4, knowledge_id = $5, intent = $6, query_code = $7 WHERE id = $1`, [conv.id, a.answer, a.answered, a.ticket_id ?? null, a.knowledge_id ?? null, a.intent, a.query_code ?? null]);
      return { ...a, conversation_id: conv.id, language: lang } as Answer;
    };
    if (cls.intent === 'DATA' && cls.query_code) {
      if (!allowed.includes(cls.query_code)) return done({ intent: 'DATA', query_code: cls.query_code, params: cls.params, answer: L(lang, '您的角色不能看这个', 'Peranan anda tidak boleh lihat ini', 'Your role cannot view this'), answered: true, denied: true });
      const res = await runQuery(tx, ctx, cls.query_code, cls.params, lang);
      return done({ intent: 'DATA', query_code: cls.query_code, params: cls.params, answer: res.text, rows: res.rows, screen_ref: res.screen_ref ?? null, answered: true });
    }
    const hits = await searchKnowledge(tx, ctx, q, 3);
    if (hits.length) {
      const k = hits[0];
      await tx.query(`UPDATE knowledge_article SET hit_count = hit_count + 1 WHERE id = $1`, [k.id]);
      const ans = (lang === 'ms' ? k.answer_ms : lang === 'en' ? k.answer_en : k.answer_zh) ?? k.answer_zh ?? k.answer_en ?? k.answer_ms ?? '';
      return done({ intent: cls.intent === 'DATA' ? 'HOWTO' : cls.intent, answer: ans, screen_ref: k.screen_ref ?? null, knowledge_id: k.id, rows: hits.map((h) => ({ id: h.id, question_zh: h.question_zh, question_ms: h.question_ms, question_en: h.question_en, screen_ref: h.screen_ref })), answered: true });
    }
    const { ticket, managerId } = await escalate(tx, ctx, q, conv.id);
    return { ...(await done({ intent: cls.intent === 'DATA' ? 'OTHER' : cls.intent, answer: L(lang, '已转给主管，有答案会通知你', 'Telah dihantar kepada penyelia, anda akan dimaklumkan', 'Sent to your supervisor, you will be notified'), ticket_id: ticket.id, answered: false })), _managerId: managerId, _ticket: ticket } as any;
  });
  if (r._managerId) await tgSendToUser(ctx.companyId, r._managerId, `<b>机器人答不了 #${r._ticket.ticket_no}</b>\n${ctx.name} 问：${q}`, undefined, 'BOT_UNANSWERED');
  const { _managerId, _ticket, ...out } = r; return out;
}

export async function botRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);
  const cx = (req: any) => ({ companyId: req.ctx.companyId, userId: req.ctx.userId, deviceId: req.ctx.deviceId });

  app.post('/bot/ask', async (req) => {
    let text = '', language: Lang | undefined, audio: { buf: Buffer; mime: string } | null = null;
    if ((req as any).isMultipart?.()) {
      for await (const part of (req as any).parts()) {
        if (part.type === 'file') audio = { buf: await part.toBuffer(), mime: part.mimetype };  // 任何文件字段都当语音
        else if (part.fieldname === 'text') text = String(part.value ?? ''); else if (part.fieldname === 'language') language = part.value as Lang;
      }
    } else {
      const b = z.object({ text: z.string().max(500).optional(), language: z.enum(['zh', 'ms', 'en']).optional() }).parse(req.body ?? {}); text = b.text ?? ''; language = b.language;
    }
    if (!text.trim() && audio) {
      const t = await transcribeAudio(audio.buf, audio.mime);
      if (!t) { const lang = language ?? req.ctx.lang; return { intent: 'OTHER', answer: L(lang, '语音暂不支持，请打字', 'Suara belum disokong, sila taip', 'Voice is not supported yet, please type'), answered: false, needs_text: true, language: lang }; }
      text = t;
    }
    if (!text.trim()) throw new AppError(400, 'VALIDATION', 'text or audio required');
    return answerQuestion(req.ctx, text, { channel: 'APP', language });
  });
  app.get('/bot/queries', async (req) => withCompany(cx(req), async (tx) => (await tx.query(`SELECT code, description_zh, description_ms, description_en, required_permission, params_json, examples FROM bot_query WHERE is_active ORDER BY code`)).rows.filter((r: any) => r.code === 'HOW_TO' || canRunQuery(req.ctx, r.code)).map((r: any) => ({ ...r, available: true }))));
  app.post('/bot/queries/:code/run', async (req) => {
    const { code } = z.object({ code: z.string() }).parse(req.params); const b = z.object({ params: z.record(z.any()).default({}), language: z.enum(['zh', 'ms', 'en']).optional() }).parse(req.body ?? {});
    if (!BOT_QUERIES[code]) throw notFound();
    if (!canRunQuery(req.ctx, code)) throw new AppError(403, 'FORBIDDEN', { need: [BOT_QUERIES[code].permission] });
    return withCompany(cx(req), (tx) => runQuery(tx, req.ctx, code, b.params, b.language ?? req.ctx.lang));
  });
  app.get('/bot/knowledge/search', async (req) => { const q = z.object({ q: z.string().min(1) }).parse(req.query); return withCompany(cx(req), (tx) => searchKnowledge(tx, req.ctx, q.q, 10)); });
  app.post('/bot/escalate', async (req) => {
    const b = z.object({ conversation_id: z.string().uuid().optional(), text: z.string().min(1).max(500) }).parse(req.body);
    const r = await withCompany(cx(req), async (tx) => {
      let convId = b.conversation_id;
      if (!convId) convId = (await tx.query(`INSERT INTO bot_conversation (company_id, user_id, channel, question_text, detected_language, intent) VALUES ($1,$2,'APP',$3,$4,'OTHER') RETURNING id`, [req.ctx.companyId, req.ctx.userId, b.text, detectLanguage(b.text)])).rows[0].id;
      const { ticket, managerId } = await escalate(tx, req.ctx, b.text, convId!);
      await tx.query(`UPDATE bot_conversation SET answered = false, ticket_id = $2 WHERE id = $1`, [convId, ticket.id]);
      return { ticket_id: ticket.id, conversation_id: convId, managerId, ticket_no: ticket.ticket_no };
    });
    if (r.managerId) await tgSendToUser(req.ctx.companyId, r.managerId, `<b>员工提问 #${r.ticket_no}</b>\n${req.ctx.name} 问：${b.text}`, undefined, 'BOT_UNANSWERED');
    return { ticket_id: r.ticket_id, conversation_id: r.conversation_id };
  });
  app.get('/bot/conversations', { preHandler: requirePerm('kb.edit') }, async (req) => {
    const q = z.object({ unanswered: z.string().optional(), limit: z.coerce.number().int().min(1).max(500).default(200) }).parse(req.query);
    return withCompany(cx(req), async (tx) => (await tx.query(`SELECT c.*, u.name AS user_name, t.ticket_no, t.status AS ticket_status FROM bot_conversation c JOIN app_user u ON u.id = c.user_id LEFT JOIN ticket t ON t.id = c.ticket_id WHERE ($1::boolean IS NOT TRUE OR c.answered = false) ORDER BY c.at DESC LIMIT $2`, [q.unanswered === 'true', q.limit])).rows);
  });
  app.get('/bot/stats', { preHandler: requirePerm('kb.edit') }, async (req) => withCompany(cx(req), async (tx) => ({
    conversations: (await tx.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE answered)::int AS answered, count(*) FILTER (WHERE NOT answered)::int AS unanswered, count(*) FILTER (WHERE intent = 'DATA')::int AS data, count(*) FILTER (WHERE intent = 'HOWTO')::int AS howto, count(*) FILTER (WHERE at > now() - interval '7 days')::int AS last_7d FROM bot_conversation`)).rows[0],
    top_queries: (await tx.query(`SELECT query_code, count(*)::int AS n FROM bot_conversation WHERE query_code IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 20`)).rows,
    top_knowledge: (await tx.query(`SELECT id, screen_ref, question_zh, question_ms, question_en, hit_count, company_id IS NULL AS is_system FROM knowledge_article WHERE is_active ORDER BY hit_count DESC, question_zh LIMIT 20`)).rows,
  })));

  // ---------- 知识库 ----------
  app.get('/knowledge', async (req) => {
    const q = z.object({ screen: z.string().optional(), all: z.string().optional(), q: z.string().optional() }).parse(req.query);
    return withCompany(cx(req), async (tx) => {
      if (q.q) return searchKnowledge(tx, req.ctx, q.q, 20);
      const all = q.all === 'true' && hasPerm(req.ctx, 'kb.edit');
      return (await tx.query(`SELECT k.*, k.company_id IS NULL AS is_system FROM knowledge_article k WHERE ($3::boolean OR k.is_active) AND ($1::text IS NULL OR k.screen_ref = $1 OR k.screen_ref = left($1, 1)) AND ($3::boolean OR k.role_codes = '{}' OR k.role_codes IS NULL OR k.role_codes && $2::text[]) ORDER BY k.company_id NULLS LAST, k.screen_ref, k.hit_count DESC`, [q.screen ?? null, req.ctx.roles, all])).rows;
    });
  });
  const kbSchema = z.object({ screen_ref: z.string().max(10).nullable().optional(), question_zh: z.string().max(200).nullable().optional(), question_ms: z.string().max(200).nullable().optional(), question_en: z.string().max(200).nullable().optional(), answer_zh: z.string().max(2000).nullable().optional(), answer_ms: z.string().max(2000).nullable().optional(), answer_en: z.string().max(2000).nullable().optional(), keywords: z.string().max(500).nullable().optional(), role_codes: z.array(z.string()).default([]), is_active: z.boolean().default(true), source_ticket_id: z.string().uuid().nullable().optional(), conversation_id: z.string().uuid().nullable().optional() });
  app.post('/knowledge', { preHandler: requirePerm('kb.edit') }, async (req, reply) => {
    const b = kbSchema.parse(req.body);
    if (!(b.question_zh || b.question_ms || b.question_en)) throw new AppError(400, 'VALIDATION', 'question required');
    if (!(b.answer_zh || b.answer_ms || b.answer_en)) throw new AppError(400, 'VALIDATION', 'answer required');
    const r = await withCompany(cx(req), async (tx) => {
      let conv = b.conversation_id ? (await tx.query(`SELECT * FROM bot_conversation WHERE id = $1`, [b.conversation_id])).rows[0] : null;
      const ticketId = b.source_ticket_id ?? conv?.ticket_id ?? null;
      if (!conv && ticketId) conv = (await tx.query(`SELECT * FROM bot_conversation WHERE ticket_id = $1 ORDER BY at DESC LIMIT 1`, [ticketId])).rows[0] ?? null;
      const k = (await tx.query(`INSERT INTO knowledge_article (company_id, screen_ref, question_zh, question_ms, question_en, answer_zh, answer_ms, answer_en, keywords, role_codes, source_ticket_id, is_active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`, [req.ctx.companyId, b.screen_ref ?? null, b.question_zh ?? conv?.question_text ?? null, b.question_ms ?? null, b.question_en ?? null, b.answer_zh ?? null, b.answer_ms ?? null, b.answer_en ?? null, b.keywords ?? null, b.role_codes, ticketId, b.is_active])).rows[0];
      const ans = b.answer_zh ?? b.answer_en ?? b.answer_ms ?? '';
      if (conv) await tx.query(`UPDATE bot_conversation SET answered = true, answer_text = $2, knowledge_id = $3 WHERE id = $1`, [conv.id, ans, k.id]);
      if (ticketId) { await tx.query(`UPDATE ticket SET status = 'RESOLVED', resolved_at = now(), resolution = $2, close_reason = 'FIXED' WHERE id = $1 AND status NOT IN ('RESOLVED','CLOSED')`, [ticketId, ans.slice(0, 500)]); await tx.query(`INSERT INTO ticket_event (company_id, ticket_id, user_id, event, text) VALUES ($1,$2,$3,'STATUS',$4)`, [req.ctx.companyId, ticketId, req.ctx.userId, `RESOLVED · 已回答并存入知识库`]); }
      return { k, conv, ans };
    });
    if (r.conv) await tgSendToUser(req.ctx.companyId, r.conv.user_id, `<b>你的问题有答案了</b>\n问：${r.conv.question_text}\n答：${r.ans}`, undefined, 'BOT_ANSWERED');
    reply.status(201); return r.k;
  });
  app.put('/knowledge/:id', { preHandler: requirePerm('kb.edit') }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params); const b = kbSchema.partial().parse(req.body);
    return withCompany(cx(req), async (tx) => {
      const r = (await tx.query(`UPDATE knowledge_article SET screen_ref = COALESCE($2, screen_ref), question_zh = COALESCE($3, question_zh), question_ms = COALESCE($4, question_ms), question_en = COALESCE($5, question_en), answer_zh = COALESCE($6, answer_zh), answer_ms = COALESCE($7, answer_ms), answer_en = COALESCE($8, answer_en), keywords = COALESCE($9, keywords), role_codes = COALESCE($10, role_codes), is_active = COALESCE($11, is_active) WHERE id = $1 AND company_id = $12 RETURNING *`, [id, b.screen_ref ?? null, b.question_zh ?? null, b.question_ms ?? null, b.question_en ?? null, b.answer_zh ?? null, b.answer_ms ?? null, b.answer_en ?? null, b.keywords ?? null, b.role_codes ?? null, b.is_active ?? null, req.ctx.companyId])).rows[0];
      if (!r) throw new AppError(404, 'NOT_FOUND', 'system SOP cannot be edited');
      return r;
    });
  });
  app.delete('/knowledge/:id', { preHandler: requirePerm('kb.edit') }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return withCompany(cx(req), async (tx) => { const r = await tx.query(`UPDATE knowledge_article SET is_active = false WHERE id = $1 AND company_id = $2`, [id, req.ctx.companyId]); if (!r.rowCount) throw new AppError(404, 'NOT_FOUND', 'system SOP cannot be deleted'); return { ok: true }; });
  });
}
