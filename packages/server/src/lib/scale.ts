/** 称重条码解析：默认 2 + 5 位 PLU + 5 位重量（克）+ 校验位 = 13 位 */
export interface ScaleFormat { prefix: string; plu_len: number; weight_len: number; unit: 'g' | 'kg' | 'price' }
export function parseScaleBarcode(code: string, f: ScaleFormat = { prefix: '2', plu_len: 5, weight_len: 5, unit: 'g' }) {
  if (!code.startsWith(f.prefix) || code.length !== f.prefix.length + f.plu_len + f.weight_len + 1) return null;
  const plu = code.slice(f.prefix.length, f.prefix.length + f.plu_len);
  const raw = Number(code.slice(f.prefix.length + f.plu_len, f.prefix.length + f.plu_len + f.weight_len));
  if (Number.isNaN(raw)) return null;
  const weight_kg = f.unit === 'g' ? raw / 1000 : f.unit === 'kg' ? raw / 1000 : null;
  const price = f.unit === 'price' ? raw / 100 : null;
  return { plu, weight_kg, price };
}
