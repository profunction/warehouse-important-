import { useEffect, useState } from 'react';
import { api } from '../../../api/client.js';
import { useAuth } from '../../../store/auth.js';
import { errText, fmtDate, pillColor, STATUS_ZH } from './_util.js';
const TYPE_ZH: Record<string, string> = { PHONE: '手机', POS: '收银机', KIOSK: '大屏', SCANNER: '扫描枪', SCALE: '电子秤', LABEL_PRINTER: '标签打印机', RECEIPT_PRINTER: '收据打印机', CASH_DRAWER: '钱箱' };
export default function Devices() {
  const { has } = useAuth();
  const [rows, setRows] = useState<any[]>([]); const [sites, setSites] = useState<any[]>([]); const [msg, setMsg] = useState(''); const [form, setForm] = useState<any | null>(null);
  const load = () => api('/devices').then(setRows).catch((e) => setMsg(errText(e)));
  useEffect(() => { void load(); api('/sites').then(setSites).catch(() => {}); }, []);
  const canManage = has('device.manage');
  const setStatus = async (d: any, status: string) => { if (!window.confirm(`${status === 'DISABLED' ? '停用' : '启用'}设备 ${d.name}？${status === 'DISABLED' ? '该设备所有请求将被拒绝。' : ''}`)) return; try { await api(`/devices/${d.id}`, { method: 'PUT', body: { status } }); await load(); } catch (e) { setMsg(errText(e)); } };
  const save = async () => { try { await api('/devices', { body: { ...form, site_id: form.site_id || null, paired_to_device_id: form.paired_to_device_id || null } }); setForm(null); await load(); } catch (e) { setMsg(errText(e)); } };
  const stale = (d: any) => d.type === 'PHONE' || d.type === 'POS' || d.type === 'KIOSK' ? !d.last_seen_at || Date.now() - new Date(d.last_seen_at).getTime() > 2 * 3600_000 : false;
  return (
    <div>
      <h1>设备管理</h1>
      <div className="toolbar">{canManage && <button className="btn btn-primary" onClick={() => setForm({ type: 'SCANNER', name: '', site_id: '', serial: '', paired_to_device_id: '' })}>+ 登记外设</button>}<span className="note">手机在首次登录时自动登记。{msg}</span></div>
      {form && <div className="form" style={{ marginBottom: 14 }}>
        <label>类型<select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>{Object.entries(TYPE_ZH).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>名称<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
        <label>站点<select value={form.site_id} onChange={(e) => setForm({ ...form, site_id: e.target.value })}><option value="">—</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}</select></label>
        <label>序列号<input value={form.serial} onChange={(e) => setForm({ ...form, serial: e.target.value })} /></label>
        <label>挂在哪台手机或收银机下<select value={form.paired_to_device_id} onChange={(e) => setForm({ ...form, paired_to_device_id: e.target.value })}><option value="">—</option>{rows.filter((d) => ['PHONE', 'POS'].includes(d.type)).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
        <label>&nbsp;<span><button className="btn btn-primary" onClick={save} disabled={!form.name}>保存</button> <button className="btn btn-ghost" onClick={() => setForm(null)}>取消</button></span></label>
      </div>}
      <table><thead><tr><th>名称</th><th>类型</th><th>站点</th><th>状态</th><th>最后同步</th><th>待上传</th><th>App 版本</th><th>序列号</th><th></th></tr></thead><tbody>
        {rows.map((d) => <tr key={d.id}><td>{d.name}</td><td>{TYPE_ZH[d.type] ?? d.type}</td><td>{d.site_code ?? ''}</td><td><span className="pill" style={{ background: pillColor(d.status) }}>{STATUS_ZH[d.status] ?? d.status}</span>{stale(d) && d.status !== 'DISABLED' && <span className="err"> 超过 2 小时未同步</span>}</td><td>{fmtDate(d.last_seen_at)}</td><td className={d.pending_count > 50 ? 'err' : ''}>{d.pending_count}</td><td>{d.app_version ?? ''}</td><td>{d.serial ?? ''}</td>
          <td>{canManage && (d.status === 'DISABLED' ? <button className="btn btn-ghost" onClick={() => setStatus(d, 'ACTIVE')}>启用</button> : <button className="btn btn-danger" onClick={() => setStatus(d, 'DISABLED')}>停用</button>)}</td></tr>)}
        {rows.length === 0 && <tr><td colSpan={9} className="note">没有设备</td></tr>}
      </tbody></table>
    </div>
  );
}
