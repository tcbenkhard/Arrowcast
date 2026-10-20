import { useSyncExternalStore } from 'react';
import { t as translate, translateMessage } from '@arrowcast/contracts/i18n';
import type { Language, TranslationKey, TranslationParams } from '@arrowcast/contracts/i18n';

export type { Language } from '@arrowcast/contracts/i18n';
const storageKey = 'arrowcast.language';
function initialLanguage(): Language {
  try { const saved = localStorage.getItem(storageKey); if (saved === 'en' || saved === 'nl') return saved; } catch { /* Storage is optional. */ }
  return 'nl';
}
let language = initialLanguage();
const listeners = new Set<() => void>();
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function useLanguage() { return useSyncExternalStore(subscribe, () => language); }
export function getLanguage() { return language; }
export function setLanguage(value: Language) {
  language = value;
  document.documentElement.lang = value;
  document.title = translate('App.arrowcast', {}, value);
  try { localStorage.setItem(storageKey, value); } catch { /* Keep working without browser storage. */ }
  for (const listener of listeners) listener();
}
document.documentElement.lang = language;
document.title = translate('App.arrowcast', {}, language);
export function t(key: TranslationKey, params?: TranslationParams) { return translate(key, params, language); }
export function message(value: string | null | undefined) { return value ? translateMessage(value, language) ?? t('common.unexpectedError') : ''; }
