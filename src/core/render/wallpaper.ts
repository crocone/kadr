/**
 * Wallpapers are generated in code: a pattern is a formula, not an image in the repo
 * (PLAN.md §9). Hence the model — pattern name plus two colours, no files or licences.
 *
 * Repeating patterns are tiled: one small tile instead of a twenty-thousand-pixel
 * canvas. The tile is drawn at 2x and scaled down when laid — so a 2x export stays
 * crisp instead of blurry.
 */
import type { WallpaperPattern } from '@/core/doc/types'

export const WALLPAPER_PATTERNS: readonly WallpaperPattern[] = [
  'mesh',
  'dots',
  'grid',
  'stripes',
  'rings',
]

/** Patterns laid as tiles; the rest are drawn as shapes across the whole canvas. */
export const TILED_PATTERNS: readonly WallpaperPattern[] = ['dots', 'grid', 'stripes']

export const TILE_SIZE = 64
export const TILE_OVERSAMPLE = 2

export type TileGeometry = {
  /** Pattern step in document units. */
  step: number
  /** Dot radius — `dots` only. */
  dotRadius: number
  /** Line width — `grid` and `stripes`. */
  lineWidth: number
}

export function tileGeometry(pattern: WallpaperPattern, step = TILE_SIZE): TileGeometry {
  switch (pattern) {
    case 'dots':
      return { step, dotRadius: step / 16, lineWidth: 0 }
    case 'grid':
      return { step, dotRadius: 0, lineWidth: Math.max(1, step / 32) }
    case 'stripes':
      return { step, dotRadius: 0, lineWidth: step / 3 }
    default:
      return { step, dotRadius: 0, lineWidth: 0 }
  }
}

/**
 * `mesh` blobs are canvas fractions, not pixels: the pattern lies the same on a small
 * capture and a long page. Positions are explicit, no RNG: the same document must
 * look the same on every open.
 */
export type Blob = { x: number; y: number; radius: number; colour: 'from' | 'to' }

export const MESH_BLOBS: readonly Blob[] = [
  { x: 0.18, y: 0.16, radius: 0.55, colour: 'from' },
  { x: 0.86, y: 0.28, radius: 0.45, colour: 'to' },
  { x: 0.52, y: 0.88, radius: 0.6, colour: 'to' },
  { x: 0.06, y: 0.78, radius: 0.4, colour: 'from' },
]

/** `rings` radii — also fractions, from the canvas centre outward. */
export function ringRadii(count = 7): number[] {
  return Array.from({ length: count }, (_, i) => ((i + 1) / count) * 0.85)
}

/** Pattern tile. Drawn transparent: a gradient of the same colours lies beneath. */
export function drawTile(
  context: CanvasRenderingContext2D,
  pattern: WallpaperPattern,
  colour: string,
  size: number,
): void {
  const { step, dotRadius, lineWidth } = tileGeometry(pattern, size)
  context.clearRect(0, 0, size, size)
  context.fillStyle = colour
  context.strokeStyle = colour

  switch (pattern) {
    case 'dots':
      for (const [x, y] of [
        [step / 4, step / 4],
        [(step * 3) / 4, (step * 3) / 4],
      ] as const) {
        context.beginPath()
        context.arc(x, y, dotRadius, 0, Math.PI * 2)
        context.fill()
      }
      break

    case 'grid':
      context.lineWidth = lineWidth
      context.beginPath()
      context.moveTo(0, lineWidth / 2)
      context.lineTo(step, lineWidth / 2)
      context.moveTo(lineWidth / 2, 0)
      context.lineTo(lineWidth / 2, step)
      context.stroke()
      break

    case 'stripes':
      // Diagonal stripe, drawn three times with an offset so tile seams line up.
      context.lineWidth = lineWidth
      context.beginPath()
      for (const shift of [-step, 0, step]) {
        context.moveTo(shift - step / 2, step * 1.5)
        context.lineTo(shift + step * 1.5, -step / 2)
      }
      context.stroke()
      break

    default:
      break
  }
}

export function makeTile(pattern: WallpaperPattern, colour: string): HTMLCanvasElement | null {
  if (!TILED_PATTERNS.includes(pattern)) return null

  const size = TILE_SIZE * TILE_OVERSAMPLE
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size

  const context = canvas.getContext('2d')
  if (!context) return null

  drawTile(context, pattern, colour, size)
  return canvas
}
