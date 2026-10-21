import en from './locales/en.json' with { type: 'json' };
import nl from './locales/nl.json' with { type: 'json' };

export type Language = 'nl' | 'en';
export type TranslationKey = keyof typeof en;
export type TranslationParams = Record<string, string | number | boolean | null | undefined>;
const dictionaries = { en, nl };

export function t(key: TranslationKey, params: TranslationParams = {}, language: Language = 'en'): string {
  return dictionaries[language][key].replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    params[name] === undefined ? placeholder : String(params[name] ?? ''),
  );
}

// API messages and notices can outlive the language in which they were created.
// Match complete catalogue templates to translate them again when rendered.
const entries = Object.values(dictionaries).flatMap((dictionary) =>
  Object.entries(dictionary).map(([key, value]) => {
    const names: string[] = [];
    const pattern = value
      .split(/(\{\w+\})/g)
      .map((part) => {
        if (/^\{\w+\}$/.test(part)) {
          names.push(part.slice(1, -1));
          return '([\\s\\S]*?)';
        }
        return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .join('');
    const literal = value.replace(/\{\w+\}/g, '');
    return { key: key as TranslationKey, value, literal, names, pattern: new RegExp(`^${pattern}$`) };
  }),
);
const exactMessages = new Map(
  entries.filter((entry) => entry.names.length === 0).map((entry) => [entry.value, entry.key]),
);
const templates = entries
  .filter((entry) => entry.names.length > 0 && /\p{L}/u.test(entry.literal))
  .sort((a, b) => b.literal.length - a.literal.length);

export function translateMessage(message: string, language: Language): string | undefined {
  const exact = exactMessages.get(message);
  if (exact) return t(exact, {}, language);
  for (const template of templates) {
    const match = template.pattern.exec(message);
    if (match) {
      const params = Object.fromEntries(template.names.map((name, index) => [name, match[index + 1]]));
      if (template.key === 'xlsx_import.regel' && params.p1) {
        params.p1 = translateMessage(params.p1, language) ?? params.p1;
      }
      return t(template.key, params, language);
    }
  }
  return undefined;
}
