import { fileURLToPath } from 'node:url';
export const config = {
  port: Number(process.env.PORT || 3000),
  dbName: process.env.DATABASE_NAME || 'warehouse',
  dbHost: process.env.DATABASE_HOST || 'localhost',
  dbPort: Number(process.env.DATABASE_PORT || 5432),
  rwUser: process.env.DB_RW_USER || 'app_rw', rwPass: process.env.DB_RW_PASS || 'app_rw',
  adminUser: process.env.DB_ADMIN_USER || 'app_admin', adminPass: process.env.DB_ADMIN_PASS || 'app_admin',
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  tokenTtlSec: 12 * 3600,
  refreshTtlSec: 7 * 24 * 3600,
  uploadDir: process.env.UPLOAD_DIR || fileURLToPath(new URL('../../uploads/', import.meta.url)),
  minAppVersion: '0.1.0',
  fileTokenSecret: process.env.FILE_TOKEN_SECRET || 'dev-file-secret',
};
