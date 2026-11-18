// 外观主题：老板在网页端自己选，存在 company.settings.theme，全公司生效。
export interface Theme {
  preset: 'minimal' | 'market' | 'glass' | 'night';
  primary?: string;      // 主色（确认按钮、品牌）
  accent?: string;       // 点缀色（角标、横条）
  paper?: string;        // 底色
  ink?: string;          // 文字色
  font: 'serif' | 'sans' | 'round';   // 标题和数字字体
  radius: 0 | 12 | 20;   // 圆角
  home: 'list' | 'tiles';// 首页排法
  density: 'normal' | 'large';
}
export const THEME_PRESETS: Record<Theme['preset'], { name_zh: string; name_en: string; vars: Record<string, string>; defaults: Partial<Theme> }> = {
  minimal: { name_zh: '深林与黄铜', name_en: 'Minimal', vars: { '--paper': '#FAF8F3', '--paper-dim': '#F3F0E8', '--ink': '#15201A', '--muted': '#43534A', '--stroke': '#6F7A74', '--hair': '#E3DFD2', '--green': '#0E3B2B', '--green-press': '#0A2D20', '--brass': '#B8894A', '--mint': '#9FD7B6' }, defaults: { font: 'serif', radius: 0, home: 'list' } },
  market: { name_zh: '市场晨光', name_en: 'Market', vars: { '--paper': '#FBF8F1', '--paper-dim': '#F3EFE4', '--ink': '#1B1F1C', '--muted': '#4F5751', '--stroke': '#8A918C', '--hair': '#E6E2D8', '--green': '#0B6B3A', '--green-press': '#08512C', '--brass': '#D99A1E', '--mint': '#5EEAA0' }, defaults: { font: 'sans', radius: 20, home: 'tiles' } },
  glass: { name_zh: '玻璃货架', name_en: 'Glass', vars: { '--paper': '#F1F4F8', '--paper-dim': '#E6EBF2', '--ink': '#0F172A', '--muted': '#475569', '--stroke': '#94A3B8', '--hair': '#DCE3EC', '--green': '#15803D', '--green-press': '#116A33', '--brass': '#2563EB', '--mint': '#86EFAC' }, defaults: { font: 'sans', radius: 20, home: 'tiles' } },
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
  v['--radius'] = `${th.radius}px`; v['--radius-sm'] = `${Math.min(th.radius, 12)}px`;
  v['--btn-h'] = th.density === 'large' ? '84px' : '72px';
  return v;
}
