// 电子发票（模块 D）：提交列表按状态、重试、取消、二维码、合并发票月度预览/提交、MyInvois 设定。
import { useEffect, useState } from 'react';
import { api } from '../../../api/client.js';
import { useAuth } from '../../../store/auth.js';
import { errText, fmtDate, fmtMoney } from './_util.js';
const ST_ZH: Record<string, string> = { QUEUED: '排队中', SUBMITTED: '已提交待验证', VALID: '有效', INVALID: '被拒', CANCELLED: '已取消', FAILED: '失败' };
const stColor = (s: string) => (s === 'VALID' ? '#1B8A3A' : s === 'INVALID' || s === 'FAILED' ? '#C62828' : s === 'CANCELLED' ? '#9E9E9E' : '#F9A825');
const DOC_ZH: Record<string, string> = { INVOICE: '发票', CREDIT_NOTE: '贷项', CONSOLIDATED: '合并', SELF_BILLED: '自开', REFUND_NOTE: '退款' };
/** 二维码 PNG 要带登录头，所以用 fetch 转 blob 再显示 */
function QrImg({ id }: { id: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => { let url: string | null = null; api(`/einvoice/submissions/${id}/qr`, { raw: true }).then(async (r: Response) => { url = URL.createObjectURL(await r.blob()); setSrc(url); }).catch(() => setSrc(null)); return () => { if (url) URL.revokeObjectURL(url); }; }, [id]);
  return src ? <img alt="QR" src={src} style={{ width: 160, height: 160 }} /> : null;
}
const lastMonth = () => { const d = new Date(Date.now() + 8 * 3600_000); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); };

