import type { FastifyInstance } from 'fastify';
import { createHmac } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { config } from '../lib/config.js';
import { notFound, unauthorized } from '../lib/errors.js';
/** 导出文件下载：签名 URL，7 天有效 */
export function signedFileUrl(name: string) {
  const exp = Math.floor(Date.now() / 1000) + 7 * 86400;
  const sig = createHmac('sha256', config.fileTokenSecret).update(`${name}:${exp}`).digest('hex');
  return `/api/v1/files/${encodeURIComponent(name)}?exp=${exp}&sig=${sig}`;
}
export async function fileRoutes(app: FastifyInstance) {
  app.get('/files/:name', async (req, reply) => {
    const name = basename(decodeURIComponent((req.params as any).name));
    const { exp, sig } = req.query as any;
    const want = createHmac('sha256', config.fileTokenSecret).update(`${name}:${exp}`).digest('hex');
    if (sig !== want || Number(exp) < Date.now() / 1000) throw unauthorized();
    const p = join(config.uploadDir, name);
    if (!existsSync(p)) throw notFound();
    reply.header('Content-Disposition', `attachment; filename="${name}"`);
    return reply.send(createReadStream(p));
  });
}
