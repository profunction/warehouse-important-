// 创建系统公司和超级管理员。用法：node scripts/bootstrap-admin.mjs <email> <6位PIN> [name]
import pg from 'pg';
import argon2 from 'argon2';
const [email, pin, name = 'Super Admin'] = process.argv.slice(2);
if (!email || !/^[0-9]{6}$/.test(pin ?? '')) { console.error('用法: bootstrap-admin.mjs <email> <6位PIN> [name]'); process.exit(1); }
const url = process.env.DATABASE_URL || `postgres://postgres:postgres@localhost:5432/${process.env.DATABASE_NAME || 'warehouse'}`;
const c = new pg.Client({ connectionString: url }); await c.connect();
let sys = (await c.query(`SELECT id FROM company WHERE short_code = 'SYS'`)).rows[0];
if (!sys) {
  sys = (await c.query(`INSERT INTO company (name, short_code, plan, feature_flags, settings) VALUES ('系统', 'SYS', 'B', '{}', '{}') RETURNING id`)).rows[0];
  await c.query(`INSERT INTO role (company_id, code, name_zh, name_ms, name_en, home_buttons) SELECT $1, code, name_zh, name_ms, name_en, home_buttons FROM role WHERE company_id IS NULL AND code = 'SUPER_ADMIN'`, [sys.id]);
}
const hash = await argon2.hash(pin, { type: argon2.argon2id });
const u = (await c.query(`INSERT INTO app_user (company_id, name, email, pin_hash, is_super_admin, language) VALUES ($1,$2,$3,$4,true,'zh')
  ON CONFLICT ((lower(email))) WHERE email IS NOT NULL DO UPDATE SET pin_hash = EXCLUDED.pin_hash, is_super_admin = true, is_active = true RETURNING id`, [sys.id, name, email, hash])).rows[0];
const role = (await c.query(`SELECT id FROM role WHERE company_id = $1 AND code = 'SUPER_ADMIN'`, [sys.id])).rows[0];
await c.query(`INSERT INTO user_site_role (company_id, user_id, site_id, role_id) VALUES ($1,$2,NULL,$3) ON CONFLICT DO NOTHING`, [sys.id, u.id, role.id]);
console.log('super admin ready:', email, u.id);
await c.end();
