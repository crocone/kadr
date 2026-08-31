/**
 * Background picking from the frame's colours. Computed locally from a histogram:
 * no network, no API key, yet it feels "smart" (PLAN.md §7).
 *
 * Near-white and near-black are dropped on purpose: most pages are white, and without
 * this every pick would yield the same grey gradient.
 */
import type { GradientBackground } from '@/core/doc/types'

import { asBackdrop, rgbToHex, type Rgb, rgbToHsl, shiftHue } from './color'

const BUCKETS_PER_CHANNEL = 4
const BUCKET_SIZE = 256 / BUCKETS_PER_CHANNEL

export type ColorWeight = { color: Rgb; weight: number }

/** Histogram over 4x4x4 buckets: coarse enough for close shades to merge. */
export function dominantColors(pixels: Uint8ClampedArray, limit = 4): ColorWeight[] {
  const sums = new Map<number, { r: number; g: number; b: number; n: number }>()

  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const alpha = pixels[i + 3] ?? 0
    if (alpha < 128) continue

    const r = pixels[i] ?? 0
    const g = pixels[i + 1] ?? 0
    const b = pixels[i + 2] ?? 0

    const key =
      Math.floor(r / BUCKET_SIZE) * BUCKETS_PER_CHANNEL * BUCKETS_PER_CHANNEL +
      Math.floor(g / BUCKET_SIZE) * BUCKETS_PER_CHANNEL +
      Math.floor(b / BUCKET_SIZE)

    const bucket = sums.get(key) ?? { r: 0, g: 0, b: 0, n: 0 }
    bucket.r += r
    bucket.g += g
    bucket.b += b
    bucket.n += 1
    sums.set(key, bucket)
  }

  return [...sums.values()]
    .map((bucket) => ({
      color: {
        r: Math.round(bucket.r / bucket.n),
        g: Math.round(bucket.g / bucket.n),
        b: Math.round(bucket.b / bucket.n),
      },
      weight: bucket.n,
    }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, limit)
}

/** Drops what a backdrop can't be made of: paper, ink and grey UI chrome. */
export function pickAccents(colors: ColorWeight[]): Rgb[] {
  return colors
    .filter(({ color }) => {
      const { s, l } = rgbToHsl(color)
      return l > 0.12 && l < 0.92 && s > 0.18
    })
    .map(({ color }) => color)
}

/**
 * Gradient from the frame: the two most prominent colours, adjusted to backdrop
 * lightness. With only one accent the second comes from a hue shift, so the
 * transition stays visible.
 */
export function gradientFromColors(colors: ColorWeight[]): GradientBackground | null {
  const accents = pickAccents(colors)
  if (accents.length === 0) return null

  const first = accents[0]!
  const second = accents[1] ?? shiftHue(first, 42)

  return {
    kind: 'gradient',
    from: rgbToHex(asBackdrop(first, 0.52)),
    to: rgbToHex(asBackdrop(second, 0.68)),
    angle: 135,
  }
}

/**
 * Downscaled copy of the frame: no point computing the histogram at full size,
 * which for a long page means tens of millions of pixels.
 */
export function samplePixels(image: CanvasImageSource, side = 64): Uint8ClampedArray | null {
  const canvas = document.createElement('canvas')
  canvas.width = side
  canvas.height = side
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return null

  context.drawImage(image, 0, 0, side, side)
  return context.getImageData(0, 0, side, side).data
}
