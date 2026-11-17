import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../../api/client.js';
import { useAuth } from '../../../store/auth.js';
import { downloadRaw, errText, fmtDate, pillColor, STATUS_ZH } from './_util.js';

const SHEET_ZH: Record<string, string> = { PRODUCT: '产品', BARCODE: '更多条码', SUPPLIER: '供应商', OPENING_STOCK: '期初库存', LOCATION: '位置', CUSTOMER: '客户' };
export default function Import() {
  const { has } = useAuth(); const [sp, setSp] = useSearchParams();
  const [templates, setTemplates] = useState<any[]>([]); const [jobs, setJobs] = useState<any[]>([]); const [job, setJob] = useState<any | null>(null); const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false); const [fill, setFill] = useState(false); const [sheetFilter, setSheetFilter] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const loadJobs = () => api('/import/jobs').then(setJobs).catch((e) => setMsg(errText(e)));
  const openJob = async (id: string) => { try { setJob(await api(`/import/jobs/${id}/preview${sheetFilter ? `?sheet=${sheetFilter}` : ''}`)); setMsg(''); } catch (e) { setMsg(errText(e)); } };
  useEffect(() => { api('/import/templates').then(setTemplates).catch(() => {}); void loadJobs(); const j = sp.get('job'); if (j) void openJob(j); }, []);
  useEffect(() => { if (job) void openJob(job.job.id); }, [sheetFilter]);
  const upload = async () => {
    const f = fileRef.current?.files?.[0]; if (!f) return; setBusy(true); setMsg('');
    try { const fd = new FormData(); fd.append('fill_min_levels', fill ? 'true' : 'false'); fd.append('file', f); const r = await api('/import/jobs', { body: fd }); await loadJobs(); await openJob(r.job_id); setSp({ job: r.job_id }); }
    catch (e) { setMsg(errText(e)); } finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  };
  const act = async (action: 'submit' | 'apply' | 'reject') => {
    if (action === 'apply' && !window.confirm('批准并执行导入？执行后产品、供应商、期初库存会写入数据库。')) return;
    if (action === 'reject' && !window.confirm('拒绝这个导入？')) return;
    setBusy(true); try { await api(`/import/jobs/${job.job.id}/${action}`, { method: 'POST', body: action === 'reject' ? { note: '' } : undefined }); await openJob(job.job.id); await loadJobs(); setMsg(action === 'apply' ? '导入已执行' : action === 'submit' ? '已送审批' : '已拒绝'); } catch (e) { setMsg(errText(e)); } finally { setBusy(false); }
  };
  const step = !job ? 1 : job.job.status === 'VALIDATED' ? 3 : job.job.status === 'PENDING_APPROVAL' ? 4 : job.job.status === 'APPLIED' ? 5 : 3;
  const summary: Record<string, any> = job?.job.sheets_summary ?? {};
  return (
    <div>
      <h1>Excel 导入</h1>
      <div className="step">{['下载模板', '上传', '预览', '送审', '批准执行'].map((s, i) => <><span key={i} className={i + 1 <= step ? 'on' : ''}>{i + 1}</span><b style={{ marginRight: 12 }}>{s}</b></>)}</div>
      <div className="toolbar">
        <span>模板：</span>
        <button className="btn btn-primary" onClick={() => downloadRaw('/import/templates/ALL', 'template-ALL.xlsx').catch((e) => setMsg(errText(e)))}>下载开店全套模板</button>
        {templates.map((t) => <button key={t.code} className="btn btn-ghost" onClick={() => downloadRaw(`/import/templates/${t.code}`, `template-${t.code}.xlsx`).catch((e) => setMsg(errText(e)))}>{t.sheet_name_zh}</button>)}
      </div>
      <div className="note" style={{ marginBottom: 8 }}>模板的类别、税码、位置、供应商列是下拉选项。第 1 行列名，第 2 行马来文英文，第 3 行示例，从第 4 行填。带 * 必填。</div>
      <div className="toolbar">
        <input type="file" accept=".xlsx" ref={fileRef} style={{ width: 'auto' }} />
        <label><input type="checkbox" checked={fill} onChange={(e) => setFill(e.target.checked)} style={{ width: 'auto', minHeight: 0 }} /> 最低量、补货量空值用模板规则填</label>
        <button className="btn btn-primary" onClick={upload} disabled={busy}>上传并验证</button>
        <span className={msg.includes('错') || msg.includes('不') ? 'err' : 'ok'}>{msg}</span>
      </div>
      {job && (
        <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 10, padding: 16, marginBottom: 16 }}>
          <h2>{job.job.file_name} <span className="pill" style={{ background: pillColor(job.job.status) }}>{STATUS_ZH[job.job.status] ?? job.job.status}</span></h2>
          <div className="cards">
            {Object.entries(summary).map(([code, s]: any) => <div key={code} className={`stat ${s.error ? 'warn' : ''}`} style={{ cursor: 'pointer', outline: sheetFilter === code ? '2px solid var(--blue)' : 'none' }} onClick={() => setSheetFilter(sheetFilter === code ? '' : code)}>
              <div className="v">{s.total ?? 0}</div><div className="l">{SHEET_ZH[code] ?? code} · 通过 {s.ok ?? 0} · 警告 {s.warning ?? 0} · <b className={s.error ? 'err' : ''}>错误 {s.error ?? 0}</b>{s.missing_columns?.length ? <div className="err">缺少列：{s.missing_columns.join('、')}</div> : null}</div>
              <div className="note">新建 {s.create ?? 0} · 更新 {s.update ?? 0}</div>
            </div>)}
          </div>
          <div className="toolbar">
            {job.job.status === 'VALIDATED' && <button className="btn btn-primary" disabled={job.has_errors || busy} onClick={() => act('submit')} title={job.has_errors ? '有错误，改好后重新上传' : ''}>送审批</button>}
            {job.job.status === 'PENDING_APPROVAL' && job.can_approve && has('approval.decide') && <><button className="btn btn-primary" disabled={busy} onClick={() => act('apply')}>批准并执行</button><button className="btn btn-danger" disabled={busy} onClick={() => act('reject')}>拒绝</button></>}
            {job.job.status === 'PENDING_APPROVAL' && !(job.can_approve && has('approval.decide')) && <span className="note">等待有权限的人批准</span>}
            {job.has_errors && <span className="err">文件有错误，不能送审。请下载标注文件，改好后重新上传。</span>}
            <button className="btn btn-ghost" onClick={() => downloadRaw(`/import/jobs/${job.job.id}/annotated`, 'annotated.xlsx').catch((e) => setMsg(errText(e)))}>下载带错误标注的原文件</button>
            <button className="btn btn-ghost" onClick={() => { setJob(null); setSp({}); }}>关闭</button>
          </div>
          {job.problems.length > 0 && <>
            <h2>错误和警告（{job.problems.length}）</h2>
            <table><thead><tr><th>表</th><th>行</th><th>级别</th><th>列</th><th>说明</th></tr></thead><tbody>
              {job.problems.map((p: any, i: number) => (p.messages as any[]).map((m, j) => <tr key={`${i}-${j}`}><td>{SHEET_ZH[p.sheet_code] ?? p.sheet_code}</td><td>{p.row_no}</td><td><span className="pill" style={{ background: pillColor(m.level) }}>{m.level === 'ERROR' ? '错误' : '警告'}</span></td><td>{m.column}</td><td>{m.zh}</td></tr>))}
            </tbody></table>
          </>}
          <h2>预览（前 50 行{sheetFilter ? `，${SHEET_ZH[sheetFilter]}` : ''}）</h2>
          <table><thead><tr><th>表</th><th>行</th><th>状态</th><th>动作</th><th>内容</th></tr></thead><tbody>
            {job.rows.map((r: any) => <tr key={`${r.sheet_code}-${r.row_no}`}><td>{SHEET_ZH[r.sheet_code] ?? r.sheet_code}</td><td>{r.row_no}</td><td><span className="pill" style={{ background: pillColor(r.status) }}>{r.status}</span></td><td>{r.action === 'UPDATE' ? '更新' : r.action === 'CREATE' ? '新建' : '跳过'}</td><td className="note">{Object.entries(r.raw_json).map(([k, v]) => `${k}=${v}`).join(' · ')}</td></tr>)}
          </tbody></table>
        </div>
      )}
      <h2>导入记录</h2>
      <table><thead><tr><th>时间</th><th>文件</th><th>上传人</th><th>状态</th><th>批准人</th><th>执行时间</th><th></th></tr></thead><tbody>
        {jobs.map((j) => <tr key={j.id}><td>{fmtDate(j.created_at)}</td><td>{j.file_name}</td><td>{j.uploaded_by_name}</td><td><span className="pill" style={{ background: pillColor(j.status) }}>{STATUS_ZH[j.status] ?? j.status}</span></td><td>{j.approved_by_name ?? ''}</td><td>{fmtDate(j.applied_at)}</td><td><button className="btn btn-ghost" onClick={() => { setSheetFilter(''); setSp({ job: j.id }); void openJob(j.id); }}>打开</button></td></tr>)}
        {jobs.length === 0 && <tr><td colSpan={7} className="note">还没有导入</td></tr>}
      </tbody></table>
    </div>
  );
}
