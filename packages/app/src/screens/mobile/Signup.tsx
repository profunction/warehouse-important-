// 开新店（自助）：店名 → 老板名字和手机 → 选小店或中型 → 设 6 位 PIN → 建好显示公司代码，一键登录
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '../../i18n/index.js';
import { useAuth } from '../../store/auth.js';
import { api, ApiError } from '../../api/client.js';
import { ErrorScreen, Page, TopBar } from '../../ui/Shell.js';
import { Icon, I } from '../../ui/icons.js';
import { Store, Building2 } from 'lucide-react';

export default function Signup() {
  const { lang } = useT(); const { login } = useAuth(); const nav = useNavigate();
  const L = (zh: string, ms: string, en: string) => (lang === 'zh' ? zh : lang === 'ms' ? ms : en);
  const [f, setF] = useState({ shop_name: '', boss_name: '', phone: '', email: '', plan: 'A' as 'A' | 'B', pin: '', pin2: '' });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null); const [done, setDone] = useState<any>(null); const [open, setOpen] = useState(true);
  useEffect(() => { api('/signup/config', { auth: false }).then((c) => setOpen(c.open)).catch(() => {}); }, []);
  const set = (k: string, v: string) => setF({ ...f, [k]: v });
  const pinOk = /^\d{6}$/.test(f.pin) && f.pin === f.pin2;
  const ok = f.shop_name.trim().length >= 2 && f.boss_name.trim() && f.phone.replace(/\D/g, '').length >= 8 && pinOk;
  const submit = async () => {
    setBusy(true);
    try { const r = await api('/signup/company', { auth: false, body: { shop_name: f.shop_name.trim(), boss_name: f.boss_name.trim(), phone: f.phone, email: f.email || null, plan: f.plan, pin: f.pin } }); setDone(r); localStorage.setItem('wh.company', r.company_code); localStorage.setItem('wh.loginMode', 'phone'); }
    catch (e: any) { setErr(e instanceof ApiError ? (e.code === 'TOO_MANY_REQUESTS' ? L('太多次了，一小时后再试', 'Terlalu banyak cubaan, cuba sejam lagi', 'Too many tries, try again in an hour') : e.text(lang)) : String(e?.message ?? e)); }
    finally { setBusy(false); }
  };
  const enter = async () => { setBusy(true); try { await login({ company_code: done.company_code, phone: f.phone.replace(/[\s-]/g, ''), pin: f.pin }); nav('/', { replace: true }); } catch (e: any) { setErr(e instanceof ApiError ? e.text(lang) : String(e)); } finally { setBusy(false); } };
  if (done) return (
    <div className="mobile"><div className="done-screen" data-testid="signup-done">
      <div className="big"><Icon name={I.Check} size={30} /></div>
      <div className="msg">{L('开店成功', 'Kedai dibuka', 'Shop created')}</div>
      <div>{done.shop_name}</div>
      <div style={{ marginTop: 10 }}>{L('你的公司代码（员工登录要用，请记下）', 'Kod syarikat anda (untuk log masuk pekerja)', 'Your company code (staff need it to log in)')}</div>
      <div style={{ fontFamily: 'var(--sans)', fontSize: 40, fontWeight: 800, letterSpacing: '.08em', color: 'var(--green)', userSelect: 'all' }} data-testid="signup-code">{done.company_code}</div>
      <div style={{ width: '100%', maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
        <button className="btn btn-primary btn-xl" onClick={() => void enter()} disabled={busy} data-testid="signup-enter">{L('进入我的店', 'Masuk kedai saya', 'Go to my shop')}</button>
      </div>
      <div style={{ fontSize: 13 }}>{L('下一步：网页后台"Excel 导入"把产品一次导入，或在"产品管理"一个个加；"用户管理"加员工，或让员工自己申请加入。', 'Seterusnya: import produk melalui Excel, tambah pekerja atau biar mereka memohon sendiri.', 'Next: import products from Excel, then add staff or let them request to join.')}</div>
    </div>{err && <ErrorScreen msg={err} onOk={() => setErr(null)} />}</div>
  );
  return (
    <Page>
      <TopBar title={L('开新店', 'Buka kedai baru', 'Open a new shop')} onBack={() => nav('/')} />
      {err && <ErrorScreen msg={err} onOk={() => setErr(null)} />}
      {!open ? <div className="empty">{L('目前不开放自助开店，请联系我们', 'Pendaftaran sendiri ditutup, sila hubungi kami', 'Self sign-up is closed, please contact us')}</div> : (
        <div className="login">
          <div className="note" style={{ color: 'var(--muted)', fontSize: 'var(--fs-small)' }}>{L('免费试用。建好马上能用，产品、货架、角色都按模板准备好。', 'Percubaan percuma. Sedia digunakan serta-merta.', 'Free trial. Ready to use right away with a starter template.')}</div>
          <input placeholder={L('店名', 'Nama kedai', 'Shop name')} value={f.shop_name} onChange={(e) => set('shop_name', e.target.value)} data-testid="su-shop" />
          <input placeholder={L('你的名字', 'Nama anda', 'Your name')} value={f.boss_name} onChange={(e) => set('boss_name', e.target.value)} data-testid="su-name" />
          <input placeholder={L('手机号（登录用）', 'No. telefon (untuk log masuk)', 'Phone (used to log in)')} inputMode="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} data-testid="su-phone" />
          <input placeholder={L('电邮（可不填）', 'E-mel (pilihan)', 'Email (optional)')} inputMode="email" value={f.email} onChange={(e) => set('email', e.target.value)} />
          <div className="seg" style={{ display: 'flex' }}>
            <button className={`btn ${f.plan === 'A' ? 'btn-primary' : 'btn-ghost'}`} style={{ flex: 1 }} onClick={() => set('plan', 'A')}><Store size={18} /> {L('小店（一间店）', 'Kedai kecil', 'Small shop')}</button>
            <button className={`btn ${f.plan === 'B' ? 'btn-primary' : 'btn-ghost'}`} style={{ flex: 1 }} onClick={() => set('plan', 'B')}><Building2 size={18} /> {L('有仓库或多间店', 'Gudang / banyak kedai', 'Warehouse / many shops')}</button>
          </div>
          <input placeholder={L('设 6 位 PIN', 'Tetapkan PIN 6 digit', 'Set a 6-digit PIN')} inputMode="numeric" type="password" maxLength={6} value={f.pin} onChange={(e) => set('pin', e.target.value.replace(/\D/g, ''))} data-testid="su-pin" />
          <input placeholder={L('再输一次 PIN', 'Ulang PIN', 'Repeat PIN')} inputMode="numeric" type="password" maxLength={6} value={f.pin2} onChange={(e) => set('pin2', e.target.value.replace(/\D/g, ''))} data-testid="su-pin2" />
          {f.pin2.length === 6 && f.pin !== f.pin2 && <div className="err" style={{ color: 'var(--red)', fontSize: 'var(--fs-small)' }}>{L('两次 PIN 不一样', 'PIN tidak sama', 'PINs do not match')}</div>}
          <button className="btn btn-primary btn-xl" disabled={!ok || busy} onClick={() => void submit()} data-testid="su-submit">{busy ? '…' : L('开店', 'Buka kedai', 'Create shop')}</button>
        </div>
      )}
    </Page>
  );
}
