// 顾客扫收据二维码自己开电子发票（/e/<公司代码>/<收据号>?t=签名，不用登录）。72 小时内有效。
import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../../api/client.js';
import { useT } from '../../i18n/index.js';
import { Check, FileText, Clock } from 'lucide-react';
import './public.css';

export default function ReceiptEinvoice() {
  const { code = '', receipt = '' } = useParams(); const [sp] = useSearchParams(); const t = sp.get('t') ?? ''; const { lang, setLang } = useT();
  const L = (zh: string, ms: string, en: string) => (lang === 'zh' ? zh : lang === 'ms' ? ms : en);
  const [info, setInfo] = useState<any>(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [done, setDone] = useState<string | null>(null);
  const [f, setF] = useState({ kind: 'person' as 'person' | 'company', name: '', email: '', tin: '', id_type: 'NRIC', id_no: '', address: '', sst_no: '', phone: '', save: false });
  const base = `/public/receipt/${encodeURIComponent(code)}/${encodeURIComponent(receipt)}?t=${encodeURIComponent(t)}`;
  useEffect(() => { api(base, { auth: false }).then(setInfo).catch(() => setInfo(false)); }, [base]);
  const ok = f.name.trim() && /.+@.+\..+/.test(f.email) && (f.tin || f.id_no) && (!f.save || f.phone.replace(/\D/g, '').length >= 8);
  const submit = async () => {
    setBusy(true); setErr('');
    try { const r = await api(`/public/receipt/${encodeURIComponent(code)}/${encodeURIComponent(receipt)}/einvoice?t=${encodeURIComponent(t)}`, { auth: false, body: { name: f.name, email: f.email, tin: f.tin || null, id_type: f.kind === 'company' ? 'BRN' : f.id_type, id_no: f.id_no || null, address: f.address || null, sst_no: f.sst_no || null, phone: f.phone || null, save_as_member: f.save } }); setDone(r.status); }
    catch (e: any) { setErr(e instanceof ApiError ? (e.code === 'DUPLICATE' ? L('这张收据已经开过电子发票了', 'Resit ini sudah ada e-invois', 'This receipt already has an e-invoice') : e.text(lang)) : String(e?.message ?? e)); }
    finally { setBusy(false); }
  };
  const Lang = () => <div className="lang">{(['zh', 'ms', 'en'] as const).map((l) => <button key={l} className={lang === l ? 'on' : ''} onClick={() => setLang(l)}>{l === 'zh' ? '中文' : l === 'ms' ? 'BM' : 'EN'}</button>)}</div>;
  if (info === false) return <div className="pub"><div className="pub-card"><Lang /><h2>{L('收据链接不对', 'Pautan resit tidak sah', 'Invalid receipt link')}</h2><p>{L('请再扫一次收据上的二维码，或请收银员帮你开。', 'Sila imbas semula kod QR pada resit atau minta juruwang.', 'Please scan the receipt QR again or ask the cashier.')}</p></div></div>;
  if (!info) return <div className="pub"><div className="pub-card"><p>…</p></div></div>;
  return (
    <div className="pub"><div className="pub-card" data-testid="ei-card">
      <Lang />
      <div className="pub-shop"><span className="logo"><FileText size={20} /></span><div><b>{info.shop}</b><span>{L('电子发票', 'E-invois', 'e-Invoice')} · MyInvois</span></div></div>
      <div className="sum"><span>{L('收据', 'Resit', 'Receipt')} {info.receipt_no}<br /><small style={{ color: 'var(--muted)' }}>{new Date(info.sold_at).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-MY')}</small></span><b>RM {info.total.toFixed(2)}</b></div>
      {done || info.submitted ? (
        <div className="done" data-testid="ei-done"><div className="ic"><Check size={30} /></div><h2>{L('已提交电子发票', 'E-invois dihantar', 'e-Invoice submitted')}</h2><p>{['FAILED', 'INVALID'].includes(done ?? info.einvoice_status) ? L('资料已收到，店家会核对后补开，完成后寄到你的电邮。', 'Maklumat diterima, kedai akan menyemak dan menghantar e-invois ke e-mel anda.', 'Details received; the shop will check and email you the e-invoice.') : (done ?? info.einvoice_status) === 'VALID' ? L('税务局已验证，发票会寄到你的电邮。', 'Telah disahkan LHDN, invois akan dihantar ke e-mel anda.', 'Validated by LHDN. The invoice will be emailed to you.') : L('正在提交给税务局，完成后寄到你的电邮。', 'Sedang dihantar ke LHDN.', 'Being sent to LHDN; you will get it by email.')}</p></div>
      ) : info.expired ? (
        <div className="done"><div className="ic" style={{ color: 'var(--brass)' }}><Clock size={30} /></div><h2>{L('已经超过 72 小时', 'Melebihi 72 jam', 'Over 72 hours')}</h2><p>{L('按规定这张收据会并入月底的合并电子发票，不能再单独开。', 'Mengikut peraturan, resit ini dimasukkan dalam e-invois disatukan.', 'By the rules this receipt goes into the monthly consolidated e-invoice.')}</p></div>
      ) : <>
        <p>{L(`请在 ${new Date(info.deadline).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-MY')} 之前填好（72 小时内）。`, `Isi sebelum ${new Date(info.deadline).toLocaleString('en-MY')} (dalam 72 jam).`, `Fill this in before ${new Date(info.deadline).toLocaleString('en-MY')} (within 72 hours).`)}</p>
        <div className="pub-tabs"><button className={f.kind === 'person' ? 'on' : ''} onClick={() => setF({ ...f, kind: 'person' })}>{L('个人', 'Individu', 'Individual')}</button><button className={f.kind === 'company' ? 'on' : ''} onClick={() => setF({ ...f, kind: 'company' })} data-testid="ei-company">{L('公司', 'Syarikat', 'Company')}</button></div>
        <label>{f.kind === 'company' ? L('公司名', 'Nama syarikat', 'Company name') : L('名字（跟证件一样）', 'Nama (seperti dalam ID)', 'Name (as in ID)')}<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-testid="ei-name" /></label>
        <label>TIN<input value={f.tin} onChange={(e) => setF({ ...f, tin: e.target.value.toUpperCase() })} placeholder={f.kind === 'company' ? 'C1234567890' : 'IG1234567890'} data-testid="ei-tin" /></label>
        {f.kind === 'person'
          ? <div className="row"><label>{L('证件类型', 'Jenis ID', 'ID type')}<select value={f.id_type} onChange={(e) => setF({ ...f, id_type: e.target.value })}><option value="NRIC">MyKad / NRIC</option><option value="PASSPORT">Passport</option><option value="ARMY">Army</option></select></label><label>{L('证件号码', 'No. ID', 'ID number')}<input value={f.id_no} onChange={(e) => setF({ ...f, id_no: e.target.value })} data-testid="ei-idno" /></label></div>
          : <div className="row"><label>BRN / SSM<input value={f.id_no} onChange={(e) => setF({ ...f, id_no: e.target.value })} /></label><label>{L('SST 号', 'No. SST', 'SST no.')}<input value={f.sst_no} onChange={(e) => setF({ ...f, sst_no: e.target.value })} /></label></div>}
        <label>{L('电邮（发票寄这里）', 'E-mel (invois dihantar ke sini)', 'Email (invoice goes here)')}<input inputMode="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} data-testid="ei-email" /></label>
        <label>{L('地址（可不填）', 'Alamat (pilihan)', 'Address (optional)')}<input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></label>
        <label className="check"><input type="checkbox" checked={f.save} onChange={(e) => setF({ ...f, save: e.target.checked })} data-testid="ei-save" />{L('存成会员资料，下次报手机号就自动开', 'Simpan sebagai ahli, lain kali cuma beri nombor telefon', 'Save as member so next time I only give my phone number')}</label>
        {f.save && <label>{L('手机号', 'No. telefon', 'Phone')}<input inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} data-testid="ei-phone" /></label>}
        {err && <div className="err">{err}</div>}
        <button className="go" disabled={!ok || busy} onClick={() => void submit()} data-testid="ei-submit">{busy ? '…' : L('开电子发票', 'Hantar e-invois', 'Get e-invoice')}</button>
      </>}
    </div></div>
  );
}
