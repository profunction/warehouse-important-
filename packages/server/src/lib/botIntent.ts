// 机器人意图分类（模块 E）。
// - 规则优先：三语关键词 → DATA（query_code + params）/ HOWTO / OTHER。零依赖、离线可用、可测试。
// - 若 env ANTHROPIC_API_KEY 存在，再用 Claude（默认模型 claude-sonnet-5-5，可用 BOT_MODEL 覆盖）做分类：
//   只允许它返回 {query_code, params, language} 的 JSON，查询清单由我们给，禁止写 SQL；失败/超时回落到规则结果。
// - 语音：/bot/ask 接受 audio 上传，但转文字留 TODO（需要 STT 服务），服务器回"请打字"。
import { BOT_QUERIES, type Lang } from './botQueries.js';

export type Intent = 'DATA' | 'HOWTO' | 'OTHER';
export interface Classified { intent: Intent; query_code?: string; params: Record<string, any>; language: Lang; source: 'rules' | 'llm' }

export function detectLanguage(text: string): Lang {
  if (/[一-鿿]/.test(text)) return 'zh';
  const t = ' ' + text.toLowerCase() + ' ';
  const ms = ['mana', 'berapa', 'apa', 'bila', 'macam', 'bagaimana', 'cara', 'hari ini', 'ada', 'tak', 'tidak', 'kat', 'dalam', 'luput', 'rak', 'stok', 'barang', 'kos', 'jualan', 'perlu', 'isi', 'tiket', 'saya', 'sampai', 'pindah', 'peranti', 'kelulusan', 'lulus', 'zon'];
  const en = ['where', 'how', 'what', 'when', 'many', 'much', 'today', 'cost', 'sales', 'sold', 'stock', 'shelf', 'refill', 'expir', 'ticket', 'approv', 'arrive', 'transfer', 'device', 'offline', 'zone', 'price'];
  const score = (ws: string[]) => ws.reduce((a, w) => a + (t.includes(' ' + w) ? 1 : 0), 0);
  return score(ms) > score(en) ? 'ms' : 'en';
}

