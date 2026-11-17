// 网页管理端入口（页面由 pages/ 下各文件提供）
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '../../store/auth.js';
import { pages } from './pages/index.js';
import { Icon, I } from '../../ui/icons.js';
import { LayoutDashboard, CheckCircle2, Package, MapPin, FileSpreadsheet, Boxes, History, BarChart3, Ticket, Smartphone, Users, ScrollText, Settings, Building2, Wand2, Activity, type LucideIcon } from 'lucide-react';
const NAV_ICON: Record<string, LucideIcon> = { dashboard: LayoutDashboard, approvals: CheckCircle2, products: Package, locations: MapPin, import: FileSpreadsheet, stock: Boxes, movements: History, reports: BarChart3, tickets: Ticket, devices: Smartphone, users: Users, audit: ScrollText, settings: Settings, 'admin/companies': Building2, 'admin/wizard': Wand2, 'admin/sync-monitor': Activity };
export default function WebApp() {
  const { me, has, logout } = useAuth();
  if (!me) return null;
  const visible = pages.filter((p) => !p.perm || p.perm.some((x) => has(x)) || (p.superAdmin && me.user.is_super_admin)).filter((p) => !p.superAdmin || me.user.is_super_admin);
  const groups = [...new Set(visible.map((p) => p.group))];
  return (
    <div className="web">
      <nav className="side">
        <div className="brand"><span className="logo" style={{ width: 34, height: 34, borderRadius: 10 }}><Icon name={I.Warehouse} size={20} /></span>{me.company.name}</div>
        {groups.map((g) => <div key={g}><div className="grp">{g}</div>{visible.filter((p) => p.group === g).map((p) => <NavLink key={p.path} to={`/w/${p.path}`}>{NAV_ICON[p.path] && <Icon name={NAV_ICON[p.path]} size={18} strokeWidth={2} />}{p.title}</NavLink>)}</div>)}
        <div style={{ marginTop: 'auto', padding: '12px 20px', fontSize: 13 }}>{me.user.name} · {me.roles.join(',')}<br /><a href="/m" style={{ padding: 0 }}>手机界面</a> · <a href="#" style={{ padding: 0 }} onClick={(e) => { e.preventDefault(); void logout(); }}>退出</a></div>
      </nav>
      <main className="main">
        <Routes>
          {visible.map((p) => <Route key={p.path} path={p.path} element={<p.component />} />)}
          <Route path="*" element={<Navigate to={`/w/${visible[0]?.path ?? 'dashboard'}`} replace />} />
        </Routes>
      </main>
    </div>
  );
}
