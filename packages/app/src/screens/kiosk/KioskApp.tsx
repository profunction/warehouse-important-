// 顾客大屏 D1–D8（模块 E）。不登录：密钥 ?key=wh_… 或 localStorage；竖屏 1080×1920；三语同屏；60 秒无操作回待机。
// 离线：目录/地图缓存 localStorage 可查，路线本地 A*；"叫员工"离线排队补发。实时：SSE shelf.updated/price.updated → 刷目录；map.published → 刷地图；help.accepted → 已接。
// 设计取舍（文档没写的）：照片找（D2 的"照片"）用类别照片格子代替；扫码接受键盘枪（USB HID）输入 + 手动输条码，不开摄像头（大屏多无前置摄像头）。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cache, callHelp, findTarget, flushHelpQueue, kfetch, kioskKey, localRoute, localSearch, refreshAll, refreshCatalog, subscribeEvents, type KMap, type KProduct } from './kioskApi.js';
import { MapView } from './MapView.js';
import './kiosk.css';

type Screen = 'idle' | 'search' | 'result' | 'help' | 'thanks' | 'nokey';
const Tri = ({ zh, ms, en, className }: { zh: string; ms: string; en: string; className?: string }) => <span className={`tri ${className ?? ''}`}><span className="zh">{zh}</span><span className="ms">{ms}</span><span className="en">{en}</span></span>;
const name3 = (p: any) => ({ main: p?.name_zh ?? p?.name_en ?? p?.name_ms ?? '', sub: [p?.name_ms, p?.name_en].filter((x) => x && x !== (p?.name_zh ?? p?.name_en)).join(' · ') });
const money = (v: any) => `RM ${Number(v ?? 0).toFixed(2)}`;
const ROWS = ['1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
const IDLE_MS = 60_000;

export default function KioskApp() {
  const [key, setKey] = useState<string | null>(() => kioskKey());
  const [screen, setScreen] = useState<Screen>(() => (kioskKey() ? 'idle' : 'nokey'));
  const [online, setOnline] = useState(navigator.onLine);
  const [catalog, setCatalog] = useState<KProduct[]>(() => cache.catalog());
  const [map, setMap] = useState<KMap | null>(() => cache.map());
  const [cats, setCats] = useState<any[]>(() => cache.cats());
  const [promos, setPromos] = useState<any[]>(() => cache.promos());
  const [promoIdx, setPromoIdx] = useState(0);
  const [q, setQ] = useState(''); const [cat, setCat] = useState<string | null>(null); const [results, setResults] = useState<KProduct[]>([]);
  const [sel, setSel] = useState<{ product: KProduct; locations: any[]; in_stock: boolean | null; primary_location_id: string | null } | null>(null);
  const [route, setRoute] = useState<{ found: boolean; path: { x: number; y: number }[]; target: any } | null>(null);
  const [help, setHelp] = useState<{ ticket_id: string | null; client_id: string; queued: boolean; accepted: boolean; by_name?: string | null; by_photo?: string | null; left: number } | null>(null);
  const [lastTouch, setLastTouch] = useState(Date.now());
  const wedge = useRef(''); const wedgeT = useRef<any>(null);

  const touch = useCallback(() => setLastTouch(Date.now()), []);
  // 60 秒无操作回待机（叫员工等待中不回）
  useEffect(() => { const t = setInterval(() => { if (screen !== 'idle' && screen !== 'nokey' && !(screen === 'help' && help && !help.accepted) && Date.now() - lastTouch > IDLE_MS) goIdle(); }, 1000); return () => clearInterval(t); }, [screen, lastTouch, help]);
  const goIdle = () => { setScreen('idle'); setQ(''); setCat(null); setResults([]); setSel(null); setRoute(null); setHelp(null); };
  // 在线状态 + 首次拉数据 + 定时增量 + 心跳 + 离线队列补发
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false); window.addEventListener('online', on); window.addEventListener('offline', off);
    if (!key) return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
    const load = async () => { try { const r = await refreshAll(); setCatalog(r.catalog); if (r.map) setMap(r.map); setCats(r.cats); setPromos(r.promos); setOnline(true); } catch (e: any) { if (e.status === 401 || e.status === 403) setScreen('nokey'); } };
    void load();
    const hb = setInterval(() => { void kfetch('/kiosk/heartbeat', { body: { app_version: '0.1.0' } }).then(() => setOnline(true)).catch(() => setOnline(false)); void flushHelpQueue(); }, 60_000);
    void kfetch('/kiosk/heartbeat', { body: { app_version: '0.1.0' } }).catch(() => {});
    const inc = setInterval(() => { void refreshCatalog().then(setCatalog).catch(() => {}); }, 5 * 60_000);
    const unsub = subscribeEvents((ev, data) => {
      if (ev === 'shelf.updated' || ev === 'price.updated') void refreshCatalog().then(setCatalog).catch(() => {});
      if (ev === 'map.published') void kfetch<KMap>('/kiosk/map').then((m) => { cache.setMap(m); setMap(m); }).catch(() => {});
      if (ev === 'help.accepted') setHelp((h) => (h && h.ticket_id === data.ticket_id ? { ...h, accepted: true, by_name: data.by_name } : h));
    });
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); clearInterval(hb); clearInterval(inc); unsub(); };
  }, [key]);
  // 促销轮播
  useEffect(() => { if (screen !== 'idle' || promos.length < 2) return; const t = setInterval(() => setPromoIdx((i) => (i + 1) % promos.length), 5000); return () => clearInterval(t); }, [screen, promos.length]);
  // 键盘枪：任何屏幕上快速连续数字 + Enter → 查条码
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (screen === 'nokey') return;
      if (e.key === 'Enter') { const code = wedge.current; wedge.current = ''; if (code.length >= 8) void openBarcode(code); return; }
      if (/^[0-9]$/.test(e.key)) { wedge.current += e.key; clearTimeout(wedgeT.current); wedgeT.current = setTimeout(() => (wedge.current = ''), 400); }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  });
  // 搜索：本地即时 + 在线补充
  useEffect(() => {
    if (screen !== 'search') return;
    let list = q ? localSearch(catalog, q) : cat ? catalog.filter((p) => p.category_id === cat).slice(0, 40) : [];
    setResults(list);
    if (q.length >= 2 && online) { const qq = q; const t = setTimeout(() => { void kfetch<KProduct[]>(`/kiosk/search?q=${encodeURIComponent(qq)}`).then((r) => { if (qq === q) setResults((cur) => { const m = new Map(cur.map((p) => [p.id, p])); for (const p of r) m.set(p.id, p); return [...m.values()].slice(0, 20); }); }).catch(() => {}); }, 250); return () => clearTimeout(t); }
  }, [q, cat, screen, catalog, online]);
  // 叫员工倒计时 + 轮询
  useEffect(() => {
    if (screen !== 'help' || !help) return;
    const t = setInterval(async () => {
      setHelp((h) => (h && !h.accepted ? { ...h, left: Math.max(0, h.left - 1) } : h));
      if (help.accepted) return;
      if (!help.ticket_id) { const done = await flushHelpQueue(); if (done[help.client_id]) setHelp((h) => (h ? { ...h, ticket_id: done[h.client_id], queued: false } : h)); return; }
      try { const r = await kfetch<any>(`/kiosk/help/${help.ticket_id}`); if (r.accepted) setHelp((h) => (h ? { ...h, accepted: true, by_name: r.by_name, by_photo: r.by_photo_url } : h)); } catch { /* */ }
    }, 1000);
    return () => clearInterval(t);
  }, [screen, help?.ticket_id, help?.accepted, help?.client_id]);

  const openProduct = async (p: KProduct) => {
    touch(); setScreen('result'); setSel({ product: p, locations: [], in_stock: null, primary_location_id: null }); setRoute(null);
    try {
      const w = await kfetch<any>(`/kiosk/products/${p.id}/where`);
      setSel({ product: w.product ?? p, locations: w.locations, in_stock: w.in_stock, primary_location_id: w.primary_location_id });
      if (w.primary_location_id) { try { const r = await kfetch<any>(`/kiosk/route?to=${w.primary_location_id}`); setRoute(r); } catch { if (map) { const loc = w.locations.find((l: any) => l.location_id === w.primary_location_id); const tg = loc ? findTarget(map, loc) : null; setRoute(tg ? { ...localRoute(map, tg), target: tg } : null); } } }
    } catch {
      // 离线：地图上找带 location 的元素（缓存地图元素含 location_code/zone_code）
      if (map) { const els = map.elements.filter((e) => e.kind === 'RACK' && e.label && (p.name_zh ?? '').includes(e.label)); const tg = els[0] ?? null; setSel({ product: p, locations: [], in_stock: null, primary_location_id: null }); setRoute(tg ? { ...localRoute(map, tg), target: tg } : null); }
    }
  };
  const openBarcode = async (code: string) => {
    touch(); const local = catalog.find((p) => p.barcode === code);
    if (local) return openProduct(local);
    try { const p = await kfetch<KProduct>(`/kiosk/products/${encodeURIComponent(code)}`); return openProduct(p); } catch { setScreen('search'); setQ(code); }
  };
  const doHelp = async () => {
    touch(); const r = await callHelp({ product_id: sel?.product.id, location_id: sel?.primary_location_id ?? undefined, note: sel ? `大屏找 ${name3(sel.product).main}` : undefined });
    setHelp({ ticket_id: r.ticket_id, client_id: r.client_id, queued: r.queued, accepted: false, left: 600 }); setScreen('help');
  };
  const typeKey = (k: string) => { touch(); if (k === '⌫') setQ((s) => s.slice(0, -1)); else if (k === '␣') setQ((s) => s + ' '); else if (k === '清除 Padam Clear') setQ(''); else setQ((s) => (s + k).slice(0, 30)); setCat(null); };
  const promo = promos[promoIdx % Math.max(1, promos.length)];
  const mapTarget = useMemo(() => route?.target ?? null, [route]);

  if (screen === 'nokey') return (
    <div className="kiosk"><div className="k-head"><div><div className="brand">仓店通 · 顾客大屏</div><div className="sub">WarehouseShop Kiosk</div></div></div>
      <div className="nokey"><Tri zh="请输入大屏密钥（老板在 网页 → 对接与密钥 生成）" ms="Masukkan kunci kiosk" en="Enter the kiosk key (Web → Integrations & Keys)" />
        <input placeholder="wh_xxxxxxxx.xxxxxxxx…" onKeyDown={(e) => { if (e.key === 'Enter') { const v = (e.target as HTMLInputElement).value.trim(); if (v) { try { localStorage.setItem('wh.kiosk.key', v); } catch { /* */ } setKey(v); setScreen('idle'); } } }} />
        <div className="hint">或打开 /kiosk?key=wh_…</div></div></div>);

  return (
    <div className="kiosk" onPointerDown={touch} data-screen={screen}>
      <div className="k-head">
        {screen === 'idle' ? <div><div className="brand">欢迎 · Selamat datang · Welcome</div><div className="sub">触摸屏幕找商品 · Sentuh untuk cari · Touch to find a product</div></div>
          : <><button className="k-back" onClick={() => { touch(); if (screen === 'search') goIdle(); else if (screen === 'result') { setScreen('search'); setSel(null); } else goIdle(); }}>‹ <Tri zh="返回" ms="Kembali" en="Back" /></button>
            <div className="brand">{screen === 'search' ? '找商品 · Cari · Find' : screen === 'result' ? '在这里 · Di sini · Here' : screen === 'help' ? '叫员工 · Panggil staf · Call staff' : '谢谢 · Terima kasih · Thank you'}</div>
            <button className="k-back" onClick={goIdle}><Tri zh="回首页" ms="Utama" en="Home" /></button></>}
      </div>
      <div className="k-body">
        {screen === 'idle' && <div className="idle" onClick={() => { touch(); setScreen('search'); }} data-testid="kiosk-idle">
          <div className="promo" key={promo?.id ?? 'none'}>
            {promo ? <>{(promo.image_url ?? promo.product_photo_url) ? <img src={promo.image_url ?? promo.product_photo_url} alt="" /> : <div className="ph">%</div>}
              <div className="pt">{promo.title_zh ?? promo.product_name_zh ?? ''}<br /><span style={{ fontSize: '.6em', opacity: .75 }}>{[promo.title_ms ?? promo.product_name_ms, promo.title_en ?? promo.product_name_en].filter(Boolean).join(' · ')}</span></div>
              {promo.promo_price != null && <div className="price">{money(promo.promo_price)}{promo.sell_price != null && Number(promo.sell_price) > Number(promo.promo_price) && <s>{money(promo.sell_price)}</s>}</div>}</>
              : <><div className="ph">🛒</div><div className="pt">今日好货，欢迎选购<br /><span style={{ fontSize: '.6em', opacity: .75 }}>Selamat berbelanja · Happy shopping</span></div></>}
          </div>
          {promos.length > 1 && <div className="promo-dots">{promos.map((p, i) => <i key={p.id} className={i === promoIdx % promos.length ? 'on' : ''} />)}</div>}
          <button className="find-btn" data-testid="kiosk-find"><span style={{ fontSize: 80 }}>⌕</span><Tri zh="找商品？" ms="Cari barang?" en="Find a product?" /></button>
        </div>}

        {screen === 'search' && <>
          <div className="search-box" data-testid="kiosk-search">{q ? <span>{q}</span> : <span className="ph">打字 / 拼音 / Malay / English / 扫条码 · Taip atau imbas · Type or scan</span>}<span className="caret" /></div>
          <div className="cats">{cats.map((c) => <button key={c.id} className={cat === c.id ? 'on' : ''} style={{ ['--c' as any]: c.color }} onClick={() => { touch(); setQ(''); setCat(cat === c.id ? null : c.id); }}>{c.name_zh ?? c.code}<br /><small style={{ fontSize: 18, opacity: .75 }}>{[c.name_ms, c.name_en].filter(Boolean).join(' · ')}</small></button>)}</div>
          <div className="results" data-testid="kiosk-results">
            {results.map((p) => { const n = name3(p); return <button key={p.id} className="r-item" onClick={() => openProduct(p)} data-testid="kiosk-result">{p.photo_url ? <img src={p.photo_url} alt="" /> : <div className="ph">▣</div>}<div className="n">{n.main}<small>{n.sub}</small></div><div className="p">{money(p.sell_price)}</div></button>; })}
            {!results.length && (q || cat) && <div className="hint" style={{ gridColumn: '1 / -1' }}><Tri zh="没找到，试试别的字或叫员工" ms="Tidak dijumpai, cuba perkataan lain" en="Not found, try another word or call staff" /><br /><button className="r-item" style={{ marginTop: 16, justifyContent: 'center', background: '#EF6C00', color: '#fff' }} onClick={doHelp}><Tri zh="叫员工" ms="Panggil staf" en="Call staff" /></button></div>}
            {!results.length && !q && !cat && <div className="hint" style={{ gridColumn: '1 / -1' }}><Tri zh="打字、选类别，或把条码对准扫描器" ms="Taip, pilih kategori atau imbas kod bar" en="Type, pick a category, or scan the barcode" /></div>}
          </div>
          <div className="kb">
            {ROWS.map((r) => <div className="row" key={r}>{[...r].map((k) => <button key={k} onClick={() => typeKey(k)}>{k}</button>)}</div>)}
            <div className="row"><button className="act wide" onClick={() => typeKey('清除 Padam Clear')}>清除 · Padam · Clear</button><button className="act wide" onClick={() => typeKey('␣')}>␣</button><button className="act" onClick={() => typeKey('⌫')}>⌫</button></div>
          </div>
        </>}

        {screen === 'result' && sel && (() => { const n = name3(sel.product); return <div className="result" data-testid="kiosk-result-map">
          <div className="prod">{sel.product.photo_url ? <img src={sel.product.photo_url} alt="" /> : <div className="ph">▣</div>}
            <div><div className="n">{n.main}<small>{n.sub}</small></div><div className="price">{money(sel.product.sell_price)}</div>
              {sel.in_stock === true && <div className="stock yes">● <Tri zh="有货" ms="Ada stok" en="In stock" /></div>}
              {sel.in_stock === false && <div className="stock no">● <Tri zh="暂时缺货" ms="Kehabisan" en="Out of stock" /></div>}
            </div></div>
          <div className="where"><Tri zh="位置" ms="Lokasi" en="Shelf" />{sel.locations.length ? sel.locations.map((l) => <span key={l.location_id} className="loc" style={{ animation: l.is_primary ? undefined : 'none', background: l.is_primary ? '#C62828' : '#90A4AE' }}>{l.code}</span>) : <span style={{ color: '#888' }}>{sel.in_stock === null ? '…' : '— 请叫员工 · Sila panggil staf · Please call staff'}</span>}</div>
          <div className="map-wrap">{map && map.elements.length ? <MapView map={map} path={route?.path} target={mapTarget} cell={30} /> : <div className="hint"><Tri zh="店地图还没发布" ms="Peta kedai belum diterbitkan" en="Store map not published yet" /></div>}</div>
          <div className="legend"><span><i style={{ background: '#1565C0' }} />您在这里 · Anda di sini · You are here</span><span><i style={{ background: '#C62828' }} />货架 · Rak · Shelf</span><span><i style={{ background: '#1B8A3A' }} />路线 · Laluan · Route</span></div>
          <div className="actions"><button className="call" onClick={doHelp} data-testid="kiosk-call"><Tri zh="叫员工" ms="Panggil staf" en="Call staff" /></button><button className="again" onClick={() => { touch(); setScreen('search'); setSel(null); setQ(''); }}><Tri zh="再找一个" ms="Cari lagi" en="Find another" /></button></div>
        </div>; })()}

        {screen === 'help' && help && <div className={`help ${help.accepted ? 'ok' : ''}`} data-testid="kiosk-help">
          {help.accepted ? <><div className="staff">{help.by_photo ? <img src={help.by_photo} alt="" /> : '☺'}</div><div className="big">{help.by_name ?? ''}<br /><Tri zh="员工正在赶来" ms="Staf sedang datang" en="Staff is on the way" /></div>
            <button onClick={() => { touch(); setScreen('thanks'); setTimeout(goIdle, 5000); }}><Tri zh="好的，谢谢" ms="Baik, terima kasih" en="OK, thanks" /></button></>
            : <><div className="big"><Tri zh="已通知员工，请稍等" ms="Staf telah dimaklumkan, sila tunggu" en="Staff notified, please wait" /></div>
              <div className="count">{String(Math.floor(help.left / 60)).padStart(2, '0')}:{String(help.left % 60).padStart(2, '0')}</div>
              {help.queued && <div className="hint"><Tri zh="网络断开，呼叫已排队，恢复后自动发送" ms="Tiada talian, panggilan dalam giliran" en="Offline, call queued and will be sent" /></div>}
              {sel && <div className="hint">{name3(sel.product).main} {sel.locations[0]?.code ?? ''}</div>}
              <button style={{ background: '#9E9E9E' }} onClick={goIdle}><Tri zh="不用了" ms="Tidak perlu" en="Never mind" /></button></>}
        </div>}
        {screen === 'thanks' && <div className="thanks" onClick={goIdle}><div style={{ fontSize: 160 }}>✓</div><Tri zh="谢谢！" ms="Terima kasih!" en="Thank you!" /></div>}
      </div>
      <div className="k-foot"><span className={`dot ${online ? '' : 'off'}`} />{online ? '在线 · Dalam talian · Online' : '离线（可查缓存）· Luar talian · Offline'} · {catalog.length} 商品 · {map?.version ? `地图 v${map.version}` : '无地图'}</div>
    </div>
  );
}
