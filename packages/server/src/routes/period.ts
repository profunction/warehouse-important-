// 月结（模块 D）。B12：检查清单 → 锁定 → 该月 movement 插入被触发器 trg_movement_period_lock 拒绝（PERIOD_LOCKED）。
// 自定决定：
//  - 只能锁定已经过去的月份（KL 时间）；清单未全清时返回 400 PERIOD_NOT_CLEAR，带 force=true 可强制锁（审计记录）。
//  - 清单项：月末前建立且未关的工单、PENDING 审批、当前负库存、VARIANCE 供应商发票、该月 QUEUED/FAILED/INVALID 电子发票、该月有零售销售但没有有效合并发票的店。
//  - 解锁仅 BOSS（或超管），写 audit_log。
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withCompany, type Tx } from '../lib/db.js';
import { requireAuth, requirePerm } from '../lib/auth.js';
import { AppError } from '../lib/errors.js';
import { monthStart, MONTH_RANGE_SQL } from '../lib/myinvois.js';

const cx = (req: any) => ({ companyId: req.ctx.companyId, userId: req.ctx.userId, deviceId: req.ctx.deviceId });
const klMonth = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 7);

export async function periodChecklist(tx: Tx, month: string) {
  const m = monthStart(month);
  const one = async (sql: string, params: any[] = [m]) => (await tx.query(sql, params)).rows[0];
  const open_tickets = Number((await one(`SELECT count(*)::int AS n FROM ticket WHERE status NOT IN ('RESOLVED','CLOSED') AND created_at < ($1::date + interval '1 month')::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur'`)).n);
  const pending_approvals = Number((await one(`SELECT count(*)::int AS n FROM approval_request WHERE status = 'PENDING' AND created_at < ($1::date + interval '1 month')::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur'`)).n);
  const negative_stock = Number((await one(`SELECT count(*)::int AS n FROM stock s JOIN location l ON l.id = s.location_id WHERE s.qty < 0 AND NOT l.is_virtual`, [])).n);
  const variance_supplier_invoices = Number((await one(`SELECT count(*)::int AS n FROM supplier_invoice WHERE status IN ('VARIANCE','PENDING_MATCH') AND invoice_date < $1::date + interval '1 month'`)).n);
  const einvoice_pending = Number((await one(`SELECT count(*)::int AS n FROM einvoice_submission WHERE status IN ('QUEUED','FAILED','INVALID','SUBMITTED') AND ${MONTH_RANGE_SQL('created_at', '1')}`)).n);
  const consolidated_missing = (await tx.query(`SELECT DISTINCT si.id AS site_id, si.code AS site_code FROM sale s JOIN site si ON si.id = s.site_id
      WHERE s.status = 'COMPLETED' AND s.sale_type = 'RETAIL' AND NOT s.einvoice_required AND ${MONTH_RANGE_SQL('s.sold_at', '1')}
        AND NOT EXISTS (SELECT 1 FROM consolidated_invoice_period p JOIN einvoice_submission e ON e.id = p.submission_id WHERE p.site_id = s.site_id AND p.period_month = $1::date AND e.status IN ('VALID','SUBMITTED'))
        AND coalesce((SELECT (feature_flags->>'einvoice_consolidated')::boolean FROM company WHERE id = s.company_id), true)`, [m])).rows;
  const open_drawers = Number((await one(`SELECT count(*)::int AS n FROM cash_drawer_session WHERE status = 'OPEN' AND opened_at < ($1::date + interval '1 month')::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur'`)).n);
  const lock = (await one(`SELECT pl.*, u.name AS locked_by_name FROM period_lock pl LEFT JOIN app_user u ON u.id = pl.locked_by WHERE pl.period_month = $1::date`)) ?? null;
  const items = [
    { key: 'open_tickets', label: '未关闭工单', count: open_tickets, link: 'tickets' },
    { key: 'pending_approvals', label: '待处理审批', count: pending_approvals, link: 'approvals' },
    { key: 'negative_stock', label: '负库存货位', count: negative_stock, link: 'reports' },
    { key: 'variance_supplier_invoices', label: '有差异 / 未匹配供应商发票', count: variance_supplier_invoices, link: 'ap' },
    { key: 'einvoice_pending', label: '未成功电子发票', count: einvoice_pending, link: 'einvoice' },
    { key: 'consolidated_missing', label: '未提交合并发票的店', count: consolidated_missing.length, detail: consolidated_missing, link: 'einvoice' },
    { key: 'open_drawers', label: '未日结钱箱', count: open_drawers, link: 'sales' },
  ];
  const stats = await one(`SELECT (SELECT count(*)::int FROM sale WHERE status = 'COMPLETED' AND ${MONTH_RANGE_SQL('sold_at', '1')}) AS sales, (SELECT coalesce(sum(total),0) FROM sale WHERE status = 'COMPLETED' AND ${MONTH_RANGE_SQL('sold_at', '1')}) AS sales_total,
    (SELECT count(*)::int FROM movement WHERE ${MONTH_RANGE_SQL('performed_at', '1')}) AS movements, (SELECT count(*)::int FROM invoice WHERE issue_date >= $1::date AND issue_date < $1::date + interval '1 month') AS invoices`);
  return { month, items, all_clear: items.every((i) => i.count === 0), locked: !!lock, lock, stats, is_past: month < klMonth() };
}