// 每个查询的触发词（正则，不区分大小写），顺序即优先级。
const RULES: { code: string; re: RegExp; param?: string; strip?: RegExp }[] = [
  { code: 'PRODUCT_COST', re: /成本|进价|\bkos\b|\bcost\b|harga beli/i, param: 'product', strip: /成本(多少|是多少|价)?|进价|多少钱?|的|是|\?|？|\bkos(nya)?\b|\bberapa\b|\bcost\b|\bof\b|\bwhat('s| is)?\b|\bthe\b|\bhow much\b|\bdoes\b|\bprice\b/gi },
  { code: 'LOW_STOCK', re: /要补|补什么|补货|缺货|低库存|perlu (di)?isi|isi semula|kurang stok|\brefill|low stock|replenish|running low|out of stock/i },
  { code: 'EXPIRING', re: /到期|过期|快过|luput|expir/i, param: 'days' },
  { code: 'TODAY_SALES', re: /今天.*(卖|销售|营业|收入)|今日销售|jualan hari ini|hari ini.*jual|today.?s? sales|sales today|sold today|how much.*today/i },
  { code: 'PRODUCT_SALES_30D', re: /(一个月|30 ?天|这个月|上个月|月).*(卖|销量|销售)|(卖|销量).*(一个月|30 ?天|月)|sebulan|30 hari|jual.*bulan|\bmonth\b.*(sales|sold|sell)|(sales|sold|sell).*\bmonth\b|30 days/i, param: 'product', strip: /一个月|30 ?天|这个月|上个月|每月|月|卖了?多少|卖多少|销量|销售|多少|的|\?|？|sebulan|30 hari|jual(an)?|berapa|dalam|\bsales\b|\bsold\b|\bsell\b|\bper\b|\bin\b|\ba\b|\bthe\b|\blast\b|\bmonth\b|\bhow (many|much)\b|\bof\b|\bdays?\b|\bdid\b|\bwe\b/gi },
  { code: 'MY_TICKETS', re: /工单|我的任务|待办|tiket|tugas(an)? saya|\bticket|my tasks?\b|\bto-?do\b/i },
  { code: 'PENDING_APPROVALS', re: /等我批|待审批|审批|要批|批准|kelulusan|lulus|approv/i },
  { code: 'TRANSFER_STATUS', re: /调拨|调货|调到|pindah(an)?|\btransfer/i },
  { code: 'PO_STATUS', re: /什么时候到|几时到|货.*到了?[吗没]|采购单|订的货|\bPO\b|bila.*sampai|barang.*sampai|pesanan|purchase order|when.*(arrive|come|deliver)|\bdeliver/i, param: 'supplier_or_product', strip: /什么时候到|几时到|的货|货|到了吗|到了没|到没|采购单|状态|订的|的|\?|？|\bPO\b|bila|sampai|barang|pesanan|belum|purchase order|when|will|does|the|arrive|come|delivery|deliver|order|from|is|my/gi },
  { code: 'DEVICE_STATUS', re: /掉线|离线|设备|哪台|peranti|luar talian|\bdevice|offline|\bpos\b.*(down|offline)/i },
  { code: 'ZONE_CONTENTS', re: /([A-Z]{1,3}[0-9]{0,2}|[A-Z]?[0-9]{1,2}) ?区|zon [A-Z0-9]{1,3}\b|zone [A-Z0-9]{1,3}\b|what('s| is) in [A-Z0-9]{1,3}\b/i, param: 'zone_code' },
  { code: 'STOCK_BY_BARCODE', re: /还有多少|有多少|剩多少|库存|数量|多少个|多少件|berapa (banyak|unit|stok)|baki|stok|how many|how much (stock|left)|\bstock (of|for|level)|\bqty\b|\bquantity\b|[0-9]{8,14}/i, param: 'barcode_or_name', strip: /还有多少|有多少|剩多少|库存|数量|多少个|多少件|多少|的|在哪里?|哪里|放哪|\?|？|berapa|banyak|unit|stok|baki|ada|lagi|how many|how much|stock|left|of|for|level|do we have|is there|are there|qty|quantity|the|there/gi },
  { code: 'PRODUCT_LOCATION_SHOP', re: /在哪|放哪|哪里|哪个货架|哪个位置|位置|货架|\bmana\b|\bdi mana|\bkat mana|\brak\b|\bwhere\b|\bshelf\b|\blocation\b|\bfind\b/i, param: 'product', strip: /在哪里?|放哪里?|放在哪里?|哪里|哪个货架|哪个位置|位置|货架|的|是|在|放|\?|？|\bdi\b|\bkat\b|\bmana\b|\brak\b|\bletak\b|\bada\b|\bwhere\b|\bis\b|\bare\b|\bthe\b|\bshelf\b|\bwhich\b|\bon\b|\bcan\b|\bi\b|\bfind\b|\blocation\b|\bof\b|\bdo\b|\bwe\b|\bput\b/gi },
];
const HOWTO_RE = /怎么|怎样|如何|咋|怎么办|什么意思|是什么|为什么|能不能|可以.*吗|要不要|步骤|\bcara\b|macam mana|bagaimana|apa (maksud|itu)|kenapa|boleh(kah)?|\bhow (do|to|can|should)\b|\bwhat (does|is|if|should)\b|\bwhy\b|\bcan i\b|\bshould i\b|\bsteps?\b|\bmeaning\b/i;

function cleanParam(text: string, strip?: RegExp) {
  let s = text;
  if (strip) s = s.replace(strip, ' ');
  return s.replace(/[，,。.!！、：:；;]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function classifyByRules(text: string): Classified {
  const language = detectLanguage(text);
  const t = text.trim();
  for (const r of RULES) {
    if (!r.re.test(t)) continue;
    const params: Record<string, any> = {};
    if (r.code === 'EXPIRING') { const m = t.match(/(\d+)\s*(天|hari|days?)/i); params.days = m ? Number(m[1]) : /周|星期|minggu|week/i.test(t) ? 7 : /月|bulan|month/i.test(t) ? 30 : 7; }
    else if (r.code === 'ZONE_CONTENTS') { const m = t.match(/([A-Z]{1,3}[0-9]{0,2}|[A-Z]?[0-9]{1,2}) ?区/i) ?? t.match(/zon(?:e)? ([A-Z0-9]{1,3})\b/i) ?? t.match(/in ([A-Z0-9]{1,3})\b/i); params.zone_code = (m?.[1] ?? '').toUpperCase(); }
    else if (r.param) { const v = cleanParam(t, r.strip); if (v) params[r.param] = v; }
    // 产品类查询没有产品名时，不算 DATA（可能是 HOWTO，例如"位置怎么登记"）
    if (['PRODUCT_COST', 'PRODUCT_LOCATION_SHOP', 'PRODUCT_SALES_30D'].includes(r.code) && !params[r.param!]) continue;
    if (r.code === 'STOCK_BY_BARCODE' && !params.barcode_or_name) continue;
    if (HOWTO_RE.test(t) && !['LOW_STOCK', 'TODAY_SALES', 'MY_TICKETS', 'PENDING_APPROVALS'].includes(r.code) && !/[0-9]{8,14}/.test(t)) {
      // "可乐怎么放" 之类：有产品名+怎么 → 还是按 HOWTO 处理
      if (/怎么|怎样|如何|cara|macam mana|bagaimana|how (do|to)/i.test(t)) return { intent: 'HOWTO', params: {}, language, source: 'rules' };
    }
    return { intent: 'DATA', query_code: r.code, params, language, source: 'rules' };
  }
  if (HOWTO_RE.test(t)) return { intent: 'HOWTO', params: {}, language, source: 'rules' };
  return { intent: 'OTHER', params: {}, language, source: 'rules' };
}

/** 用 Claude 分类（只选查询填参数，不写 SQL）。返回 null 表示没配置或失败。 */
export async function classifyByLLM(text: string, allowedCodes: string[]): Promise<Classified | null> {
  const key = process.env.ANTHROPIC_API_KEY; if (!key) return null;
  const model = process.env.BOT_MODEL || 'claude-sonnet-5-5';
  const catalog = allowedCodes.filter((c) => BOT_QUERIES[c]).map((c) => `${c}(${BOT_QUERIES[c].params.join(',')})`).join('\n');
  const system = `You classify a warehouse/shop staff question into one fixed read-only query. Never write SQL. Reply with ONLY one JSON object, no prose:
{"intent":"DATA"|"HOWTO"|"OTHER","query_code":string|null,"params":object,"language":"zh"|"ms"|"en"}
Allowed query codes with their params (choose query_code only from this list, else intent HOWTO for "how do I…" / procedure questions, OTHER for anything else):
${catalog}
Params: product/barcode_or_name/supplier_or_product = the product or supplier name as written by the user (any language); days = integer; zone_code = zone code like "A" or "S01".`;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: AbortSignal.timeout(8000),
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: 300, system, messages: [{ role: 'user', content: text }] }),
    });
    if (!r.ok) { console.error('bot llm http', r.status); return null; }
    const j: any = await r.json();
    const txt = (j.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
    const m = txt.match(/\{[\s\S]*\}/); if (!m) return null;
    const o = JSON.parse(m[0]);
    const intent: Intent = o.intent === 'DATA' && o.query_code && allowedCodes.includes(o.query_code) ? 'DATA' : o.intent === 'HOWTO' ? 'HOWTO' : o.intent === 'DATA' ? 'OTHER' : 'OTHER';
    const language: Lang = ['zh', 'ms', 'en'].includes(o.language) ? o.language : detectLanguage(text);
    return { intent, query_code: intent === 'DATA' ? o.query_code : undefined, params: typeof o.params === 'object' && o.params ? o.params : {}, language, source: 'llm' };
  } catch (e: any) { console.error('bot llm failed', e.message); return null; }
}

/** 总入口：规则先出结果；有 LLM 时用 LLM 结果覆盖（仅当它选了允许的查询或明确 HOWTO）。 */
export async function classify(text: string, allowedCodes: string[]): Promise<Classified> {
  const rules = classifyByRules(text);
  const llm = await classifyByLLM(text, allowedCodes);
  if (llm && (llm.intent !== 'OTHER' || rules.intent === 'OTHER')) return { ...llm, language: rules.language === 'zh' ? 'zh' : llm.language };
  return rules;
}

// TODO 语音转文字：接入 STT（例如 Whisper/云服务）后在此实现 transcribe(buffer, mime) → text。目前返回 null，/bot/ask 回"请打字"。
export async function transcribeAudio(_buf: Buffer, _mime: string): Promise<string | null> { return null; }
