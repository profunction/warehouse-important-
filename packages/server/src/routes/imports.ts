import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { withCompany, adminPool } from '../lib/db.js';
import { requireAuth, requirePerm, hasPerm } from '../lib/auth.js';
import { AppError, notFound } from '../lib/errors.js';
import { config } from '../lib/config.js';
import { buildTemplate, readUpload, type Tmpl } from '../lib/xlsx.js';
import { loadLookups, validateSheet, type ValidatedRow } from '../lib/importValidate.js';
import { applyMovement } from '../lib/movements.js';
import { toPinyin } from '../lib/pinyin.js';
import { signedFileUrl } from './files.js';

const APPROVE_PERM: Record<string, string> = { PRODUCT: 'import.approve.product', BARCODE: 'import.approve.product', SUPPLIER: 'import.approve.supplier', OPENING_STOCK: 'import.approve.opening_stock', LOCATION: 'import.approve.location', CUSTOMER: 'import.approve.customer' };
const ORDER = ['SUPPLIER', 'LOCATION', 'PRODUCT', 'BARCODE', 'OPENING_STOCK', 'CUSTOMER'];
async function templates(plan: string): Promise<Tmpl[]> { return (await adminPool.query(`SELECT * FROM import_template WHERE $1 = ANY(plans) ORDER BY code`, [plan])).rows; }

