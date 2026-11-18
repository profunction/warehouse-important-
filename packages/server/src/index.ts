import { buildApp } from './app.js';
import { config } from './lib/config.js';
import { mkdirSync } from 'node:fs';
import { startJobs, stopJobs } from './lib/jobs.js';
mkdirSync(config.uploadDir, { recursive: true });
const app = buildApp();
app.listen({ port: config.port, host: '0.0.0.0' }).then(() => { console.log('server on', config.port); startJobs().catch((e) => console.error('jobs failed', e.message)); });
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, async () => { await stopJobs(); await app.close(); process.exit(0); });
