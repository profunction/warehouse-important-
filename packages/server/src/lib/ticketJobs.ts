// 工单期限表、默认负责角色、超期提醒和大屏呼叫升级（模块 E）。
// 设计文档 B9 的期限表；A 模式所有自动工单给 BOSS（没有经理）。
// 每天 08:30（吉隆坡）跑超期提醒：老板 tgSend 一份清单 + 每位负责人 tgSendToUser；每分钟检查大屏呼叫 10 分钟无人接 → 升级给经理（只升一次）。
import type PgBoss from 'pg-boss';
import { adminPool } from './db.js';
import { tgSend, tgSendToUser } from './telegram.js';

/** 期限（分钟）。当天 = 到今天 23:59。 */
export const TICKET_DEADLINE_MINUTES: Record<string, number | 'EOD'> = {
  COUNT_VARIANCE: 2 * 1440, RECEIVE_VARIANCE: 3 * 1440, TRANSFER_VARIANCE: 2 * 1440, NEGATIVE_STOCK: 'EOD',
  CUSTOMER_HELP: 10, BOT_UNANSWERED: 1440, DEVICE: 'EOD', UNKNOWN_BARCODE: 1440, OVERDUE_AR: 7 * 1440, SYNC_QUARANTINE: 1440, MANUAL: 2 * 1440, RECEIVE_DAMAGE: 3 * 1440,
};
/** 默认负责角色（B 模式）；A 模式一律 BOSS */
export const TICKET_DEFAULT_ROLE: Record<string, string> = {
  COUNT_VARIANCE: 'MANAGER', RECEIVE_VARIANCE: 'PURCHASER', TRANSFER_VARIANCE: 'MANAGER', NEGATIVE_STOCK: 'COUNTER',
  CUSTOMER_HELP: 'STOCKER', BOT_UNANSWERED: 'MANAGER', DEVICE: 'MANAGER', UNKNOWN_BARCODE: 'MANAGER', OVERDUE_AR: 'ACCOUNTS', SYNC_QUARANTINE: 'MANAGER', MANUAL: 'MANAGER', RECEIVE_DAMAGE: 'PURCHASER',
};
export const CLOSE_REASONS = ['FIXED', 'NOT_AN_ISSUE', 'DUPLICATE', 'CUSTOMER_LEFT', 'HANDLED_OTHER', 'CANNOT_REPRODUCE', 'OTHER'] as const;

export function deadlineFor(type: string, from = new Date()): Date {
  const m = TICKET_DEADLINE_MINUTES[type] ?? 2 * 1440;
  if (m === 'EOD') { const d = new Date(from); d.setHours(23, 59, 0, 0); return d; }
  return new Date(from.getTime() + m * 60_000);
}
export function defaultRoleFor(type: string, plan: 'A' | 'B') { return plan === 'A' ? 'BOSS' : (TICKET_DEFAULT_ROLE[type] ?? 'MANAGER'); }

