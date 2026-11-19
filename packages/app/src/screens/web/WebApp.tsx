// 网页管理端入口（页面由 pages/ 下各文件提供）。导航两种排法：左侧栏（默认）或顶部导航（外观设计里选，Stitch 稿）。
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../store/auth.js';
import { pages } from './pages/index.js';
import { Icon, I } from '../../ui/icons.js';
import { LayoutDashboard, CheckCircle2, Package, MapPin, FileSpreadsheet, Boxes, History, BarChart3, Ticket, Smartphone, Users, ScrollText, Settings, Building2, Wand2, Activity, Search, UserRound, LogOut, type LucideIcon } from 'lucide-react';
const NAV_ICON: Record<string, LucideIcon> = { dashboard: LayoutDashboard, approvals: CheckCircle2, products: Package, locations: MapPin, import: FileSpreadsheet, stock: Boxes, movements: History, reports: BarChart3, tickets: Ticket, devices: Smartphone, users: Users, audit: ScrollText, settings: Settings, 'admin/companies': Building2, 'admin/wizard': Wand2, 'admin/sync-monitor': Activity };
const GROUP_EN: Record<string, string> = { 总览: 'Overview', 主数据: 'Master data', 采购: 'Purchasing', 库存: 'Stock', 销售: 'Sales', 运营: 'Operations', 管理: 'Admin', 超管: 'Super admin' };
export default function WebApp() {
  const { me, has, logout } = useAuth();
  const loc = useLocation(); const nav = useNavigate();
  if (!me) return null;
  const visible = pages.filter((p) => !p.perm || p.perm.some((x) => has(x)) || (p.superAdmin && me.user.is_super_admin)).filter((p) => !p.superAdmin || me.user.is_super_admin);
  const groups = [...new Set(visible.map((p) => p.group))];
  const topNav = document.documentElement.dataset.nav === 'top';
  const cur = visible.find((p) => loc.pathname === `/w/${p.path}` || loc.pathname.startsWith(`/w/${p.path}/`));
  const curGroup = cur?.group ?? groups[0];
  const sub = visible.filter((p) => p.group === curGroup);
  const routes = (
    <Routes>
      {visible.map((p) => <Route key={p.path} path={p.path} element={<p.component />} />)}
      <Route path="*" element={<Navigate to={`/w/${visible[0]?.path ?? 'dashboard'}`} replace />} />
    </Routes>
  );
  if (topNav) return (
    <div className="web top">
      <header className="tophead">
        <div className="inner">
          <div className="brand"><b>WarehouseShop</b><small>{me.company.name}</small>{me.site && <span className="sitechip"><i />{me.site.name} · {me.site.code}</span>}</div>
          <nav className="groups">{groups.map((g) => <button key={g} className={g === curGroup ? 'active' : ''} onClick={() => nav(`/w/${visible.find((p) => p.group === g)!.path}`)}>{g} <span>({GROUP_EN[g] ?? g})</span></button>)}</nav>
          <div className="right">
            {visible.some((p) => p.path === 'stock') && <button className="search" onClick={() => nav('/w/stock')}><Icon name={Search} size={16} /><span>找商品 / 条码</span></button>}
            <a className="pill-link" href="/m">手机界面</a>
            <div className="user"><div><b>{me.user.name}</b><small>{me.roles.join(' · ')}</small></div><span className="avatar"><Icon name={UserRound} size={16} /></span><button title="退出" onClick={() => void logout()}><Icon name={LogOut} size={16} /></button></div>
          </div>
        </div>
        {sub.length > 1 && <div className="inner subnav">{sub.map((p) => <NavLink key={p.path} to={`/w/${p.path}`}>{NAV_ICON[p.path] && <Icon name={NAV_ICON[p.path]} size={16} />}{p.title}</NavLink>)}</div>}
      </header>
      <main className="main">{routes}</main>
      <footer className="topfoot"><b>WarehouseShop</b><span>仓店一体化作业中枢 · {me.company.name}</span></footer>
    </div>
  );
  return (
    <div className="web">
      <nav className="side">
        <div className="brand"><span className="logo" style={{ width: 34, height: 34, borderRadius: 10 }}><Icon name={I.Warehouse} size={20} /></span>{me.company.name}</div>
        {groups.map((g) => <div key={g}><div className="grp">{g}</div>{visible.filter((p) => p.group === g).map((p) => <NavLink key={p.path} to={`/w/${p.path}`}>{NAV_ICON[p.path] && <Icon name={NAV_ICON[p.path]} size={18} strokeWidth={2} />}{p.title}</NavLink>)}</div>)}
        <div style={{ marginTop: 'auto', padding: '12px 20px', fontSize: 13 }}>{me.user.name} · {me.roles.join(',')}<br /><a href="/m" style={{ padding: 0 }}>手机界面</a> · <a href="#" style={{ padding: 0 }} onClick={(e) => { e.preventDefault(); void logout(); }}>退出</a></div>
      </nav>
      <main className="main">{routes}</main>
    </div>
  );
}
