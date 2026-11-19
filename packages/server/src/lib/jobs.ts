// 定时任务（pg-boss，队列存在同一个 Postgres 里）。第一阶段：设备掉线检查、导出文件清理。第二阶段加每日订货建议、MyInvois 重试。
import PgBoss from 'pg-boss';
import { config } from './config.js';
import { adminPool } from './db.js';
import { readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { registerOrdersJobs } from './ordersJobs.js';

let boss: PgBoss | null = null;
export async function startJobs() {
  if (process.env.NODE_ENV === 'test' || process.env.JOBS_DISABLED === '1') return null;
  boss = new PgBoss({ connectionString: `postgres://${config.adminUser}:${config.adminPass}@${config.dbHost}:${config.dbPort}/${config.dbName}`, schema: 'pgboss' });
  boss.on('error', (e) => console.error('pg-boss', e.message));
  await boss.start();

  // 设备掉线：工作时间内 PHONE/POS/KIOSK 超过 10 分钟无心跳 → 标 OFFLINE 并开工单（同设备只开一张未关闭的）
  await boss.createQueue('device-offline-check');
  await boss.schedule('device-offline-check', '*/10 * * * *', {}, { tz: 'Asia/Kuala_Lumpur' });
  await boss.work('device-offline-check', async () => {
    const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kuala_Lumpur' }).format(new Date()));
    if (hour < 8 || hour >= 22) return;
    await adminPool.query(`UPDATE device SET status = 'OFFLINE' WHERE status = 'ACTIVE' AND type IN ('PHONE','POS','KIOSK') AND last_seen_at < now() - interval '10 minutes'`);
    await adminPool.query(`
      INSERT INTO ticket (company_id, site_id, type, title, ref_type, ref_id, owner_role_code, priority, deadline_at)
      SELECT d.company_id, d.site_id, 'DEVICE', format('设备掉线 %s（%s 分钟）', d.name, floor(extract(epoch from now() - d.last_seen_at) / 60)), 'device', d.id, 'MANAGER', 'NORMAL', date_trunc('day', now()) + interval '1 day'
      FROM device d WHERE d.status = 'OFFLINE' AND d.type IN ('PHONE','POS','KIOSK') AND d.last_seen_at < now() - interval '10 minutes' AND d.last_seen_at > now() - interval '2 days'
        AND NOT EXISTS (SELECT 1 FROM ticket t WHERE t.type = 'DEVICE' AND t.ref_id = d.id AND t.status NOT IN ('RESOLVED','CLOSED'))`);
  });

  // 导出文件 7 天后删除，记录保留
  await boss.createQueue('cleanup-exports');
  await boss.schedule('cleanup-exports', '15 3 * * *', {}, { tz: 'Asia/Kuala_Lumpur' });
  await boss.work('cleanup-exports', async () => {
    const cutoff = Date.now() - 7 * 86400_000;
    for (const f of readdirSync(config.uploadDir)) { if (!f.startsWith('export-')) continue; const p = join(config.uploadDir, f); if (statSync(p).mtimeMs < cutoff) unlinkSync(p); }
  });

  // 同步积压：工作时间内 outbox 超过 100 条或设备 2 小时未同步 → 工单给经理
  await boss.createQueue('sync-backlog-check');
  await boss.schedule('sync-backlog-check', '0 * * * *', {}, { tz: 'Asia/Kuala_Lumpur' });
  await boss.work('sync-backlog-check', async () => {
    await adminPool.query(`
      INSERT INTO ticket (company_id, site_id, type, title, ref_type, ref_id, owner_role_code, priority, deadline_at)
      SELECT d.company_id, d.site_id, 'DEVICE', format('%s 有 %s 笔记录未上传', d.name, d.pending_count), 'device', d.id, 'MANAGER', 'HIGH', now() + interval '4 hours'
      FROM device d WHERE d.pending_count >= 100 AND NOT EXISTS (SELECT 1 FROM ticket t WHERE t.type = 'DEVICE' AND t.ref_id = d.id AND t.title LIKE '%未上传%' AND t.status NOT IN ('RESOLVED','CLOSED'))`);
  });
  await (await import('./ticketJobs.js')).registerTicketJobs(boss);
  await (await import('./einvoiceJobs.js')).registerEinvoiceJobs(boss);
  await (await import('./posJobs.js')).registerPosJobs(boss);
  await registerOrdersJobs(boss);
  await (await import('./countJobs.js')).registerCountJobs(boss);   // 模块 B：循环盘点、日报、工单超期、代理过期
  console.log('jobs started: device-offline-check, cleanup-exports, sync-backlog-check');
  return boss;
}
export async function stopJobs() { await boss?.stop({ graceful: true, timeout: 5000 }); boss = null; }
