// 页面注册表：子代理在此目录添加页面并在下方登记。字段：path, title, group, perm（任一权限可见）, superAdmin, component
import type { ComponentType } from 'react';
import Dashboard from './Dashboard.js';
import ThemeEditor from './ThemeEditor.js';
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
import Orders from './Orders.js';
import Transfers from './Transfers.js';
import Counts from './Counts.js';
import Delegations from './Delegations.js';
import Customers from './Customers.js';
import SupplierInvoices from './SupplierInvoices.js';
import EInvoice from './EInvoice.js';
import MonthEnd from './MonthEnd.js';
import Integrations from './Integrations.js';
import MapEditor from './MapEditor.js';
import Knowledge from './Knowledge.js';
import Notifications from './Notifications.js';
import Sales from './Sales.js';
import AdminCompanies from './AdminCompanies.js';
import AdminWizard from './AdminWizard.js';
import AdminSyncMonitor from './AdminSyncMonitor.js';
export interface PageDef { path: string; title: string; group: string; perm?: string[]; superAdmin?: boolean; component: ComponentType }
export const pages: PageDef[] = [
  { path: 'dashboard', title: '仪表板', group: '总览', component: Dashboard },
  { path: 'approvals', title: '审批', group: '总览', perm: ['approval.decide'], component: Approvals },
  { path: 'notifications', title: '通知', group: '总览', component: Notifications },
  { path: 'products', title: '产品管理', group: '主数据', perm: ['product.view'], component: Products },
  { path: 'locations', title: '位置和区', group: '主数据', perm: ['location.manage', 'stock.view'], component: Locations },
  { path: 'import', title: 'Excel 导入', group: '主数据', perm: ['import.upload'], component: Import },
  { path: 'stock', title: '库存查询', group: '库存', perm: ['stock.view'], component: Stock },
  { path: 'movements', title: '移动记录', group: '库存', perm: ['movement.view', 'movement.view_all'], component: Movements },
  { path: 'reports', title: '报表中心', group: '库存', perm: ['report.stock'], component: Reports },
  { path: 'orders', title: '订货与采购', group: '采购', perm: ['order.view', 'po.view'], component: Orders },
  { path: 'transfers', title: '调拨', group: '采购', perm: ['transfer.view', 'transfer.approve', 'transfer.request'], component: Transfers },
  { path: 'counts', title: '盘点', group: '库存', perm: ['count.assign', 'count.approve', 'count.rules'], component: Counts },
  { path: 'sales', title: '销售', group: '销售', perm: ['report.sales', 'pos.close'], component: Sales },
  { path: 'ar', title: '客户与应收', group: '销售', perm: ['invoice.manage', 'customer.manage', 'pos.b2b'], component: Customers },
  { path: 'ap', title: '供应商发票', group: '销售', perm: ['ap.manage', 'ap.pay', 'ap.approve'], component: SupplierInvoices },
  { path: 'einvoice', title: '电子发票', group: '销售', perm: ['einvoice.manage'], component: EInvoice },
  { path: 'month-end', title: '月结', group: '销售', perm: ['period.lock'], component: MonthEnd },
  { path: 'tickets', title: '工单', group: '运营', perm: ['ticket.view_all'], component: Tickets },
  { path: 'map', title: '店地图与大屏', group: '运营', perm: ['map.edit'], component: MapEditor },
  { path: 'knowledge', title: '知识库与机器人', group: '运营', perm: ['kb.edit'], component: Knowledge },
  { path: 'delegations', title: '代理', group: '管理', perm: ['delegation.manage'], component: Delegations },
  { path: 'integrations', title: '对接与密钥', group: '管理', perm: ['integration.edit', 'settings.edit'], component: Integrations },
  { path: 'devices', title: '设备管理', group: '运营', perm: ['device.view', 'device.manage'], component: Devices },
  { path: 'users', title: '用户管理', group: '管理', perm: ['user.manage', 'user.reset_pin'], component: Users },
  { path: 'audit', title: '审计日志', group: '管理', perm: ['audit.view'], component: Audit },
  { path: 'settings', title: '公司设定', group: '管理', perm: ['settings.edit'], component: CompanySettings },
  { path: 'theme', title: '外观设计', group: '管理', perm: ['settings.edit'], component: ThemeEditor },
  { path: 'admin/companies', title: '公司列表', group: '超管', superAdmin: true, component: AdminCompanies },
  { path: 'admin/wizard', title: '开店向导', group: '超管', superAdmin: true, component: AdminWizard },
  { path: 'admin/sync-monitor', title: '同步监控', group: '超管', superAdmin: true, component: AdminSyncMonitor },
];
