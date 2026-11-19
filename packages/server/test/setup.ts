import { execSync } from 'node:child_process';
export default function setup() {
  execSync('node ../db/scripts/migrate.mjs --reset', { stdio: 'inherit', env: { ...process.env, DATABASE_NAME: process.env.DATABASE_NAME || 'warehouse_test' } });
  execSync('node ../db/scripts/bootstrap-admin.mjs admin@test.local 123456', { stdio: 'inherit', env: { ...process.env, DATABASE_NAME: process.env.DATABASE_NAME || 'warehouse_test' } });
}
