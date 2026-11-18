// 外观设计：老板自己选预设、颜色、字体、圆角、首页排法，右边手机实时预览，保存后全公司生效
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../api/client.js';
import { useAuth, applyTheme } from '../../../store/auth.js';
import { THEME_PRESETS, DEFAULT_THEME, themeVars, type Theme } from '@wh/shared';
import { PackageOpen, ShoppingCart, ClipboardList, Search, ChevronRight } from 'lucide-react';

const SWATCH = ['#0E3B2B', '#0B6B3A', '#15803D', '#1D4ED8', '#7C3AED', '#B91C1C', '#C2410C', '#0F172A', '#B8894A', '#D99A1E', '#2563EB', '#DB2777'];
export default function ThemeEditor() {
  const { me, refreshMe } = useAuth();
  const [t, setT] = useState<Theme>({ ...DEFAULT_THEME, ...((me?.company.settings as any)?.theme ?? {}) });
  const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  const vars = useMemo(() => themeVars(t), [t]);
  const set = (patch: Partial<Theme>) => setT({ ...t, ...patch });
  const pick = (preset: Theme['preset']) => setT({ ...t, preset, primary: undefined, accent: undefined, paper: undefined, ink: undefined, ...THEME_PRESETS[preset].defaults });
  const save = async () => { setBusy(true); try { await api('/company/settings', { method: 'PUT', body: { settings: { theme: t } } }); applyTheme(t); await refreshMe(); setMsg('已保存，全公司手机下次打开生效'); } catch (e: any) { setMsg(e?.text?.('zh') ?? '保存失败'); } finally { setBusy(false); } };
  useEffect(() => { setMsg(''); }, [t]);
  const Phone = () => {
    const style = { ...Object.fromEntries(Object.entries(vars)), width: 300, height: 640, border: '1px solid #D8D2C2', boxShadow: '0 24px 70px rgba(21,32,26,.2)', background: 'var(--paper)', color: 'var(--ink)', overflow: 'hidden', fontFamily: 'var(--sans)', display: 'flex', flexDirection: 'column', fontSize: 16 } as any;
    const items = [['收货', 'Terima · Receive', PackageOpen, 0], ['补货', 'Isi semula · Refill', ShoppingCart, 12], ['盘点', 'Kira · Count', ClipboardList, 20], ['查询', 'Cari · Lookup', Search, 0]] as const;
    const tiles = t.home === 'tiles';
    return (
      <div style={style} data-home={t.home}>
        <div style={{ padding: '22px 22px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}><div><div style={{ fontSize: 11, letterSpacing: '.3em', fontWeight: 600 }}>{me?.company.name}</div><div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 5, letterSpacing: '.18em' }}>SHOP1 · ● 在线</div></div><div style={{ width: 30, height: 30, background: 'var(--green)', color: '#fff', display: 'grid', placeItems: 'center', fontFamily: 'var(--serif)', borderRadius: 'var(--radius-sm)' }}>店</div></div>
        <div style={{ padding: '18px 22px 0' }}><div style={{ fontSize: 10, letterSpacing: '.24em', color: 'var(--muted)', textTransform: 'uppercase' }}>11月18日 星期三</div><div style={{ fontFamily: 'var(--serif)', fontSize: 24, fontWeight: 600, marginTop: 6 }}>早安，阿明</div><div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>库存员</div></div>
        <div style={{ width: 22, height: 2, background: 'var(--brass)', margin: '12px 22px 0' }} />
        <div style={tiles ? { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, padding: '14px 22px' } : { padding: '12px 22px 0' }}>
          {items.map(([zh, ms, Ic, n], i) => tiles ? (
            <div key={zh} style={{ aspectRatio: '1', border: '1px solid var(--hair)', borderRadius: 'var(--radius)', background: i === 0 ? 'var(--green)' : 'var(--paper-dim)', color: i === 0 ? '#fff' : 'var(--ink)', padding: 12, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', position: 'relative' }}><Ic size={28} strokeWidth={1.6} /><div><div style={{ fontSize: 17, fontWeight: 600 }}>{zh}</div><div style={{ fontSize: 10, opacity: .75 }}>{ms}</div></div>{n > 0 && <div style={{ position: 'absolute', top: 10, right: 12, fontFamily: 'var(--serif)', fontSize: 20, color: i === 0 ? '#fff' : 'var(--brass)' }}>{n}</div>}</div>
          ) : (
            <div key={zh} style={{ display: 'flex', alignItems: 'center', gap: 14, minHeight: 66, borderTop: i === 0 ? '1px solid var(--hair)' : 0, borderBottom: '1px solid var(--hair)' }}><span style={{ fontFamily: 'var(--serif)', color: 'var(--muted)', width: 24, fontSize: 14 }}>{String(i + 1).padStart(2, '0')}</span><Ic size={24} strokeWidth={1.6} /><span style={{ flex: 1 }}><div style={{ fontSize: 17, fontWeight: 500 }}>{zh}</div><div style={{ fontSize: 11, color: 'var(--muted)' }}>{ms}</div></span>{n > 0 && <span style={{ fontFamily: 'var(--serif)', fontSize: 22, color: 'var(--brass)' }}>{n}</span>}<ChevronRight size={18} color="var(--stroke)" /></div>
          ))}
        </div>
        <div style={{ marginTop: 'auto', padding: '14px 22px 20px', display: 'flex', gap: 14, fontSize: 11, letterSpacing: '.14em', color: 'var(--muted)', fontWeight: 600 }}><span style={{ color: 'var(--ink)', borderBottom: '2px solid var(--brass)' }}>中文</span><span>BM</span><span>EN</span><span style={{ marginLeft: 'auto' }}>退出</span></div>
        <div style={{ padding: '0 22px 18px' }}><div style={{ background: 'var(--green)', color: '#fff', height: 52, display: 'grid', placeItems: 'center', fontWeight: 600, borderRadius: 'var(--radius)' }}>✓ 确认 24 件</div></div>
      </div>
    );
  };
  const Color = ({ label, k }: { label: string; k: 'primary' | 'accent' | 'paper' | 'ink' }) => (
    <label>{label}<div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 4 }}>
      {SWATCH.map((c) => <button key={c} onClick={() => set({ [k]: c })} title={c} style={{ width: 26, height: 26, background: c, border: (t[k] ?? '') === c ? '3px solid var(--brass)' : '1px solid #0002', cursor: 'pointer' }} />)}
      <input type="color" value={t[k] ?? (vars[k === 'primary' ? '--green' : k === 'accent' ? '--brass' : k === 'paper' ? '--paper' : '--ink'])} onChange={(e) => set({ [k]: e.target.value })} style={{ width: 44, minHeight: 28, padding: 0 }} />
      {t[k] && <button className="btn btn-ghost" style={{ minHeight: 28, fontSize: 12 }} onClick={() => set({ [k]: undefined })}>用预设</button>}
    </div></label>
  );
  return (
    <div>
      <h1>外观设计</h1>
      <p className="note" style={{ maxWidth: 720 }}>选一个预设再微调。改的只是颜色、字体、圆角和首页排法；按钮大小、字号、对比度这些老人规则不会变。保存后全公司的手机和网页下次打开生效。</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: 32, alignItems: 'start', marginTop: 18 }}>
        <div>
          <h2>预设</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
            {(Object.keys(THEME_PRESETS) as Theme['preset'][]).map((p) => { const pr = THEME_PRESETS[p]; return <button key={p} onClick={() => pick(p)} style={{ textAlign: 'left', padding: 12, border: t.preset === p ? '2px solid var(--brass)' : '1px solid var(--hair)', background: pr.vars['--paper'], color: pr.vars['--ink'], cursor: 'pointer' }}><div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>{['--green', '--brass', '--paper-dim', '--ink'].map((k) => <i key={k} style={{ width: 18, height: 18, background: pr.vars[k], display: 'block', border: '1px solid #0002' }} />)}</div><b>{pr.name_zh}</b><div style={{ fontSize: 12, opacity: .7 }}>{pr.name_en}</div></button>; })}
          </div>
          <h2>颜色</h2>
          <div className="form"><Color label="主色（确认按钮、品牌）" k="primary" /><Color label="点缀色（角标、横条）" k="accent" /><Color label="底色" k="paper" /><Color label="文字色" k="ink" /></div>
          <h2>字体、圆角、排法</h2>
          <div className="form">
            <label>标题和数字字体<select value={t.font} onChange={(e) => set({ font: e.target.value as any })}><option value="serif">衬线（Fraunces 加思源宋体，高端）</option><option value="sans">黑体（Inter 加思源黑体，清晰）</option><option value="round">圆体（Nunito，亲切）</option></select></label>
            <label>圆角<select value={t.radius} onChange={(e) => set({ radius: Number(e.target.value) as any })}><option value={0}>方角（0）</option><option value={12}>小圆角（12）</option><option value={20}>大圆角（20）</option></select></label>
            <label>首页排法<select value={t.home} onChange={(e) => set({ home: e.target.value as any })}><option value="list">编号清单（一行一项）</option><option value="tiles">四格瓷砖（2 × 2）</option></select></label>
            <label>按钮高度<select value={t.density} onChange={(e) => set({ density: e.target.value as any })}><option value="normal">标准 72px</option><option value="large">加大 84px</option></select></label>
          </div>
          <div className="toolbar" style={{ marginTop: 20 }}><button className="btn btn-primary" onClick={save} disabled={busy}>保存并应用到全公司</button><button className="btn btn-ghost" onClick={() => pick('minimal')}>恢复默认</button><span className={msg.includes('失败') ? 'err' : 'ok'}>{msg}</span></div>
          <div className="note" style={{ marginTop: 10 }}>想要完全自定义的设计稿？把 Figma、Penpot 或 Muse 导出的 HTML 发给开发，按它改代码。这个页面只覆盖日常能自己改的部分。</div>
        </div>
        <div style={{ position: 'sticky', top: 20 }}><h2>实时预览</h2><Phone /></div>
      </div>
    </div>
  );
}
