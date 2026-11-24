// 顾客当场自助登记（扫柜台二维码 /c/<公司代码>，不用登录）：会员（不做积分）、企业记账申请。电子发票资料可以存进会员资料。
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, ApiError } from '../../api/client.js';
import { useT } from '../../i18n/index.js';
import { Check, UserRound, Building2 } from 'lucide-react';
import './public.css';

export default function CustomerSelf() {
  const { code = '' } = useParams(); const { lang, setLang } = useT();
  const L = (zh: string, ms: string, en: string) => (lang === 'zh' ? zh : lang === 'ms' ? ms : en);
  const [shop, setShop] = useState<any>(null); const [tab, setTab] = useState<'member' | 'credit'>('member'); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [done, setDone] = useState<any>(null);
  const [m, setM] = useState({ name: '', phone: '', email: '', want_einv: false, tin: '', id_type: 'NRIC', id_no: '', address: '', consent: false });
  const [c, setC] = useState({ company_name: '', brn: '', tin: '', sst_no: '', address: '', contact_name: '', phone: '', email: '', requested_limit: '', requested_terms: '30', note: '', consent: false });
  useEffect(() => { api(`/public/shop/${encodeURIComponent(code)}`, { auth: false }).then(setShop).catch(() => setShop(false)); }, [code]);
  const msg = (e: any) => (e instanceof ApiError ? (e.code === 'DUPLICATE' ? L('这家公司已经申请过或已经开通记账', 'Syarikat ini sudah memohon atau sudah diluluskan', 'This company already applied or is already approved') : e.code === 'TOO_MANY_REQUESTS' ? L('太多次了，稍后再试', 'Terlalu banyak cubaan', 'Too many tries') : e.text(lang)) : String(e?.message ?? e));
  const submitMember = async () => { setBusy(true); setErr(''); try { const r = await api(`/public/shop/${code}/member`, { auth: false, body: { name: m.name, phone: m.phone, email: m.email || null, consent: true, einvoice: m.want_einv ? { tin: m.tin || null, id_type: m.id_type, id_no: m.id_no || null, address: m.address || null } : null } }); setDone({ kind: 'member', ...r }); } catch (e) { setErr(msg(e)); } finally { setBusy(false); } };
  const submitCredit = async () => { setBusy(true); setErr(''); try { await api(`/public/shop/${code}/credit-apply`, { auth: false, body: { ...c, brn: c.brn || null, tin: c.tin || null, sst_no: c.sst_no || null, note: c.note || null, requested_limit: Number(c.requested_limit), requested_terms: Number(c.requested_terms), consent: true } }); setDone({ kind: 'credit' }); } catch (e) { setErr(msg(e)); } finally { setBusy(false); } };
  const okM = m.name.trim() && m.phone.replace(/\D/g, '').length >= 8 && m.consent && (!m.want_einv || m.tin || m.id_no);
  const okC = c.company_name.trim().length >= 2 && (c.brn || c.tin) && c.address.trim().length >= 5 && c.contact_name.trim() && c.phone.replace(/\D/g, '').length >= 8 && /.+@.+\..+/.test(c.email) && Number(c.requested_limit) >= 100 && c.consent;
  const Lang = () => <div className="lang">{(['zh', 'ms', 'en'] as const).map((l) => <button key={l} className={lang === l ? 'on' : ''} onClick={() => setLang(l)}>{l === 'zh' ? '中文' : l === 'ms' ? 'BM' : 'EN'}</button>)}</div>;
  if (shop === false) return <div className="pub"><div className="pub-card"><Lang /><h2>{L('找不到这家店', 'Kedai tidak dijumpai', 'Shop not found')}</h2><p>{L('请再扫一次柜台的二维码', 'Sila imbas semula kod QR di kaunter', 'Please scan the counter QR again')}</p></div></div>;
  if (!shop) return <div className="pub"><div className="pub-card"><p>…</p></div></div>;
  return (
    <div className="pub"><div className="pub-card" data-testid="cs-card">
      <Lang />
      <div className="pub-shop"><span className="logo">{shop.name.slice(0, 1)}</span><div><b>{shop.name}</b><span>{L('顾客登记', 'Pendaftaran pelanggan', 'Customer sign-up')}</span></div></div>
      {done ? (
        <div className="done" data-testid="cs-done">
          <div className="ic"><Check size={30} /></div>
          {done.kind === 'member' ? <>
            <h2>{done.existing ? L('资料已更新', 'Maklumat dikemas kini', 'Details updated') : L('登记成功', 'Pendaftaran berjaya', 'You are signed up')}</h2>
            <p>{L('你的会员号', 'Nombor ahli anda', 'Your member number')}</p><div className="big" data-testid="cs-member-no">{done.member_no}</div>
            <p>{L('付款时跟收银员说你的手机号就可以。', 'Beritahu juruwang nombor telefon anda semasa bayar.', 'Tell the cashier your phone number when you pay.')}{m.want_einv ? L('要电子发票时会自动用你存的资料。', ' E-invois akan guna maklumat yang disimpan.', ' Your saved details will be used for e-invoices.') : ''}</p>
          </> : <>
            <h2>{L('申请已送出', 'Permohonan dihantar', 'Application sent')}</h2>
            <p>{L('老板审核后会联系你。批准后就可以在收银台记账，按月结算。', 'Pemilik akan menghubungi anda selepas menyemak. Selepas diluluskan anda boleh membeli secara kredit.', 'The owner will contact you after review. Once approved you can buy on credit and pay monthly.')}</p>
          </>}
        </div>
      ) : <>
        <div className="pub-tabs"><button className={tab === 'member' ? 'on' : ''} onClick={() => setTab('member')} data-testid="cs-tab-member"><UserRound size={14} /> {L('会员登记', 'Daftar ahli', 'Membership')}</button><button className={tab === 'credit' ? 'on' : ''} onClick={() => setTab('credit')} data-testid="cs-tab-credit"><Building2 size={14} /> {L('企业记账申请', 'Mohon kredit syarikat', 'Business credit')}</button></div>
        {tab === 'member' ? <>
          <p>{L('登记后付款报手机号就行，要电子发票不用每次填资料。', 'Selepas daftar, cuma beri nombor telefon semasa bayar.', 'After signing up, just give your phone number at checkout.')}</p>
          <label>{L('名字', 'Nama', 'Name')}<input value={m.name} onChange={(e) => setM({ ...m, name: e.target.value })} data-testid="cs-name" /></label>
          <label>{L('手机号', 'No. telefon', 'Phone')}<input inputMode="tel" value={m.phone} onChange={(e) => setM({ ...m, phone: e.target.value })} data-testid="cs-phone" /></label>
          <label>{L('电邮（可不填）', 'E-mel (pilihan)', 'Email (optional)')}<input inputMode="email" value={m.email} onChange={(e) => setM({ ...m, email: e.target.value })} /></label>
          <label className="check"><input type="checkbox" checked={m.want_einv} onChange={(e) => setM({ ...m, want_einv: e.target.checked })} data-testid="cs-want-einv" />{L('我常要电子发票，帮我存资料', 'Saya selalu perlukan e-invois, simpan maklumat saya', 'I often need e-invoices, save my details')}</label>
          {m.want_einv && <>
            <label>TIN {L('（税号，没有就填身份证）', '(atau no. pengenalan)', '(or ID number)')}<input value={m.tin} onChange={(e) => setM({ ...m, tin: e.target.value.toUpperCase() })} data-testid="cs-tin" /></label>
            <div className="row"><label>{L('证件类型', 'Jenis ID', 'ID type')}<select value={m.id_type} onChange={(e) => setM({ ...m, id_type: e.target.value })}><option value="NRIC">MyKad / NRIC</option><option value="PASSPORT">Passport</option><option value="BRN">BRN</option><option value="ARMY">Army</option></select></label><label>{L('证件号码', 'No. ID', 'ID number')}<input value={m.id_no} onChange={(e) => setM({ ...m, id_no: e.target.value })} /></label></div>
            <label>{L('地址（可不填）', 'Alamat (pilihan)', 'Address (optional)')}<input value={m.address} onChange={(e) => setM({ ...m, address: e.target.value })} /></label>
          </>}
          <label className="check"><input type="checkbox" checked={m.consent} onChange={(e) => setM({ ...m, consent: e.target.checked })} data-testid="cs-consent" />{L(`我同意 ${shop.name} 保存我的资料，只用于会员和开发票。`, `Saya bersetuju ${shop.name} menyimpan maklumat saya untuk keahlian dan invois sahaja.`, `I agree that ${shop.name} keeps my details for membership and invoices only.`)}</label>
          {err && <div className="err">{err}</div>}
          <button className="go" disabled={!okM || busy} onClick={() => void submitMember()} data-testid="cs-submit-member">{busy ? '…' : L('登记', 'Daftar', 'Sign up')}</button>
        </> : <>
          <p>{L('公司客户可以申请在收银台记账、按月付款。老板审核后会联系你。', 'Pelanggan syarikat boleh memohon akaun kredit. Pemilik akan menyemak.', 'Business customers can apply to buy on credit and pay monthly. The owner will review.')}</p>
          <label>{L('公司名', 'Nama syarikat', 'Company name')}<input value={c.company_name} onChange={(e) => setC({ ...c, company_name: e.target.value })} data-testid="cr-company" /></label>
          <div className="row"><label>BRN / SSM<input value={c.brn} onChange={(e) => setC({ ...c, brn: e.target.value })} data-testid="cr-brn" /></label><label>TIN<input value={c.tin} onChange={(e) => setC({ ...c, tin: e.target.value.toUpperCase() })} /></label></div>
          <label>{L('SST 号（可不填）', 'No. SST (pilihan)', 'SST no. (optional)')}<input value={c.sst_no} onChange={(e) => setC({ ...c, sst_no: e.target.value })} /></label>
          <label>{L('公司地址', 'Alamat syarikat', 'Company address')}<textarea value={c.address} onChange={(e) => setC({ ...c, address: e.target.value })} data-testid="cr-address" /></label>
          <div className="row"><label>{L('联系人', 'Orang hubungan', 'Contact person')}<input value={c.contact_name} onChange={(e) => setC({ ...c, contact_name: e.target.value })} data-testid="cr-contact" /></label><label>{L('手机号', 'No. telefon', 'Phone')}<input inputMode="tel" value={c.phone} onChange={(e) => setC({ ...c, phone: e.target.value })} data-testid="cr-phone" /></label></div>
          <label>{L('电邮（发票和对账单寄这里）', 'E-mel (untuk invois dan penyata)', 'Email (for invoices and statements)')}<input inputMode="email" value={c.email} onChange={(e) => setC({ ...c, email: e.target.value })} data-testid="cr-email" /></label>
          <div className="row"><label>{L('想要的信用额 RM', 'Had kredit RM', 'Credit limit RM')}<input inputMode="decimal" value={c.requested_limit} onChange={(e) => setC({ ...c, requested_limit: e.target.value.replace(/[^\d.]/g, '') })} data-testid="cr-limit" /></label><label>{L('付款期', 'Tempoh bayaran', 'Payment terms')}<select value={c.requested_terms} onChange={(e) => setC({ ...c, requested_terms: e.target.value })}>{[7, 14, 30, 60].map((d) => <option key={d} value={d}>{d} {L('天', 'hari', 'days')}</option>)}</select></label></div>
          <label>{L('备注（可不填）', 'Nota (pilihan)', 'Note (optional)')}<input value={c.note} onChange={(e) => setC({ ...c, note: e.target.value })} /></label>
          <label className="check"><input type="checkbox" checked={c.consent} onChange={(e) => setC({ ...c, consent: e.target.checked })} data-testid="cr-consent" />{L('以上资料正确，我同意按期付款。', 'Maklumat di atas betul dan saya bersetuju membayar mengikut tempoh.', 'The details above are correct and I agree to pay on time.')}</label>
          {err && <div className="err">{err}</div>}
          <button className="go" disabled={!okC || busy} onClick={() => void submitCredit()} data-testid="cr-submit">{busy ? '…' : L('送出申请', 'Hantar permohonan', 'Send application')}</button>
        </>}
      </>}
    </div></div>
  );
}
