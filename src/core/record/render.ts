/**
 * One frame of a clip, drawn.
 *
 * The player and the exporter both call this and nothing else. That is the same rule
 * the screenshot side follows — preview and file render from one model — and it removes
 * the entire class of bugs where the export looks different from what was on screen. A
 * zoom that lands half a second late is invisible while scrubbing and obvious in the
 * finished file.
 *
 * Everything positional in a clip is a fraction of the video frame: the crop, the camera
 * centre, the click points. So the whole job here is one mapping — from frame fractions
 * to canvas pixels — applied to a handful of things.
 */
import { chromeHeight } from '@/core/doc/frames'
import { withAlpha } from '@/core/render/color'
import { paintDecoration } from '@/core/render/decoration'
import { paintBackground, roundedRect } from '@/core/render/paint'
import type { Point, Rect } from '@/core/doc/types'

import { clickPulses } from './clicks'
import type { Clip } from './types'
import { cameraAt } from './zoom'

/** The frame area the clip keeps, in fractions. */
export function cropOf(clip: Clip): Rect {
  return clip.edit.crop ?? { x: 0, y: 0, w: 1, h: 1 }
}

/** Size of the picture itself, in pixels, after the crop and before the padding. */
export function contentSize(clip: Clip): { w: number; h: number } {
  const crop = cropOf(clip)
  return {
    w: Math.max(1, Math.round(clip.width * crop.w)),
    h: Math.max(1, Math.round(clip.height * crop.h)),
  }
}

/**
 * Height of the browser chrome above the picture, in pixels. Zero without a frame.
 *
 * The chrome is not padding: it sits directly on top of the video with no gap, and the
 * padding then goes around the pair of them. Treating it as extra padding would leave a
 * seam between the toolbar and the page it belongs to.
 */
export function chromeOf(clip: Clip): number {
  if (clip.decoration.frame.style === 'none') return 0
  return chromeHeight(contentSize(clip).w)
}

/**
 * Size of the finished frame. Even numbers on both sides: every video encoder worth
 * using wants them, and an odd height is the difference between an MP4 and an error.
 */
export function outputSize(clip: Clip, scale = 1): { w: number; h: number } {
  const content = contentSize(clip)
  const padding = clip.decoration.padding
  const even = (value: number) => Math.max(2, Math.round((value * scale) / 2) * 2)

  return {
    w: even(content.w + padding * 2),
    h: even(content.h + chromeOf(clip) + padding * 2),
  }
}

/**
 * The window of the frame that is visible at this moment: the crop, narrowed by
 * whatever the camera is doing, and kept inside the crop so the view never runs off
 * the edge of the picture into empty canvas.
 */
export function windowAt(clip: Clip, sourceMs: number): Rect {
  const crop = cropOf(clip)
  const camera = cameraAt(clip.edit.zooms, sourceMs)

  const w = crop.w / camera.scale
  const h = crop.h / camera.scale
  const x = Math.min(crop.x + crop.w - w, Math.max(crop.x, camera.at.x - w / 2))
  const y = Math.min(crop.y + crop.h - h, Math.max(crop.y, camera.at.y - h / 2))

  return { x, y, w, h }
}

/** Frame fractions to canvas pixels, through the visible window. */
function project(point: Point, window: Rect, box: Rect): Point {
  return {
    x: box.x + ((point.x - window.x) / window.w) * box.w,
    y: box.y + ((point.y - window.y) / window.h) * box.h,
  }
}

/**
 * Click ripples: a ring that grows and fades. Drawn under the pointer, so the pointer
 * never disappears inside its own ripple.
 */
