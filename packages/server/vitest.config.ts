import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { globalSetup: ['./test/setup.ts'], testTimeout: 60000, hookTimeout: 120000, fileParallelism: false, env: { NODE_ENV: 'test', DATABASE_NAME: process.env.DATABASE_NAME || 'warehouse_test' } } });
