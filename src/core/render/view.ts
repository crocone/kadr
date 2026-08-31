/**
 * Document position within the viewport: zoom plus offset.
 *
 * Fitting a long capture entirely is pointless: a twenty-thousand-pixel-tall page
 * shrinks ~20x into the panel and no filtering can save that — the information just
 * isn't there anymore. So by default the document is fitted to width and scrolls
 * vertically.
 */
import type { Content, Size } from './fit'

export type Point = { x: number; y: number }
export type View = { zoom: number; x: number; y: number }

export const ZOOM_MIN = 0.02
/** High ceiling so individual pixels of the capture can be inspected. */
export const ZOOM_MAX = 64
export const ZOOM_STEP = 1.15

export function clampZoom(zoom: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom))
}

/**
 * Initial view: fit to width, but no larger than natural size. If the document also
 * fits vertically it is centred — a short capture shouldn't stick to the top edge.
 */
export function initialView(content: Content, viewport: Size, maxZoom = 1): View | null {
  if (content.w <= 0 || content.h <= 0) return null
  if (viewport.width <= 0 || viewport.height <= 0) return null

  const byWidth = Math.min(viewport.width / content.w, maxZoom)
  const fitsVertically = content.h * byWidth <= viewport.height
  const zoom = clampZoom(byWidth)

  return {
    zoom,
    x: (viewport.width - content.w * zoom) / 2,
    y: fitsVertically ? (viewport.height - content.h * zoom) / 2 : 0,
  }
}

/** Fit the whole document, however long it is. */
export function fitView(content: Content, viewport: Size, maxZoom = 1): View | null {
  if (content.w <= 0 || content.h <= 0) return null
  if (viewport.width <= 0 || viewport.height <= 0) return null

  const zoom = clampZoom(Math.min(viewport.width / content.w, viewport.height / content.h, maxZoom))
  return {
    zoom,
    x: (viewport.width - content.w * zoom) / 2,
    y: (viewport.height - content.h * zoom) / 2,
  }
}

/** Zoom around a point: the same document pixel stays under the cursor. */
export function zoomAt(view: View, pointer: Point, nextZoom: number): View {
  const zoom = clampZoom(nextZoom)
  const documentX = (pointer.x - view.x) / view.zoom
  const documentY = (pointer.y - view.y) / view.zoom

  return {
    zoom,
    x: pointer.x - documentX * zoom,
    y: pointer.y - documentY * zoom,
  }
}

/** Zoom around the viewport centre — for the +/- buttons. */
export function zoomAtCentre(view: View, viewport: Size, nextZoom: number): View {
  return zoomAt(view, { x: viewport.width / 2, y: viewport.height / 2 }, nextZoom)
}
