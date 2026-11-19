// P1 开班：选机号 → 大键盘输开班现金 → 确认。已有本机本人的 OPEN 班次直接进主屏。
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../store/auth.js';
import { useT } from '../../i18n/index.js';
import { api, ApiError, isOnline } from '../../api/client.js';
import { ErrorScreen } from '../../ui/Shell.js';
import { kvGet } from '../../offline/db.js';
import { PosTop } from './PosApp.js';
import { usePos } from './posStore.js';
import { Keypad, Amount, Btn, Tri } from './PosUi.js';

export default function PosOpen() {
  const { me } = useAuth(); const { t, lang } = useT(); const nav = useNavigate();
  const { terminal, setTerminal, session, sessionLoading, setSession, refreshSession } = usePos();
  const [cash, setCash] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null); const [terminals, setTerminals] = useState<string[]>(['P1', 'P2']);
  useEffect(() => { void kvGet<any>('sync.settings', {}).then((s) => { const n = Math.max(1, Math.min(8, Number(s?.pos_terminal_count ?? 2))); setTerminals(Array.from({ length: n }, (_, i) => `P${i + 1}`)); }); }, []);
  useEffect(() => { if (!sessionLoading && session?.status === 'OPEN') nav('/pos', { replace: true }); }, [session, sessionLoading, nav]);
  const open = async () => {
    if (busy) return; setBusy(true);
    try {
      const s = await api('/pos/sessions/open', { body: { terminal_code: terminal, opening_cash: Number(cash || 0) } });
      await setSession(s); nav('/pos', { replace: true });
    } catch (e: any) {
      if (e instanceof ApiError && e.code === 'SESSION_ALREADY_OPEN') {
        if (e.body?.detail?.cashier_id === me?.user.id) { const s = await refreshSession(); if (s) { nav('/pos', { replace: true }); return; } }
        setErr(t('pos_shift_taken', { name: '…' }));
      } else if (e instanceof ApiError) setErr(e.text(lang)); else setErr(t('needs_network'));
    } finally { setBusy(false); }
  };
  return (
    <div className="pos">
      <PosTop />
      {!isOnline() && <div className="pos-bar warn">{t('offline')} · {t('needs_network')}</div>}
      <div className="pos-center">
        <div className="pos-panel" style={{ width: 'min(1000px, 96vw)' }}>
          <Tri k="pos_open_shift" />
          <div className="pos-cols">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="hint">{t('pos_terminal')}</div>
              <div className="pos-quick" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>{terminals.map((x) => <button key={x} className={terminal === x ? 'on' : ''} onClick={() => void setTerminal(x)} data-testid={`terminal-${x}`}>{x}</button>)}</div>
              <div className="hint">{t('pos_enter_opening_cash')}</div>
              <Amount label={t('pos_opening_cash')} value={cash} testid="open-cash" />
              <div className="hint">{me?.site?.name} · {me?.user.name}</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Keypad value={cash} onChange={setCash} />
              <Btn k="confirm" color="pay" onClick={() => void open()} disabled={busy} testid="pos-open-confirm" />
            </div>
          </div>
        </div>
      </div>
      {err && <ErrorScreen msg={err} onOk={() => setErr(null)} />}
    </div>
  );
}
