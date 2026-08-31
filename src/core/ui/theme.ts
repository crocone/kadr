import type { ThemePreference } from '@/core/storage/settings'

export type ResolvedTheme = 'light' | 'dark'

const DARK_QUERY = '(prefers-color-scheme: dark)'

const noop = () => undefined

export function resolveTheme(preference: ThemePreference, prefersDark: boolean): ResolvedTheme {
  if (preference === 'system') return prefersDark ? 'dark' : 'light'
  return preference
}

export function prefersDark(): boolean {
  return globalThis.matchMedia?.(DARK_QUERY).matches ?? false
}

/** System theme subscription: needed while the setting is on "system". */
export function watchPrefersDark(listener: (dark: boolean) => void): () => void {
  const media = globalThis.matchMedia?.(DARK_QUERY)
  if (!media) return noop
  const handler = (event: MediaQueryListEvent) => listener(event.matches)
  media.addEventListener('change', handler)
  return () => media.removeEventListener('change', handler)
}

/** <html> always gets a concrete theme — the CSS doesn't handle three states. */
export function applyTheme(theme: ResolvedTheme): void {
  document.documentElement.dataset.theme = theme
}