export async function importRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);
  const cx = (req: any) => ({ companyId: req.ctx.companyId, userId: req.ctx.userId, deviceId: req.ctx.deviceId });

  app.get('/import/templates', { preHandler: requirePerm('import.upload') }, async (req) => (await templates(req.ctx.plan)).map((t) => ({ code: t.code, sheet_name_zh: t.sheet_name_zh, sheet_name_ms: t.sheet_name_ms, sheet_name_en: t.sheet_name_en, columns: t.columns })));
  app.get('/import/templates/:code', { preHandler: requirePerm('import.upload') }, async (req, reply) => {
    const code = (req.params as any).code as string;
    const all = await templates(req.ctx.plan);
    const sel = code === 'ALL' ? all : all.filter((t) => t.code === code);
    if (!sel.length) throw notFound();
    const buf = await withCompany(cx(req), (tx) => buildTemplate(tx, req.ctx, sel));
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').header('Content-Disposition', `attachment; filename="template-${code}.xlsx"`);
    return reply.send(buf);
  });

  /** 上传并验证 */
  app.post('/import/jobs', { preHandler: requirePerm('import.upload') }, async (req, reply) => {
    const file = await (req as any).file();
    if (!file) throw new AppError(400, 'VALIDATION', 'file required');
    if (!/\.xlsx$/i.test(file.filename)) throw new AppError(400, 'IMPORT_BAD_FILE');
    const buf: Buffer = await file.toBuffer();
    const fill = String((file.fields?.fill_min_levels as any)?.value ?? 'false') === 'true';
    const hash = createHash('sha256').update(buf).digest('hex');
    await mkdir(config.uploadDir, { recursive: true });
    const stored = `import-${hash.slice(0, 16)}.xlsx`;
    await writeFile(join(config.uploadDir, stored), buf);
    const tmpls = await templates(req.ctx.plan);
    const { sheets, missing } = await readUpload(buf, tmpls);
    if (!sheets.length) throw new AppError(400, 'IMPORT_BAD_FILE', '没有找到任何可识别的工作表');
    const prodRows = sheets.find((s) => s.code === 'PRODUCT')?.rows.length ?? 0;
    if (prodRows > 5000) throw new AppError(400, 'IMPORT_TOO_MANY_ROWS');
    return withCompany(cx(req), async (tx) => {
      const job = (await tx.query(`INSERT INTO import_job (company_id, file_url, file_hash, file_name, uploaded_by, status, options) VALUES ($1,$2,$3,$4,$5,'VALIDATING',$6) RETURNING id`, [req.ctx.companyId, stored, hash, file.filename, req.ctx.userId, { fill_min_levels: fill }])).rows[0];
      const lk = await loadLookups(tx);
      const summary: Record<string, any> = {};
      let anyError = missing.length > 0;
      for (const m of missing) summary[m.sheet] = { ...(summary[m.sheet] ?? {}), missing_columns: [...(summary[m.sheet]?.missing_columns ?? []), m.column] };
      for (const sh of sheets) {
        const t = tmpls.find((x) => x.code === sh.code)!;
        const rows = validateSheet(t, sh, lk, sheets, { fill_min_levels: fill });
        const counts = { total: rows.length, ok: rows.filter((r) => r.status === 'OK').length, warning: rows.filter((r) => r.status === 'WARNING').length, error: rows.filter((r) => r.status === 'ERROR').length, create: rows.filter((r) => r.action === 'CREATE').length, update: rows.filter((r) => r.action === 'UPDATE').length };
        summary[sh.code] = { ...(summary[t.sheet_name_zh] ?? {}), ...counts };
        if (counts.error) anyError = true;
        for (const r of rows) await tx.query(`INSERT INTO import_row (company_id, job_id, sheet_code, row_no, raw_json, normalized_json, status, messages, action) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [req.ctx.companyId, job.id, sh.code, r.row_no, r.raw, r.norm, r.status, JSON.stringify(r.messages), r.action]);
      }
      await tx.query(`UPDATE import_job SET status = $2, sheets_summary = $3 WHERE id = $1`, [job.id, anyError ? 'VALIDATED' : 'VALIDATED', summary]);
      reply.status(201);
      return { job_id: job.id, has_errors: anyError, summary };
    });
  });

  app.get('/import/jobs', { preHandler: requirePerm('import.upload') }, async (req) => withCompany(cx(req), async (tx) => (await tx.query(`SELECT j.id, j.file_name, j.status, j.sheets_summary, j.created_at, j.applied_at, u.name AS uploaded_by_name, a.name AS approved_by_name FROM import_job j JOIN app_user u ON u.id = j.uploaded_by LEFT JOIN app_user a ON a.id = j.approved_by ORDER BY j.created_at DESC LIMIT 50`)).rows));
  app.get('/import/jobs/:id/preview', { preHandler: requirePerm('import.upload') }, async (req) => {
    const { id } = req.params as any;
    const q = z.object({ sheet: z.string().optional(), status: z.string().optional(), limit: z.coerce.number().default(50), offset: z.coerce.number().default(0) }).parse(req.query);
    return withCompany(cx(req), async (tx) => {
      const job = (await tx.query(`SELECT * FROM import_job WHERE id = $1`, [id])).rows[0]; if (!job) throw notFound();
      const rows = (await tx.query(`SELECT sheet_code, row_no, raw_json, normalized_json - 'category' - 'location' - 'backroom_location' AS normalized_json, status, messages, action FROM import_row WHERE job_id = $1 AND ($2::text IS NULL OR sheet_code = $2) AND ($3::text IS NULL OR status = $3) ORDER BY sheet_code, row_no LIMIT $4 OFFSET $5`, [id, q.sheet ?? null, q.status ?? null, q.limit, q.offset])).rows;
      const problems = (await tx.query(`SELECT sheet_code, row_no, status, messages FROM import_row WHERE job_id = $1 AND status <> 'OK' ORDER BY status, sheet_code, row_no LIMIT 500`, [id])).rows;
      const has_errors = problems.some((p) => p.status === 'ERROR') || Object.values(job.sheets_summary ?? {}).some((s: any) => s.missing_columns?.length);
      return { job, rows, problems, has_errors, can_approve: Object.keys(job.sheets_summary ?? {}).every((code) => !APPROVE_PERM[code] || hasPerm(req.ctx, APPROVE_PERM[code])) };
    });
  });
  /** 下载带错误标注的原文件 */
  app.get('/import/jobs/:id/annotated', { preHandler: requirePerm('import.upload') }, async (req, reply) => {
    const { id } = req.params as any;
    const buf = await withCompany(cx(req), async (tx) => {
      const job = (await tx.query(`SELECT * FROM import_job WHERE id = $1`, [id])).rows[0]; if (!job) throw notFound();
      const rows = (await tx.query(`SELECT sheet_code, row_no, status, messages FROM import_row WHERE job_id = $1 AND status <> 'OK'`, [id])).rows;
      const tmpls = await templates(req.ctx.plan);
      const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await readFile(join(config.uploadDir, job.file_url)) as any);
      for (const r of rows) {
        const t = tmpls.find((x) => x.code === r.sheet_code)!;
        const ws = wb.worksheets.find((w) => [t.sheet_name_zh, t.sheet_name_ms, t.sheet_name_en, t.code].includes(w.name.trim())); if (!ws) continue;
        const lastCol = t.columns.length + 1;
        ws.getCell(1, lastCol).value = '导入结果 / Hasil / Result';
        ws.getCell(r.row_no, lastCol).value = (r.messages as any[]).map((m) => `${m.zh}`).join('；');
        for (const m of r.messages as any[]) { const ci = t.columns.findIndex((c) => c.zh === m.column); if (ci >= 0) ws.getCell(r.row_no, ci + 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: m.level === 'ERROR' ? 'FFFFC7CE' : 'FFFFEB9C' } }; }
      }
      return Buffer.from(await wb.xlsx.writeBuffer());
    });
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').header('Content-Disposition', 'attachment; filename="annotated.xlsx"'); return reply.send(buf);
  });

  /** 送审批：有错误不能送；上传人本人有批准权限时（A 模式老板）直接变 PENDING_APPROVAL 可自批 */
  app.post('/import/jobs/:id/submit', { preHandler: requirePerm('import.upload') }, async (req) => {
    const { id } = req.params as any;
    return withCompany(cx(req), async (tx) => {
      const job = (await tx.query(`SELECT * FROM import_job WHERE id = $1`, [id])).rows[0]; if (!job) throw notFound();
      if (job.status !== 'VALIDATED') throw new AppError(400, 'IMPORT_WRONG_STATUS');
      const errs = (await tx.query(`SELECT count(*)::int n FROM import_row WHERE job_id = $1 AND status = 'ERROR'`, [id])).rows[0].n;
      if (errs > 0 || Object.values(job.sheets_summary ?? {}).some((s: any) => s.missing_columns?.length)) throw new AppError(400, 'IMPORT_HAS_ERRORS', { errors: errs });
      const codes = Object.keys(job.sheets_summary ?? {}).filter((c) => APPROVE_PERM[c]);
      const approverRole = codes.includes('OPENING_STOCK') || codes.includes('PRODUCT') ? 'BOSS' : codes.includes('LOCATION') ? 'MANAGER' : 'BOSS';
      const ar = (await tx.query(`INSERT INTO approval_request (company_id, type, ref_type, ref_id, requested_by, approver_role_code, summary) VALUES ($1,'IMPORT','import_job',$2,$3,$4,$5) RETURNING id`, [req.ctx.companyId, id, req.ctx.userId, approverRole, job.sheets_summary])).rows[0];
      await tx.query(`UPDATE import_job SET status = 'PENDING_APPROVAL', approval_request_id = $2 WHERE id = $1`, [id, ar.id]);
      return { ok: true, approval_request_id: ar.id };
    });
  });

  /** 批准并执行 */
  app.post('/import/jobs/:id/apply', async (req) => {
    const { id } = req.params as any;
    return withCompany({ ...cx(req), priceSource: 'IMPORT' }, async (tx) => {
      const job = (await tx.query(`SELECT * FROM import_job WHERE id = $1 FOR UPDATE`, [id])).rows[0]; if (!job) throw notFound();
      if (job.status !== 'PENDING_APPROVAL') throw new AppError(400, 'IMPORT_WRONG_STATUS');
      const codes = Object.keys(job.sheets_summary ?? {});
      for (const c of codes) if (APPROVE_PERM[c] && !hasPerm(req.ctx, APPROVE_PERM[c])) throw new AppError(403, 'FORBIDDEN', { need: APPROVE_PERM[c] });
      if (job.uploaded_by === req.ctx.userId && req.ctx.plan !== 'A') throw new AppError(400, 'APPROVAL_SELF');
      await tx.query(`UPDATE approval_request SET status = 'APPROVED', approver_id = $2, decided_at = now() WHERE id = $1`, [job.approval_request_id, req.ctx.userId]);
      await tx.query(`UPDATE import_job SET status = 'APPLYING' WHERE id = $1`, [id]);
      const rowsBySheet = new Map<string, ValidatedRow[]>();
      for (const r of (await tx.query(`SELECT * FROM import_row WHERE job_id = $1 AND status <> 'ERROR' ORDER BY row_no`, [id])).rows)
        rowsBySheet.set(r.sheet_code, [...(rowsBySheet.get(r.sheet_code) ?? []), { row_no: r.row_no, raw: r.raw_json, norm: r.normalized_json, messages: r.messages, status: r.status, action: r.action }]);
      const cid = req.ctx.companyId; const result: Record<string, number> = {};
      const setResult = (sheet: string, row_no: number, rid: string, action: string) => tx.query(`UPDATE import_row SET result_id = $3, action = $4 WHERE job_id = $1 AND sheet_code = $2 AND row_no = $5`, [id, sheet, rid, action, row_no]);
      const supplierIds = new Map<string, string>((await tx.query(`SELECT id, lower(name) n FROM supplier`)).rows.map((s) => [s.n, s.id]));
      for (const code of ORDER) {
        const rows = rowsBySheet.get(code); if (!rows) continue;
        let n = 0;
        if (code === 'SUPPLIER') for (const r of rows) {
          const k = r.raw.name.toLowerCase();
          if (r.norm.existing_id) { await tx.query(`UPDATE supplier SET tin = COALESCE($2, tin), email = COALESCE($3, email), phone = COALESCE($4, phone), whatsapp = COALESCE($5, whatsapp), payment_terms_days = COALESCE($6, payment_terms_days), lead_time_days = COALESCE($7, lead_time_days), min_order_amount = COALESCE($8, min_order_amount) WHERE id = $1`, [r.norm.existing_id, r.norm.tin ?? null, r.norm.email ?? null, r.norm.phone ?? null, r.norm.whatsapp ?? null, r.norm.payment_terms_days ?? null, r.norm.lead_time_days ?? null, r.norm.min_order_amount ?? null]); await setResult(code, r.row_no, r.norm.existing_id, 'UPDATE'); }
          else { const s = (await tx.query(`INSERT INTO supplier (company_id, name, tin, email, phone, whatsapp, payment_terms_days, lead_time_days, min_order_amount) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`, [cid, r.raw.name, r.norm.tin ?? null, r.norm.email ?? null, r.norm.phone ?? null, r.norm.whatsapp ?? null, r.norm.payment_terms_days ?? 30, r.norm.lead_time_days ?? 3, r.norm.min_order_amount ?? 0])).rows[0]; supplierIds.set(k, s.id); await setResult(code, r.row_no, s.id, 'CREATE'); }
          n++;
        }
        if (code === 'LOCATION') for (const r of rows) {
          const zn = (await tx.query(`INSERT INTO zone (company_id, site_id, code, name_zh, zone_type, color, allowed_is_hard, sort_order) VALUES ($1,$2,$3,$4,$5,'#9E9E9E',$6,0) ON CONFLICT (site_id, code) DO UPDATE SET name_zh = EXCLUDED.name_zh RETURNING id`, [cid, r.norm.site_id, r.raw.zone_code, r.raw.zone_name, r.norm.zone_type, r.norm.zone_type === 'BACKROOM'])).rows[0];
          await tx.query(`DELETE FROM zone_category WHERE zone_id = $1`, [zn.id]);
          for (const c of r.norm.allowed_category_ids ?? []) await tx.query(`INSERT INTO zone_category VALUES ($1,$2)`, [zn.id, c]);
          for (let i = 1; i <= r.norm.racks; i++) for (let j = 1; j <= r.norm.levels; j++) await tx.query(`INSERT INTO location (company_id, site_id, zone_id, code, rack, level, capacity_boxes) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (company_id, code) DO NOTHING`, [cid, r.norm.site_id, zn.id, `${r.raw.zone_code}-${String(i).padStart(2, '0')}-${j}`, i, j, r.norm.boxes_per_level ?? 10]);
          await setResult(code, r.row_no, zn.id, 'CREATE'); n++;
        }
        if (code === 'PRODUCT') for (const r of rows) {
          const supId = r.norm.supplier_id ?? (r.norm.supplier_name ? supplierIds.get(r.norm.supplier_name.toLowerCase()) : null) ?? null;
          if (r.norm.supplier_name && !supId) { const s = (await tx.query(`INSERT INTO supplier (company_id, name) VALUES ($1,$2) RETURNING id`, [cid, r.norm.supplier_name])).rows[0]; supplierIds.set(r.norm.supplier_name.toLowerCase(), s.id); r.norm.supplier_id = s.id; } else r.norm.supplier_id = supId;
          const vals = [r.raw.name_zh ?? null, r.raw.name_ms ?? null, r.raw.name_en ?? null, toPinyin(r.raw.name_zh), r.norm.category.id, r.norm.unit ?? 'PCS', (r.norm.unit ?? 'PCS') === 'KG', r.norm.plu_code ?? null, r.norm.cost_price ?? 0, r.norm.sell_price, r.norm.tax_code_id ?? null, r.norm.min_level, r.norm.reorder_qty, r.norm.supplier_id, r.norm.backroom_location?.id ?? null, r.norm.shelf_life_days ?? null];
          let pid: string;
          if (r.norm.existing_id) {
            pid = r.norm.existing_id;
            await tx.query(`UPDATE product SET name_zh = COALESCE($2, name_zh), name_ms = COALESCE($3, name_ms), name_en = COALESCE($4, name_en), name_pinyin = COALESCE($5, name_pinyin), category_id = $6, unit = $7, is_weighed = $8, plu_code = COALESCE($9, plu_code), cost_price = $10, sell_price = $11, tax_code_id = COALESCE($12, tax_code_id), min_level = $13, reorder_qty = $14, default_supplier_id = COALESCE($15, default_supplier_id), default_location_id = COALESCE($16, default_location_id), shelf_life_days = COALESCE($17, shelf_life_days) WHERE id = $1`, [pid, ...vals]);
          } else {
            const sku = r.raw.sku ?? (await tx.query(`SELECT 'P' || lpad((count(*) + 1 + $1)::text, 6, '0') AS s FROM product`, [n])).rows[0].s;
            pid = (await tx.query(`INSERT INTO product (company_id, sku, name_zh, name_ms, name_en, name_pinyin, category_id, unit, is_weighed, plu_code, cost_price, sell_price, tax_code_id, min_level, reorder_qty, default_supplier_id, default_location_id, shelf_life_days) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,COALESCE($13,(SELECT id FROM tax_code WHERE is_default)),$14,$15,$16,$17,$18) RETURNING id`, [cid, sku, ...vals])).rows[0].id;
            await tx.query(`INSERT INTO barcode (company_id, product_id, barcode, pack_qty, barcode_type, is_primary) VALUES ($1,$2,$3,1,'UNIT',true)`, [cid, pid, r.raw.barcode]);
            if (r.norm.pack_qty > 1) { /* 箱码占位：等更多条码表提供真实箱码 */ }
          }
          await setResult(code, r.row_no, pid, r.norm.existing_id ? 'UPDATE' : 'CREATE'); n++;
        }
        if (code === 'BARCODE') for (const r of rows) {
          const pid = (await tx.query(`SELECT product_id FROM barcode WHERE barcode = $1`, [r.norm.product_barcode])).rows[0]?.product_id;
          if (!pid) continue;
          const b = (await tx.query(`INSERT INTO barcode (company_id, product_id, barcode, pack_qty, barcode_type) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [cid, pid, r.raw.barcode, r.norm.barcode_type === 'UNIT' ? 1 : r.norm.pack_qty, r.norm.barcode_type])).rows[0];
          await setResult(code, r.row_no, b.id, 'CREATE'); n++;
        }
        if (code === 'OPENING_STOCK') {
          const supplierLoc = (await tx.query(`SELECT id FROM location WHERE virtual_type = 'SUPPLIER'`)).rows[0].id;
          type M = { qty: number; expiry?: string; rows: number[]; product_id: string; location_id: string };
          const merged = new Map<string, M>();
          for (const r of rows) {
            const b = (await tx.query(`SELECT product_id, pack_qty FROM barcode WHERE barcode = $1`, [r.norm.barcode])).rows[0];
            if (!b) continue;
            const k = `${b.product_id}|${r.norm.location.id}`;
            const m: M = merged.get(k) ?? { qty: 0, rows: [] as number[], product_id: b.product_id, location_id: r.norm.location.id, expiry: r.norm.expiry_date };
            m.qty += r.norm.qty * Number(b.pack_qty); m.rows.push(r.row_no); merged.set(k, m);
          }
          for (const m of merged.values()) {
            const mv = await applyMovement(tx, req.ctx, { product_id: m.product_id, from_location_id: supplierLoc, to_location_id: m.location_id, qty: m.qty, reason: 'COUNT', ref_type: 'IMPORT', ref_id: id, expiry_date: m.expiry ?? null, note: '期初库存导入' });
            for (const rn of m.rows) await setResult(code, rn, mv.id, 'CREATE'); n++;
          }
        }
        result[code] = n;
      }
      await tx.query(`UPDATE import_job SET status = 'APPLIED', approved_by = $2, applied_at = now() WHERE id = $1`, [id, req.ctx.userId]);
      await tx.query(`INSERT INTO audit_log (company_id, user_id, action, table_name, row_id, after_json) VALUES ($1,$2,'IMPORT','import_job',$3,$4)`, [cid, req.ctx.userId, id, JSON.stringify(result)]);
      return { ok: true, applied: result };
    });
  });

  app.post('/import/jobs/:id/reject', async (req) => {
    const { id } = req.params as any;
    const { note } = z.object({ note: z.string().optional() }).parse(req.body ?? {});
    return withCompany(cx(req), async (tx) => {
      const job = (await tx.query(`SELECT * FROM import_job WHERE id = $1`, [id])).rows[0]; if (!job) throw notFound();
      if (job.approval_request_id) await tx.query(`UPDATE approval_request SET status = 'REJECTED', approver_id = $2, decided_at = now(), decision_note = $3 WHERE id = $1`, [job.approval_request_id, req.ctx.userId, note ?? null]);
      await tx.query(`UPDATE import_job SET status = 'REJECTED' WHERE id = $1`, [id]);
      return { ok: true };
    });
  });
  app.get('/import/jobs/:id/file', { preHandler: requirePerm('import.upload') }, async (req) => {
    const { id } = req.params as any;
    return withCompany(cx(req), async (tx) => { const job = (await tx.query(`SELECT file_url FROM import_job WHERE id = $1`, [id])).rows[0]; if (!job) throw notFound(); return { url: signedFileUrl(job.file_url) }; });
  });
}
