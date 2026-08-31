/**
 * Guide annotation styling.
 *
 * The style lives on the guide, not in global settings: an internal-panel guide and a
 * customer-facing one are styled differently, and toggling a global setting between
 * them is busywork nobody should do. The shared default lives here.
 *
 * Pure module: values and their validation. `build.ts` applies them.
 */
import type { BadgeStyle } from '@/core/doc/types'

export type ScribeStyle = {
  /** Outline and badge color. */
  accent: string
  /** Outline around the element. */
  outline: boolean
  outlineWidth: number
  /** Step number. */
  badge: boolean
  badgeStyle: BadgeStyle
  badgeSize: number
  /** Caption under the frame. */
  caption: boolean
  captionSize: number
  captionColor: string
}

export const DEFAULT_SCRIBE_STYLE: ScribeStyle = {
  accent: '#6d5cf5',
  outline: true,
  outlineWidth: 3,
  badge: true,
  badgeStyle: 'number',
  badgeSize: 32,
  caption: true,
  captionSize: 22,
  captionColor: '#e7e9ee',
}

/** Size limits: below them annotations are unreadable, above them they eat the frame. */
export const STYLE_LIMITS = {
  outlineWidth: { min: 1, max: 12 },
  badgeSize: { min: 18, max: 72 },
  captionSize: { min: 12, max: 48 },
} as const

function clamp(value: number, limits: { min: number; max: number }): number {
  return Math.min(limits.max, Math.max(limits.min, Math.round(value)))
}

/**
 * Normalize a style loaded from the DB.
 *
 * Guides recorded before styles existed arrive with none at all, and fields may drift
 * out of range. Cheaper to normalize once here than to validate at every draw site.
 */
export function resolveStyle(style: Partial<ScribeStyle> | null | undefined): ScribeStyle {
  const merged = { ...DEFAULT_SCRIBE_STYLE, ...(style ?? {}) }
  return {
    ...merged,
    outlineWidth: clamp(merged.outlineWidth, STYLE_LIMITS.outlineWidth),
    badgeSize: clamp(merged.badgeSize, STYLE_LIMITS.badgeSize),
    captionSize: clamp(merged.captionSize, STYLE_LIMITS.captionSize),
  }
}
