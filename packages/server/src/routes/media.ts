// 产品照片：上传（网页选文件、手机拍照、批量按文件名配条码）和公开读取（大屏、收银、手机都直接显示）。
// 照片不是敏感数据，所以 /media/* 不要登录；只放行本模块生成的文件名，别的文件一律 404。
import type { FastifyInstance } from 'fastify';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { config } from '../lib/config.js';
import { withCompany } from '../lib/db.js';
import { requireAuth, requirePerm } from '../lib/auth.js';
import { AppError, notFound } from '../lib/errors.js';

const NAME_RE = /^prod-[0-9a-f-]{36}-\d+\.jpg$/;
const cx = (req: any) => ({ companyId: req.ctx.companyId, userId: req.ctx.userId, deviceId: req.ctx.deviceId });
/** 压成 800×800 白底 JPEG（约 60KB），自动转正 */
async function toJpeg(buf: Buffer) {
  const sharp = (await import('sharp')).default;
  try { return await sharp(buf).rotate().resize(800, 800, { fit: 'contain', background: '#ffffff', withoutEnlargement: false }).flatten({ background: '#ffffff' }).jpeg({ quality: 82, mozjpeg: true }).toBuffer(); }
  catch { throw new AppError(400, 'VALIDATION', '不是图片文件 / Not an image'); }
}
async function savePhoto(tx: any, productId: string, buf: Buffer) {
  const old = (await tx.query(`SELECT photo_url FROM product WHERE id = $1`, [productId])).rows[0];
  if (!old) throw notFound('PRODUCT_NOT_FOUND');
  const name = `prod-${productId}-${Date.now()}.jpg`;
  await mkdir(config.uploadDir, { recursive: true });
  await writeFile(join(config.uploadDir, name), await toJpeg(buf));
  const url = `/api/v1/media/${name}`;
  await tx.query(`UPDATE product SET photo_url = $2 WHERE id = $1`, [productId, url]);
  const oldName = old.photo_url?.startsWith('/api/v1/media/') ? basename(old.photo_url) : null;
  if (oldName && NAME_RE.test(oldName)) await unlink(join(config.uploadDir, oldName)).catch(() => {});
  return url;
}

export async function mediaRoutes(app: FastifyInstance) {
  app.get('/media/:name', async (req, reply) => {
    const name = basename(String((req.params as any).name));
    if (!NAME_RE.test(name)) throw notFound();
    const p = join(config.uploadDir, name);
    if (!existsSync(p)) throw notFound();
    reply.header('Content-Type', 'image/jpeg').header('Cache-Control', 'public, max-age=31536000, immutable');
    return reply.send(createReadStream(p));
  });

  app.register(async (a) => {
    a.addHook('preHandler', requireAuth);
    /** 单张：网页选文件或手机拍照 */
    a.post('/products/:id/photo', { preHandler: requirePerm('product.edit') }, async (req) => {
      const { id } = req.params as any;
      const file = await (req as any).file();
      if (!file) throw new AppError(400, 'VALIDATION', 'file required');
      const buf: Buffer = await file.toBuffer();
      return withCompany(cx(req), async (tx) => ({ photo_url: await savePhoto(tx, id, buf) }));
    });
    a.delete('/products/:id/photo', { preHandler: requirePerm('product.edit') }, async (req) => {
      const { id } = req.params as any;
      return withCompany(cx(req), async (tx) => {
        const old = (await tx.query(`UPDATE product p SET photo_url = NULL FROM (SELECT photo_url FROM product WHERE id = $1) o WHERE p.id = $1 RETURNING o.photo_url`, [id])).rows[0];
        if (!old) throw notFound('PRODUCT_NOT_FOUND');
        const n = old.photo_url ? basename(old.photo_url) : ''; if (NAME_RE.test(n)) await unlink(join(config.uploadDir, n)).catch(() => {});
        return { ok: true };
      });
    });
    /** 批量：文件名就是条码或货号，例如 9556001234567.jpg、P000001.png */
    a.post('/products/photos/bulk', { preHandler: requirePerm('product.edit') }, async (req) => {
      const matched: { file: string; product_id: string; name: string }[] = []; const unmatched: string[] = [];
      for await (const part of (req as any).files()) {
        const fname = String(part.filename ?? ''); const buf: Buffer = await part.toBuffer();
        const key = fname.replace(/\.[a-z0-9]+$/i, '').trim();
        if (!key) { unmatched.push(fname); continue; }
        const r = await withCompany(cx(req), async (tx) => {
          const p = (await tx.query(`SELECT p.id, coalesce(p.name_zh, p.name_en, p.name_ms) AS name FROM product p LEFT JOIN barcode b ON b.product_id = p.id WHERE b.barcode = $1 OR upper(p.sku) = upper($1) LIMIT 1`, [key])).rows[0];
          if (!p) return null;
          await savePhoto(tx, p.id, buf); return p;
        }).catch(() => null);
        if (r) matched.push({ file: fname, product_id: r.id, name: r.name }); else unmatched.push(fname);
      }
      return { matched, unmatched };
    });
  });
}
