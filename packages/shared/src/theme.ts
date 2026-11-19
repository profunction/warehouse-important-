// 外观主题：老板在网页端自己选，存在 company.settings.theme，全公司生效。
export interface Theme {
  preset: 'minimal' | 'market' | 'glass' | 'night' | 'super' | 'fresh' | 'stitch';
  primary?: string;      // 主色（确认按钮、品牌）
  accent?: string;       // 点缀色（角标、横条）
  paper?: string;        // 底色
  ink?: string;          // 文字色
  font: 'serif' | 'sans' | 'round';   // 标题和数字字体
  radius: 0 | 12 | 20;   // 圆角
  home: 'list' | 'tiles';// 首页排法
  density: 'normal' | 'large';
  nav?: 'side' | 'top';  // 网页端导航：左侧栏或顶部
}
export const THEME_PRESETS: Record<Theme['preset'], { name_zh: string; name_en: string; vars: Record<string, string>; defaults: Partial<Theme> }> = {
  minimal: { name_zh: '深林与黄铜', name_en: 'Minimal', vars: { '--paper': '#FAF8F3', '--paper-dim': '#F3F0E8', '--ink': '#15201A', '--muted': '#43534A', '--stroke': '#6F7A74', '--hair': '#E3DFD2', '--green': '#0E3B2B', '--green-press': '#0A2D20', '--brass': '#B8894A', '--mint': '#9FD7B6' }, defaults: { font: 'serif', radius: 0, home: 'list' } },
  market: { name_zh: '市场晨光', name_en: 'Market', vars: { '--paper': '#FBF8F1', '--paper-dim': '#F3EFE4', '--ink': '#1B1F1C', '--muted': '#4F5751', '--stroke': '#8A918C', '--hair': '#E6E2D8', '--green': '#0B6B3A', '--green-press': '#08512C', '--brass': '#D99A1E', '--mint': '#5EEAA0' }, defaults: { font: 'sans', radius: 20, home: 'tiles' } },
  glass: { name_zh: '玻璃货架', name_en: 'Glass', vars: { '--paper': '#F1F4F8', '--paper-dim': '#E6EBF2', '--ink': '#0F172A', '--muted': '#475569', '--stroke': '#94A3B8', '--hair': '#DCE3EC', '--green': '#15803D', '--green-press': '#116A33', '--brass': '#2563EB', '--mint': '#86EFAC' }, defaults: { font: 'sans', radius: 20, home: 'tiles' } },
  super: { name_zh: '超级应用（Grab / TnG 风）', name_en: 'Super app', vars: { '--paper': '#FFFFFF', '--paper-dim': '#F5F7FA', '--ink': '#1A1D21', '--muted': '#5B6470', '--stroke': '#98A2B3', '--hair': '#E9EDF2', '--green': '#00B14F', '--green-press': '#009A45', '--brass': '#FF6B00', '--mint': '#7CE0A6' }, defaults: { font: 'sans', radius: 20, home: 'tiles' } },
  fresh: { name_zh: '清新薄荷', name_en: 'Fresh', vars: { '--paper': '#F6FBF8', '--paper-dim': '#E8F5EE', '--ink': '#10251A', '--muted': '#4C6B5A', '--stroke': '#8FB3A0', '--hair': '#D7EBE0', '--green': '#1F9D5A', '--green-press': '#188A4E', '--brass': '#F2A33A', '--mint': '#9FE3BE' }, defaults: { font: 'round', radius: 20, home: 'tiles' } },
  stitch: { name_zh: '清爽作业台（Stitch 稿）', name_en: 'Workbench', vars: { '--paper': '#FAF8FF', '--paper-dim': '#F2F3FF', '--ink': '#131B2E', '--muted': '#414944', '--stroke': '#717974', '--hair': '#E2E7FF', '--green': '#0E3B2B', '--green-press': '#002418', '--brass': '#E88219', '--mint': '#82F5C1', '--heading': '"Noto Serif","Noto Serif SC",Georgia,serif', '--sans-preset': '"Plus Jakarta Sans","Noto Sans SC","PingFang SC",system-ui,sans-serif' }, defaults: { font: 'sans', radius: 12, home: 'tiles', nav: 'top' } },
  night: { name_zh: '夜班仓库', name_en: 'Night', vars: { '--paper': '#0B1020', '--paper-dim': '#151C31', '--ink': '#F1F5F9', '--muted': '#B6C2D4', '--stroke': '#64748B', '--hair': '#243052', '--green': '#A3E635', '--green-press': '#84CC16', '--brass': '#FBBF24', '--mint': '#A3E635' }, defaults: { font: 'sans', radius: 12, home: 'tiles' } },
};
export const DEFAULT_THEME: Theme = { preset: 'minimal', font: 'serif', radius: 0, home: 'list', density: 'normal' };
/** 主题 → CSS 变量表 */
export function themeVars(t: Partial<Theme> | null | undefined): Record<string, string> {
  const th = { ...DEFAULT_THEME, ...(t ?? {}) } as Theme;
  const p = THEME_PRESETS[th.preset] ?? THEME_PRESETS.minimal;
  const v: Record<string, string> = { ...p.vars };
  if (th.primary) { v['--green'] = th.primary; v['--green-press'] = th.primary; }
  if (th.accent) v['--brass'] = th.accent;
  if (th.paper) v['--paper'] = th.paper;
  if (th.ink) v['--ink'] = th.ink;
  v['--serif'] = th.font === 'serif' ? '"Fraunces","Noto Serif SC",Georgia,serif' : th.font === 'round' ? '"Nunito","Noto Sans SC",system-ui,sans-serif' : '"Inter","Noto Sans SC",system-ui,sans-serif';
  if (p.vars['--heading'] && th.font === (p.defaults.font ?? 'serif')) v['--serif'] = p.vars['--heading'];
  if (p.vars['--sans-preset']) v['--sans'] = p.vars['--sans-preset'];
  v['--radius'] = `${th.radius}px`; v['--radius-sm'] = `${Math.min(th.radius, 12)}px`;
  v['--btn-h'] = th.density === 'large' ? '84px' : '72px';
  return v;
}
