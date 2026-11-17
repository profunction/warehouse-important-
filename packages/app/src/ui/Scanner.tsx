// T3 扫描：摄像头（zxing）+ 键盘枪（HID）+ 打字输入
import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import { useT } from '../i18n/index.js';
import { fx } from './feedback.js';
import { Icon, I } from './icons.js';
import type { LucideIcon } from 'lucide-react';

export function Scanner({ onScan, instruction, icon, last, enabled = true }: { onScan: (code: string) => void; instruction: string; icon: LucideIcon; last?: string; enabled?: boolean }) {
  const { t } = useT();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hit, setHit] = useState(false);
  const [camErr, setCamErr] = useState(false);
  const [typing, setTyping] = useState(false);
  const [torch, setTorch] = useState(false);
  const controls = useRef<IScannerControls | null>(null);
  const lastRef = useRef<{ code: string; at: number }>({ code: '', at: 0 });
  const buf = useRef(''); const bufAt = useRef(0);
  const emit = (raw: string) => {
    const code = raw.trim(); if (!code) return;
    const now = Date.now();
    if (lastRef.current.code === code && now - lastRef.current.at < 2000) return;   // 2 秒内同码忽略
    lastRef.current = { code, at: now };
    setHit(true); setTimeout(() => setHit(false), 300); fx.scanOk();
    onScan(code);
  };
  // 键盘枪：快速连续字符 + Enter
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      const now = Date.now(); if (now - bufAt.current > 100) buf.current = ''; bufAt.current = now;
      if (e.key === 'Enter') { if (buf.current.length >= 3) emit(buf.current); buf.current = ''; }
      else if (e.key.length === 1) buf.current += e.key;
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
  // 摄像头
  useEffect(() => {
    if (!enabled || typing) return;
    let stopped = false;
    const hints = new Map(); hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE, BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.CODE_128, BarcodeFormat.UPC_A, BarcodeFormat.ITF, BarcodeFormat.DATA_MATRIX]);
    hints.set(DecodeHintType.TRY_HARDER, true);
    const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 150 });
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('no camera');
        const c = await reader.decodeFromConstraints({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } } }, videoRef.current!, (res) => { if (res) emit(res.getText()); });
        if (stopped) c.stop(); else controls.current = c;
      } catch { if (!stopped) setCamErr(true); }
    })();
    return () => { stopped = true; controls.current?.stop(); controls.current = null; };
  }, [enabled, typing]);
  const toggleTorch = async () => {
    const track = (videoRef.current?.srcObject as MediaStream | null)?.getVideoTracks?.()[0];
    try { await track?.applyConstraints({ advanced: [{ torch: !torch } as any] }); setTorch(!torch); } catch { /* 不支持 */ }
  };
  const [typed, setTyped] = useState('');
  return (
    <div>
      {!typing && (
        <div className={`scan-wrap ${hit ? 'hit' : ''}`} data-testid="scan-area">
          {camErr ? <div style={{ color: '#fff', padding: 24, textAlign: 'center', fontSize: 20 }}>{t('camera_denied')}</div> : <video ref={videoRef} muted playsInline />}
          <div className="scan-frame"><i className="c1" /><i className="c2" /><i className="laser" /></div>
        </div>
      )}
      <div className="instruct"><span className="ic"><Icon name={icon} size={36} /></span>{instruction}</div>
      {last && <div className="last">{t('last')}：{last}</div>}
      {typing ? (
        <form className="row2" onSubmit={(e) => { e.preventDefault(); emit(typed); setTyped(''); }}>
          <input autoFocus inputMode="text" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={instruction} data-testid="scan-input" />
          <button type="submit" className="btn btn-primary" style={{ width: 'auto' }}>{t('confirm')}</button>
          <button type="button" className="btn btn-ghost" style={{ width: 'auto' }} onClick={() => setTyping(false)}><Icon name={I.Close} size={24} /></button>
        </form>
      ) : (
        <div className="row2">
          <button className="btn btn-ghost" onClick={() => setTyping(true)} data-testid="type-in"><Icon name={I.Keyboard} size={24} /> {t('type_in')}</button>
          <button className="btn btn-ghost" onClick={toggleTorch}><Icon name={I.Torch} size={24} /> {t('torch')}</button>
        </div>
      )}
    </div>
  );
}
