/**
 * Background palette. Gradients are colour pairs drawn in code — no third-party
 * wallpapers in the repo, ever (PLAN.md §9).
 */
import type { Background, GradientBackground, WallpaperBackground, WallpaperPattern } from './types'

export type GradientPreset = { id: string; from: string; to: string }

export const GRADIENT_PRESETS: readonly GradientPreset[] = [
  { id: 'indigo', from: '#4f46e5', to: '#a855f7' },
  { id: 'sunset', from: '#f97316', to: '#db2777' },
  { id: 'ocean', from: '#0ea5e9', to: '#2563eb' },
  { id: 'mint', from: '#10b981', to: '#0ea5e9' },
  { id: 'ember', from: '#dc2626', to: '#f59e0b' },
  { id: 'grape', from: '#7c3aed', to: '#ec4899' },
  { id: 'forest', from: '#166534', to: '#65a30d' },
  { id: 'slate', from: '#334155', to: '#64748b' },
  { id: 'dusk', from: '#1e1b4b', to: '#701a75' },
  { id: 'sand', from: '#fbbf24', to: '#f472b6' },
  { id: 'steel', from: '#0f172a', to: '#334155' },
  { id: 'paper', from: '#e2e8f0', to: '#f8fafc' },
]

export const SOLID_PRESETS: readonly string[] = [
  '#ffffff',
  '#f1f5f9',
  '#cbd5e1',
  '#64748b',
  '#0f172a',
  '#000000',
  '#4f46e5',
  '#0ea5e9',
  '#16a34a',
  '#f59e0b',
  '#dc2626',
  '#db2777',
]

export const DEFAULT_GRADIENT_ANGLE = 135

export function wallpaperFromPreset(
  pattern: WallpaperPattern,
  preset: GradientPreset,
  angle = DEFAULT_GRADIENT_ANGLE,
): WallpaperBackground {
  return { kind: 'wallpaper', pattern, from: preset.from, to: preset.to, angle }
}

export function gradientFromPreset(
  preset: GradientPreset,
  angle = DEFAULT_GRADIENT_ANGLE,
): GradientBackground {
  return { kind: 'gradient', from: preset.from, to: preset.to, angle }
}

/**
 * Switching background kind keeps what's already configured: coming back from
 * "solid" to "gradient" should show the user's gradient, not the default.
 */
export function switchBackgroundKind(
  current: Background,
  kind: Background['kind'],
  remembered: Partial<Record<Background['kind'], Background>> = {},
): Background {
  if (current.kind === kind) return current

  const previous = remembered[kind]
  if (previous?.kind === kind) return previous

  switch (kind) {
    case 'gradient':
      return gradientFromPreset(GRADIENT_PRESETS[0]!)
    case 'wallpaper':
      return wallpaperFromPreset('mesh', GRADIENT_PRESETS[0]!)
    case 'solid':
      return { kind: 'solid', color: '#0f172a' }
    case 'transparent':
      return { kind: 'transparent' }
    case 'image':
      return { kind: 'image', imageId: '', fit: 'cover' }
  }
}
