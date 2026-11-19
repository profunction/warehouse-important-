// 模块 B 定时任务：循环盘点生成（06:00）、工单超期提醒（08:30）、日报（20:00）、代理过期（每小时）。
// 用 adminPool（跨公司），每家公司一个事务。设计文档没写而这里定下的：
//  - 候选货位 = 有库存且符合规则条件的非虚拟货位，frequency_days 内没数过、也不在未完成会话里。
//  - 指派：该站 COUNTER 角色用户轮流（无则 WAREHOUSE，再无则 STOCKER）；每人每天 ≤ lines_per_day 个货位（算上今天已指派的 CYCLE 会话）。
//  - 条件：{category_code}（含父类）| {min_value}（qty×成本 ≥）| {negative_stock:true}（qty<0，规则 frequency_days 设 1 即「立即」）| {last_variance_days:N}（N 天前有差异且之后没再数）。
//  - 日报各项查不到就显示 0；常备代理：审批超 24 小时无人处理 → 发给 is_standby 的代理人（每条审批只发一次）。
import type PgBoss from 'pg-boss';
import { adminPool, type Tx } from './db.js';
import { nextDocNo } from './docno.js';
import { tgSend, tgSendToUser } from './telegram.js';

const PUBLIC_URL = () => (process.env.PUBLIC_URL ?? '').replace(/\/$/, '');
const KL_DAY_START = `date_trunc('day', now() AT TIME ZONE 'Asia/Kuala_Lumpur') AT TIME ZONE 'Asia/Kuala_Lumpur'`;

