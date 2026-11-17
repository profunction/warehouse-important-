import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { withCompany } from '../lib/db.js';
import { requireAuth, hasPerm } from '../lib/auth.js';
import { AppError } from '../lib/errors.js';
import { config } from '../lib/config.js';
import { signedFileUrl } from './files.js';

type ColDef = { key: string; title: string; perm?: string };
const EXPORTS: Record<string, { perm: string[]; sql: (f: any, ctx: any) => { text: string; params: any[] }; columns: ColDef[] }> = {
  product: {
    perm: ['export.product', 'export.product_with_cost'],
    sql: () => ({ text: `SELECT p.sku, (SELECT barcode FROM barcode b WHERE b.product_id = p.id AND b.is_primary) AS barcode, p.name_zh, p.name_ms, p.name_en, c.name_zh AS category, p.unit, p.cost_price, p.sell_price, t.code AS tax_code, s.name AS supplier, p.min_level, p.reorder_qty, p.shelf_life_days, p.plu_code, p.is_active,
      (SELECT coalesce(sum(st.qty),0) FROM stock st JOIN location l ON l.id = st.location_id WHERE st.product_id = p.id AND NOT l.is_virtual) AS total_qty
      FROM product p JOIN category c ON c.id = p.category_id JOIN tax_code t ON t.id = p.tax_code_id LEFT JOIN supplier s ON s.id = p.default_supplier_id ORDER BY p.sku`, params: [] }),
    columns: [{ key: 'sku', title: '货号' }, { key: 'barcode', title: '主条码' }, { key: 'name_zh', title: '中文名' }, { key: 'name_ms', title: '马来文名' }, { key: 'name_en', title: '英文名' }, { key: 'category', title: '类别' }, { key: 'unit', title: '单位' }, { key: 'cost_price', title: '成本价', perm: 'export.product_with_cost' }, { key: 'sell_price', title: '售价' }, { key: 'tax_code', title: '税码' }, { key: 'supplier', title: '供应商' }, { key: 'min_level', title: '最低量' }, { key: 'reorder_qty', title: '补货量' }, { key: 'shelf_life_days', title: '保质期天数' }, { key: 'plu_code', title: '称重 PLU' }, { key: 'total_qty', title: '总库存' }, { key: 'is_active', title: '启用' }],
  },
  stock: {
    perm: ['export.stock'],
    sql: (f, ctx) => ({ text: `SELECT s.code AS site, l.code AS location, z.code AS zone, p.sku, (SELECT barcode FROM barcode b WHERE b.product_id = p.id AND b.is_primary) AS barcode, p.name_zh, p.name_en, p.unit, st.qty, st.earliest_expiry, p.cost_price, (st.qty * p.cost_price) AS stock_value
      FROM stock st JOIN location l ON l.id = st.location_id JOIN site s ON s.id = l.site_id JOIN zone z ON z.id = l.zone_id JOIN product p ON p.id = st.product_id WHERE NOT l.is_virtual AND st.qty <> 0 AND ($1::uuid IS NULL OR l.site_id = $1) ORDER BY s.code, l.code, p.sku`, params: [f.site ?? (hasPerm(ctx, 'stock.view_other_sites') ? null : ctx.siteId)] }),
    columns: [{ key: 'site', title: '站点' }, { key: 'location', title: '位置' }, { key: 'zone', title: '区' }, { key: 'sku', title: '货号' }, { key: 'barcode', title: '条码' }, { key: 'name_zh', title: '中文名' }, { key: 'name_en', title: '英文名' }, { key: 'unit', title: '单位' }, { key: 'qty', title: '数量' }, { key: 'earliest_expiry', title: '最早到期' }, { key: 'cost_price', title: '成本价', perm: 'product.view_cost' }, { key: 'stock_value', title: '库存金额', perm: 'product.view_cost' }],
  },
  location: {
    perm: ['export.stock'],
    sql: () => ({ text: `SELECT s.code AS site, z.code AS zone, z.name_zh AS zone_name, z.zone_type, l.code, l.rack, l.level, l.is_active, l.qr_printed_at, (SELECT string_agg(c.name_zh, ';') FROM zone_category zc JOIN category c ON c.id = zc.category_id WHERE zc.zone_id = z.id) AS allowed FROM location l JOIN zone z ON z.id = l.zone_id JOIN site s ON s.id = l.site_id ORDER BY s.code, z.sort_order, l.rack, l.level`, params: [] }),
    columns: [{ key: 'site', title: '站点' }, { key: 'zone', title: '区' }, { key: 'zone_name', title: '区名称' }, { key: 'zone_type', title: '区类型' }, { key: 'code', title: '位置代码' }, { key: 'rack', title: '架' }, { key: 'level', title: '层' }, { key: 'allowed', title: '允许类别' }, { key: 'is_active', title: '启用' }, { key: 'qr_printed_at', title: '标签打印时间' }],
  },
  movement: {
    perm: ['export.movement'],
    sql: (f) => ({ text: `SELECT m.performed_at, m.reason, p.sku, p.name_zh, fl.code AS from_code, tl.code AS to_code, m.qty, m.unit_cost, u.name AS by_name, m.ref_type, m.note, m.synced_at FROM movement m JOIN product p ON p.id = m.product_id JOIN location fl ON fl.id = m.from_location_id JOIN location tl ON tl.id = m.to_location_id JOIN app_user u ON u.id = m.performed_by
      WHERE ($1::timestamptz IS NULL OR m.performed_at >= $1) AND ($2::timestamptz IS NULL OR m.performed_at < $2) AND ($3::text IS NULL OR m.reason = $3) ORDER BY m.performed_at DESC LIMIT 50000`, params: [f.from ?? null, f.to ?? null, f.reason ?? null] }),
    columns: [{ key: 'performed_at', title: '时间' }, { key: 'reason', title: '原因' }, { key: 'sku', title: '货号' }, { key: 'name_zh', title: '产品' }, { key: 'from_code', title: '从' }, { key: 'to_code', title: '到' }, { key: 'qty', title: '数量' }, { key: 'unit_cost', title: '单位成本', perm: 'product.view_cost' }, { key: 'by_name', title: '操作人' }, { key: 'ref_type', title: '来源' }, { key: 'note', title: '备注' }, { key: 'synced_at', title: '上传时间' }],
  },
  audit: {
    perm: ['export.audit'],
    sql: (f) => ({ text: `SELECT a.at, u.name AS user_name, a.action, a.table_name, a.row_id, a.changed_columns, a.before_json, a.after_json FROM audit_log a LEFT JOIN app_user u ON u.id = a.user_id WHERE ($1::timestamptz IS NULL OR a.at >= $1) AND ($2::timestamptz IS NULL OR a.at < $2) ORDER BY a.at DESC LIMIT 50000`, params: [f.from ?? null, f.to ?? null] }),
    columns: [{ key: 'at', title: '时间' }, { key: 'user_name', title: '用户' }, { key: 'action', title: '动作' }, { key: 'table_name', title: '表' }, { key: 'row_id', title: '行' }, { key: 'changed_columns', title: '改动列' }, { key: 'before_json', title: '之前' }, { key: 'after_json', title: '之后' }],
  },
};

