import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
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
import { ordersRoutes } from './routes/orders.js';
import { receivingRoutes } from './routes/receiving.js';
import { transfersRoutes } from './routes/transfers.js';
import { countsRoutes } from './routes/counts.js';
import { approvalsRoutes } from './routes/approvals.js';
import { telegramRoutes } from './routes/telegram.js';
import { posRoutes } from './routes/pos.js';
import { arRoutes } from './routes/ar.js';
import { apRoutes } from './routes/ap.js';
import { einvoiceRoutes } from './routes/einvoice.js';
import { openRoutes } from './routes/open.js';
import { kioskRoutes, kioskKeyGuard } from './routes/kiosk.js';
import { botRoutes } from './routes/bot.js';
import { mapRoutes } from './routes/map.js';
import { reportsRoutes } from './routes/reports.js';
import { periodRoutes } from './routes/period.js';
import { ticketsRoutes } from './routes/tickets.js';

export function buildApp() {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test', bodyLimit: 20 * 1024 * 1024 });
  app.register(cors, { origin: true, exposedHeaders: ['Content-Disposition'] });
  app.register(helmet, { contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } });
  // 速率限制（验收 A14）：每设备或 IP 每分钟 600 次，登录每分钟 20 次
  if (process.env.NODE_ENV !== 'test') {
    app.register(rateLimit, { global: true, max: 600, timeWindow: '1 minute', keyGenerator: (req) => (req.headers['x-device-id'] as string) || req.ip, errorResponseBuilder: () => new AppError(429, 'TOO_MANY_REQUESTS').toJSON() });
  }
  app.register(multipart, { limits: { fileSize: 30 * 1024 * 1024 } });
  // API 文档：/api/v1/docs（给 Pandal 等第三方对接看）
  app.register(swagger, { openapi: { info: { title: 'WarehouseShop API', version: '0.1.0', description: '仓店通开放接口。所有写入带 client_id 幂等；成本字段按角色过滤。' }, servers: [{ url: '/api/v1' }], components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } }, security: [{ bearer: [] }] } });
  app.register(swaggerUi, { routePrefix: '/api/v1/docs' });
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
  app.addHook('onRequest', kioskKeyGuard);
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
    await api.register(ordersRoutes);
    await api.register(receivingRoutes);
    await api.register(transfersRoutes);
    await api.register(countsRoutes);
    await api.register(approvalsRoutes);
    await api.register(telegramRoutes);
    await api.register(posRoutes);
    await api.register(arRoutes);
    await api.register(apRoutes);
    await api.register(einvoiceRoutes);
    await api.register(openRoutes);
    await api.register(kioskRoutes);
    await api.register(botRoutes);
    await api.register(mapRoutes);
    await api.register(reportsRoutes);
    await api.register(periodRoutes);
    await api.register(ticketsRoutes);
  }, { prefix: '/api/v1' });
  return app;
}
