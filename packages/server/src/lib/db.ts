import pg from 'pg';
import { config } from './config.js';
import { AppError, fromDbError } from './errors.js';
import { ZodError } from 'zod';
const wrap = (e: any) => (e instanceof AppError ? e : e instanceof ZodError ? new AppError(400, 'VALIDATION', e.issues) : fromDbError(e));

// 数字类型以字符串返回会很烦，numeric 转 number（金额数量精度在 14,3 内安全）
pg.types.setTypeParser(1700, (v) => Number(v));
pg.types.setTypeParser(20, (v) => Number(v));

const url = (u: string, p: string) => `postgres://${u}:${p}@${config.dbHost}:${config.dbPort}/${config.dbName}`;
export const rwPool = new pg.Pool({ connectionString: url(config.rwUser, config.rwPass), max: 20 });
export const adminPool = new pg.Pool({ connectionString: url(config.adminUser, config.adminPass), max: 5 });

export type Tx = pg.PoolClient;
export interface SessionCtx { companyId: string; userId?: string | null; deviceId?: string | null; priceSource?: string }

/** 在一个事务里以某公司身份执行（RLS 生效） */
export async function withCompany<T>(ctx: SessionCtx, fn: (tx: Tx) => Promise<T>, pool: pg.Pool = rwPool): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.company_id', $1, true), set_config('app.user_id', $2, true), set_config('app.device_id', $3, true), set_config('app.price_source', $4, true)`,
      [ctx.companyId, ctx.userId ?? '', ctx.deviceId ?? '', ctx.priceSource ?? '']);
    const r = await fn(client);
    await client.query('COMMIT');
    return r;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw wrap(e);
  } finally {
    client.release();
  }
}
/** 管理员身份（跨公司，超管用） */
export async function withAdmin<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await adminPool.connect();
  try {
    await client.query('BEGIN');
    const r = await fn(client);
    await client.query('COMMIT');
    return r;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw wrap(e);
  } finally { client.release(); }
}
export async function closePools() { await rwPool.end(); await adminPool.end(); }
