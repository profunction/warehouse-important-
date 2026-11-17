import { useEffect, useState } from 'react';
import { api } from '../../../api/client.js';
import { useAuth } from '../../../store/auth.js';
export default function Dashboard() {
  const { me } = useAuth(); const [d, setD] = useState<any>(null);
  useEffect(() => { api('/dashboard').then(setD).catch(() => setD({})); }, []);
  if (!d) return <div>加载中…</div>;
  const Stat = ({ l, v, warn }: { l: string; v: any; warn?: boolean }) => <div className={`stat ${warn && v > 0 ? 'warn' : ''}`}><div className="v">{v ?? '—'}</div><div className="l">{l}</div></div>;
  return (
    <div>
      <h1>仪表板 · {me?.site?.name ?? me?.company.name}</h1>
      <div className="cards">
        {d.stock_value != null && <Stat l="库存金额 RM" v={Number(d.stock_value).toLocaleString('en-MY', { maximumFractionDigits: 0 })} />}
        <Stat l="产品数" v={d.product_count} /><Stat l="今日移动" v={d.movements_today} /><Stat l="低库存产品" v={d.low_stock} warn />
        <Stat l="负库存" v={d.negative_stock} warn /><Stat l="待处理导入" v={d.pending_imports} warn /><Stat l="待审批" v={d.pending_approvals} warn />
        <Stat l="设备离线" v={d.devices_offline} warn /><Stat l="未关工单" v={d.open_tickets} warn /><Stat l="未打印标签" v={d.labels_unprinted} warn /><Stat l="14 天内到期" v={d.expiring_14d} warn />
      </div>
    </div>
  );
}
