// K7 我的记录：30 天内我的盘点会话和差异结果（不含系统量、金额）
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '../../i18n/index.js';
import { Icon, I } from '../../ui/icons.js';
import { Page, TopBar } from '../../ui/Shell.js';
import { api, isOnline } from '../../api/client.js';
import { kvGet, kvSet } from '../../offline/db.js';

export default function MyRecords() {
  const { t, lang } = useT(); const nav = useNavigate(); const [rows, setRows] = useState<any[]>([]); const [loading, setLoading] = useState(true);
  useEffect(() => { (async () => { try { if (isOnline()) { const r = await api('/counts/my-records'); setRows(r); await kvSet('counts.myRecords', r); } else setRows(await kvGet('counts.myRecords', [])); } catch { setRows(await kvGet('counts.myRecords', [])); } finally { setLoading(false); } })(); }, []);
  const color = (s: string) => (s === 'APPROVED' ? 'var(--green)' : s === 'CANCELLED' ? 'var(--red)' : s === 'PENDING_APPROVAL' || s === 'RECOUNT' ? 'var(--yellow)' : 'var(--muted)');
  const fmt = (d: string) => new Date(d).toLocaleDateString(lang === 'zh' ? 'zh-CN' : lang === 'ms' ? 'ms-MY' : 'en-MY', { month: 'short', day: 'numeric' });
  return (
    <Page>
      <TopBar title={t('my_records')} onBack={() => nav('/m')} />
      {loading ? <div className="empty">{t('loading')}</div> : rows.length === 0 ? <div className="empty"><div className="big"><Icon name={I.Check} size={48} /></div>{t('count_no_records')}</div> : (
        <div className="list">
          {rows.map((r) => (
            <div key={r.id} className="card" style={{ cursor: 'default' }}>
              <div className="thumb"><Icon name={I.Shelf} size={30} /></div>
              <div className="body"><div className="t">{r.session_no} · {t('count_type_' + r.count_type)}</div><div className="s">{fmt(r.scheduled_for)} · {t('count_locations_n', { n: r.location_count })} · {t('count_variance_lines', { n: Number(r.variance_lines) })}</div></div>
              <div className="status" style={{ flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                <span><span className="dot" style={{ background: color(r.status), marginRight: 6 }} />{t('cs_' + r.status)}</span>
                {r.accuracy_pct != null && <b style={{ fontSize: 22, color: Number(r.accuracy_pct) >= 95 ? 'var(--green)' : 'var(--ink)' }}>{Number(r.accuracy_pct)}%</b>}
              </div>
            </div>
          ))}
        </div>
      )}
    </Page>
  );
}