/** 按规则生成 CYCLE 会话。tx 可以是 RLS 事务（手动触发）或 adminPool 客户端（定时）。返回新建会话。 */
export async function generateCycleSessions(tx: Tx, companyId: string) {
  const rules = (await tx.query(`SELECT * FROM count_rule WHERE company_id = $1 AND is_active ORDER BY frequency_days`, [companyId])).rows;
  const created: { id: string; session_no: string; rule: string; assigned_to: string; locations: number }[] = [];
  const takenToday = new Map<string, number>();   // user → 今天已指派货位数
  for (const r of (await tx.query(`SELECT assigned_to, sum(cardinality(location_ids)) n FROM count_session WHERE company_id = $1 AND scheduled_for = current_date AND status IN ('ASSIGNED','IN_PROGRESS') GROUP BY assigned_to`, [companyId])).rows) takenToday.set(r.assigned_to, Number(r.n));
  const usedLocs = new Set<string>();
  for (const rule of rules) {
    const c = rule.condition ?? {};
    const cand = (await tx.query(
      `SELECT DISTINCT l.id AS location_id, l.site_id, z.sort_order, l.rack, l.level, l.code
       FROM stock st JOIN location l ON l.id = st.location_id JOIN zone z ON z.id = l.zone_id JOIN product p ON p.id = st.product_id
       LEFT JOIN category c ON c.id = p.category_id LEFT JOIN category pc ON pc.id = c.parent_id
       WHERE st.company_id = $1 AND NOT l.is_virtual AND l.is_active AND p.is_active
         AND ($2::text IS NULL OR c.code = $2 OR pc.code = $2)
         AND ($3::numeric IS NULL OR st.qty * p.cost_price >= $3)
         AND (NOT $4::boolean OR st.qty < 0)
         AND ($5::int IS NULL OR EXISTS (SELECT 1 FROM count_line cl WHERE cl.product_id = st.product_id AND cl.location_id = st.location_id AND cl.variance_qty <> 0
                AND cl.counted_at <= now() - make_interval(days => $5) AND NOT EXISTS (SELECT 1 FROM count_line c2 WHERE c2.product_id = cl.product_id AND c2.location_id = cl.location_id AND c2.counted_at > cl.counted_at)))
         AND ($4::boolean OR st.qty <> 0)
         AND NOT EXISTS (SELECT 1 FROM count_line cl WHERE cl.location_id = l.id AND cl.counted_at > now() - make_interval(days => $6))
         AND NOT EXISTS (SELECT 1 FROM count_session s WHERE s.company_id = $1 AND s.status IN ('ASSIGNED','IN_PROGRESS','PENDING_APPROVAL') AND l.id = ANY(s.location_ids))
       ORDER BY l.site_id, z.sort_order, l.rack, l.level, l.code`,
      [companyId, c.category_code ?? null, c.min_value ?? null, c.negative_stock === true, c.last_variance_days ?? null, Number(rule.frequency_days)])).rows.filter((l) => !usedLocs.has(l.location_id));
    if (!cand.length) continue;
    const bySite = new Map<string, any[]>();
    for (const l of cand) bySite.set(l.site_id, [...(bySite.get(l.site_id) ?? []), l]);
    for (const [siteId, locs] of bySite) {
      let users: any[] = [];
      for (const role of ['COUNTER', 'WAREHOUSE', 'STOCKER']) {
        users = (await tx.query(`SELECT DISTINCT u.id FROM app_user u JOIN user_site_role usr ON usr.user_id = u.id JOIN role r ON r.id = usr.role_id WHERE u.company_id = $1 AND u.is_active AND r.code = $2 AND (usr.site_id IS NULL OR usr.site_id = $3) ORDER BY u.id`, [companyId, role, siteId])).rows;
        if (users.length) break;
      }
      if (!users.length) continue;
      // 轮流：按剩余容量把货位分给每个人
      const buckets = new Map<string, string[]>();
      let ui = 0; let guard = 0;
      for (const l of locs) {
        let placed = false;
        for (let k = 0; k < users.length && !placed; k++) {
          const u = users[(ui + k) % users.length].id;
          if ((takenToday.get(u) ?? 0) < Number(rule.lines_per_day)) { buckets.set(u, [...(buckets.get(u) ?? []), l.location_id]); takenToday.set(u, (takenToday.get(u) ?? 0) + 1); placed = true; ui = (ui + k + 1) % users.length; }
        }
        if (!placed) break;   // 今天大家都满了
        if (++guard > 5000) break;
      }
      for (const [uid, ids] of buckets) {
        const no = await nextDocNo(tx, companyId, 'CS', 'CS-');
        const s = (await tx.query(`INSERT INTO count_session (company_id, session_no, site_id, count_type, status, assigned_to, scheduled_for, location_ids, rule_id, note) VALUES ($1,$2,$3,'CYCLE','ASSIGNED',$4,current_date,$5,$6,$7) RETURNING id, session_no`, [companyId, no, siteId, uid, ids, rule.id, `循环盘点：${rule.name}`])).rows[0];
        ids.forEach((id) => usedLocs.add(id));
        created.push({ id: s.id, session_no: s.session_no, rule: rule.name, assigned_to: uid, locations: ids.length });
        void tgSendToUser(companyId, uid, `今日循环盘点 ${s.session_no}：${ids.length} 个货位（${rule.name}）`, undefined, 'COUNT');
      }
    }
  }
  return { created };
}

async function forEachCompany(filterSql: string, fn: (companyId: string, c: any) => Promise<void>) {
  const cs = (await adminPool.query(`SELECT id, name, plan, settings, feature_flags FROM company WHERE is_active ${filterSql}`)).rows;
  for (const c of cs) { try { await fn(c.id, c); } catch (e: any) { console.error('countJobs', c.id, e.message); } }
}
const num = async (sql: string, params: any[]) => { try { return Number((await adminPool.query(sql, params)).rows[0]?.v ?? 0); } catch { return 0; } };

