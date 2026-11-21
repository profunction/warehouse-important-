// 对接与密钥：API 密钥（Pandal / 大屏 / POS）、Telegram 机器人、我的 Telegram 绑定、Pandal 拉取、MyInvois 入口
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../api/client.js';
import { useAuth } from '../../../store/auth.js';
import { errText, fmtDate } from './_util.js';
const SCOPE_ZH: Record<string, string> = { OPEN: '开放接口（Pandal 等）', KIOSK: '顾客大屏', POS: '收银机' };
export default function Integrations() {
  const { me } = useAuth();
  const [keys, setKeys] = useState<any[]>([]); const [sites, setSites] = useState<any[]>([]); const [msg, setMsg] = useState('');
  const [nk, setNk] = useState({ name: '', scope: 'KIOSK', site_id: '' }); const [created, setCreated] = useState<any>(null);
  const [tg, setTg] = useState<any>(null); const [tgForm, setTgForm] = useState({ bot_token: '', chat_id: '', bot_username: '' }); const [tgRes, setTgRes] = useState<any>(null);
  const [link, setLink] = useState<any>(null); const [linkCode, setLinkCode] = useState<any>(null);
  const [company, setCompany] = useState<any>(null); const [pandal, setPandal] = useState({ pandal_api_url: '', pandal_api_key: '' });
  const load = async () => {
    try { setKeys(await api('/api-keys')); } catch (e) { setMsg(errText(e)); }
    api('/sites').then(setSites).catch(() => {});
    api('/company/telegram').then((t) => { setTg(t); setTgForm((f) => ({ ...f, chat_id: t.chat_id ?? '', bot_username: t.bot_username ?? '' })); }).catch(() => {});
    api('/me/telegram-link').then(setLink).catch(() => {});
    api('/company').then((c) => { setCompany(c); setPandal({ pandal_api_url: c.settings?.pandal_api_url ?? '', pandal_api_key: c.settings?.pandal_api_key ? '••••••' : '' }); }).catch(() => {});
  };
  useEffect(() => { void load(); }, []);
  const createKey = async () => { try { const r = await api('/api-keys', { body: { name: nk.name || SCOPE_ZH[nk.scope], scope: nk.scope, site_id: nk.site_id || null } }); setCreated(r); setNk({ name: '', scope: 'KIOSK', site_id: '' }); await load(); } catch (e) { setMsg(errText(e)); } };
  const disable = async (k: any) => { if (!confirm(`停用密钥「${k.name}」？用它的设备会立刻断开。`)) return; try { await api(`/api-keys/${k.id}/disable`, { method: 'POST' }); await load(); } catch (e) { setMsg(errText(e)); } };
  const saveTg = async () => { try { const r = await api('/company/telegram', { body: { bot_token: tgForm.bot_token || undefined, chat_id: tgForm.chat_id || undefined, bot_username: tgForm.bot_username || undefined } }); setTgRes(r); setTgForm((f) => ({ ...f, bot_token: '' })); await load(); } catch (e) { setMsg(errText(e)); } };
  const genLink = async () => { try { setLinkCode(await api('/me/telegram-link', { method: 'POST' })); } catch (e) { setMsg(errText(e)); } };
  const savePandal = async () => { try { const settings: any = { pandal_api_url: pandal.pandal_api_url || null }; if (pandal.pandal_api_key && !pandal.pandal_api_key.startsWith('••')) settings.pandal_api_key = pandal.pandal_api_key; await api('/company/settings', { method: 'PUT', body: { settings } }); setMsg('Pandal 设定已保存，每 5 分钟自动拉取'); } catch (e) { setMsg(errText(e)); } };
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return (
    <div>
      <h1>对接与密钥</h1>
      {msg && <div className={msg.includes('已保存') ? 'ok' : 'err'}>{msg}</div>}

      <h2>API 密钥（大屏、收银机、Pandal 等外部系统）</h2>
      <div className="toolbar">
        <input placeholder="名称，例如 门口大屏" value={nk.name} onChange={(e) => setNk({ ...nk, name: e.target.value })} style={{ width: 220 }} />
        <select value={nk.scope} onChange={(e) => setNk({ ...nk, scope: e.target.value })}>{Object.entries(SCOPE_ZH).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select value={nk.site_id} onChange={(e) => setNk({ ...nk, site_id: e.target.value })}><option value="">{nk.scope === 'KIOSK' ? '选店（大屏必须绑店）' : '全公司'}</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.code} {s.name}</option>)}</select>
        <button className="btn btn-primary" onClick={createKey} disabled={nk.scope === 'KIOSK' && !nk.site_id}>生成密钥</button>
      </div>
      {created && <div className="form" style={{ border: '1px solid var(--brass)', padding: 14, marginBottom: 14, gridTemplateColumns: '1fr' }}>
        <div><b>密钥只显示这一次，请现在复制：</b></div>
        <pre style={{ fontSize: 14, userSelect: 'all', maxHeight: 'none' }}>{created.key}</pre>
        {created.scope === 'KIOSK' && <div className="note">大屏浏览器全屏打开：<code style={{ userSelect: 'all' }}>{origin}/kiosk?key={created.key}</code></div>}
        {created.scope === 'OPEN' && <div className="note">外部系统每次请求带 header <code>x-api-key</code>。接口文档：<a href="/api/v1/docs" target="_blank" rel="noreferrer">{origin}/api/v1/docs</a></div>}
        <div><button className="btn btn-ghost" onClick={() => setCreated(null)}>已复制，关闭</button></div>
      </div>}
      <table><thead><tr><th>名称</th><th>用途</th><th>店</th><th>前缀</th><th>最后使用</th><th>状态</th><th></th></tr></thead><tbody>
        {keys.map((k) => <tr key={k.id}><td>{k.name}</td><td>{SCOPE_ZH[k.scope] ?? k.scope}</td><td>{k.site_code ?? '全公司'}</td><td><code>wh_{k.key_prefix}…</code></td><td>{fmtDate(k.last_used_at)}</td><td><span className="pill" style={{ background: k.is_active ? '#1B8A3A' : '#9E9E9E' }}>{k.is_active ? '启用' : '已停用'}</span></td><td>{k.is_active && <button className="btn btn-ghost" onClick={() => disable(k)}>停用</button>}</td></tr>)}
        {keys.length === 0 && <tr><td colSpan={7} className="note">还没有密钥</td></tr>}
      </tbody></table>

      <h2>Telegram 机器人（老板审批按钮、每日订货、日报、工单提醒）</h2>
      <div className="note" style={{ marginBottom: 10 }}>{tg?.configured ? <span className="ok">已配置 · 机器人 {tg.bot_token_masked}{tg.bot_username ? ` · @${tg.bot_username}` : ''} · 群 {tg.chat_id}</span> : '未配置：消息会先放到"通知"页。'}　做法：在 Telegram 找 @BotFather 发 /newbot 拿到 token；把机器人拉进老板群，用 @userinfobot 或 getUpdates 拿群 chat_id（负数）。</div>
      <div className="form">
        <label>Bot token<input placeholder={tg?.bot_token_masked ? '已保存，留空不改' : '123456:ABC…'} value={tgForm.bot_token} onChange={(e) => setTgForm({ ...tgForm, bot_token: e.target.value })} /></label>
        <label>群 chat_id<input placeholder="-1001234567890" value={tgForm.chat_id} onChange={(e) => setTgForm({ ...tgForm, chat_id: e.target.value })} /></label>
        <label>机器人用户名（给员工绑定用）<input placeholder="warehouseshop_bot" value={tgForm.bot_username} onChange={(e) => setTgForm({ ...tgForm, bot_username: e.target.value })} /></label>
      </div>
      <div className="toolbar" style={{ marginTop: 10 }}><button className="btn btn-primary" onClick={saveTg}>保存并设置 webhook</button>{tgRes && <span className={tgRes.webhook?.set ? 'ok' : 'note'}>{tgRes.webhook?.set ? `webhook 已设置：${tgRes.webhook.url}` : `已保存。webhook 未设置（${tgRes.webhook?.error ?? '服务器需要公网地址 PUBLIC_URL'}），按钮回调要有公网地址才能用`}</span>}</div>
      <div className="form" style={{ marginTop: 14 }}>
        <label>我的 Telegram 绑定<div>{link?.bound ? <span className="ok">已绑定</span> : <span className="note">未绑定</span>} <button className="btn btn-ghost" onClick={genLink}>生成绑定码</button></div>
          {linkCode && <div className="note" style={{ marginTop: 6 }}>15 分钟内在 Telegram 给机器人发：<code style={{ userSelect: 'all' }}>/start {linkCode.code}</code>{linkCode.deep_link && <> 或点 <a href={linkCode.deep_link} target="_blank" rel="noreferrer">{linkCode.deep_link}</a></>}</div>}</label>
      </div>

      <h2>Pandal 收银系统（B 模式，每 5 分钟拉取交易）</h2>
      {company && !company.feature_flags?.pandal && <div className="note" style={{ marginBottom: 8 }}>本公司未开通 Pandal 对接（超管在公司列表的"开关"里打开 pandal）。</div>}
      <div className="form">
        <label>Pandal API 地址<input placeholder="https://api.pandal.example/v1" value={pandal.pandal_api_url} onChange={(e) => setPandal({ ...pandal, pandal_api_url: e.target.value })} /></label>
        <label>Pandal API 密钥<input placeholder="留空不改" value={pandal.pandal_api_key} onChange={(e) => setPandal({ ...pandal, pandal_api_key: e.target.value })} /></label>
      </div>
      <div className="toolbar" style={{ marginTop: 10 }}><button className="btn btn-primary" onClick={savePandal}>保存</button><span className="note">没有 API 时：收银机装小程序把导出文件推到 <code>POST /api/v1/open/sales</code>（用上面的开放接口密钥）。</span></div>

      <h2>其他对接</h2>
      <ul className="note" style={{ lineHeight: 1.9 }}>
        <li>MyInvois 电子发票凭据：<Link to="/w/einvoice">电子发票 → 设定</Link></li>
        <li>收银机硬件（打印机、钱箱、秤）：收银电脑装 <code>tools/wh-bridge</code>，浏览器开 <code>{origin}/pos</code></li>
        <li>接口文档（给 Pandal 等第三方）：<a href="/api/v1/docs" target="_blank" rel="noreferrer">{origin}/api/v1/docs</a></li>
        <li>公司：{me?.company.name}（{me?.company.short_code}，{me?.company.plan === 'A' ? '小店模式' : '中型模式'}）</li>
      </ul>
    </div>
  );
}
