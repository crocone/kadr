/**
 * Image filters.
 *
 * Applied via the 2D context's filter, not Konva filters. Konva filters only work
 * through a node cache, and a full-page frame is a canvas of tens of millions of
 * pixels: a cache that size would be rebuilt on every slider move. The context filter
 * needs none of that and matches CSS semantics.
 */
import type { ImageFilters } from '@/core/doc/types'

export const NEUTRAL: ImageFilters = { brightness: 0, contrast: 0, saturation: 0, hue: 0 }

export function isNeutral(filters: ImageFilters): boolean {
  return (
    filters.brightness === 0 &&
    filters.contrast === 0 &&
    filters.saturation === 0 &&
    filters.hue === 0
  )
}

/** -100..100 → 0..2, where zero means "unchanged". */
function ratio(value: number): number {
  return Math.max(0, 1 + value / 100)
}

/**
 * String for `context.filter`. Neutral values are omitted: a shorter string is
 * cheaper, and `none` instead of an empty string explicitly clears the filter.
 */
export function cssFilterString(filters: ImageFilters): string {
  const parts: string[] = []

  if (filters.brightness !== 0) parts.push(`brightness(${ratio(filters.brightness).toFixed(3)})`)
  if (filters.contrast !== 0) parts.push(`contrast(${ratio(filters.contrast).toFixed(3)})`)
  if (filters.saturation !== 0) parts.push(`saturate(${ratio(filters.saturation).toFixed(3)})`)
  if (filters.hue !== 0) parts.push(`hue-rotate(${filters.hue}deg)`)

  return parts.length > 0 ? parts.join(' ') : 'none'
}
