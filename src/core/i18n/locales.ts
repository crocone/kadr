export const LOCALES = ['en', 'ru'] as const
export type Locale = (typeof LOCALES)[number]

export const DEFAULT_LOCALE: Locale = 'en'

export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  ru: 'Русский',
}

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value)
}

/** Browser UI language → our locale; anything non-Russian falls back to en. */
export function resolveSystemLocale(uiLanguage: string): Locale {
  const base = uiLanguage.toLowerCase().split('-')[0] ?? ''
  return isLocale(base) ? base : DEFAULT_LOCALE
}
