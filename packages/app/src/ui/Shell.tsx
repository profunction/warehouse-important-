// 手机壳：顶栏、返回确认、叠加层、错误屏、完成屏、数量键盘
import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '../i18n/index.js';
import { fx } from './feedback.js';
import { subscribe, type SyncState, isStale } from '../offline/sync.js';
import { Icon, I } from './icons.js';

export function TopBar({ title, progress, onBack, confirmBack }: { title: string; progress?: string; onBack?: () => void; confirmBack?: boolean }) {
  const { t } = useT(); const nav = useNavigate(); const [ask, setAsk] = useState(false);
  const back = () => { fx.tap(); if (confirmBack) setAsk(true); else (onBack ?? (() => nav(-1)))(); };
  return (
    <>
      <div className="topbar">
        <button className="btn btn-back" onClick={back} data-testid="back"><Icon name={I.Back} size={22} /> {t('back')}</button>
        <div className="title">{title}</div>
        {progress && <div className="progress">{progress}</div>}
      </div>
      {ask && <Confirm msg={t('abandon_step')} okText={t('abandon')} danger onOk={() => { setAsk(false); (onBack ?? (() => nav(-1)))(); }} onCancel={() => setAsk(false)} cancelText={t('keep')} />}
    </>
  );
}
export function Confirm({ msg, okText, cancelText, onOk, onCancel, danger }: { msg: string; okText: string; cancelText?: string; onOk: () => void; onCancel: () => void; danger?: boolean }) {
  const { t } = useT();
  return (
    <div className="modal-bg" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="msg">{msg}</div>
        <div className="btns"><button className="btn btn-ghost" onClick={onCancel}>{cancelText ?? t('cancel')}</button><button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onOk} data-testid="confirm-ok">{okText}</button></div>
      </div>
    </div>
  );
}
/** 错误屏：整屏红 + 嗡 + 一句话 + 知道了 */
export function ErrorScreen({ msg, onOk }: { msg: string; onOk: () => void }) {
  const { t } = useT();
  useEffect(() => { fx.error(); }, []);
  return (
    <div className="modal-bg" style={{ background: 'var(--red)', padding: 0 }}>
      <div className="err-screen" style={{ width: '100%' }} data-testid="error-screen">
        <div className="big"><Icon name={I.Close} size={64} strokeWidth={3} /></div><div className="msg">{msg}</div>
        <button className="btn btn-xl" style={{ background: '#fff', color: 'var(--red)', maxWidth: 360 }} onClick={onOk} autoFocus>{t('ok')}</button>
      </div>
    </div>
  );
}
/** 完成屏 */
export function DoneScreen({ title, lines, warn, onNext, onHome, nextText }: { title: string; lines?: string[]; warn?: string; onNext?: () => void; onHome: () => void; nextText?: string }) {
  const { t } = useT();
  useEffect(() => { fx.done(); }, []);
  return (
    <div className="done-screen" data-testid="done-screen">
      <div className="big"><svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12.5l5 5L20 6.5" /></svg></div><div className="msg">{title}</div>
      {lines?.map((l, i) => <div key={i}>{l}</div>)}
      {warn && <div className="warn">{warn}</div>}
      <div style={{ width: '100%', maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
        {onNext && <button className="btn btn-primary btn-xl" onClick={onNext} data-testid="done-next">{nextText ?? t('continue_next')}</button>}
        <button className="btn btn-secondary" onClick={onHome} data-testid="done-home">{t('home')}</button>
      </div>
    </div>
  );
}
/** 顶部叠加横条：离线、已同步、数据过期、需处理 */
export function SyncBars() {
  const { t } = useT(); const nav = useNavigate();
  const [s, setS] = useState<SyncState | null>(null);
  useEffect(() => subscribe(setS), []);
  if (!s) return null;
  return (
    <>
      {!s.online && <div className="overlay-bar bar-offline" data-testid="bar-offline"><Icon name={I.WifiOff} size={20} /> {t('offline')} · {s.pending} {t('pending_upload')}</div>}
      {s.online && s.justSynced && <div className="overlay-bar bar-synced"><Icon name={I.Check} size={20} /> {t('synced')}</div>}
      {s.online && isStale() && <div className="overlay-bar bar-stale">⚠ {t('stale_data')}</div>}
      {s.online && s.pending >= 50 && <div className="overlay-bar bar-stale">⚠ {t('please_connect')}</div>}
      {s.rejected > 0 && <div className="overlay-bar bar-alert" onClick={() => nav('/m/outbox')} data-testid="bar-rejected">⚠ {t('needs_attention', { n: s.rejected })} ›</div>}
      {s.clockSkew != null && Math.abs(s.clockSkew) > 300 && <div className="overlay-bar bar-offline">🕒 {t('clock_skew')}</div>}
    </>
  );
}
export function Page({ children, flash }: { children: ReactNode; flash?: 'green' | 'red' | null }) {
  return <div className={`mobile ${flash === 'green' ? 'flash-green' : flash === 'red' ? 'flash-red' : ''}`}><SyncBars />{children}</div>;
}
/** T4 数量键盘 */
export function QtyPad({ value, onChange, unit, caseQty, allowDecimal, placeholder, auto }: { value: string; onChange: (v: string) => void; unit: string; caseQty?: number; allowDecimal?: boolean; placeholder?: string; auto?: boolean }) {
  const { t } = useT();
  const press = (k: string) => {
    fx.tap();
    if (k === '⌫') return onChange(value.slice(0, -1));
    if (k === '.' && (value.includes('.') || !allowDecimal)) return;
    if (value.replace('.', '').length >= 7) return;
    onChange(value === '0' && k !== '.' ? k : value + k);
  };
  const add = (n: number) => { fx.tap(); onChange(String(Math.round(((Number(value) || 0) + n) * 1000) / 1000)); };
  return (
    <>
      <div className="qty-display"><div className={`n ${!value ? 'placeholder' : ''} ${auto ? 'auto' : ''}`} data-testid="qty-value">{value || placeholder || '0'}</div><div className="u">{unit}</div></div>
      <div className="quick">
        {caseQty && caseQty > 1 && <button className="btn btn-ghost" onClick={() => add(caseQty)} data-testid="plus-case">{t('plus_case')} ({caseQty})</button>}
        <button className="btn btn-ghost" onClick={() => add(1)} data-testid="plus-one">{t('plus_one')}</button>
        <button className="btn btn-ghost" onClick={() => { fx.tap(); onChange(''); }}>{t('clear')}</button>
      </div>
      <div className="keypad" data-testid="keypad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', allowDecimal ? '.' : '', '0', '⌫'].map((k, i) => k ? <button key={i} onClick={() => press(k)} data-key={k}>{k}</button> : <span key={i} />)}
      </div>
    </>
  );
}
/** 到期日：月份大按钮，默认月底 */
export function ExpiryPicker({ onPick, onSkip }: { onPick: (iso: string) => void; onSkip: () => void }) {
  const { t } = useT();
  const now = new Date(); const [year, setYear] = useState(now.getFullYear()); const [month, setMonth] = useState<number | null>(null); const [day, setDay] = useState<number | null>(null);
  const lastDay = (y: number, m: number) => new Date(y, m, 0).getDate();
  const pick = (m: number) => { setMonth(m); setDay(lastDay(year, m)); };
  const iso = month ? `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` : '';
  return (
    <div>
      <div className="instruct">{t('pick_month')}</div>
      <div className="row2"><button className="btn btn-ghost" onClick={() => setYear(year - 1)}>‹</button><div className="btn btn-ghost" style={{ flex: 2 }}>{year}</div><button className="btn btn-ghost" onClick={() => setYear(year + 1)}>›</button></div>
      <div className="months">{Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <button key={m} className={month === m ? 'sel' : ''} onClick={() => pick(m)}>{m} 月</button>)}</div>
      {month && <div className="row2"><span className="btn btn-ghost" style={{ flex: 1 }}>{t('day')}</span><input type="number" min={1} max={lastDay(year, month)} value={day ?? ''} onChange={(e) => setDay(Number(e.target.value))} style={{ flex: 1 }} /></div>}
      <div className="row2"><button className="btn btn-ghost" onClick={onSkip}>{t('skip')}</button><button className="btn btn-primary" disabled={!iso} onClick={() => onPick(iso)}>{t('confirm')} {iso}</button></div>
    </div>
  );
}
export function ProductHead({ p, sub, barcode }: { p: any; sub?: string; barcode?: string }) {
  const { n } = useT();
  return (
    <div className="prod-head">
      <div className="thumb">{p?.photo_url ? <img src={p.photo_url} alt="" /> : <Icon name={I.Product} size={44} strokeWidth={1.75} />}</div>
      <div><div className="n">{n(p)}</div>{barcode && <div className="b">{barcode}</div>}{sub && <div className="k">{sub}</div>}</div>
    </div>
  );
}
