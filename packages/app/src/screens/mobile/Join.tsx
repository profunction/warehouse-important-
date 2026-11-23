// 员工申请加入：输公司代码（确认店名）→ 名字、手机、岗位 → 设 PIN → 等老板批准；也能查申请状态
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '../../i18n/index.js';
import { api, ApiError } from '../../api/client.js';
import { ErrorScreen, Page, TopBar } from '../../ui/Shell.js';
import { Icon, I } from '../../ui/icons.js';

const ROLE: Record<string, [string, string, string]> = { WAREHOUSE: ['库存员', 'Pekerja Stok', 'Stock staff'], CASHIER: ['收银员', 'Juruwang', 'Cashier'], STOCKER: ['上架员', 'Penyusun Rak', 'Shelf stocker'], COUNTER: ['盘点员', 'Pengira Stok', 'Stock checker'] };
export default function Join() {
  const { lang } = useT(); const nav = useNavigate();
  const L = (zh: string, ms: string, en: string) => (lang === 'zh' ? zh : lang === 'ms' ? ms : en);
  const li = lang === 'zh' ? 0 : lang === 'ms' ? 1 : 2;
  const [code, setCode] = useState(localStorage.getItem('wh.company') ?? ''); const [shop, setShop] = useState<any>(null);
  const [f, setF] = useState({ name: '', phone: '', role_code: '', pin: '', pin2: '', note: '' });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null); const [sent, setSent] = useState(false); const [status, setStatus] = useState<string | null>(null);
  useEffect(() => { setShop(null); if (code.length < 3) return; const h = setTimeout(() => api(`/signup/company/${encodeURIComponent(code)}`, { auth: false }).then((s) => { setShop(s); setF((x) => ({ ...x, role_code: x.role_code || s.roles[0] })); }).catch(() => setShop(false)), 400); return () => clearTimeout(h); }, [code]);
  const set = (k: string, v: string) => setF({ ...f, [k]: v });
  const ok = shop && f.name.trim() && f.phone.replace(/\D/g, '').length >= 8 && f.role_code && /^\d{6}$/.test(f.pin) && f.pin === f.pin2;
  const msg = (e: any) => (e instanceof ApiError ? (e.code === 'DUPLICATE' ? L('这个手机号已经有账号或已经申请过了', 'Nombor ini sudah berdaftar atau sudah memohon', 'This phone already has an account or a pending request') : e.code === 'TOO_MANY_REQUESTS' ? L('太多次了，等一下再试', 'Terlalu banyak cubaan', 'Too many tries') : e.text(lang)) : String(e?.message ?? e));
  const submit = async () => { setBusy(true); try { await api('/signup/join', { auth: false, body: { company_code: code, name: f.name.trim(), phone: f.phone, role_code: f.role_code, pin: f.pin, language: lang, note: f.note || undefined } }); localStorage.setItem('wh.company', code); localStorage.setItem('wh.loginMode', 'phone'); setSent(true); } catch (e) { setErr(msg(e)); } finally { setBusy(false); } };
  const check = async () => { try { const r = await api(`/signup/join/status?company_code=${encodeURIComponent(code)}&phone=${encodeURIComponent(f.phone)}`, { auth: false }); setStatus(r.status); } catch (e) { setErr(msg(e)); } };
  if (sent) return (
    <div className="mobile"><div className="done-screen" data-testid="join-done">
      <div className="big"><Icon name={I.Check} size={30} /></div>
      <div className="msg">{L('申请已送出', 'Permohonan dihantar', 'Request sent')}</div>
      <div>{shop?.name} · {ROLE[f.role_code]?.[li]}</div>
      <div>{L('老板批准后，用这个手机号和 PIN 登录', 'Selepas bos lulus, log masuk dengan telefon dan PIN ini', 'Once the boss approves, log in with this phone and PIN')}</div>
      {status && <div style={{ fontWeight: 700, color: status === 'APPROVED' ? 'var(--green)' : status === 'REJECTED' ? 'var(--red)' : 'var(--brass)' }} data-testid="join-status">{status === 'APPROVED' ? L('已批准，可以登录了', 'Diluluskan', 'Approved, you can log in') : status === 'REJECTED' ? L('老板没有批准', 'Ditolak', 'Rejected') : L('还在等老板批准', 'Menunggu kelulusan', 'Waiting for approval')}</div>}
      <div style={{ width: '100%', maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
        <button className="btn btn-secondary" onClick={() => void check()} data-testid="join-check">{L('查看批准了没有', 'Semak status', 'Check status')}</button>
        <button className="btn btn-primary btn-xl" onClick={() => nav('/')}>{L('去登录', 'Ke log masuk', 'Go to login')}</button>
      </div>
    </div>{err && <ErrorScreen msg={err} onOk={() => setErr(null)} />}</div>
  );
  return (
    <Page>
      <TopBar title={L('申请加入', 'Mohon sertai', 'Request to join')} onBack={() => nav('/')} />
      {err && <ErrorScreen msg={err} onOk={() => setErr(null)} />}
      <div className="login">
        <input placeholder={L('公司代码（问老板）', 'Kod syarikat (tanya bos)', 'Company code (ask your boss)')} value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} autoCapitalize="characters" data-testid="join-code" />
        {shop && <div className="ok" style={{ color: 'var(--green)', fontWeight: 600 }} data-testid="join-shop">✓ {shop.name}</div>}
        {shop === false && <div style={{ color: 'var(--red)', fontSize: 'var(--fs-small)' }}>{L('找不到这个公司代码', 'Kod syarikat tidak dijumpai', 'Company code not found')}</div>}
        {shop && <>
          <input placeholder={L('你的名字', 'Nama anda', 'Your name')} value={f.name} onChange={(e) => set('name', e.target.value)} data-testid="join-name" />
          <input placeholder={L('手机号（登录用）', 'No. telefon (untuk log masuk)', 'Phone (used to log in)')} inputMode="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} data-testid="join-phone" />
          <div style={{ fontSize: 'var(--fs-small)', color: 'var(--muted)' }}>{L('想做的岗位', 'Jawatan', 'Role')}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>{shop.roles.map((r: string) => <button key={r} className={`btn ${f.role_code === r ? 'btn-primary' : 'btn-ghost'}`} onClick={() => set('role_code', r)} data-testid={`join-role-${r}`}>{ROLE[r]?.[li] ?? r}</button>)}</div>
          <input placeholder={L('设 6 位 PIN', 'Tetapkan PIN 6 digit', 'Set a 6-digit PIN')} inputMode="numeric" type="password" maxLength={6} value={f.pin} onChange={(e) => set('pin', e.target.value.replace(/\D/g, ''))} data-testid="join-pin" />
          <input placeholder={L('再输一次 PIN', 'Ulang PIN', 'Repeat PIN')} inputMode="numeric" type="password" maxLength={6} value={f.pin2} onChange={(e) => set('pin2', e.target.value.replace(/\D/g, ''))} data-testid="join-pin2" />
          <input placeholder={L('给老板的话（可不填）', 'Nota kepada bos (pilihan)', 'Note to the boss (optional)')} value={f.note} onChange={(e) => set('note', e.target.value)} />
          <button className="btn btn-primary btn-xl" disabled={!ok || busy} onClick={() => void submit()} data-testid="join-submit">{busy ? '…' : L('送出申请', 'Hantar permohonan', 'Send request')}</button>
        </>}
      </div>
    </Page>
  );
}
