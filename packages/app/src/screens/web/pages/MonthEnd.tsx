// 月结（模块 D）：检查清单（未关工单、未审批、负库存、未匹配发票、未提交电子发票、未提交合并发票、未日结钱箱）、锁定、已锁月份、解锁（老板）。
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../api/client.js';
import { useAuth } from '../../../store/auth.js';
import { errText, fmtDate, fmtMoney } from './_util.js';
const lastMonth = () => { const d = new Date(Date.now() + 8 * 3600_000); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); };

export default function MonthEnd() {
  const { has, isBoss, me } = useAuth();
  const [month, setMonth] = useState(lastMonth()); const [cl, setCl] = useState<any | null>(null); const [locks, setLocks] = useState<any[]>([]);
  const [msg, setMsg] = useState(''); const [ok, setOk] = useState(''); const [note, setNote] = useState('');
  const say = (t: string) => { setOk(t); setMsg(''); setTimeout(() => setOk(''), 5000); }; const fail = (e: any) => { setMsg(errText(e)); setOk(''); };
  const load = async () => { try { setCl(await api(`/period/${month}/checklist`)); setLocks(await api('/period/locks')); } catch (e) { fail(e); } };
  useEffect(() => { void load(); }, [month]);
  const lock = async (force: boolean) => {
    if (!window.confirm(`锁定 ${month}？锁定后该月的库存移动不能再新增或调整。${force ? '\n检查清单还有未完成项，确定强制锁定？' : ''}`)) return;
    try { await api(`/period/${month}/lock`, { body: { force, note: note || undefined } }); say(`${month} 已锁定`); await load(); } catch (e) { fail(e); }
  };
  const unlock = async (m: string) => { const reason = window.prompt(`解锁 ${m} 的原因（会记录审计）`); if (!reason) return; try { await api(`/period/${m}/unlock`, { body: { reason } }); say(`${m} 已解锁`); await load(); } catch (e) { fail(e); } };
  return (
    <div>
      <h1>月结</h1>
      {msg && <div className="err" style={{ marginBottom: 8 }}>{msg}</div>}{ok && <div className="ok" style={{ marginBottom: 8 }}>{ok}</div>}
      <div className="toolbar"><span>月份 <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></span><button className="btn btn-ghost" onClick={load}>刷新</button><span className="note">每月 1 日 02:00 系统自动提交合并电子发票、生成客户对账单、把损耗/周转/供应商准时率 Excel 发给老板。会计检查清单后锁定上月。</span></div>
      {cl && <>
        <div className="cards"><div className="stat"><div className="v">{cl.stats?.sales ?? 0}</div><div className="l">销售单数</div></div><div className="stat"><div className="v">{fmtMoney(cl.stats?.sales_total)}</div><div className="l">销售额 RM</div></div><div className="stat"><div className="v">{cl.stats?.invoices ?? 0}</div><div className="l">企业发票</div></div><div className="stat"><div className="v">{cl.stats?.movements ?? 0}</div><div className="l">库存移动</div></div><div className={`stat ${cl.locked ? '' : 'warn'}`}><div className="v">{cl.locked ? '已锁定' : cl.all_clear ? '可锁定' : '未清'}</div><div className="l">状态</div></div></div>
        <h2>检查清单 {month}</h2>
        <table data-testid="checklist"><thead><tr><th style={{ width: 40 }}></th><th>项目</th><th style={{ width: 100 }}>数量</th><th>说明</th><th style={{ width: 120 }}></th></tr></thead><tbody>
          {cl.items.map((i: any) => <tr key={i.key}><td style={{ fontSize: 18 }}>{i.count === 0 ? <span className="ok">✓</span> : <span className="err">✗</span>}</td><td>{i.label}</td><td className={i.count > 0 ? 'err' : 'ok'}><b>{i.count}</b></td><td className="note">{i.detail?.length ? i.detail.map((d: any) => d.site_code).join('、') : ''}</td><td>{i.count > 0 && i.link && <Link className="btn btn-ghost" to={`/w/${i.link}`}>去处理</Link>}</td></tr>)}
        </tbody></table>
        <div className="toolbar" style={{ marginTop: 12 }}>
          {cl.locked ? <span className="ok">已于 {fmtDate(cl.lock?.locked_at)} 由 {cl.lock?.locked_by_name ?? '—'} 锁定{cl.lock?.checklist?.forced ? '（强制）' : ''}</span>
            : !cl.is_past ? <span className="note">当前或未来月份不能锁定</span>
              : has('period.lock') && <><input placeholder="备注" value={note} onChange={(e) => setNote(e.target.value)} style={{ width: 240 }} />
                {cl.all_clear ? <button className="btn btn-primary" data-testid="lock" onClick={() => lock(false)}>锁定 {month}</button> : <button className="btn btn-danger" onClick={() => lock(true)}>清单未清，强制锁定</button>}</>}
          {cl.locked && (isBoss || me?.user.is_super_admin) && <button className="btn btn-danger" onClick={() => unlock(month)}>解锁（老板）</button>}
        </div>
      </>}
      <h2>已锁月份</h2>
      <table><thead><tr><th>月份</th><th>锁定时间</th><th>锁定人</th><th>清单</th><th></th></tr></thead><tbody>
        {locks.map((l) => <tr key={l.month}><td><b>{l.month}</b></td><td>{fmtDate(l.locked_at)}</td><td>{l.locked_by_name ?? '—'}</td><td className="note">{l.checklist?.all_clear ? '全部清' : `强制（${(l.checklist?.items ?? []).filter((i: any) => i.count > 0).map((i: any) => `${i.label} ${i.count}`).join('，')}）`}{l.checklist?.note ? ` · ${l.checklist.note}` : ''}</td><td>{(isBoss || me?.user.is_super_admin) && <button className="btn btn-ghost" onClick={() => unlock(l.month)}>解锁</button>}</td></tr>)}
        {locks.length === 0 && <tr><td colSpan={5} className="note">还没有锁定过的月份</td></tr>}
      </tbody></table>
    </div>
  );
}