function drawClicks(
  context: CanvasRenderingContext2D,
  clip: Clip,
  sourceMs: number,
  window: Rect,
  box: Rect,
): void {
  const style = clip.edit.clicks
  const radius = style.size * box.h

  for (const pulse of clickPulses(clip.events, sourceMs, style.duration)) {
    const at = project(pulse.at, window, box)
    const grown = radius * (0.35 + pulse.progress * 0.65)

    context.save()
    context.globalAlpha = 1 - pulse.progress
    context.beginPath()
    context.arc(at.x, at.y, grown, 0, Math.PI * 2)
    context.fillStyle = withAlpha(style.color, 0.25)
    context.fill()
    context.lineWidth = Math.max(1.5, radius * 0.12)
    context.strokeStyle = style.color
    context.stroke()
    context.restore()
  }
}

/**
 * Draws the frame. `source` is whatever holds the picture at `sourceMs` — a `<video>`
 * seeked to it during playback, a decoded `VideoFrame` during export.
 *
 * The caller is responsible for the two of them agreeing: this function trusts that the
 * pixels handed to it are the pixels of that moment, and draws the camera and the
 * ripples for it.
 */
export function drawClipFrame(
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  clip: Clip,
  sourceMs: number,
  size: { w: number; h: number } = outputSize(clip),
  /**
   * Decoded bitmap for an uploaded background. Loaded once by the caller and passed in
   * every frame: decoding a picture inside the draw loop would decode it thirty times a
   * second.
   */
  backdrop: CanvasImageSource | null = null,
): void {
  const { decoration } = clip
  const scale = size.w / outputSize(clip).w
  const padding = decoration.padding * scale
  const chrome = chromeOf(clip) * scale

  // The picture sits below the chrome; the chrome sits inside the padding with it.
  const box: Rect = {
    x: padding,
    y: padding + chrome,
    w: Math.max(1, size.w - padding * 2),
    h: Math.max(1, size.h - padding * 2 - chrome),
  }

  context.clearRect(0, 0, size.w, size.h)
  paintBackground(context, decoration.background, size.w, size.h, backdrop)

  const radius = decoration.radius * scale

  // The shadow is cast by an opaque rounded rectangle drawn first: a shadow on the
  // video draw itself would be recomputed for every frame of a moving picture, which is
  // the single most expensive thing this function could do. With a frame it wraps the
  // chrome too, since the chrome is part of the same object.
  if (decoration.shadow.preset !== 'none' && decoration.shadow.opacity > 0) {
    context.save()
    context.shadowColor = withAlpha(decoration.shadow.color, decoration.shadow.opacity)
    context.shadowBlur = decoration.shadow.blur * scale
    context.shadowOffsetX = decoration.shadow.offsetX * scale
    context.shadowOffsetY = decoration.shadow.offsetY * scale
    context.fillStyle = '#000000'
    roundedRect(context, box.x, box.y - chrome, box.w, box.h + chrome, radius)
    context.fill()
    context.restore()
  }

  /**
   * The chrome, drawn by the screenshot editor's own painter.
   *
   * It works in the picture's coordinates with the origin at its top-left corner and the
   * header in negative Y — the same contract the editor's scene uses — so the translate
   * below is the whole of the adaptation.
   */
  if (decoration.frame.style !== 'none') {
    context.save()
    context.translate(box.x, box.y)
    paintDecoration(
      context,
      {
        frame: decoration.frame,
        mockup: 'none',
        customMockup: null,
        radius: decoration.radius,
        shadow: decoration.shadow,
      },
      clip.page?.domain ?? null,
      box.w,
      box.h,
    )
    context.restore()
  }

  const window = windowAt(clip, sourceMs)

  context.save()
  roundedRect(context, box.x, box.y, box.w, box.h, radius)
  context.clip()

  context.drawImage(
    source,
    window.x * clip.width,
    window.y * clip.height,
    Math.max(1, window.w * clip.width),
    Math.max(1, window.h * clip.height),
    box.x,
    box.y,
    box.w,
    box.h,
  )

  if (clip.edit.clicks.show) drawClicks(context, clip, sourceMs, window, box)

  context.restore()
}
