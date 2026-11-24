// P9 企业记账：搜客户（模块 D 的 GET /customers?search=，404 时退回 /pos/customers；都没有则"客户功能未开通"）→ 选中 → 回主屏扫商品 → 付款屏"记账"。
// 离线时用本地 Dexie customer 副本（上次在线时缓存）。
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '../../i18n/index.js';
import { isOnline } from '../../api/client.js';
import { db } from '../../offline/db.js';
import { refreshCustomers } from '../../offline/posSync.js';
import { fx } from '../../ui/feedback.js';
import { PosTop } from './PosApp.js';
import { usePos } from './posStore.js';
import { Btn, Tri, money } from './PosUi.js';
import { Building2, Search } from 'lucide-react';

export default function PosB2B() {
  const { t } = useT(); const nav = useNavigate(); const pos = usePos();
  const [q, setQ] = useState(''); const [rows, setRows] = useState<any[] | null>(null); const [off, setOff] = useState(false);
  const search = async (s = q) => {
    if (isOnline()) { const r = await refreshCustomers(s); if (r === null) { const local = await db.customer.toArray(); if (!local.length) { setOff(true); setRows([]); return; } } }
    const local = (await db.customer.toArray()).filter((c) => c.is_active && (!s || c.name.toLowerCase().includes(s.toLowerCase()) || (c.code ?? '').toLowerCase().includes(s.toLowerCase()) || (c.phone ?? '').includes(s)));
    setRows(local.slice(0, 40).map((c) => ({ ...c, credit_available: Math.round((c.credit_limit - c.balance) * 100) / 100 })));
  };
  useEffect(() => { void search(''); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="pos"><PosTop />
      <div className="pos-center" style={{ alignItems: 'stretch' }}>
        <div className="pos-panel wide" style={{ margin: '0 auto' }}>
          <Tri k="pos_b2b" />
          <div className="pos-scan" style={{ padding: 0, border: 0, background: 'transparent' }}>
            <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void search()} placeholder={t('pos_search_customer')} autoFocus data-testid="b2b-search" />
            <button className="pos-btn ghost" style={{ minHeight: 72, minWidth: 110, flexDirection: 'row' }} onClick={() => void search()}><Search size={26} />{t('pos_find')}</button>
          </div>
          {off ? <div className="pos-bar warn" style={{ borderRadius: 10 }}><Building2 size={22} /> {t('pos_customers_off')}</div> : rows === null ? <div className="pos-empty">{t('loading')}</div> : rows.length === 0 ? <div className="pos-empty">{t('pos_no_results')}</div> : (
            <div className="pos-list">{rows.map((c) => <button key={c.id} className={`pos-card ${pos.customer?.id === c.id ? 'sel' : ''}`} onClick={() => { fx.tap(); pos.setCustomer({ mode: 'B2B', id: c.id, name: c.name, credit_available: c.credit_available, credit_limit: c.credit_limit, balance: c.balance }); nav('/pos'); }} data-testid="b2b-customer"><div>{c.name}<div className="s">{c.code ?? ''} {c.phone ?? ''} · {t('pos_credit_left')} {money(c.credit_available)} / {money(c.credit_limit)}</div></div><div className={`r ${c.credit_available < 0 ? 'neg' : ''}`} style={{ color: c.credit_available <= 0 ? 'var(--red)' : 'var(--green)' }}>{c.credit_available <= 0 ? t('pos_credit_over') : money(c.credit_available)}</div></button>)}</div>
          )}
          <div className="pos-actions"><Btn k="back" color="ghost" onClick={() => nav('/pos')} />{pos.customer && <Btn k="pos_clear_customer" color="red" onClick={() => { pos.setCustomer(null); nav('/pos'); }} />}</div>
        </div>
      </div>
    </div>
  );
}
