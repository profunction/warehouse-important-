// S5 登记位置：扫货架 → 扫产品 → 完成（不动库存）
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '../../i18n/index.js';
import { Icon, I } from '../../ui/icons.js';
import { useAuth } from '../../store/auth.js';
import { Scanner } from '../../ui/Scanner.js';
import { DoneScreen, ErrorScreen, Page, TopBar } from '../../ui/Shell.js';
import { db } from '../../offline/db.js';
import { resolveLocation, resolveProduct, queueShelf } from './flow.js';
export default function AssignShelf() {
  const { t, n } = useT(); const { me } = useAuth(); const nav = useNavigate();
  const [shelf, setShelf] = useState<any>(null); const [err, setErr] = useState<string | null>(null); const [done, setDone] = useState<string | null>(null);
  const onShelf = async (c: string) => { const l = await resolveLocation(c); const z = l?.zone_id ? await db.zone.get(l.zone_id) : null; if (!l || z?.zone_type !== 'SHELF') { setErr(t('scan_shelf')); return; } setShelf(l); };
  const onProduct = async (c: string) => { const f = await resolveProduct(c); if (!f || !me) { setErr(t('not_in_system')); return; } await queueShelf(me, f.product.id, shelf.id); setDone(`${n(f.product)} → ${shelf.code}`); };
  if (done) return <DoneScreen title={t('assigned_done')} lines={[done]} onNext={() => { setDone(null); }} onHome={() => nav('/m')} />;
  return (
    <Page>
      <TopBar title={t('assign_shelf')} onBack={() => (shelf ? setShelf(null) : nav('/m'))} />
      {err && <ErrorScreen msg={err} onOk={() => setErr(null)} />}
      {!shelf ? <Scanner onScan={onShelf} instruction={t('scan_shelf')} icon={I.Shelf} enabled={!err} /> : <><div className="instruct"><span className="label-chip" style={{ background: '#1565C0', fontSize: 28 }}>{shelf.code}</span></div><Scanner onScan={onProduct} instruction={t('scan_product')} icon={I.Product} enabled={!err} /></>}
    </Page>
  );
}
