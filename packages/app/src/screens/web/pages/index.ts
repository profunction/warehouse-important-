// 页面注册表：子代理在此目录添加页面并在下方登记。字段：path, title, group, perm（任一权限可见）, superAdmin, component
import type { ComponentType } from 'react';
import Dashboard from './Dashboard.js';
export interface PageDef { path: string; title: string; group: string; perm?: string[]; superAdmin?: boolean; component: ComponentType }
export const pages: PageDef[] = [
  { path: 'dashboard', title: '仪表板', group: '总览', component: Dashboard },
];
