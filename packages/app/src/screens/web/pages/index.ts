// 页面注册表：子代理在此目录添加页面并在下方登记。字段：path, title, group, perm（任一权限可见）, superAdmin, component
import type { ComponentType } from 'react';
import Dashboard from './Dashboard.js';
import Products from './Products.js';
import Stock from './Stock.js';
import Movements from './Movements.js';
import Locations from './Locations.js';
import Users from './Users.js';
import Reports from './Reports.js';
import Import from './Import.js';
import Devices from './Devices.js';
import Audit from './Audit.js';
import Approvals from './Approvals.js';
import Tickets from './Tickets.js';
import CompanySettings from './CompanySettings.js';
import AdminCompanies from './AdminCompanies.js';
import AdminWizard from './AdminWizard.js';
import AdminSyncMonitor from './AdminSyncMonitor.js';
export interface PageDef { path: string; title: string; group: string; perm?: string[]; superAdmin?: boolean; component: ComponentType }
export const pages: PageDef[] = [
  { path: 'dashboard', title: '仪表板', group: '总览', component: Dashboard },
  { path: 'approvals', title: '审批', group: '总览', perm: ['approval.decide'], component: Approvals },
  { path: 'products', title: '产品管理', group: '主数据', perm: ['product.view'], component: Products },
  { path: 'locations', title: '位置和区', group: '主数据', perm: ['location.manage', 'stock.view'], component: Locations },
  { path: 'import', title: 'Excel 导入', group: '主数据', perm: ['import.upload'], component: Import },
  { path: 'stock', title: '库存查询', group: '库存', perm: ['stock.view'], component: Stock },
  { path: 'movements', title: '移动记录', group: '库存', perm: ['movement.view', 'movement.view_all'], component: Movements },
  { path: 'reports', title: '报表中心', group: '库存', perm: ['report.stock'], component: Reports },
  { path: 'tickets', title: '工单', group: '运营', perm: ['ticket.view_all'], component: Tickets },
  { path: 'devices', title: '设备管理', group: '运营', perm: ['device.view', 'device.manage'], component: Devices },
  { path: 'users', title: '用户管理', group: '管理', perm: ['user.manage', 'user.reset_pin'], component: Users },
  { path: 'audit', title: '审计日志', group: '管理', perm: ['audit.view'], component: Audit },
  { path: 'settings', title: '公司设定', group: '管理', perm: ['settings.edit'], component: CompanySettings },
  { path: 'admin/companies', title: '公司列表', group: '超管', superAdmin: true, component: AdminCompanies },
  { path: 'admin/wizard', title: '开店向导', group: '超管', superAdmin: true, component: AdminWizard },
  { path: 'admin/sync-monitor', title: '同步监控', group: '超管', superAdmin: true, component: AdminSyncMonitor },
];
