// 自有 POS（平板横屏 1280×800）：/pos 主屏 P2、/pos/open 开班 P1、/pos/pay 付款 P5、/pos/done 完成 P6（含电子发票 P7）、
// /pos/returns 退货 P8、/pos/close 日结 P11、/pos/hold 挂单取单 P10、/pos/b2b 企业记账 P9；称重 P3、折扣 P10、主管授权 P12 是主屏上的叠加层。
// 约定：机号存本机（kv pos.terminal，默认 P1）；班次从服务器取，离线用上次缓存；扫描枪 = 自动聚焦的输入框（HID 键盘模式 + Enter）。
import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../store/auth.js';
import { useT } from '../../i18n/index.js';
import { subscribe as subscribeSync, type SyncState } from '../../offline/sync.js';
import { subscribeBridge, type BridgeStatus } from '../../pos/bridge.js';
import { PosProvider, usePos } from './posStore.js';
import PosMain from './PosMain.js';
import PosOpen from './PosOpen.js';
import PosPay from './PosPay.js';
import PosDone from './PosDone.js';
import PosReturns from './PosReturns.js';
import PosClose from './PosClose.js';
import PosHold from './PosHold.js';
import PosB2B from './PosB2B.js';
import { I, Icon } from '../../ui/icons.js';
import type { Lang } from '@wh/shared';
import './pos.css';

export function PosTop() {
  const { me } = useAuth(); const { t, lang, setLang } = useT(); const { terminal, session } = usePos(); const nav = useNavigate();
  const [now, setNow] = useState(new Date()); const [sync, setSync] = useState<SyncState | null>(null); const [br, setBr] = useState<BridgeStatus>({ connected: false });
  useEffect(() => { const i = setInterval(() => setNow(new Date()), 10000); const u1 = subscribeSync(setSync); const u2 = subscribeBridge(setBr); return () => { clearInterval(i); u1(); u2(); }; }, []);
  return (
    <div className="pos-top" data-testid="pos-top">
      <span className="brand">{t('app_name')}</span>
      <span>{me?.site?.code ?? ''} · <b>{terminal}</b></span>
      <span>{me?.user.name}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
      <span className="sp" />
      {session ? <span className="pdot on" title={session.id}><i />{t('pos_open_shift')}</span> : <span className="pdot warn"><i />{t('pos_no_shift')}</span>}
      <span className={`pdot ${sync?.online ? (sync.pending ? 'warn' : 'on') : 'off'}`}><i />{sync?.online ? (sync.pending ? t('pos_offline_sales', { n: sync.pending }) : t('online')) : t('offline')}</span>
      <span className={`pdot ${br.connected ? 'on' : 'off'}`}><i />{br.connected ? t('pos_bridge_on') : t('pos_bridge_off')}</span>
      <span className="lang">{(['zh', 'ms', 'en'] as Lang[]).map((l) => <button key={l} className={lang === l ? 'on' : ''} onClick={() => setLang(l)}>{l.toUpperCase()}</button>)}</span>
      <button className="iconbtn" onClick={() => nav('/m')} data-testid="pos-exit"><Icon name={I.LogOut} size={20} /> {t('pos_exit')}</button>
    </div>
  );
}

function Guard({ children }: { children: JSX.Element }) {
  const { session, sessionLoading } = usePos(); const loc = useLocation(); const { t } = useT();
  if (sessionLoading) return <div className="pos"><div className="pos-center">{t('loading')}</div></div>;
  if (!session && !['/pos/open', '/pos/returns', '/pos/close'].includes(loc.pathname)) return <Navigate to="/pos/open" replace />;
  return children;
}

export default function PosApp() {
  const { me } = useAuth();
  if (!me) return null;
  return (
    <PosProvider>
      <Routes>
        <Route path="/" element={<Guard><PosMain /></Guard>} />
        <Route path="/open" element={<PosOpen />} />
        <Route path="/pay" element={<Guard><PosPay /></Guard>} />
        <Route path="/done" element={<Guard><PosDone /></Guard>} />
        <Route path="/returns" element={<PosReturns />} />
        <Route path="/close" element={<PosClose />} />
        <Route path="/hold" element={<Guard><PosHold /></Guard>} />
        <Route path="/b2b" element={<Guard><PosB2B /></Guard>} />
        <Route path="*" element={<Navigate to="/pos" replace />} />
      </Routes>
    </PosProvider>
  );
}