export async function exportRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);
  app.post('/export', async (req) => {
    const b = z.object({ type: z.enum(['product', 'stock', 'location', 'movement', 'audit']), filters: z.record(z.any()).default({}) }).parse(req.body);
    const def = EXPORTS[b.type];
    if (!def.perm.some((p) => hasPerm(req.ctx, p))) throw new AppError(403, 'FORBIDDEN', { need: def.perm });
    // 列按权限过滤：服务器生成文件时就不写
    const cols = def.columns.filter((c) => !c.perm || hasPerm(req.ctx, c.perm));
    return withCompany({ companyId: req.ctx.companyId, userId: req.ctx.userId }, async (tx) => {
      const { text, params } = def.sql(b.filters, req.ctx);
      const rows = (await tx.query(text, params)).rows;
      const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet(b.type);
      ws.addRow(cols.map((c) => c.title)); ws.getRow(1).font = { bold: true };
      for (const r of rows) ws.addRow(cols.map((c) => { const v = r[c.key]; return v && typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : v; }));
      cols.forEach((_, i) => (ws.getColumn(i + 1).width = 18));
      await mkdir(config.uploadDir, { recursive: true });
      const name = `export-${b.type}-${Date.now()}.xlsx`;
      await writeFile(join(config.uploadDir, name), Buffer.from(await wb.xlsx.writeBuffer()));
      const url = signedFileUrl(name);
      await tx.query(`INSERT INTO export_log (company_id, user_id, export_type, filters_json, columns_json, row_count, file_url) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [req.ctx.companyId, req.ctx.userId, b.type, b.filters, JSON.stringify(cols.map((c) => c.key)), rows.length, url]);
      await tx.query(`INSERT INTO audit_log (company_id, user_id, action, table_name, after_json) VALUES ($1,$2,'EXPORT',$3,$4)`, [req.ctx.companyId, req.ctx.userId, b.type, JSON.stringify({ rows: rows.length, columns: cols.map((c) => c.key) })]);
      return { url, row_count: rows.length, columns: cols.map((c) => c.key) };
    });
  });
  app.get('/export/log', async (req) => withCompany({ companyId: req.ctx.companyId, userId: req.ctx.userId }, async (tx) => (await tx.query(`SELECT e.*, u.name AS user_name FROM export_log e JOIN app_user u ON u.id = e.user_id ORDER BY e.at DESC LIMIT 100`)).rows));
}
