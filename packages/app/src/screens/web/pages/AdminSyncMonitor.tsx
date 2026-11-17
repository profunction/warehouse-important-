import { useEffect, useState } from 'react';
import { api } from '../../../api/client.js';
import { errText, fmtDate, pillColor, STATUS_ZH } from './_util.js';
export default function AdminSyncMonitor() {
  const [rows, setRows] = useState<any[]>([]); const [msg, setMsg] = useState('');
  const load = () => api('/admin/sync-monitor').then(setRows).catch((e) => setMsg(errText(e)));
  useEffect(() => { void load(); const h = setInterval(load, 30000); return () => clearInterval(h); }, []);
  const age = (v?: string) => (v ? Math.round((Date.now() - new Date(v).getTime()) / 60000) : null);
  return (
    <div>
      <h1>同步监控</h1>
      <div className="note" style={{ marginBottom: 8 }}>所有公司的手机、收银机、大屏。工作时间超过 2 小时未同步、待上传超过 100 条、有隔离记录的要跟进。每 30 秒刷新。{msg && <span className="err"> {msg}</span>}</div>
      <table><thead><tr><th>公司</th><th>设备</th><th>类型</th><th>状态</th><th>最后同步</th><th>多久前</th><th>待上传</th><th>隔离</th><th>App 版本</th></tr></thead><tbody>
        {rows.map((d) => { const m = age(d.last_seen_at); const bad = m == null || m > 120; return <tr key={d.id} style={{ background: Number(d.quarantined) > 0 || Number(d.pending_count) > 100 ? '#FFF3F3' : bad ? '#FFFBE6' : undefined }}>
          <td>{d.short_code}</td><td>{d.name}</td><td>{d.type}</td><td><span className="pill" style={{ background: pillColor(d.status) }}>{STATUS_ZH[d.status] ?? d.status}</span></td><td>{fmtDate(d.last_seen_at)}</td><td className={bad ? 'err' : ''}>{m == null ? '从未' : m < 60 ? `${m} 分` : `${Math.round(m / 60)} 小时`}</td><td className={Number(d.pending_count) > 100 ? 'err' : ''}>{d.pending_count}</td><td className={Number(d.quarantined) > 0 ? 'err' : ''}>{d.quarantined}</td><td>{d.app_version ?? ''}</td>
        </tr>; })}
        {rows.length === 0 && <tr><td colSpan={9} className="note">没有设备</td></tr>}
      </tbody></table>
    </div>
  );
}
