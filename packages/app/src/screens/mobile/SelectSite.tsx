import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../store/auth.js';
import { useT } from '../../i18n/index.js';
export default function SelectSite() {
  const { me, selectSite } = useAuth(); const { t } = useT(); const nav = useNavigate();
  return (
    <div className="mobile">
      <div className="topbar"><div className="title">{t('select_site')}</div></div>
      <div className="list">{me?.sites.map((s) => <div key={s.id} className="card" onClick={async () => { await selectSite(s.id); nav('/'); }}><div className="thumb">{s.type === 'SHOP' ? '🏪' : '🏭'}</div><div className="body"><div className="t">{s.name}</div><div className="s">{s.code} · {s.roles.join(', ')}</div></div></div>)}</div>
    </div>
  );
}
