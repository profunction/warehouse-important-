import { useEffect, useState } from 'react';
import { api } from '../../../api/client.js';
import { errText } from './_util.js';
export default function CompanySettings() {
  const [c, setC] = useState<any | null>(null); const [s, setS] = useState<any>({}); const [msg, setMsg] = useState('');
  useEffect(() => { api('/company').then((r) => { setC(r); setS(r.settings ?? {}); }).catch((e) => setMsg(errText(e))); }, []);
  if (!c) return <div>{msg || '加载中…'}</div>;
  const save = async () => {
    try {
      const r = await api('/company/settings', { method: 'PUT', body: { name: c.name, tin: c.tin || null, sst_no: c.sst_no || null, msic_code: c.msic_code || null, telegram_chat_id: c.telegram_chat_id || null, address: c.address ?? undefined, settings: { order_proposal_time: s.order_proposal_time, approval_threshold_count_variance: Number(s.approval_threshold_count_variance) || 0, approval_threshold_adjust: Number(s.approval_threshold_adjust) || 0, approval_threshold_payment: Number(s.approval_threshold_payment) || 0, cashier_discount_max_pct: Number(s.cashier_discount_max_pct) || 0, pos_terminal_count: Number(s.pos_terminal_count) || 1, scale_barcode_format: s.scale_barcode_format } } });
      setS(r.settings); setMsg('已保存');
    } catch (e) { setMsg(errText(e)); }
  };
  const sf = s.scale_barcode_format ?? { prefix: '2', plu_len: 5, weight_len: 5, unit: 'g' };
  const setSf = (k: string, v: any) => setS({ ...s, scale_barcode_format: { ...sf, [k]: v } });
  return (
    <div>
      <h1>公司设定</h1>
      <div className="note" style={{ marginBottom: 10 }}>模式：{c.plan === 'A' ? 'A 小型商店' : 'B 中型公司'} · 代码 {c.short_code} · 货币 {c.currency} · 时区 {c.timezone}。模式和功能开关由超级管理员设定。</div>
      <h2>基本资料</h2>
      <div className="form">
        <label>公司名<input value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} /></label>
        <label>税号 TIN<input value={c.tin ?? ''} onChange={(e) => setC({ ...c, tin: e.target.value })} /></label>
        <label>SST 号<input value={c.sst_no ?? ''} onChange={(e) => setC({ ...c, sst_no: e.target.value })} /></label>
        <label>MSIC 行业代码（5 位）<input value={c.msic_code ?? ''} onChange={(e) => setC({ ...c, msic_code: e.target.value })} maxLength={5} /></label>
        <label>Telegram 群/聊天 ID（第二阶段）<input value={c.telegram_chat_id ?? ''} onChange={(e) => setC({ ...c, telegram_chat_id: e.target.value })} /></label>
      </div>
      <h2>审批门槛和规则</h2>
      <div className="form">
        <label>每日订货建议时间<input type="time" value={s.order_proposal_time ?? '08:00'} onChange={(e) => setS({ ...s, order_proposal_time: e.target.value })} /></label>
        <label>盘点差异需老板批的金额（0 = 全部）<input type="number" value={s.approval_threshold_count_variance ?? 0} onChange={(e) => setS({ ...s, approval_threshold_count_variance: e.target.value })} /></label>
        <label>手动调整需老板批的金额<input type="number" value={s.approval_threshold_adjust ?? 0} onChange={(e) => setS({ ...s, approval_threshold_adjust: e.target.value })} /></label>
        <label>付款需老板批的金额<input type="number" value={s.approval_threshold_payment ?? 0} onChange={(e) => setS({ ...s, approval_threshold_payment: e.target.value })} /></label>
        <label>收银员折扣上限 %（0-20）<input type="number" min={0} max={20} value={s.cashier_discount_max_pct ?? 5} onChange={(e) => setS({ ...s, cashier_discount_max_pct: e.target.value })} /></label>
        <label>收银机数量<input type="number" min={1} max={5} value={s.pos_terminal_count ?? 2} onChange={(e) => setS({ ...s, pos_terminal_count: e.target.value })} /></label>
      </div>
      <h2>称重条码格式</h2>
      <div className="form">
        <label>前缀<input value={sf.prefix} onChange={(e) => setSf('prefix', e.target.value)} maxLength={2} /></label>
        <label>PLU 位数<input type="number" value={sf.plu_len} onChange={(e) => setSf('plu_len', Number(e.target.value))} /></label>
        <label>重量位数<input type="number" value={sf.weight_len} onChange={(e) => setSf('weight_len', Number(e.target.value))} /></label>
        <label>单位<select value={sf.unit} onChange={(e) => setSf('unit', e.target.value)}><option value="g">克</option><option value="kg">公斤（千分之一）</option><option value="price">价格（分）</option></select></label>
      </div>
      <div className="note">例：前缀 2，PLU 5 位，重量 5 位（克）。条码 2 00123 01250 X = PLU 00123，1.250 公斤。</div>
      <div className="toolbar" style={{ marginTop: 14 }}><button className="btn btn-primary" onClick={save}>保存</button><span className={msg === '已保存' ? 'ok' : 'err'}>{msg}</span></div>
    </div>
  );
}
