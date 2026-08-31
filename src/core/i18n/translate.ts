import { DEFAULT_LOCALE, type Locale } from './locales'
import { type MessageKey, messages } from './messages'

export type TranslateParams = Record<string, string | number>

/** Substitutes `{name}` placeholders; an unknown key returns itself, not an empty string. */
export function translate(locale: Locale, key: MessageKey, params?: TranslateParams): string {
  const dict = messages[locale] as Record<string, string>
  const fallback = messages[DEFAULT_LOCALE] as Record<string, string>
  const template = dict[key] ?? fallback[key] ?? key
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  )
}
