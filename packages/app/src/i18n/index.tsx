import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Lang } from '@wh/shared';
import { tr, tr2, name3 } from './strings.js';
const Ctx = createContext<{ lang: Lang; setLang: (l: Lang) => void; t: (k: string, v?: Record<string, string | number>) => string; t2: (k: string) => string; n: (o: any) => string; fontLarge: boolean; setFontLarge: (b: boolean) => void }>(null!);
export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangS] = useState<Lang>(() => (localStorage.getItem('wh.lang') as Lang) || 'zh');
  const [fontLarge, setFontLargeS] = useState(() => localStorage.getItem('wh.font') === 'large');
  useEffect(() => { document.documentElement.lang = lang; localStorage.setItem('wh.lang', lang); }, [lang]);
  useEffect(() => { document.documentElement.dataset.font = fontLarge ? 'large' : ''; localStorage.setItem('wh.font', fontLarge ? 'large' : 'normal'); }, [fontLarge]);
  const v = useMemo(() => ({ lang, setLang: setLangS, t: (k: string, vars?: any) => tr(lang, k, vars), t2: (k: string) => tr2(lang, k), n: (o: any) => name3(lang, o), fontLarge, setFontLarge: setFontLargeS }), [lang, fontLarge]);
  return <Ctx.Provider value={v}>{children}</Ctx.Provider>;
}
export const useT = () => useContext(Ctx);
