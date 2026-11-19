// 工单完整版（模块 E，第十组）。原 admin.ts 的 /tickets 最小版已搬到这里。
// 约定：GET /tickets/:id 任何登录用户可看自己相关的；有 ticket.view_all 看全部。POST /tickets 期限按类型默认（lib/ticketJobs）。
// accept（"我去"）：owner=我、IN_PROGRESS；CUSTOMER_HELP 还发大屏事件 help.accepted。close 记 close_reason 供统计。
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withCompany } from '../lib/db.js';
import { requireAuth, requirePerm, hasPerm } from '../lib/auth.js';
import { AppError, notFound } from '../lib/errors.js';
import { tgSendToUser } from '../lib/telegram.js';
import { publishKioskEvent } from '../lib/kioskEvents.js';
import { deadlineFor, defaultRoleFor, CLOSE_REASONS, closeReasonStats } from '../lib/ticketJobs.js';

const TICKET_TYPES = ['COUNT_VARIANCE', 'RECEIVE_VARIANCE', 'TRANSFER_VARIANCE', 'NEGATIVE_STOCK', 'CUSTOMER_HELP', 'BOT_UNANSWERED', 'DEVICE', 'UNKNOWN_BARCODE', 'OVERDUE_AR', 'SYNC_QUARANTINE', 'MANUAL', 'RECEIVE_DAMAGE'] as const;

