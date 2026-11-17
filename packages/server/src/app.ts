import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { AppError } from './lib/errors.js';
import { ZodError } from 'zod';
import { authRoutes } from './routes/auth.js';
import { masterRoutes } from './routes/master.js';
import { stockRoutes } from './routes/stock.js';
import { syncRoutes } from './routes/sync.js';
import { importRoutes } from './routes/imports.js';
import { exportRoutes } from './routes/exports.js';
import { adminRoutes } from './routes/admin.js';
import { fileRoutes } from './routes/files.js';

export function buildApp() {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test', bodyLimit: 20 * 1024 * 1024 });
  app.register(cors, { origin: true, exposedHeaders: ['Content-Disposition'] });
  app.register(multipart, { limits: { fileSize: 30 * 1024 * 1024 } });
  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof AppError) return reply.status(err.status).send(err.toJSON());
    if (err instanceof ZodError) return reply.status(400).send(new AppError(400, 'VALIDATION', err.issues).toJSON());
    if (err?.validation) return reply.status(400).send(new AppError(400, 'VALIDATION', err.validation).toJSON());
    if (err?.statusCode === 429) return reply.status(429).send(new AppError(429, 'TOO_MANY_REQUESTS').toJSON());
    if (err?.statusCode && err.statusCode < 500) return reply.status(err.statusCode).send(new AppError(err.statusCode, 'VALIDATION', err.message).toJSON());
    req.log.error(err);
    if (process.env.NODE_ENV === 'test') console.error('500 @', req.method, req.url, err?.message, err?.stack?.split('\n')[1]);
    return reply.status(500).send(new AppError(500, 'INTERNAL', process.env.NODE_ENV === 'production' ? undefined : String(err?.message)).toJSON());
  });
  app.get('/api/v1/health', async () => ({ ok: true, time: new Date().toISOString() }));
  app.register(async (api) => {
    await api.register(authRoutes);
    await api.register(masterRoutes);
    await api.register(stockRoutes);
    await api.register(syncRoutes);
    await api.register(importRoutes);
    await api.register(exportRoutes);
    await api.register(adminRoutes);
    await api.register(fileRoutes);
  }, { prefix: '/api/v1' });
  return app;
}
