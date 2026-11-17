// SOP 帮助：按屏幕列出问答（第四阶段换成 AI 机器人）
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '../../i18n/index.js';
import { Page, TopBar } from '../../ui/Shell.js';
import { db } from '../../offline/db.js';
import { api, isOnline } from '../../api/client.js';
export default function Help() {
  const { t, lang } = useT(); const nav = useNavigate(); const [items, setItems] = useState<any[]>([]); const [q, setQ] = useState(''); const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { (async () => { let rows = await db.knowledge_article.toArray(); if (!rows.length && isOnline()) try { rows = await api('/knowledge'); } catch { /* */ } setItems(rows); })(); }, []);
  const L = (o: any, k: string) => o[`${k}_${lang}`] ?? o[`${k}_zh`];
  const shown = items.filter((i) => !q || L(i, 'question').toLowerCase().includes(q.toLowerCase()) || L(i, 'answer').toLowerCase().includes(q.toLowerCase()));
  return (
    <Page>
      <TopBar title={t('help')} onBack={() => nav('/m')} />
      <div className="login" style={{ paddingBottom: 0 }}><input placeholder={t('lookup')} value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <div className="list">{shown.map((i) => <div key={i.id} className="card" style={{ flexDirection: 'column', alignItems: 'stretch' }} onClick={() => setOpen(open === i.id ? null : i.id)}><div className="t">❓ {L(i, 'question')}</div>{open === i.id && <div className="s" style={{ fontSize: 'var(--fs-body)', color: 'var(--fg)', marginTop: 8 }}>{L(i, 'answer')}</div>}</div>)}</div>
      <div className="confirm-wrap"><button className="btn btn-secondary" onClick={() => nav('/m/tickets')}>🎫 {t('supervisor_ans')}</button></div>
    </Page>
  );
}