export async function ticketsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);
  const cx = (req: any) => ({ companyId: req.ctx.companyId, userId: req.ctx.userId, deviceId: req.ctx.deviceId });
  const canSee = (req: any, t: any) => hasPerm(req.ctx, 'ticket.view_all') || t.owner_id === req.ctx.userId || t.created_by === req.ctx.userId || (!t.owner_id && req.ctx.roles.includes(t.owner_role_code));

  app.get('/tickets/mine', async (req) => {
    const q = z.object({ type: z.string().optional(), status: z.string().optional() }).parse(req.query);
    return withCompany(cx(req), async (tx) => (await tx.query(
      `SELECT t.*, u.name AS owner_name FROM ticket t LEFT JOIN app_user u ON u.id = t.owner_id
       WHERE t.status NOT IN ('CLOSED') AND ($3::text IS NULL OR t.type = $3) AND ($4::text IS NULL OR t.status = $4)
         AND (t.owner_id = $1 OR t.created_by = $1 OR (t.owner_id IS NULL AND t.owner_role_code = ANY($2)))
         AND ($5::uuid IS NULL OR t.site_id IS NULL OR t.site_id = $5)
       ORDER BY CASE t.priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'NORMAL' THEN 2 ELSE 3 END, t.deadline_at`, [req.ctx.userId, req.ctx.roles, q.type ?? null, q.status ?? null, req.ctx.siteId])).rows);
  });
  app.get('/tickets', { preHandler: requirePerm('ticket.view_all') }, async (req) => {
    const q = z.object({ site: z.string().uuid().optional(), status: z.string().optional(), type: z.string().optional(), owner: z.string().uuid().optional(), open: z.string().optional() }).parse(req.query);
    return withCompany(cx(req), async (tx) => (await tx.query(
      `SELECT t.*, u.name AS owner_name, c.name AS created_by_name FROM ticket t LEFT JOIN app_user u ON u.id = t.owner_id LEFT JOIN app_user c ON c.id = t.created_by
       WHERE ($1::text IS NULL OR t.status = $1) AND ($2::text IS NULL OR t.type = $2) AND ($3::uuid IS NULL OR t.site_id = $3) AND ($4::uuid IS NULL OR t.owner_id = $4) AND ($5::boolean IS NOT TRUE OR t.status NOT IN ('RESOLVED','CLOSED'))
       ORDER BY t.created_at DESC LIMIT 300`, [q.status ?? null, q.type ?? null, q.site ?? null, q.owner ?? null, q.open === 'true'])).rows);
  });
  app.get('/tickets/stats', { preHandler: requirePerm('ticket.view_all') }, async (req) => {
    const q = z.object({ days: z.coerce.number().int().min(1).max(365).default(90) }).parse(req.query);
    return withCompany(cx(req), async (tx) => {
      const byType = (await tx.query(`SELECT type, count(*)::int AS total, count(*) FILTER (WHERE status NOT IN ('RESOLVED','CLOSED'))::int AS open, count(*) FILTER (WHERE status NOT IN ('RESOLVED','CLOSED') AND deadline_at < now())::int AS overdue_open, count(*) FILTER (WHERE status IN ('RESOLVED','CLOSED') AND resolved_at > deadline_at)::int AS closed_late, avg(EXTRACT(epoch FROM (resolved_at - created_at)) / 3600) FILTER (WHERE resolved_at IS NOT NULL) AS avg_hours FROM ticket WHERE created_at > now() - ($1 || ' days')::interval GROUP BY type ORDER BY total DESC`, [String(q.days)])).rows;
      const total = byType.reduce((a: number, r: any) => a + r.total, 0); const late = byType.reduce((a: number, r: any) => a + r.overdue_open + r.closed_late, 0);
      return { days: q.days, total, overdue_rate: total ? Math.round((late / total) * 1000) / 10 : 0, by_type: byType.map((r: any) => ({ ...r, avg_hours: r.avg_hours == null ? null : Math.round(Number(r.avg_hours) * 10) / 10 })), close_reasons: await closeReasonStats(tx, q.days), reasons: CLOSE_REASONS };
    });
  });
  app.post('/tickets', async (req, reply) => {
    const b = z.object({ client_id: z.string().uuid().optional(), type: z.enum(TICKET_TYPES).default('MANUAL'), title: z.string().min(1).max(200), text: z.string().optional(), photo_url: z.string().optional(), ref_type: z.string().optional(), ref_id: z.string().uuid().optional(), priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL'), owner_id: z.string().uuid().optional(), owner_role_code: z.string().optional(), site_id: z.string().uuid().optional(), deadline_at: z.string().optional() }).parse(req.body);
    const t = await withCompany(cx(req), async (tx) => {
      if (b.client_id) { const dup = (await tx.query(`SELECT * FROM ticket WHERE id = $1`, [b.client_id])).rows[0]; if (dup) { reply.status(200); return { ...dup, duplicate: true }; } }
      const role = b.owner_role_code ?? defaultRoleFor(b.type, req.ctx.plan);
      const deadline = b.deadline_at ? new Date(b.deadline_at) : deadlineFor(b.type);
      const t = (await tx.query(`INSERT INTO ticket (id, company_id, site_id, type, title, ref_type, ref_id, owner_id, owner_role_code, priority, deadline_at) VALUES (COALESCE($1::uuid, uuid_v7()),$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [b.client_id ?? null, req.ctx.companyId, b.site_id ?? req.ctx.siteId, b.type, b.title, b.ref_type ?? null, b.ref_id ?? null, b.owner_id ?? null, role, b.priority, deadline])).rows[0];
      await tx.query(`INSERT INTO ticket_event (company_id, ticket_id, user_id, event, text, photo_url) VALUES ($1,$2,$3,'CREATED',$4,$5)`, [req.ctx.companyId, t.id, req.ctx.userId, b.text ?? null, b.photo_url ?? null]);
      reply.status(201); return t;
    });
    if (!t.duplicate && t.owner_id) await tgSendToUser(req.ctx.companyId, t.owner_id, `<b>新工单 #${t.ticket_no}</b> ${t.title}\n${b.text ?? ''}`, undefined, 'TICKET_NEW');
    return t;
  });
  app.get('/tickets/:id', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return withCompany(cx(req), async (tx) => {
      const t = (await tx.query(`SELECT t.*, u.name AS owner_name, c.name AS created_by_name FROM ticket t LEFT JOIN app_user u ON u.id = t.owner_id LEFT JOIN app_user c ON c.id = t.created_by WHERE t.id = $1`, [id])).rows[0]; if (!t) throw notFound();
      if (!canSee(req, t)) throw new AppError(403, 'FORBIDDEN');
      const events = (await tx.query(`SELECT e.*, u.name AS user_name FROM ticket_event e LEFT JOIN app_user u ON u.id = e.user_id WHERE e.ticket_id = $1 ORDER BY e.at`, [id])).rows;
      return { ...t, events };
    });
  });
  app.post('/tickets/:id/events', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const b = z.object({ event: z.enum(['COMMENT', 'STATUS', 'ASSIGN', 'PHOTO']), text: z.string().optional(), photo_url: z.string().optional(), status: z.enum(['NEW', 'IN_PROGRESS', 'WAITING', 'RESOLVED', 'CLOSED']).optional(), owner_id: z.string().uuid().optional(), close_reason: z.string().optional() }).parse(req.body);
    return withCompany(cx(req), async (tx) => {
      const t = (await tx.query(`SELECT * FROM ticket WHERE id = $1`, [id])).rows[0]; if (!t) throw notFound();
      if (!canSee(req, t)) throw new AppError(403, 'FORBIDDEN');
      if (b.status) await tx.query(`UPDATE ticket SET status = $2, resolved_at = CASE WHEN $2 IN ('RESOLVED','CLOSED') THEN now() ELSE NULL END, resolution = COALESCE($3, resolution), close_reason = COALESCE($4, close_reason) WHERE id = $1`, [id, b.status, b.text ?? null, b.close_reason ?? null]);
      if (b.owner_id) { if (!hasPerm(req.ctx, 'ticket.manage')) throw new AppError(403, 'FORBIDDEN', { need: ['ticket.manage'] }); await tx.query(`UPDATE ticket SET owner_id = $2 WHERE id = $1`, [id, b.owner_id]); }
      if (b.event === 'STATUS' && b.status === 'IN_PROGRESS') await tx.query(`UPDATE ticket SET owner_id = COALESCE(owner_id, $2) WHERE id = $1`, [id, req.ctx.userId]);
      await tx.query(`INSERT INTO ticket_event (company_id, ticket_id, user_id, event, text, photo_url) VALUES ($1,$2,$3,$4,$5,$6)`, [req.ctx.companyId, id, req.ctx.userId, b.event, b.text ?? b.status ?? null, b.photo_url ?? null]);
      return { ok: true };
    });
  });
  app.post('/tickets/:id/assign', { preHandler: requirePerm('ticket.manage') }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const b = z.object({ owner_id: z.string().uuid().nullable().optional(), owner_role_code: z.string().optional(), deadline_at: z.string().optional(), text: z.string().optional() }).parse(req.body);
    const r = await withCompany(cx(req), async (tx) => {
      const t = (await tx.query(`UPDATE ticket SET owner_id = CASE WHEN $2::text = 'clear' THEN NULL ELSE COALESCE($3::uuid, owner_id) END, owner_role_code = COALESCE($4, owner_role_code), deadline_at = COALESCE($5::timestamptz, deadline_at), status = CASE WHEN status = 'CLOSED' THEN 'NEW' ELSE status END WHERE id = $1 RETURNING *`, [id, b.owner_id === null ? 'clear' : 'keep', b.owner_id ?? null, b.owner_role_code ?? null, b.deadline_at ?? null])).rows[0]; if (!t) throw notFound();
      const name = t.owner_id ? (await tx.query(`SELECT name FROM app_user WHERE id = $1`, [t.owner_id])).rows[0]?.name : null;
      await tx.query(`INSERT INTO ticket_event (company_id, ticket_id, user_id, event, text) VALUES ($1,$2,$3,'ASSIGN',$4)`, [req.ctx.companyId, id, req.ctx.userId, b.text ?? `转派给 ${name ?? t.owner_role_code ?? '-'}${b.deadline_at ? `，期限 ${new Date(b.deadline_at).toLocaleString('zh-CN')}` : ''}`]);
      return t;
    });
    if (r.owner_id && r.owner_id !== req.ctx.userId) await tgSendToUser(req.ctx.companyId, r.owner_id, `<b>工单转派给你 #${r.ticket_no}</b> ${r.title}`, undefined, 'TICKET_ASSIGNED');
    return r;
  });
  app.post('/tickets/:id/accept', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const t = await withCompany(cx(req), async (tx) => {
      const t0 = (await tx.query(`SELECT * FROM ticket WHERE id = $1`, [id])).rows[0]; if (!t0) throw notFound();
      if (t0.status === 'IN_PROGRESS' && t0.owner_id && t0.owner_id !== req.ctx.userId) throw new AppError(409, 'DUPLICATE', 'already_accepted');
      if (['RESOLVED', 'CLOSED'].includes(t0.status)) throw new AppError(400, 'VALIDATION', 'ticket_closed');
      const t = (await tx.query(`UPDATE ticket SET owner_id = $2, status = 'IN_PROGRESS' WHERE id = $1 RETURNING *`, [id, req.ctx.userId])).rows[0];
      await tx.query(`INSERT INTO ticket_event (company_id, ticket_id, user_id, event, text) VALUES ($1,$2,$3,'STATUS','IN_PROGRESS')`, [req.ctx.companyId, id, req.ctx.userId]);
      return t;
    });
    if (t.type === 'CUSTOMER_HELP') void publishKioskEvent({ event: 'help.accepted', company_id: req.ctx.companyId, site_id: t.site_id, ticket_id: t.id, by_name: req.ctx.name });
    return { ...t, owner_name: req.ctx.name };
  });
  app.post('/tickets/:id/close', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const b = z.object({ reason_code: z.enum(CLOSE_REASONS).default('FIXED'), text: z.string().optional(), status: z.enum(['RESOLVED', 'CLOSED']).default('CLOSED') }).parse(req.body ?? {});
    return withCompany(cx(req), async (tx) => {
      const t0 = (await tx.query(`SELECT * FROM ticket WHERE id = $1`, [id])).rows[0]; if (!t0) throw notFound();
      if (!canSee(req, t0)) throw new AppError(403, 'FORBIDDEN');
      if (b.status === 'CLOSED' && !hasPerm(req.ctx, 'ticket.manage') && t0.owner_id !== req.ctx.userId && t0.created_by !== req.ctx.userId) throw new AppError(403, 'FORBIDDEN', { need: ['ticket.manage'] });
      const t = (await tx.query(`UPDATE ticket SET status = $2, resolved_at = now(), resolution = COALESCE($3, resolution), close_reason = $4 WHERE id = $1 RETURNING *`, [id, b.status, b.text ?? null, b.reason_code])).rows[0];
      await tx.query(`INSERT INTO ticket_event (company_id, ticket_id, user_id, event, text) VALUES ($1,$2,$3,'STATUS',$4)`, [req.ctx.companyId, id, req.ctx.userId, `${b.status} · ${b.reason_code}${b.text ? ` · ${b.text}` : ''}`]);
      return t;
    });
  });
}
