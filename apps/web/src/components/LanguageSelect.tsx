import type { Language } from '../i18n';
import { setLanguage, t, useLanguage } from '../i18n';

export function LanguageSelect({
  flags = false,
  disabled = false,
  onChange = setLanguage,
}: {
  flags?: boolean;
  disabled?: boolean;
  onChange?: (language: Language) => void;
}) {
  const language = useLanguage();
  if (flags) {
    return (
      <div className="language-flags" role="group" aria-label={t('language.label')}>
        {(['nl', 'en'] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-label={t(`language.${value}`)}
            title={t(`language.${value}`)}
            aria-pressed={language === value}
            disabled={disabled}
            onClick={() => onChange(value)}
          >
            <svg width="30" height="20" viewBox="0 0 60 40" aria-hidden="true" focusable="false">
              {value === 'nl' ? (
                <>
                  <path fill="#ae1c28" d="M0 0h60v40H0z" />
                  <path fill="#fff" d="M0 13.333h60v13.334H0z" />
                  <path fill="#21468b" d="M0 26.667h60V40H0z" />
                </>
              ) : (
                <>
                  <path fill="#012169" d="M0 0h60v40H0z" />
                  <path stroke="#fff" strokeWidth="8" d="m0 0 60 40m0-40L0 40" />
                  <path stroke="#c8102e" strokeWidth="3" d="m0 0 60 40m0-40L0 40" />
                  <path stroke="#fff" strokeWidth="13" d="M30 0v40M0 20h60" />
                  <path stroke="#c8102e" strokeWidth="8" d="M30 0v40M0 20h60" />
                </>
              )}
            </svg>
          </button>
        ))}
      </div>
    );
  }
  return (
    <div className="language-select">
      <label htmlFor="public-language">{t('language.label')}</label>
      <select
        id="public-language"
        value={language}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as Language)}
      >
        <option value="nl">{t('language.nl')}</option>
        <option value="en">{t('language.en')}</option>
      </select>
    </div>
  );
}
