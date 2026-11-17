import { buildApp } from './app.js';
import { config } from './lib/config.js';
import { mkdirSync } from 'node:fs';
mkdirSync(config.uploadDir, { recursive: true });
const app = buildApp();
app.listen({ port: config.port, host: '0.0.0.0' }).then(() => console.log('server on', config.port));