/** 日报文字（也给测试用） */
export async function dailyReportText(companyId: string) {
  const sales = await num(`SELECT coalesce(sum(total),0) v FROM sale WHERE company_id = $1 AND status = 'COMPLETED' AND sold_at >= ${KL_DAY_START}`, [companyId]);
  const cashVar = await num(`SELECT coalesce(sum(variance),0) v FROM cash_drawer_session WHERE company_id = $1 AND closed_at >= ${KL_DAY_START}`, [companyId]);
  const low = await num(`SELECT count(*) v FROM (SELECT p.id FROM product p LEFT JOIN stock s ON s.product_id = p.id LEFT JOIN location l ON l.id = s.location_id AND NOT l.is_virtual WHERE p.company_id = $1 AND p.is_active GROUP BY p.id, p.min_level HAVING coalesce(sum(s.qty) FILTER (WHERE NOT l.is_virtual),0) < p.min_level) x`, [companyId]);
  const tickets = await num(`SELECT count(*) v FROM ticket WHERE company_id = $1 AND status NOT IN ('RESOLVED','CLOSED')`, [companyId]);
  const overdue = await num(`SELECT count(*) v FROM ticket WHERE company_id = $1 AND status NOT IN ('RESOLVED','CLOSED') AND deadline_at < now()`, [companyId]);
  const pending = await num(`SELECT count(*) v FROM approval_request WHERE company_id = $1 AND status = 'PENDING'`, [companyId]);
  const byDelegate = await num(`SELECT count(*) v FROM approval_request WHERE company_id = $1 AND on_behalf_of IS NOT NULL AND decided_at >= ${KL_DAY_START}`, [companyId]);
  let deleg: any[] = [];
  try { deleg = (await adminPool.query(`SELECT a.name AS delegator, b.name AS delegate, d.ends_at FROM delegation d JOIN app_user a ON a.id = d.delegator_id JOIN app_user b ON b.id = d.delegate_id WHERE d.company_id = $1 AND d.status = 'ACTIVE' AND now() BETWEEN d.starts_at AND d.ends_at`, [companyId])).rows; } catch { deleg = []; }
  const day = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Kuala_Lumpur', month: 'numeric', day: 'numeric' }).format(new Date());
  const lines = [`<b>日报 ${day}</b>`, `销售：RM ${sales.toFixed(2)}`, `现金差：RM ${cashVar.toFixed(2)}`, `低库存：${low} 项`, `未关工单：${tickets}（超期 ${overdue}）`, `待审批：${pending}`];
  if (deleg.length) lines.push(`代理中：${deleg.map((d) => `${d.delegate} 代 ${d.delegator} 到 ${new Date(d.ends_at).toLocaleDateString('zh-CN', { timeZone: 'Asia/Kuala_Lumpur' })}`).join('；')}`);
  if (byDelegate) lines.push(`今日代批：${byDelegate} 件`);
  return lines.join('\n');
}

export async function expireDelegations() {
  const rows = (await adminPool.query(`UPDATE delegation SET status = 'EXPIRED' WHERE status = 'ACTIVE' AND ends_at < now() RETURNING *`)).rows;
  for (const d of rows) {
    const names = (await adminPool.query(`SELECT (SELECT name FROM app_user WHERE id = $1) a, (SELECT name FROM app_user WHERE id = $2) b`, [d.delegator_id, d.delegate_id])).rows[0];
    const text = `代理到期：${names.b} 代 ${names.a} 的审批权已结束`;
    await tgSendToUser(d.company_id, d.delegate_id, text, undefined, 'DELEGATION');
    await tgSendToUser(d.company_id, d.delegator_id, text, undefined, 'DELEGATION');
  }
  // 常备代理：老板级审批超 24 小时没人处理 → 发给常备代理人（每条只发一次）
  const stale = (await adminPool.query(
    `SELECT a.id, a.company_id, a.type, a.amount, a.approver_role_code, d.delegate_id FROM approval_request a
     JOIN delegation d ON d.company_id = a.company_id AND d.status = 'ACTIVE' AND d.is_standby AND now() BETWEEN d.starts_at AND d.ends_at AND (cardinality(d.scope_types) = 0 OR a.type = ANY(d.scope_types))
     JOIN user_site_role usr ON usr.user_id = d.delegator_id JOIN role r ON r.id = usr.role_id AND r.code = a.approver_role_code
     WHERE a.status = 'PENDING' AND a.created_at < now() - make_interval(hours => coalesce(d.standby_after_hours, 24))
       AND NOT EXISTS (SELECT 1 FROM notification n WHERE n.type = 'STANDBY' AND n.ref_id = a.id AND n.user_id = d.delegate_id)`)).rows;
  for (const a of stale) {
    await adminPool.query(`INSERT INTO notification (company_id, user_id, channel, type, ref_type, ref_id, text) VALUES ($1,$2,'APP','STANDBY','approval_request',$3,$4)`, [a.company_id, a.delegate_id, a.id, `审批 ${a.type} 超过 24 小时无人处理，转给常备代理`]);
    await tgSendToUser(a.company_id, a.delegate_id, `<b>常备代理</b>：${a.type} 审批超过 24 小时无人处理${a.amount != null ? `，金额 RM ${Number(a.amount).toFixed(2)}` : ''}`, [[{ text: '✅ 批准', callback_data: `apr:${a.id}:approve` }, { text: '❌ 拒绝', callback_data: `apr:${a.id}:reject` }]], 'APPROVAL');
    await tgSend(a.company_id, `审批 ${a.type} 超过 24 小时未处理，已转给常备代理人`, undefined, { type: 'STANDBY', refType: 'approval_request', refId: a.id });
  }
  return rows.length;
}