export async function periodRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);
  app.get('/period/locks', { preHandler: requirePerm('period.lock', 'report.stock', 'audit.view') }, async (req) => withCompany(cx(req), async (tx) => (await tx.query(`SELECT pl.*, to_char(pl.period_month, 'YYYY-MM') AS month, u.name AS locked_by_name FROM period_lock pl LEFT JOIN app_user u ON u.id = pl.locked_by ORDER BY pl.period_month DESC`)).rows));
  app.get('/period/:month/checklist', { preHandler: requirePerm('period.lock', 'report.stock', 'approval.decide') }, async (req) => {
    const { month } = req.params as any;
    return withCompany(cx(req), (tx) => periodChecklist(tx, month));
  });
  app.post('/period/:month/lock', { preHandler: requirePerm('period.lock') }, async (req, reply) => {
    const { month } = req.params as any;
    const b = z.object({ force: z.boolean().optional(), note: z.string().max(300).optional() }).parse(req.body ?? {});
    return withCompany(cx(req), async (tx) => {
      const cl = await periodChecklist(tx, month);
      if (!cl.is_past) throw new AppError(400, 'PERIOD_NOT_PAST');
      if (cl.locked) throw new AppError(409, 'DUPLICATE', 'already locked');
      if (!cl.all_clear && !b.force) throw new AppError(400, 'PERIOD_NOT_CLEAR', cl.items.filter((i) => i.count > 0));
      const row = (await tx.query(`INSERT INTO period_lock (company_id, period_month, locked_by, checklist) VALUES ($1, $2::date, $3, $4) RETURNING *`, [req.ctx.companyId, monthStart(month), req.ctx.userId, JSON.stringify({ items: cl.items, all_clear: cl.all_clear, forced: !!b.force && !cl.all_clear, note: b.note ?? null, stats: cl.stats })])).rows[0];
      await tx.query(`INSERT INTO audit_log (company_id, user_id, action, table_name, after_json) VALUES ($1,$2,'PERIOD_LOCK','period_lock',$3)`, [req.ctx.companyId, req.ctx.userId, JSON.stringify({ month, forced: !!b.force && !cl.all_clear, note: b.note ?? null })]);
      reply.status(201); return { ...row, month };
    });
  });
  app.post('/period/:month/unlock', { preHandler: requirePerm('period.lock') }, async (req) => {
    const { month } = req.params as any;
    const b = z.object({ reason: z.string().min(1).max(300) }).parse(req.body);
    if (!req.ctx.roles.includes('BOSS') && !req.ctx.isSuperAdmin) throw new AppError(403, 'FORBIDDEN', { need: ['BOSS'] });
    return withCompany(cx(req), async (tx) => {
      const r = await tx.query(`DELETE FROM period_lock WHERE period_month = $1::date RETURNING *`, [monthStart(month)]);
      if (!r.rowCount) throw new AppError(404, 'NOT_FOUND');
      await tx.query(`INSERT INTO audit_log (company_id, user_id, action, table_name, before_json, after_json) VALUES ($1,$2,'PERIOD_UNLOCK','period_lock',$3,$4)`, [req.ctx.companyId, req.ctx.userId, JSON.stringify(r.rows[0]), JSON.stringify({ month, reason: b.reason })]);
      return { month, unlocked: true, reason: b.reason };
    });
  });
}
