import { useState } from 'react';
import { api } from '../../../api/client.js';
import { errText } from './_util.js';
const ZONES = ['A', 'B', 'C', 'D', 'E', 'F'];
const DEF: Record<string, [number, number]> = { A: [6, 4], B: [6, 4], C: [6, 4], D: [4, 2], E: [4, 3], F: [3, 4] };
export default function AdminWizard() {
  const [step, setStep] = useState(1); const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  const [f, setF] = useState<any>({ name: '', short_code: '', plan: 'A', tin: '', sst_no: '', address: '', boss_name: '', boss_phone: '', boss_email: '', boss_pin: '' });
  const [zo, setZo] = useState<Record<string, [number, number]>>({ ...DEF }); const [adjust, setAdjust] = useState(false);
  const [result, setResult] = useState<any | null>(null);
  const create = async () => {
    setBusy(true); setMsg('');
    try {
      const body: any = { name: f.name, short_code: f.short_code.toUpperCase(), plan: f.plan, tin: f.tin || null, sst_no: f.sst_no || null, address: f.address ? { line1: f.address } : undefined, boss_name: f.boss_name, boss_phone: f.boss_phone, boss_email: f.boss_email || null, zone_overrides: {} };
      if (f.boss_pin) body.boss_pin = f.boss_pin;
      if (f.plan === 'A' && adjust) for (const z of ZONES) body.zone_overrides[z] = { racks: zo[z][0], levels: zo[z][1] };
      const r = await api('/admin/companies', { body }); setResult(r); setStep(2);
    } catch (e) { setMsg(errText(e)); } finally { setBusy(false); }
  };
  const enter = async () => { try { const r = await api(`/admin/companies/${result.company_id}/enter`, { method: 'POST' }); localStorage.setItem('wh.access', r.access_token); location.href = step === 3 ? '/w/import' : step === 4 ? '/w/locations' : step === 5 ? '/w/users' : '/w/locations'; } catch (e) { setMsg(errText(e)); } };
  const valid = f.name && /^[A-Z0-9]{3,8}$/.test(f.short_code.toUpperCase()) && f.boss_name && f.boss_phone.length >= 6 && (!f.boss_pin || /^[0-9]{6}$/.test(f.boss_pin));
  const F = (k: string, label: string, extra: any = {}) => <label>{label}<input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...extra} /></label>;
  return (
    <div>
      <h1>开店向导</h1>
      <div className="step">{['建公司', '调整店面', '导入 Excel', '打标签', '加员工'].map((s, i) => <><span key={i} className={i + 1 <= step ? 'on' : ''}>{i + 1}</span><b style={{ marginRight: 12 }}>{s}</b></>)}</div>
      {msg && <div className="err" style={{ marginBottom: 8 }}>{msg}</div>}
      {step === 1 && <>
        <div className="form">
          {F('name', '店名 / 公司名')}{F('short_code', '公司代码（3-8 位大写字母数字，员工卡和登录用）', { maxLength: 8, style: { textTransform: 'uppercase' } })}
          <label>模式<select value={f.plan} onChange={(e) => setF({ ...f, plan: e.target.value })}><option value="A">A 小型商店（一家店，模板固定）</option><option value="B">B 中型公司（仓库加多店）</option></select></label>
          {F('tin', '税号 TIN')}{F('sst_no', 'SST 号')}{F('address', '地址')}
          {F('boss_name', '老板姓名')}{F('boss_phone', '老板手机（登录用）')}{F('boss_email', '老板电邮（网页登录，可空）')}{F('boss_pin', '老板 PIN（6 位，留空自动生成）', { maxLength: 6 })}
        </div>
        {f.plan === 'A' && <>
          <h2>店面区的架数和层数 <label style={{ fontSize: 13 }}><input type="checkbox" checked={adjust} onChange={(e) => setAdjust(e.target.checked)} style={{ width: 'auto', minHeight: 0 }} /> 自定义（不勾用模板默认）</label></h2>
          {adjust && <table style={{ maxWidth: 600 }}><thead><tr><th>区</th><th>架数（1-20）</th><th>层数（1-6）</th><th>货位数</th></tr></thead><tbody>{ZONES.map((z) => <tr key={z}><td>{z}</td><td><input type="number" min={1} max={20} value={zo[z][0]} onChange={(e) => setZo({ ...zo, [z]: [Number(e.target.value), zo[z][1]] })} style={{ width: 80 }} /></td><td><input type="number" min={1} max={6} value={zo[z][1]} onChange={(e) => setZo({ ...zo, [z]: [zo[z][0], Number(e.target.value)] })} style={{ width: 80 }} /></td><td>{zo[z][0] * zo[z][1]}</td></tr>)}</tbody></table>}
          <div className="note">后仓 S-01 到 S-06 由模板固定。类别 12 个、税码 4 个、角色 3 个自动建立。</div>
        </>}
        <div className="toolbar" style={{ marginTop: 14 }}><button className="btn btn-primary" onClick={create} disabled={!valid || busy}>建立公司</button></div>
      </>}
      {step >= 2 && result && <div style={{ background: '#FFF8E1', border: '2px solid var(--yellow)', borderRadius: 10, padding: 16, marginBottom: 16 }}>
        <h2>公司已建立：{f.name}（{f.short_code.toUpperCase()}）</h2>
        <div>老板 PIN：<span style={{ fontSize: 40, fontWeight: 800, letterSpacing: 6 }}>{result.boss_pin}</span></div>
        <div>老板员工卡二维码内容：<code style={{ fontSize: 18 }}>{result.boss_badge}</code></div>
        <div className="err">PIN 只显示这一次，请马上交给老板。老板也可以用公司代码加手机号加 PIN 登录。</div>
      </div>}
      {step === 2 && <><h2>第 2 步 调整店面（可跳过）</h2><p>进入公司后，在"位置和区管理"里改每个区的架数和层数，有库存的货位不能删。现在先用模板默认也可以，开店后再调。</p><div className="toolbar"><button className="btn btn-ghost" onClick={enter}>进入该公司调整</button><button className="btn btn-primary" onClick={() => setStep(3)}>跳过，下一步</button></div></>}
      {step === 3 && <><h2>第 3 步 导入 Excel</h2><p>进入公司后，在"Excel 导入"下载开店全套模板，老板填好产品、供应商后上传，看预览，批准执行。建议期初库存改为开店后做一次全盘点，不要从 Excel 导。</p><div className="toolbar"><button className="btn btn-ghost" onClick={enter}>进入该公司导入</button><button className="btn btn-primary" onClick={() => setStep(4)}>下一步</button></div></>}
      {step === 4 && <><h2>第 4 步 打标签</h2><p>进入公司后，在"位置和区管理"按每个区的"打印标签"生成 PDF，用蓝牙标签打印机打出来贴到货架和后仓。店面 70×40 mm，后仓 100×50 mm。</p><div className="toolbar"><button className="btn btn-ghost" onClick={enter}>进入该公司打标签</button><button className="btn btn-primary" onClick={() => setStep(5)}>下一步</button></div></>}
      {step === 5 && <><h2>第 5 步 加员工</h2><p>进入公司后，在"用户管理"加收银员和库存员（最多 10 人），每人系统生成 6 位 PIN，打印员工卡。员工用手机扫员工卡加 PIN 登录。</p><div className="toolbar"><button className="btn btn-primary" onClick={enter}>进入该公司加员工</button><a className="btn btn-ghost" href="/w/admin/companies">回公司列表</a></div></>}
    </div>
  );
}
