/**
 * The content script lives outside the React tree, so it resolves the locale itself:
 * from settings, falling back to the browser UI language.
 */
import {
  DEFAULT_LOCALE,
  type Locale,
  type MessageKey,
  resolveSystemLocale,
  translate,
  type TranslateParams,
} from '@/core/i18n'
import { readSettings } from '@/core/storage/settings'

let locale: Locale = DEFAULT_LOCALE

export async function loadLocale(): Promise<void> {
  const settings = await readSettings()
  locale =
    settings.locale === 'system'
      ? resolveSystemLocale(chrome.i18n?.getUILanguage?.() ?? navigator.language)
      : settings.locale
}

export function t(key: MessageKey, params?: TranslateParams): string {
  return translate(locale, key, params)
}
