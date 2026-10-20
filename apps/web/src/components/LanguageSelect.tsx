import { setLanguage, t, useLanguage } from '../i18n';
import type { Language } from '../i18n';

export function LanguageSelect() {
  const language = useLanguage();
  return <div className="language-select">
    <label htmlFor="public-language">{t('language.label')}</label>
    <select id="public-language" value={language} onChange={(event) => setLanguage(event.target.value as Language)}>
      <option value="nl">{t('language.nl')}</option><option value="en">{t('language.en')}</option>
    </select>
  </div>;
}
