// POS 共用小件：大键盘、金额显示、叠加面板、大按钮、三语标签
import { type ReactNode } from 'react';
import { useT } from '../../i18n/index.js';
import { fx } from '../../ui/feedback.js';

/** 大数字键盘（≥72px 键） */
export function Keypad({ value, onChange, allowDecimal = true, onEnter, max = 9 }: { value: string; onChange: (v: string) => void; allowDecimal?: boolean; onEnter?: () => void; max?: number }) {
  const press = (k: string) => {
    fx.tap();
    if (k === '⌫') return onChange(value.slice(0, -1));
    if (k === 'C') return onChange('');
    if (k === '.' && (!allowDecimal || value.includes('.'))) return;
    if (value.replace('.', '').length >= max) return;
    if (value.includes('.') && value.split('.')[1].length >= 3) return;
    onChange(value === '0' && k !== '.' ? k : value + k);
  };
  return (
    <div className="pos-keypad" data-testid="pos-keypad">
      {['1', '2', '3', '4', '5', '6', '7', '8', '9', allowDecimal ? '.' : 'C', '0', '⌫'].map((k) => <button key={k} onClick={() => press(k)} data-key={k}>{k}</button>)}
      {onEnter && <button className="wide" style={{ gridColumn: 'span 3', background: 'var(--green)', color: '#fff', borderColor: 'var(--green)' }} onClick={() => { fx.tap(); onEnter(); }} data-testid="keypad-enter">OK</button>}
    </div>
  );
}
export function Amount({ label, value, placeholder = '0.00', prefix = 'RM', testid }: { label: string; value: string | number; placeholder?: string; prefix?: string; testid?: string }) {
  const empty = value === '' || value == null;
  return <div className="pos-amount"><span className="l">{label}</span><span className={`n ${empty ? 'placeholder' : ''}`} data-testid={testid}>{prefix} {empty ? placeholder : typeof value === 'number' ? value.toFixed(2) : value}</span></div>;
}
export function Overlay({ children, onClose, wide }: { children: ReactNode; onClose?: () => void; wide?: boolean }) {
  return <div className="pos-overlay" onClick={onClose}><div className={`pos-panel ${wide ? 'wide' : ''}`} onClick={(e) => e.stopPropagation()}>{children}</div></div>;
}
/** 三语标题：当前语言大字 + 其他两种小字 */
export function Tri({ k, vars }: { k: string; vars?: Record<string, string | number> }) { const { t, t2 } = useT(); return <h2>{t(k, vars)}<small>{t2(k)}</small></h2>; }
export function Btn({ k, color = 'grey', icon, onClick, disabled, testid, className = '', children }: { k?: string; color?: 'pay' | 'blue' | 'orange' | 'red' | 'grey' | 'ghost' | 'brass'; icon?: ReactNode; onClick?: () => void; disabled?: boolean; testid?: string; className?: string; children?: ReactNode }) {
  const { t, t2 } = useT();
  return <button className={`pos-btn ${color} ${className}`} onClick={() => { fx.tap(); onClick?.(); }} disabled={disabled} data-testid={testid}>{icon}{children ?? <>{t(k!)}<small>{t2(k!)}</small></>}</button>;
}
export const money = (n: number | string | null | undefined) => `RM ${Number(n ?? 0).toFixed(2)}`;
export const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
