// O3 老板手机报表：五张横滑卡片（今日销售、本月对上月、损耗、周转最差前十、各店今日），数字大，一屏一张
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '../../i18n/index.js';
import { useAuth } from '../../store/auth.js';
import { Page, TopBar } from '../../ui/Shell.js';
import { api } from '../../api/client.js';
const kl = (d = new Date()) => new Date(d.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
const rm = (v: any) => `RM ${Number(v ?? 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const sum = (rows: any[], k: string) => rows.reduce((a, r) => a + Number(r?.[k] ?? 0), 0);
export default function Reports() {
  const { lang } = useT(); const { has } = useAuth(); const nav = useNavigate();
  const [d, setD] = useState<any>({}); const [err, setErr] = useState('');
  useEffect(() => { (async () => {
    const today = kl(); const m0 = today.slice(0, 8) + '01';
    const lm = new Date(new Date(m0).getTime() - 86400_000); const lm0 = kl(lm).slice(0, 8) + '01'; const lm1 = kl(lm);
    const get = (p: string) => api(p).catch(() => null);
    const [daily, month, last, shrink, turn] = await Promise.all([get(`/reports/daily-summary?date=${today}`), get(`/reports/sales?from=${m0}&to=${today}&group=day`), get(`/reports/sales?from=${lm0}&to=${lm1}&group=day`), get(`/reports/shrinkage?from=${m0}&to=${today}`), get('/reports/turnover?days=30')]);
    if (!daily && !month) setErr(lang === 'zh' ? '没有报表权限或离线' : lang === 'ms' ? 'Tiada kebenaran laporan atau luar talian' : 'No report permission or offline');
    setD({ daily: daily?.meta, month: month?.rows ?? [], last: last?.rows ?? [], shrink: shrink?.rows ?? [], turn: (turn?.rows ?? []).slice(0, 10), today, m0 });
  })(); }, [lang]);
  const L = (zh: string, ms: string, en: string) => (lang === 'zh' ? zh : lang === 'ms' ? ms : en);
  const net = (rows: any[]) => sum(rows, 'net') || sum(rows, 'gross') || sum(rows, 'total');
  const mNow = net(d.month ?? []), mLast = net(d.last ?? []); const delta = mLast ? Math.round(((mNow - mLast) / mLast) * 100) : null;
  const shrinkVal = sum(d.shrink ?? [], 'value') || sum(d.shrink ?? [], 'amount') || sum(d.shrink ?? [], 'cost');
  const Card = ({ label, big, sub, children }: any) => <div className="rep-card"><div className="label" style={{ fontSize: 'var(--fs-label)', letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 700 }}>{label}</div>{big != null && <div style={{ fontFamily: 'var(--serif)', fontSize: 'var(--fs-key)', fontWeight: 600, letterSpacing: '-.02em', margin: '8px 0 2px', fontVariantNumeric: 'tabular-nums' }}>{big}</div>}{sub && <div style={{ color: 'var(--muted)', fontSize: 'var(--fs-small)' }}>{sub}</div>}{children}</div>;
  const Row = ({ a, b, warn }: { a: string; b: string; warn?: boolean }) => <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--hair)', fontSize: 'var(--fs-small)' }}><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: 10 }}>{a}</span><b style={{ color: warn ? 'var(--brass)' : 'inherit', fontFamily: 'var(--serif)', flex: 'none' }}>{b}</b></div>;
  const dy = d.daily;
  return (
    <Page>
      <TopBar title={L('报表', 'Laporan', 'Reports')} onBack={() => nav('/m')} />
      {err && <div className="empty">{err}</div>}
      <style>{`.rep-wrap{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;gap:12px;padding:12px var(--pad) 8px}.rep-card{flex:0 0 88%;scroll-snap-align:center;border:1px solid var(--hair);padding:18px 18px 14px;background:var(--paper);min-height:300px;border-radius:var(--radius)}`}</style>
      <div className="rep-wrap">
        <Card label={L('今日销售', 'Jualan hari ini', 'Today sales')} big={rm(dy?.sales?.total)} sub={`${dy?.sales?.count ?? 0} ${L('单', 'resit', 'receipts')} · ${d.today ?? ''}`}>
          {(dy?.sales?.by_method ?? []).map((m: any) => <Row key={m.method} a={m.method} b={rm(m.amount)} />)}
          <Row a={L('现金差', 'Perbezaan tunai', 'Cash variance')} b={rm(dy?.cash?.variance)} warn={Math.abs(Number(dy?.cash?.variance ?? 0)) > 0} />
          <Row a={L('低库存', 'Stok rendah', 'Low stock')} b={String(dy?.low_stock ?? 0)} warn={Number(dy?.low_stock) > 0} />
          <Row a={L('未关工单', 'Tiket terbuka', 'Open tickets')} b={String(dy?.tickets?.open ?? 0)} warn={Number(dy?.tickets?.open) > 0} />
        </Card>
        <Card label={L('本月 vs 上月', 'Bulan ini vs lepas', 'This month vs last')} big={rm(mNow)} sub={`${L('上月', 'Bulan lepas', 'Last month')} ${rm(mLast)}${delta != null ? ` · ${delta > 0 ? '+' : ''}${delta}%` : ''}`}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 90, marginTop: 14 }}>{(d.month ?? []).map((r: any, i: number) => { const v = Number(r.net ?? r.gross ?? r.total ?? 0); const max = Math.max(1, ...(d.month ?? []).map((x: any) => Number(x.net ?? x.gross ?? x.total ?? 0))); return <div key={i} title={`${r.key} ${rm(v)}`} style={{ flex: 1, height: `${Math.max(3, (v / max) * 100)}%`, background: i === (d.month.length - 1) ? 'var(--green)' : 'var(--hair)' }} />; })}</div>
        </Card>
        <Card label={L('本月损耗', 'Susut bulan ini', 'Shrinkage this month')} big={rm(shrinkVal)} sub={`${(d.shrink ?? []).length} ${L('项', 'item', 'items')}`}>
          {(d.shrink ?? []).slice(0, 6).map((r: any, i: number) => <Row key={i} a={`${r.name ?? r.sku ?? ''} · ${r.reason ?? ''}`} b={String(r.qty ?? r.sold_qty ?? '')} />)}
        </Card>
        <Card label={L('周转最差前十', '10 paling perlahan', 'Slowest 10')} sub={L('30 天销量 / 平均库存', 'Jualan 30 hari / purata stok', '30-day sales / avg stock')}>
          {(d.turn ?? []).map((r: any, i: number) => <Row key={i} a={`${i + 1}. ${r.name ?? r.sku}`} b={`${Number(r.sold_qty ?? 0)} / ${Number(r.stock_qty ?? 0)}`} warn={Number(r.sold_qty ?? 0) === 0} />)}
          {(d.turn ?? []).length === 0 && <div className="note" style={{ marginTop: 12, color: 'var(--muted)' }}>{L('还没有销售数据', 'Belum ada jualan', 'No sales yet')}</div>}
        </Card>
        <Card label={L('各店今日', 'Setiap kedai hari ini', 'Per shop today')}>
          {(dy?.sales?.by_site ?? []).map((s: any) => <Row key={s.site} a={`${s.site} ${s.site_name ?? ''}`} b={rm(s.total)} />)}
          {(dy?.sales?.by_site ?? []).length === 0 && <div className="note" style={{ marginTop: 12, color: 'var(--muted)' }}>{L('今天还没有销售', 'Tiada jualan hari ini', 'No sales today')}</div>}
          <Row a={L('逾期应收', 'AR tertunggak', 'Overdue AR')} b={rm(dy?.ar_overdue)} warn={Number(dy?.ar_overdue) > 0} />
        </Card>
      </div>
      <div style={{ padding: '4px var(--pad)', color: 'var(--muted)', fontSize: 'var(--fs-small)' }}>{L('左右滑动看五张卡', 'Leret kiri kanan', 'Swipe for 5 cards')}{has('report.sales') && <> · <a href="/w/sales" style={{ color: 'var(--ink)' }}>{L('网页完整报表', 'Laporan penuh', 'Full reports')}</a></>}</div>
    </Page>
  );
}
