import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './store/auth.js';
import { useT } from './i18n/index.js';
import Login from './screens/mobile/Login.js';
import SelectSite from './screens/mobile/SelectSite.js';
import Home from './screens/mobile/Home.js';
import Lookup from './screens/mobile/Lookup.js';
import Receive from './screens/mobile/Receive.js';
import Putaway from './screens/mobile/Putaway.js';
import Refill from './screens/mobile/Refill.js';
import AssignShelf from './screens/mobile/AssignShelf.js';
import Outbox from './screens/mobile/Outbox.js';
import Tickets from './screens/mobile/Tickets.js';
import Settings from './screens/mobile/Settings.js';
import Help from './screens/mobile/Help.js';
import WebApp from './screens/web/WebApp.js';

export default function App() {
  const { me, loading } = useAuth(); const { t } = useT(); const loc = useLocation();
  if (loading) return <div className="mobile"><div className="empty">{t('loading')}</div></div>;
  if (!me) return <Routes><Route path="*" element={<Login />} /></Routes>;
  if (me.sites.length > 1 && !me.site && !me.user.is_super_admin && loc.pathname !== '/select-site') return <Navigate to="/select-site" replace />;
  return (
    <Routes>
      <Route path="/" element={<Navigate to={me.user.is_super_admin ? '/w/admin/companies' : '/m'} replace />} />
      <Route path="/select-site" element={<SelectSite />} />
      <Route path="/m" element={<Home />} />
      <Route path="/m/lookup" element={<Lookup />} />
      <Route path="/m/receive" element={<Receive />} />
      <Route path="/m/putaway" element={<Putaway />} />
      <Route path="/m/refill" element={<Refill />} />
      <Route path="/m/assign-shelf" element={<AssignShelf />} />
      <Route path="/m/outbox" element={<Outbox />} />
      <Route path="/m/tickets" element={<Tickets />} />
      <Route path="/m/settings" element={<Settings />} />
      <Route path="/m/help" element={<Help />} />
      <Route path="/w/*" element={<WebApp />} />
      <Route path="*" element={<Navigate to="/m" replace />} />
    </Routes>
  );
}
