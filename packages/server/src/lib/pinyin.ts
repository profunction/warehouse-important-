import { pinyin } from 'pinyin-pro';
/** 中文名 → 全拼 + 首字母，用于搜索 */
export function toPinyin(name?: string | null): string | null {
  if (!name || !/[一-鿿]/.test(name)) return null;
  const full = pinyin(name, { toneType: 'none', type: 'array', nonZh: 'consecutive' }).join('');
  const first = pinyin(name, { pattern: 'first', toneType: 'none', type: 'array', nonZh: 'removed' }).join('');
  return `${full} ${first}`.toLowerCase();
}
