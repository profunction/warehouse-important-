import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '../../i18n/index.js';
import { Icon, I } from '../../ui/icons.js';
import { useAuth } from '../../store/auth.js';
import { Page, TopBar } from '../../ui/Shell.js';
import { api } from '../../api/client.js';
import { pull } from '../../offline/sync.js';
import type { Lang } from '@wh/shared';
export default function Settings() {
  const { t, lang, setLang, fontLarge, setFontLarge } = useT(); const { me, isWeb } = useAuth(); const nav = useNavigate();
  const [oldPin, setOld] = useState(''); const [newPin, setNew] = useState(''); const [msg, setMsg] = useState('');
  const save = async (patch: any) => { try { await api('/me/preferences', { method: 'PUT', body: patch }); } catch { /* 离线稍后 */ } };
  return (
    <Page>
      <TopBar title={t('settings')} onBack={() => nav('/m')} />
      <div className="section">{t('language')}</div>
      <div className="row2">{(['zh', 'ms', 'en'] as Lang[]).map((l) => <button key={l} className={`btn ${lang === l ? 'btn-primary' : 'btn-ghost'}`} onClick={() => { setLang(l); void save({ language: l }); }}>{l === 'zh' ? '中文' : l === 'ms' ? 'Bahasa Melayu' : 'English'}</button>)}</div>
      <div className="section">{t('font_size')}</div>
      <div className="row2"><button className={`btn ${!fontLarge ? 'btn-primary' : 'btn-ghost'}`} onClick={() => { setFontLarge(false); void save({ font_scale: 1 }); }}>{t('normal')}</button><button className={`btn ${fontLarge ? 'btn-primary' : 'btn-ghost'}`} onClick={() => { setFontLarge(true); void save({ font_scale: 1.25 }); }}>{t('large')}</button></div>
      <div className="section">{t('change_pin')}</div>
      <div className="login" style={{ paddingTop: 0 }}>
        <input type="password" inputMode="numeric" placeholder={t('old_pin')} value={oldPin} onChange={(e) => setOld(e.target.value)} />
        <input type="password" inputMode="numeric" placeholder={t('new_pin')} value={newPin} onChange={(e) => setNew(e.target.value)} />
        <button className="btn btn-secondary" disabled={!/^\d{6}$/.test(newPin) || !oldPin} onClick={async () => { try { await api('/auth/change-pin', { body: { old_pin: oldPin, new_pin: newPin } }); setMsg(t('saved')); setOld(''); setNew(''); } catch (e: any) { setMsg(e.text?.(lang) ?? t('pin_wrong')); } }}>{t('change_pin')}</button>
        {msg && <div className="last">{msg}</div>}
      </div>
      <div className="section">{t('synced')}</div>
      <div className="confirm-wrap"><button className="btn btn-ghost" onClick={() => void pull(true)}>↻ {t('retry')}</button></div>
      {me && <div className="kv"><span className="k">{me.company.name}</span><span>{me.site?.code} · {me.roles.join(',')}</span></div>}
      {isWeb && <div className="confirm-wrap"><button className="btn btn-secondary" onClick={() => nav('/w/dashboard')}>网页管理</button></div>}
    </Page>
  );
}