export async function overdueTicketReminders() {
  await forEachCompany('', async (cid) => {
    const rows = (await adminPool.query(`SELECT t.id, t.ticket_no, t.title, t.deadline_at, t.owner_id, t.owner_role_code FROM ticket t WHERE t.company_id = $1 AND t.status NOT IN ('RESOLVED','CLOSED') AND t.deadline_at < now() ORDER BY t.deadline_at LIMIT 50`, [cid])).rows;
    if (!rows.length) return;
    const line = (t: any) => `#${t.ticket_no} ${t.title}（期限 ${new Date(t.deadline_at).toLocaleDateString('zh-CN', { timeZone: 'Asia/Kuala_Lumpur' })}）`;
    await tgSend(cid, `<b>超期工单 ${rows.length} 张</b>\n${rows.slice(0, 15).map(line).join('\n')}`, [[{ text: '看工单', url: `${PUBLIC_URL()}/w/tickets` }]], { type: 'TICKET_OVERDUE' });
    const byOwner = new Map<string, any[]>();
    for (const t of rows) if (t.owner_id) byOwner.set(t.owner_id, [...(byOwner.get(t.owner_id) ?? []), t]);
    for (const [uid, ts] of byOwner) await tgSendToUser(cid, uid, `<b>你有 ${ts.length} 张工单超期</b>\n${ts.slice(0, 10).map(line).join('\n')}`, [[{ text: '看工单', url: `${PUBLIC_URL()}/m/tickets` }]], 'TICKET_OVERDUE');
  });
}

export async function registerCountJobs(boss: PgBoss) {
  const tz = 'Asia/Kuala_Lumpur';
  await boss.createQueue('cycle-count-daily');
  await boss.schedule('cycle-count-daily', '0 6 * * *', {}, { tz });
  await boss.work('cycle-count-daily', async () => {
    await forEachCompany(`AND coalesce((feature_flags->>'cycle_count')::boolean, false)`, async (cid) => {
      const client = await adminPool.connect();
      try { await client.query('BEGIN'); const r = await generateCycleSessions(client, cid); await client.query('COMMIT'); if (r.created.length) console.log('cycle-count', cid, r.created.length); }
      catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
    });
  });
  await boss.createQueue('ticket-overdue-reminder');
  await boss.schedule('ticket-overdue-reminder', '30 8 * * *', {}, { tz });
  await boss.work('ticket-overdue-reminder', overdueTicketReminders);
  await boss.createQueue('daily-report');
  await boss.schedule('daily-report', '0 20 * * *', {}, { tz });
  await boss.work('daily-report', async () => {
    await forEachCompany('', async (cid) => { await tgSend(cid, await dailyReportText(cid), [[{ text: '看报表', url: `${PUBLIC_URL()}/w/reports` }]], { type: 'DAILY_REPORT' }); });
  });
  await boss.createQueue('delegation-expire');
  await boss.schedule('delegation-expire', '5 * * * *', {}, { tz });
  await boss.work('delegation-expire', async () => { await expireDelegations(); });
  console.log('count jobs registered: cycle-count-daily, ticket-overdue-reminder, daily-report, delegation-expire');
}