/** 超期提醒：每家公司一份清单给老板，每位负责人一份自己的。返回提醒的工单数。可在测试里直接调用。 */
export async function runOverdueCheck(companyId?: string) {
  const rows = (await adminPool.query(
    `SELECT t.id, t.company_id, t.ticket_no, t.type, t.title, t.owner_id, t.owner_role_code, t.deadline_at, t.site_id, u.name AS owner_name
     FROM ticket t LEFT JOIN app_user u ON u.id = t.owner_id
     WHERE t.status NOT IN ('RESOLVED','CLOSED') AND t.deadline_at < now() AND ($1::uuid IS NULL OR t.company_id = $1)
     ORDER BY t.company_id, t.deadline_at`, [companyId ?? null])).rows;
  const byCompany = new Map<string, any[]>();
  for (const r of rows) { const a = byCompany.get(r.company_id) ?? []; a.push(r); byCompany.set(r.company_id, a); }
  for (const [cid, list] of byCompany) {
    const lines = list.slice(0, 30).map((t) => `#${t.ticket_no} ${t.title}（${t.owner_name ?? t.owner_role_code ?? '-'}，期限 ${new Date(t.deadline_at).toLocaleString('zh-CN', { timeZone: 'Asia/Kuala_Lumpur' })}）`);
    await tgSend(cid, `<b>超期工单 ${list.length} 张</b>\n${lines.join('\n')}${list.length > 30 ? `\n… 还有 ${list.length - 30} 张` : ''}`, [[{ text: '看工单', url: `${process.env.PUBLIC_URL ?? ''}/w/tickets` }]], { type: 'TICKET_OVERDUE' });
    const byOwner = new Map<string, any[]>();
    for (const t of list) if (t.owner_id) { const a = byOwner.get(t.owner_id) ?? []; a.push(t); byOwner.set(t.owner_id, a); }
    for (const [uid, mine] of byOwner) await tgSendToUser(cid, uid, `<b>你有 ${mine.length} 张超期工单</b>\n${mine.slice(0, 20).map((t) => `#${t.ticket_no} ${t.title}`).join('\n')}`, undefined, 'TICKET_OVERDUE');
    // 没有具体负责人、只有角色的：通知该角色的人
    const byRole = new Map<string, any[]>();
    for (const t of list) if (!t.owner_id && t.owner_role_code) { const a = byRole.get(t.owner_role_code) ?? []; a.push(t); byRole.set(t.owner_role_code, a); }
    for (const [role, mine] of byRole) {
      const users = (await adminPool.query(`SELECT DISTINCT u.id FROM app_user u JOIN user_site_role usr ON usr.user_id = u.id JOIN role r ON r.id = usr.role_id WHERE u.company_id = $1 AND u.is_active AND r.code = $2 AND r.code <> 'BOSS'`, [cid, role])).rows;
      for (const u of users) await tgSendToUser(cid, u.id, `<b>${mine.length} 张超期工单等你处理</b>\n${mine.slice(0, 20).map((t) => `#${t.ticket_no} ${t.title}`).join('\n')}`, undefined, 'TICKET_OVERDUE');
    }
  }
  return rows.length;
}

/** 大屏呼叫 10 分钟无人接 → 升级给经理（A 模式 BOSS），只升一次。返回升级数。 */
export async function runHelpEscalation(companyId?: string) {
  const rows = (await adminPool.query(
    `SELECT t.id, t.company_id, t.ticket_no, t.title, t.site_id, c.plan FROM ticket t JOIN company c ON c.id = t.company_id
     WHERE t.type = 'CUSTOMER_HELP' AND t.status = 'NEW' AND t.escalated_at IS NULL AND t.created_at < now() - interval '10 minutes' AND ($1::uuid IS NULL OR t.company_id = $1)`, [companyId ?? null])).rows;
  for (const t of rows) {
    const role = t.plan === 'A' ? 'BOSS' : 'MANAGER';
    const mgr = (await adminPool.query(`SELECT u.id FROM app_user u JOIN user_site_role usr ON usr.user_id = u.id JOIN role r ON r.id = usr.role_id WHERE u.company_id = $1 AND u.is_active AND r.code = $2 AND (usr.site_id IS NULL OR usr.site_id = $3) ORDER BY usr.site_id NULLS LAST LIMIT 1`, [t.company_id, role, t.site_id])).rows[0];
    await adminPool.query(`UPDATE ticket SET escalated_at = now(), owner_id = COALESCE($2, owner_id), owner_role_code = $3, priority = 'URGENT' WHERE id = $1`, [t.id, mgr?.id ?? null, role]);
    await adminPool.query(`INSERT INTO ticket_event (company_id, ticket_id, user_id, event, text) VALUES ($1,$2,NULL,'ASSIGN',$3)`, [t.company_id, t.id, `10 分钟无人接，升级给${role === 'BOSS' ? '老板' : '经理'}`]);
    if (mgr) await tgSendToUser(t.company_id, mgr.id, `<b>顾客呼叫 10 分钟无人接</b>\n#${t.ticket_no} ${t.title}`, undefined, 'TICKET_ESCALATED');
    else await tgSend(t.company_id, `<b>顾客呼叫 10 分钟无人接</b>\n#${t.ticket_no} ${t.title}`, undefined, { type: 'TICKET_ESCALATED', refType: 'ticket', refId: t.id });
  }
  return rows.length;
}

/** 关闭原因统计（按公司，最近 90 天）。路由 /tickets/stats 也用这个。 */
export async function closeReasonStats(tx: { query: (s: string, p?: any[]) => Promise<any> }, days = 90) {
  return (await tx.query(`SELECT type, coalesce(close_reason, 'UNSPECIFIED') AS close_reason, count(*)::int AS n FROM ticket WHERE status IN ('RESOLVED','CLOSED') AND created_at > now() - ($1 || ' days')::interval GROUP BY 1, 2 ORDER BY 1, 3 DESC`, [String(days)])).rows;
}

export async function registerTicketJobs(boss: PgBoss) {
  await boss.createQueue('ticket-overdue-remind');
  await boss.schedule('ticket-overdue-remind', '30 8 * * *', {}, { tz: 'Asia/Kuala_Lumpur' });
  await boss.work('ticket-overdue-remind', async () => { await runOverdueCheck(); });
  await boss.createQueue('ticket-help-escalate');
  await boss.schedule('ticket-help-escalate', '* * * * *', {}, { tz: 'Asia/Kuala_Lumpur' });
  await boss.work('ticket-help-escalate', async () => { await runHelpEscalation(); });
  console.log('jobs started: ticket-overdue-remind, ticket-help-escalate');
}
