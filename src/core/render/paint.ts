/**
 * Painting a background onto a plain 2D canvas.
 *
 * The screenshot editor draws its scene with Konva, which has its own way of expressing
 * a gradient; the clip renderer cannot use it, because a video frame is composited
 * thirty times a second and going through a scene graph for each one is a waste. So the
 * same background description gets a second painter here — but the geometry that
 * decides where a gradient starts and ends is shared, since a background that looks one
 * way behind a screenshot and another behind a clip is a bug people notice immediately.
 *
 * An image background needs its bitmap supplied by the caller: this module cannot load
 * one, and decoding a picture inside a per-frame draw call would be a decoded picture per
 * frame. The clip editor loads it once and hands the same element in every time.
 */
import type { Background, Point } from '@/core/doc/types'

import { coverRect } from './fit'
import { makeTile, TILE_SIZE } from './wallpaper'

/** Angle in degrees to the two ends of the gradient across the box diagonal. */
export function gradientLine(w: number, h: number, angle: number): { start: Point; end: Point } {
  const radians = (angle * Math.PI) / 180
  const dx = Math.cos(radians)
  const dy = Math.sin(radians)
  const half = { x: w / 2, y: h / 2 }
  const reach = Math.abs(dx) * half.x + Math.abs(dy) * half.y

  return {
    start: { x: half.x - dx * reach, y: half.y - dy * reach },
    end: { x: half.x + dx * reach, y: half.y + dy * reach },
  }
}

/**
 * Fills the box with the background. A transparent background paints nothing at all —
 * not a white rectangle: the caller may want the alpha channel, and a WebM with a
 * transparent frame is a legitimate thing to want.
 */
export function paintBackground(
  context: CanvasRenderingContext2D,
  background: Background,
  w: number,
  h: number,
  /** Decoded bitmap for an image background; ignored by every other kind. */
  image?: CanvasImageSource | null,
): void {
  if (background.kind === 'transparent') return

  if (background.kind === 'image') {
    if (!image) return
    paintImage(context, background.fit, image, w, h)
    return
  }

  if (background.kind === 'solid') {
    context.fillStyle = background.color
    context.fillRect(0, 0, w, h)
    return
  }

  const { start, end } = gradientLine(w, h, background.angle)
  const gradient = context.createLinearGradient(start.x, start.y, end.x, end.y)

  if (background.kind === 'gradient') {
    gradient.addColorStop(0, background.from)
    gradient.addColorStop(1, background.to)
    context.fillStyle = gradient
    context.fillRect(0, 0, w, h)
    return
  }

  // Wallpaper: one flat colour under a pattern drawn in the other. The gradient is
  // built from `from` at both ends on purpose — the pattern supplies the variation, and
  // a gradient underneath it as well makes the tiling read as banding.
  gradient.addColorStop(0, background.from)
  gradient.addColorStop(1, background.from)
  context.fillStyle = gradient
  context.fillRect(0, 0, w, h)

  const tile = makeTile(background.pattern, background.to)
  if (!tile) return

  const pattern = context.createPattern(tile, 'repeat')
  if (!pattern) return

  // The tile is generated at twice the size so it stays crisp when exported at 2x;
  // here it is scaled back down to its nominal step.
  const scale = TILE_SIZE / tile.width
  pattern.setTransform(new DOMMatrix([scale, 0, 0, scale, 0, 0]))
  context.fillStyle = pattern
  context.fillRect(0, 0, w, h)
}

/**
 * An uploaded picture behind the frame.
 *
 * `cover` and `contain` reuse the screenshot editor's fitting maths so the same image
 * sits the same way behind a clip and behind a shot. `tile` repeats it at its own size:
 * scaling a tile would show the seams.
 */
function paintImage(
  context: CanvasRenderingContext2D,
  fit: 'cover' | 'contain' | 'tile',
  image: CanvasImageSource,
  w: number,
  h: number,
): void {
  const natural = sizeOf(image)
  if (natural.w <= 0 || natural.h <= 0) return

  if (fit === 'tile') {
    const pattern = context.createPattern(image, 'repeat')
    if (!pattern) return
    context.fillStyle = pattern
    context.fillRect(0, 0, w, h)
    return
  }

  const rect = coverRect(natural, { width: w, height: h }, fit)
  context.save()
  context.beginPath()
  context.rect(0, 0, w, h)
  context.clip()
  context.drawImage(image, rect.x, rect.y, rect.w, rect.h)
  context.restore()
}

/**
 * Natural size of whatever the caller handed over. Every kind of `CanvasImageSource`
 * spells it differently, and a `VideoFrame` spells it twice — coded and display.
 */
function sizeOf(image: CanvasImageSource): { w: number; h: number } {
  if (image instanceof HTMLImageElement) return { w: image.naturalWidth, h: image.naturalHeight }
  if (image instanceof HTMLVideoElement) return { w: image.videoWidth, h: image.videoHeight }
  if ('displayWidth' in image) return { w: image.displayWidth, h: image.displayHeight }
  if ('width' in image && typeof image.width === 'number') {
    return { w: image.width, h: image.height as number }
  }
  return { w: 0, h: 0 }
}

/** Rounded-rect path, the one shape every decorated frame needs. */
export function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
): void {
  const r = Math.max(0, Math.min(radius, Math.min(w, h) / 2))
  context.beginPath()
  context.moveTo(x + r, y)
  context.arcTo(x + w, y, x + w, y + h, r)
  context.arcTo(x + w, y + h, x, y + h, r)
  context.arcTo(x, y + h, x, y, r)
  context.arcTo(x, y, x + w, y, r)
  context.closePath()
}
