// Pandal 定时拉取（B5 步骤 3）：每 5 分钟，对 settings.pandal_api_url + settings.pandal_api_key 都有的公司拉交易，转 createSaleFromExternal。
// 约定（Pandal 真实接口未定，先按下面格式实现，接入时只改 mapTransaction）：
//   GET {pandal_api_url}/transactions?since=<ISO>  Header: Authorization: Bearer <pandal_api_key>
//   响应: { data: [{ id, terminal, time, outlet_code?, lines: [{ barcode, qty, weight_kg?, unit_price, discount? }], payments: [{ method: 'CASH'|'CARD'|'EWALLET', amount }] }], next_since? }
//   external_ref = `${terminal}-${id}`（第六部分"多台 POS 的设计"）。
// 游标存 external_sync_log（entity 'pandal_cursor'），不改 company.settings。
// 无 API 的公司：收银机小程序直接推 POST /open/sales，本任务不跑。
import type PgBoss from 'pg-boss';
import { adminPool, withCompany } from '../lib/db.js';
import { createSaleFromExternal, type OpenSaleInput } from '../routes/open.js';

export function mapTransaction(t: any, defaultSite?: string | null): OpenSaleInput {
  const method = (m: string) => (['CASH', 'CARD', 'EWALLET', 'BANK_TRANSFER', 'CHEQUE'].includes(String(m).toUpperCase()) ? String(m).toUpperCase() : 'CASH') as OpenSaleInput['payments'][number]['method'];
  return {
    external_ref: `${t.terminal ?? 'PD'}-${t.id}`, site_code: t.outlet_code ?? defaultSite ?? null, terminal_code: t.terminal ?? 'PD', sold_at: t.time ? new Date(t.time).toISOString() : null,
    lines: (t.lines ?? []).map((l: any) => ({ barcode: String(l.barcode), qty: Number(l.qty ?? 1), weight_kg: l.weight_kg != null ? Number(l.weight_kg) : null, unit_price: l.unit_price != null ? Number(l.unit_price) : null, discount: l.discount != null ? Number(l.discount) : null })),
    payments: (t.payments ?? []).map((p: any) => ({ method: method(p.method), amount: Number(p.amount), reference: p.reference ?? null })),
    customer_code: null, note: 'Pandal pull',
  };
}

export async function pullPandalOnce(fetchImpl: typeof fetch = fetch) {
  const companies = (await adminPool.query(`SELECT id, settings FROM company WHERE is_active AND settings->>'pandal_api_url' IS NOT NULL AND settings->>'pandal_api_key' IS NOT NULL AND coalesce((feature_flags->>'pandal')::boolean, false)`)).rows;
  const out: { company_id: string; pulled: number; errors: number }[] = [];
  for (const c of companies) {
    const url: string = c.settings.pandal_api_url; const key: string = c.settings.pandal_api_key;
    const last = (await adminPool.query(`SELECT detail->>'since' AS since FROM external_sync_log WHERE company_id = $1 AND entity = 'pandal_cursor' ORDER BY at DESC LIMIT 1`, [c.id])).rows[0]?.since ?? new Date(Date.now() - 86400_000).toISOString();
    let pulled = 0, errors = 0;
    try {
      const r = await fetchImpl(`${url.replace(/\/$/, '')}/transactions?since=${encodeURIComponent(last)}`, { headers: { authorization: `Bearer ${key}`, accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error(`pandal ${r.status}`);
      const j: any = await r.json();
      const siteId = (await adminPool.query(`SELECT id FROM site WHERE company_id = $1 AND is_active ORDER BY type = 'SHOP' DESC LIMIT 1`, [c.id])).rows[0]?.id ?? null;
      for (const t of j.data ?? []) {
        try { await withCompany({ companyId: c.id }, (tx) => createSaleFromExternal(tx, { companyId: c.id, siteId }, 'PANDAL', mapTransaction(t, c.settings.pandal_site_code))); pulled++; }
        catch (e: any) { errors++; console.error('pandal tx failed', t?.id, e?.code ?? e?.message); }
      }
      await adminPool.query(`INSERT INTO external_sync_log (company_id, system, direction, entity, status, detail) VALUES ($1,'PANDAL','PULL','pandal_cursor','OK',$2)`, [c.id, JSON.stringify({ since: j.next_since ?? new Date().toISOString(), pulled, errors })]);
    } catch (e: any) {
      errors++; console.error('pandal pull failed', c.id, e?.message);
      await adminPool.query(`INSERT INTO external_sync_log (company_id, system, direction, entity, status, detail) VALUES ($1,'PANDAL','PULL','pandal_cursor','ERROR',$2)`, [c.id, JSON.stringify({ since: last, error: String(e?.message ?? e) })]);
    }
    out.push({ company_id: c.id, pulled, errors });
  }
  return out;
}

export async function registerPosJobs(boss: PgBoss) {
  await boss.createQueue('pandal-pull');
  await boss.schedule('pandal-pull', '*/5 * * * *', {}, { tz: 'Asia/Kuala_Lumpur' });
  await boss.work('pandal-pull', async () => { await pullPandalOnce(); });
  console.log('jobs: pandal-pull (every 5 min, companies with pandal_api_url/pandal_api_key)');
}
