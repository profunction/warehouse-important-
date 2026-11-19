// B3 申请调拨 S8：扫产品 → "要补货"（不填数量，服务器按最低量算）→ 可继续扫 → 送出申请。需联网。
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '../../i18n/index.js';
import { Icon, I } from '../../ui/icons.js';
import { Scanner } from '../../ui/Scanner.js';
import { Confirm, DoneScreen, ErrorScreen, Page, ProductHead, TopBar } from '../../ui/Shell.js';
import { api, ApiError, isOnline } from '../../api/client.js';
import { uuidv7 } from '../../offline/sync.js';
import { resolveProduct, backroomStock } from './flow.js';
import { fx } from '../../ui/feedback.js';

export default function RequestTransfer() {
  const { t, n, lang } = useT(); const nav = useNavigate();
  const [items, setItems] = useState<any[]>([]); const [cur, setCur] = useState<any>(null); const [have, setHave] = useState(0); const [err, setErr] = useState<string | null>(null); const [ask, setAsk] = useState(false); const [done, setDone] = useState<any>(null); const [busy, setBusy] = useState(false);
  const onScan = async (code: string) => {
    const f = await resolveProduct(code); if (!f) { setErr(t('not_in_system')); return; }
    if (items.some((i) => i.id === f.product.id)) { setErr(t('already_added')); return; }
    setHave((await backroomStock(f.product.id)).reduce((a, b) => a + b.qty, 0)); setCur(f.product);
  };
  const add = () => { if (!cur) return; fx.scanOk(); setItems([...items, cur]); setCur(null); };
  const send = async () => {
    if (!isOnline()) { setErr(t('needs_network')); return; } setBusy(true);
    try { const r = await api('/transfers', { body: { client_id: uuidv7(), lines: items.map((i) => ({ product_id: i.id })) } }); setDone(r); }
    catch (e) { setErr(e instanceof ApiError ? e.text(lang) : String(e)); } finally { setBusy(false); setAsk(false); }
  };
  if (done) return <DoneScreen title={t('request_sent')} lines={[done.transfer_no, t('items_summary', { p: done.lines.length, q: done.lines.reduce((a: number, l: any) => a + Number(l.requested_qty), 0) }), t('wait_manager')]} onHome={() => nav('/m')} />;
  return (
    <Page>
      <TopBar title={t('request_transfer')} progress={items.length ? `${items.length}` : undefined} onBack={() => (cur ? setCur(null) : nav('/m'))} confirmBack={items.length > 0 && !cur} />
      {err && <ErrorScreen msg={err} onOk={() => setErr(null)} />}
      {ask && <Confirm msg={`${t('send_request')}？${t('added_n', { n: items.length })}`} okText={t('send_request')} onOk={send} onCancel={() => setAsk(false)} />}
      {!cur ? (
        <>
          <Scanner onScan={onScan} instruction={t('scan_product')} icon={I.Product} last={items.length ? n(items[items.length - 1]) : undefined} enabled={!err && !ask} />
          {items.length > 0 && <>
            <div className="section">{t('added_n', { n: items.length })}</div>
            <div className="list">{items.map((i) => <div key={i.id} className="card" onClick={() => setItems(items.filter((x) => x.id !== i.id))}><div className="thumb">{i.photo_url ? <img src={i.photo_url} alt="" /> : <Icon name={I.Product} size={32} />}</div><div className="body"><div className="t">{n(i)}</div><div className="s">{t('need_refill')} · {t('remove')}</div></div></div>)}</div>
            <div className="confirm-wrap"><button className="btn btn-primary btn-xl" disabled={busy} onClick={() => setAsk(true)} data-testid="send-request"><Icon name={I.Check} size={26} /> {t('send_request')}（{items.length}）</button></div>
          </>}
        </>
      ) : (
        <>
          <ProductHead p={cur} sub={`${t('backroom_has')} ${have} · ${t('total_stock')}`} />
          <div className="kv"><span className="k">{t('current_qty')}</span><b>{have}</b></div>
          <div className="confirm-wrap"><button className="btn btn-primary btn-xl" onClick={add} data-testid="need-refill"><Icon name={I.Check} size={26} /> {t('need_refill')}</button></div>
          <div className="row2"><button className="btn btn-ghost" onClick={() => setCur(null)}>{t('cancel')}</button></div>
        </>
      )}
    </Page>
  );
}
