import { createContext, use } from 'react'

import type { Locale, MessageKey, TranslateParams } from '@/core/i18n'
import type { Settings } from '@/core/storage/settings'

import type { ResolvedTheme } from './theme'

export type AppContextValue = {
  settings: Settings
  updateSettings: (patch: Partial<Settings>) => Promise<void>
  locale: Locale
  theme: ResolvedTheme
  t: (key: MessageKey, params?: TranslateParams) => string
}

export const AppContext = createContext<AppContextValue | null>(null)

export function useApp(): AppContextValue {
  const value = use(AppContext)
  if (!value) throw new Error('useApp must be used inside <AppProvider>')
  return value
}

export function useT(): AppContextValue['t'] {
  return useApp().t
}
