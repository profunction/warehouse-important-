// 迁移运行器：按文件名顺序执行 migrations/*.sql，记录在 schema_migration 表。
// --reset 先删库重建（仅开发测试）。
import pg from 'pg';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ADMIN_URL = process.env.DATABASE_ADMIN_URL || 'postgres://postgres:postgres@localhost:5432/postgres';
const DB_NAME = process.env.DATABASE_NAME || 'warehouse';
const reset = process.argv.includes('--reset');

async function run() {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  if (reset) {
    await admin.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`, [DB_NAME]);
    await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
    console.log('dropped', DB_NAME);
  }
  const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [DB_NAME]);
  if (exists.rowCount === 0) {
    await admin.query(`CREATE DATABASE ${DB_NAME}`);
    console.log('created', DB_NAME);
  }
  await admin.end();

  const url = ADMIN_URL.replace(/\/[^/]*$/, '/' + DB_NAME);
  const db = new pg.Client({ connectionString: url });
  await db.connect();
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migration (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const done = new Set((await db.query('SELECT name FROM schema_migration')).rows.map(r => r.name));
  const dirs = [join(here, '..', 'migrations'), join(here, '..', 'seeds')];
  for (const dir of dirs) {
    const files = readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
    for (const f of files) {
      const key = `${dir.endsWith('seeds') ? 'seed/' : ''}${f}`;
      if (done.has(key)) continue;
      const sql = readFileSync(join(dir, f), 'utf8');
      console.log('applying', key);
      await db.query('BEGIN');
      try {
        await db.query(sql);
        await db.query('INSERT INTO schema_migration(name) VALUES ($1)', [key]);
        await db.query('COMMIT');
      } catch (e) {
        await db.query('ROLLBACK');
        console.error('FAILED', key, e.message);
        process.exit(1);
      }
    }
  }
  await db.end();
  console.log('migrations done');
}
run().catch(e => { console.error(e); process.exit(1); });
