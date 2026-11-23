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
import Pick from './screens/mobile/Pick.js';
import ReceiveTransfer from './screens/mobile/ReceiveTransfer.js';
import RequestTransfer from './screens/mobile/RequestTransfer.js';
import Count from './screens/mobile/Count.js';
import CountPlan from './screens/mobile/CountPlan.js';
import ApprovalsM from './screens/mobile/Approvals.js';
import Adjust from './screens/mobile/Adjust.js';
import Delegation from './screens/mobile/Delegation.js';
import MyRecords from './screens/mobile/MyRecords.js';
import OrdersM from './screens/mobile/Orders.js';
import ReportsM from './screens/mobile/Reports.js';
import CustomerCall from './screens/mobile/CustomerCall.js';
import PosApp from './screens/pos/PosApp.js';
import KioskApp from './screens/kiosk/KioskApp.js';
import Signup from './screens/mobile/Signup.js';
import Join from './screens/mobile/Join.js';

export default function App() {
  const { me, loading } = useAuth(); const { t } = useT(); const loc = useLocation();
  if (loc.pathname.startsWith('/kiosk')) return <Routes><Route path="/kiosk/*" element={<KioskApp />} /></Routes>;
  if (loading) return <div className="mobile"><div className="empty">{t('loading')}</div></div>;
  if (!me) return <Routes><Route path="/signup" element={<Signup />} /><Route path="/join" element={<Join />} /><Route path="*" element={<Login />} /></Routes>;
  if (me.sites.length > 1 && !me.site && !me.user.is_super_admin && loc.pathname !== '/select-site') return <Navigate to="/select-site" replace />;
  return (
    <Routes>
      <Route path="/" element={<Navigate to={me.user.is_super_admin ? '/w/admin/companies' : (window.innerWidth >= 900 && me.roles.some((r) => ['BOSS', 'MANAGER', 'PURCHASER', 'ACCOUNTS'].includes(r)) ? '/w/dashboard' : '/m')} replace />} />
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
      <Route path="/m/pick" element={<Pick />} />
      <Route path="/m/receive-transfer" element={<ReceiveTransfer />} />
      <Route path="/m/request-transfer" element={<RequestTransfer />} />
      <Route path="/m/count" element={<Count />} />
      <Route path="/m/count-plan" element={<CountPlan />} />
      <Route path="/m/approvals" element={<ApprovalsM />} />
      <Route path="/m/adjust" element={<Adjust />} />
      <Route path="/m/delegation" element={<Delegation />} />
      <Route path="/m/my-records" element={<MyRecords />} />
      <Route path="/m/orders" element={<OrdersM />} />
      <Route path="/m/reports" element={<ReportsM />} />
      <Route path="/m/customer-call" element={<CustomerCall />} />
      <Route path="/pos/*" element={<PosApp />} />
      <Route path="/w/*" element={<WebApp />} />
      <Route path="*" element={<Navigate to="/m" replace />} />
    </Routes>
  );
}
