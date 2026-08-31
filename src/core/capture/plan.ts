import type { Rect } from '@/core/doc/types'
import { MAX_CANVAS_AREA, MAX_CANVAS_SIDE } from '@/core/render/limits'

import type { PageMetrics, StitchPlan, StitchStep } from './types'

/**
 * Chrome allows at most two captureVisibleTab frames per second, so we keep
 * 550 ms between frames: 500 is the limit itself, the rest is timer-jitter
 * headroom.
 */
export const CAPTURE_INTERVAL_MS = 550

export { MAX_CANVAS_AREA, MAX_CANVAS_SIDE }

/**
 * Frames overlap: the last step hits the page end and covers part of the
 * previous one. Each frame is drawn at its actual scrollY, so the overlap gets
 * overwritten with identical content rather than shifted.
 */
export function planFullPageCapture(metrics: PageMetrics): StitchPlan {
  const dpr = metrics.devicePixelRatio
  const viewportHeight = Math.max(1, metrics.viewportHeight)
  const width = metrics.viewportWidth

  let height = Math.max(metrics.scrollHeight, viewportHeight)
  let truncated = false

  const maxHeightBySide = Math.floor(MAX_CANVAS_SIDE / dpr)
  const maxHeightByArea = Math.floor(MAX_CANVAS_AREA / (width * dpr * dpr))
  const maxHeight = Math.min(maxHeightBySide, maxHeightByArea)
  if (height > maxHeight) {
    height = maxHeight
    truncated = true
  }

  const steps: StitchStep[] = []
  const lastScrollY = Math.max(0, height - viewportHeight)
  for (let index = 0, scrollY = 0; ; index++) {
    steps.push({ index, scrollY: Math.min(scrollY, lastScrollY) })
    if (scrollY >= lastScrollY) break
    scrollY += viewportHeight
  }

  return {
    canvasWidth: Math.round(width * dpr),
    canvasHeight: Math.round(height * dpr),
    devicePixelRatio: dpr,
    steps,
    truncated,
    estimatedMs: steps.length * CAPTURE_INTERVAL_MS,
  }
}

/** Viewport CSS pixels to physical frame pixels, rounded outward. */
export function cssRectToDeviceRect(rect: Rect, dpr: number): Rect {
  const x = Math.floor(rect.x * dpr)
  const y = Math.floor(rect.y * dpr)
  return {
    x,
    y,
    w: Math.ceil((rect.x + rect.w) * dpr) - x,
    h: Math.ceil((rect.y + rect.h) * dpr) - y,
  }
}

/** The rect may stick out of the frame: an edge selection or an element wider than the viewport. */
export function clampRect(rect: Rect, width: number, height: number): Rect {
  const x = Math.max(0, Math.min(rect.x, width))
  const y = Math.max(0, Math.min(rect.y, height))
  return {
    x,
    y,
    w: Math.max(1, Math.min(rect.w, width - x)),
    h: Math.max(1, Math.min(rect.h, height - y)),
  }
}

/**
 * If the element fits the viewport, take one frame; if not, stitch the whole
 * page and crop it out. The second path costs roughly frame-count times more,
 * so the decision is made once and explicitly.
 */
export function elementCaptureStrategy(
  rect: Rect,
  metrics: PageMetrics,
): 'single-frame' | 'full-page' {
  const fits = rect.h <= metrics.viewportHeight && rect.w <= metrics.viewportWidth
  return fits ? 'single-frame' : 'full-page'
}

/** Centers the element in the viewport without exceeding the page's scroll range. */
export function centreScrollY(rect: Rect, metrics: PageMetrics): number {
  const maxScroll = Math.max(0, metrics.scrollHeight - metrics.viewportHeight)
  const centred = rect.y - (metrics.viewportHeight - rect.h) / 2
  return Math.max(0, Math.min(centred, maxScroll))
}

/** Page coordinates to frame coordinates: the element was picked before scrolling. */
export function pageRectToViewportRect(rect: Rect, scrollX: number, scrollY: number): Rect {
  return { ...rect, x: rect.x - scrollX, y: rect.y - scrollY }
}

/** Thumbnail size for the recents strip: fit into a square, keep proportions. */
export function thumbnailSize(width: number, height: number, max: number) {
  const scale = Math.min(1, max / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}