export default function EInvoice() {
  const { has, me } = useAuth();
  const [tab, setTab] = useState<'list' | 'consolidated' | 'settings'>('list');
  const [status, setStatus] = useState(''); const [rows, setRows] = useState<any[]>([]); const [sel, setSel] = useState<any | null>(null);
  const [msg, setMsg] = useState(''); const [ok, setOk] = useState('');
  const [siteId, setSiteId] = useState(me?.site?.id ?? me?.sites?.[0]?.id ?? ''); const [month, setMonth] = useState(lastMonth()); const [preview, setPreview] = useState<any | null>(null); const [periods, setPeriods] = useState<any[]>([]);
  const [settings, setSettings] = useState<any | null>(null); const [sform, setSform] = useState<any>({});
  const say = (t: string) => { setOk(t); setMsg(''); setTimeout(() => setOk(''), 5000); }; const fail = (e: any) => { setMsg(errText(e)); setOk(''); };
  const load = async () => { try { setRows(await api(`/einvoice/submissions${status ? `?status=${status}` : ''}`)); } catch (e) { fail(e); } };
  useEffect(() => { void load(); }, [status]);
  useEffect(() => { if (tab === 'consolidated') api('/einvoice/consolidated').then(setPeriods).catch(fail); if (tab === 'settings') api('/einvoice/settings').then((s) => { setSettings(s); setSform({ env: s.env, client_id: s.client_id ?? '', client_secret: '', tin: s.tin ?? '', brn: s.brn ?? '', msic_code: s.msic_code ?? '' }); }).catch(fail); }, [tab]);
  const retry = async (id: string) => { try { const r = await api(`/einvoice/submissions/${id}/retry`, { method: 'POST' }); say(`重试结果：${ST_ZH[r.status]}`); await load(); } catch (e) { fail(e); } };
  const cancel = async (id: string) => { const reason = window.prompt('取消原因（72 小时内可取消）'); if (!reason) return; try { await api(`/einvoice/submissions/${id}/cancel`, { body: { reason } }); say('已取消'); await load(); setSel(null); } catch (e) { fail(e); } };
  const doPreview = async () => { try { setPreview(await api(`/einvoice/consolidated/${siteId}/${month}/preview`, { method: 'POST' })); } catch (e) { fail(e); } };
  const doSubmit = async () => { if (!window.confirm(`提交 ${month} 合并发票（${preview.sale_count} 张收据，RM ${fmtMoney(preview.total)}）？`)) return; try { const r = await api(`/einvoice/consolidated/${siteId}/${month}/submit`, { method: 'POST' }); say(`合并发票：${ST_ZH[r.status]}`); await doPreview(); setPeriods(await api('/einvoice/consolidated')); } catch (e) { fail(e); } };
  const saveSettings = async () => { try { const body: any = { env: sform.env, client_id: sform.client_id || null, tin: sform.tin || null, brn: sform.brn || null, msic_code: sform.msic_code || null }; if (sform.client_secret) body.client_secret = sform.client_secret; const s = await api('/einvoice/settings', { method: 'PUT', body }); setSettings(s); setSform({ ...sform, client_secret: '' }); say('已保存'); } catch (e) { fail(e); } };
  const counts = (s: string) => rows.filter((r) => r.status === s).length;
  return (
    <div>
      <h1>电子发票 MyInvois</h1>
      {msg && <div className="err" style={{ marginBottom: 8 }}>{msg}</div>}{ok && <div className="ok" style={{ marginBottom: 8 }}>{ok}</div>}
      <div className="tabs"><button className={tab === 'list' ? 'active' : ''} onClick={() => setTab('list')}>提交记录</button><button className={tab === 'consolidated' ? 'active' : ''} onClick={() => setTab('consolidated')}>月度合并发票</button>{has('settings.edit') && <button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}>MyInvois 设定</button>}</div>
      {tab === 'list' && <>
        <div className="cards"><div className="stat"><div className="v">{counts('VALID')}</div><div className="l">有效</div></div><div className={`stat ${counts('QUEUED') + counts('SUBMITTED') > 0 ? 'warn' : ''}`}><div className="v">{counts('QUEUED') + counts('SUBMITTED')}</div><div className="l">排队 / 待验证</div></div><div className={`stat ${counts('FAILED') + counts('INVALID') > 0 ? 'warn' : ''}`}><div className="v">{counts('FAILED') + counts('INVALID')}</div><div className="l">失败 / 被拒</div></div></div>
        <div className="toolbar"><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">全部状态</option>{Object.entries(ST_ZH).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select><button className="btn btn-ghost" onClick={load}>刷新</button><span className="note">失败的每 5 分钟自动重试，最多 72 小时；超时会开工单给会计。</span></div>
        <table data-testid="einvoice-table"><thead><tr><th>时间</th><th>类型</th><th>单据</th><th>买家</th><th>金额</th><th>环境</th><th>状态</th><th>重试</th><th>UUID</th><th></th></tr></thead><tbody>
          {rows.map((r) => <tr key={r.id}><td>{fmtDate(r.created_at)}</td><td>{DOC_ZH[r.doc_type] ?? r.doc_type}</td><td>{r.doc_no}</td><td>{r.buyer_name ?? ''}</td><td>{fmtMoney(r.amount)}</td><td>{r.env}</td><td><span className="pill" style={{ background: stColor(r.status) }}>{ST_ZH[r.status] ?? r.status}</span></td><td>{r.retry_count}</td><td className="note" style={{ fontSize: 11 }}>{r.document_uuid ?? ''}</td>
            <td style={{ whiteSpace: 'nowrap' }}><button className="btn btn-ghost" onClick={() => setSel(r)}>详情</button> {['QUEUED', 'FAILED', 'INVALID', 'SUBMITTED'].includes(r.status) && has('einvoice.manage') && <button className="btn btn-primary" onClick={() => retry(r.id)}>重试</button>} {['VALID', 'SUBMITTED'].includes(r.status) && has('einvoice.manage') && <button className="btn btn-danger" onClick={() => cancel(r.id)}>取消</button>}</td></tr>)}
          {rows.length === 0 && <tr><td colSpan={10} className="note">没有提交记录</td></tr>}
        </tbody></table>
        {sel && <div style={{ marginTop: 16, border: '1px solid var(--border)', borderRadius: 10, padding: 16, background: '#fff', display: 'flex', gap: 20 }}>
          <div style={{ flex: 1 }}>
            <h2>{sel.doc_no} <span className="pill" style={{ background: stColor(sel.status) }}>{ST_ZH[sel.status]}</span> <button className="btn btn-ghost" onClick={() => setSel(null)}>关闭</button></h2>
            <div className="note">提交 UID：{sel.submission_uid ?? '—'}<br />文档 UUID：{sel.document_uuid ?? '—'}<br />验证时间：{fmtDate(sel.validated_at)}{sel.cancelled_at && <><br />取消时间：{fmtDate(sel.cancelled_at)}</>}</div>
            {sel.qr_url && <div style={{ marginTop: 6 }}><a href={sel.qr_url} target="_blank" rel="noreferrer">LHDN 验证链接</a></div>}
            {sel.error_json && <pre style={{ maxHeight: 160, overflow: 'auto', background: '#FFF3F3', padding: 8, fontSize: 12 }}>{JSON.stringify(sel.error_json, null, 1)}</pre>}
            {sel.payload && <details><summary className="note">UBL JSON 文档</summary><pre style={{ maxHeight: 260, overflow: 'auto', fontSize: 11 }}>{JSON.stringify(sel.payload, null, 1)}</pre></details>}
          </div>
          {sel.status === 'VALID' && <QrImg id={sel.id} />}
        </div>}
      </>}
      {tab === 'consolidated' && <>
        <div className="toolbar">
          <select value={siteId} onChange={(e) => setSiteId(e.target.value)}>{(me?.sites ?? []).map((s: any) => <option key={s.id} value={s.id}>{s.code} {s.name}</option>)}</select>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          <button className="btn btn-ghost" onClick={doPreview} disabled={!siteId}>预览</button>
          {preview && !preview.existing?.submission_status && has('einvoice.manage') && <button className="btn btn-primary" onClick={doSubmit} disabled={preview.sale_count === 0}>提交合并发票</button>}
          <span className="note">每月 1 日 02:00 系统会自动提交上月；这里可手动预览和补交。</span>
        </div>
        {preview && <>
          <div className="cards"><div className="stat"><div className="v">{preview.sale_count}</div><div className="l">零售收据</div></div><div className="stat"><div className="v">{fmtMoney(preview.total)}</div><div className="l">合计 RM</div></div><div className="stat"><div className="v">{fmtMoney(preview.tax_total)}</div><div className="l">税 RM</div></div><div className="stat"><div className="v">{preview.existing ? ST_ZH[preview.existing.submission_status] ?? '未提交' : '未提交'}</div><div className="l">状态</div></div></div>
          <table><thead><tr><th>类别</th><th>数量</th><th>税</th><th>金额</th></tr></thead><tbody>{preview.by_category.map((c: any) => <tr key={c.code}><td>{c.name_zh ?? c.name}</td><td>{Number(c.qty)}</td><td>{fmtMoney(c.tax)}</td><td>{fmtMoney(c.total)}</td></tr>)}{preview.by_category.length === 0 && <tr><td colSpan={4} className="note">该月没有可合并的零售销售</td></tr>}</tbody></table>
          <div className="note" style={{ marginTop: 6 }}>收据范围：{preview.receipt_range?.first_no ?? '—'} 至 {preview.receipt_range?.last_no ?? '—'}</div>
        </>}
        <h2>已提交的合并发票</h2>
        <table><thead><tr><th>月份</th><th>店</th><th>收据数</th><th>金额</th><th>状态</th><th>UUID</th><th>验证时间</th></tr></thead><tbody>{periods.map((p) => <tr key={p.id}><td>{String(p.period_month).slice(0, 7)}</td><td>{p.site_code} {p.site_name}</td><td>{p.sale_count}</td><td>{fmtMoney(p.total)}</td><td><span className="pill" style={{ background: stColor(p.submission_status ?? 'QUEUED') }}>{ST_ZH[p.submission_status] ?? '未提交'}</span></td><td className="note" style={{ fontSize: 11 }}>{p.document_uuid ?? ''}</td><td>{fmtDate(p.validated_at)}</td></tr>)}{periods.length === 0 && <tr><td colSpan={7} className="note">还没有合并发票</td></tr>}</tbody></table>
      </>}
      {tab === 'settings' && settings && <>
        <div className="note" style={{ marginBottom: 10 }}>环境 STUB = 不联网假提交（测试）；SANDBOX = LHDN 预生产；PRODUCTION = 正式。凭据在 MyTax 门户申请（ERP 注册）。当前：{settings.configured ? <b className="ok">已配置</b> : <b className="err">未配置</b>}</div>
        <div className="form">
          <label>环境<select value={sform.env} onChange={(e) => setSform({ ...sform, env: e.target.value })}><option>STUB</option><option>SANDBOX</option><option>PRODUCTION</option></select></label>
          <label>公司 TIN<input value={sform.tin} onChange={(e) => setSform({ ...sform, tin: e.target.value })} /></label>
          <label>公司注册号 BRN<input value={sform.brn} onChange={(e) => setSform({ ...sform, brn: e.target.value })} /></label>
          <label>MSIC 行业代码（5 位）<input value={sform.msic_code} onChange={(e) => setSform({ ...sform, msic_code: e.target.value })} /></label>
          <label>Client ID<input value={sform.client_id} onChange={(e) => setSform({ ...sform, client_id: e.target.value })} /></label>
          <label>Client Secret（留空不改，当前 {settings.client_secret ?? '未设'}）<input type="password" value={sform.client_secret} onChange={(e) => setSform({ ...sform, client_secret: e.target.value })} /></label>
          <div style={{ display: 'flex', alignItems: 'end' }}><button className="btn btn-primary" onClick={saveSettings}>保存</button></div>
        </div>
      </>}
    </div>
  );
}
