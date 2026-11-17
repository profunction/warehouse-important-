import { useState } from 'react';
import { useT } from '../../i18n/index.js';
import { useAuth } from '../../store/auth.js';
import { Scanner } from '../../ui/Scanner.js';
import { ErrorScreen } from '../../ui/Shell.js';
import { ApiError } from '../../api/client.js';
import { fx } from '../../ui/feedback.js';
import type { Lang } from '@wh/shared';
import { Icon, I } from '../../ui/icons.js';

export default function Login() {
  const { t, lang, setLang } = useT(); const { login } = useAuth();
  const [mode, setMode] = useState<'scan' | 'phone' | 'email'>(() => (localStorage.getItem('wh.loginMode') as any) || 'scan');
  const [badge, setBadge] = useState<string | null>(null);
  const [company, setCompany] = useState(localStorage.getItem('wh.company') ?? ''); const [phone, setPhone] = useState(''); const [email, setEmail] = useState('');
  const [pin, setPin] = useState(''); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const submit = async (p: string) => {
    setBusy(true); fx.unlock();
    try {
      localStorage.setItem('wh.loginMode', mode); if (company) localStorage.setItem('wh.company', company.toUpperCase());
      await login(mode === 'scan' ? { badge, pin: p } : mode === 'phone' ? { company_code: company.toUpperCase(), phone, pin: p } : { email, pin: p });
    } catch (e: any) { setErr(e instanceof ApiError ? e.text(lang) : t('pin_wrong')); setPin(''); } finally { setBusy(false); }
  };
  const press = (k: string) => { fx.tap(); if (k === '⌫') return setPin(pin.slice(0, -1)); if (pin.length >= 6) return; const np = pin + k; setPin(np); if (np.length === 6) void submit(np); };
  const ready = mode === 'scan' ? !!badge : mode === 'phone' ? company && phone : !!email;
  return (
    <div className="mobile">
      {err && <ErrorScreen msg={err} onOk={() => setErr(null)} />}
      <div className="login">
        <h1><span className="logo"><Icon name={I.Warehouse} size={30} /></span>{t('app_name')}</h1>
        <div className="row2 seg" style={{ padding: 0 }}>
          {(['scan', 'phone', 'email'] as const).map((m) => <button key={m} className={`btn ${mode === m ? 'btn-primary' : 'btn-ghost'}`} onClick={() => { setMode(m); setBadge(null); }} data-testid={`mode-${m}`}>{m === 'scan' ? t('scan_badge') : m === 'phone' ? t('phone') : t('email')}</button>)}
        </div>
        {mode === 'scan' && !badge && <Scanner onScan={(c) => { if (/^USR:/i.test(c)) setBadge(c); }} instruction={t('scan_badge')} icon={I.Badge} />}
        {mode === 'scan' && badge && <div className="card" onClick={() => setBadge(null)}><div className="thumb"><Icon name={I.Badge} size={32} /></div><div className="body"><div className="t">✓ {t('scan_badge')}</div><div className="s">{badge.split(':')[1]}</div></div></div>}
        {mode === 'phone' && <><input placeholder={t('company_code')} value={company} onChange={(e) => setCompany(e.target.value.toUpperCase())} autoCapitalize="characters" data-testid="company" /><input placeholder={t('phone')} inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} data-testid="phone" /></>}
        {mode === 'email' && <input placeholder={t('email')} inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="email" />}
        {ready && (
          <>
            <div className="instruct" style={{ fontSize: 24 }}>{t('enter_pin')}</div>
            <div className="pin-dots" data-testid="pin-dots">{[0, 1, 2, 3, 4, 5].map((i) => <span key={i} className={i < pin.length ? 'on' : ''} />)}</div>
            <div className="keypad">{['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((k, i) => k ? <button key={i} disabled={busy} onClick={() => press(k)} data-key={k}>{k}</button> : <span key={i} />)}</div>
          </>
        )}
        <div className="bottombar" style={{ marginTop: 8, borderTop: 0, justifyContent: 'center' }}>
          {(['zh', 'ms', 'en'] as Lang[]).map((l) => <button key={l} className={`lang ${lang === l ? 'active' : ''}`} onClick={() => setLang(l)}>{l === 'zh' ? '中' : l === 'ms' ? 'BM' : 'EN'}</button>)}
        </div>
      </div>
    </div>
  );
}
