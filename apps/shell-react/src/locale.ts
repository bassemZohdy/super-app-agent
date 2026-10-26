import { useCallback, useEffect, useState } from 'react';
import { setAmountLocale } from '../../../packages/protocol-core/src/payments.ts';
import { direction, isLocale, preferredLocale, translate, type CatalogKey, type Locale } from '../../../packages/protocol-core/src/i18n.ts';

const KEY = 'cityside.locale';
const stored = (): Locale | undefined => { try { const value = localStorage.getItem(KEY); return isLocale(value) ? value : undefined; } catch { return undefined; } };

/** The resident's language: their saved choice, else the browser's first language. It sets `lang` and `dir` on the page, so layout,
 *  screen readers and form controls follow it, and it is saved only in this browser. */
export function useLocale() {
  const [locale, setLocaleState] = useState<Locale>(() => stored() ?? preferredLocale(typeof navigator === 'undefined' ? undefined : navigator.languages));
  // Set during render, not in an effect, so amounts drawn in this pass already use the chosen language.
  setAmountLocale(locale);
  useEffect(() => { document.documentElement.lang = locale; document.documentElement.dir = direction(locale); }, [locale]);
  const setLocale = useCallback((next: Locale) => { setLocaleState(next); try { localStorage.setItem(KEY, next); } catch { /* the choice still applies for this visit */ } }, []);
  const t = useCallback((key: CatalogKey, values?: Record<string, string | number>) => translate(locale, key, values), [locale]);
  return { locale, setLocale, t };
}
