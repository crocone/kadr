import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'

import { resolveSystemLocale, translate } from '@/core/i18n'
import type { Locale, MessageKey, TranslateParams } from '@/core/i18n'
import {
  DEFAULT_SETTINGS,
  onSettingsChanged,
  readSettings,
  type Settings,
  writeSettings,
} from '@/core/storage/settings'

import { AppContext, type AppContextValue } from './app-context'
import { applyTheme, prefersDark, resolveTheme, watchPrefersDark } from './theme'

/**
 * Shared shell for popup, editor, and options: theme and language are read from
 * chrome.storage.local and update across all open surfaces at once.
 */
export function AppProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [systemDark, setSystemDark] = useState<boolean>(prefersDark)

  useEffect(() => {
    void readSettings().then(setSettings)
    const unsubscribeSettings = onSettingsChanged(setSettings)
    const unsubscribeTheme = watchPrefersDark(setSystemDark)
    return () => {
      unsubscribeSettings()
      unsubscribeTheme()
    }
  }, [])

  const theme = resolveTheme(settings.theme, systemDark)

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const locale: Locale =
    settings.locale === 'system'
      ? resolveSystemLocale(chrome.i18n?.getUILanguage?.() ?? navigator.language)
      : settings.locale

  const updateSettings = useCallback(async (patch: Partial<Settings>) => {
    setSettings(await writeSettings(patch))
  }, [])

  const value = useMemo<AppContextValue>(
    () => ({
      settings,
      updateSettings,
      locale,
      theme,
      t: (key: MessageKey, params?: TranslateParams) => translate(locale, key, params),
    }),
    [settings, updateSettings, locale, theme],
  )

  return <AppContext value={value}>{children}</AppContext>
}
