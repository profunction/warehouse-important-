// 待上传 / 需处理记录
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '../../i18n/index.js';
import { Icon, I } from '../../ui/icons.js';
import { Confirm, Page, TopBar } from '../../ui/Shell.js';
import { db, type OutboxItem } from '../../offline/db.js';
import { deleteRejected, retryRejected, push, subscribe } from '../../offline/sync.js';
export default function Outbox() {
  const { t, lang } = useT(); const nav = useNavigate(); const [items, setItems] = useState<OutboxItem[]>([]); const [del, setDel] = useState<string | null>(null);
  const load = async () => setItems(await db.outbox.orderBy('seq').toArray());
  useEffect(() => { void load(); return subscribe(() => void load()); }, []);
  return (
    <Page>
      <TopBar title={t('pending_upload')} onBack={() => nav('/m')} />
      {del && <Confirm msg={t('really_delete')} okText={t('delete_record')} danger onOk={async () => { await deleteRejected(del); setDel(null); }} onCancel={() => setDel(null)} />}
      {items.length === 0 ? <div className="empty"><div className="big"><Icon name={I.Check} size={48} /></div>{t('synced')}</div> : (
        <div className="list">{items.map((it) => (
          <div key={it.client_id} className="card" style={{ borderColor: it.status === 'rejected' ? 'var(--red)' : 'var(--border)', flexDirection: 'column', alignItems: 'stretch' }}>
            <div className="t">{it.summary ?? it.entity}</div>
            <div className="s">{new Date(it.created_at).toLocaleString()} · {it.status === 'rejected' ? (it.error?.[`message_${lang}` as 'message_zh'] ?? it.error?.code) : t('pending_upload')}</div>
            {it.status === 'rejected' && <div className="row2" style={{ padding: '8px 0 0' }}><button className="btn btn-secondary" onClick={() => retryRejected(it.client_id)}>{t('retry')}</button><button className="btn btn-danger" onClick={() => setDel(it.client_id)}>{t('delete_record')}</button></div>}
          </div>
        ))}</div>
      )}
      <div className="confirm-wrap"><button className="btn btn-primary" onClick={() => void push()}>↻ {t('retry')}</button></div>
    </Page>
  );
}
