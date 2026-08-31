/**
 * Fitting the document into the viewport.
 *
 * A separate function, not an inline expression in a component, because of a concrete
 * breakage: before the first ResizeObserver tick the container size is zero, the
 * scale came out zero, Konva created a 0x0 buffer canvas and crashed in drawImage
 * with "The image argument is a canvas element with a width or height of 0".
 * Hence "not measured yet" is a distinct value, not zero.
 */
export type Size = { width: number; height: number }
export type Content = { w: number; h: number }

/** Fit scale, or null when there is nothing to draw or nowhere to draw it. */
export function fitScale(content: Content, viewport: Size, maxScale = 1): number | null {
  if (content.w <= 0 || content.h <= 0) return null
  if (viewport.width <= 0 || viewport.height <= 0) return null
  return Math.min(viewport.width / content.w, viewport.height / content.h, maxScale)
}

/**
 * Background image layout: `cover` fills the canvas with cropping, `contain` fits it
 * whole. Same math, only the choice of side differs.
 */
export function coverRect(
  image: Content,
  viewport: Size,
  fit: 'cover' | 'contain',
): { x: number; y: number; w: number; h: number } {
  if (image.w <= 0 || image.h <= 0) return { x: 0, y: 0, w: viewport.width, h: viewport.height }

  const byWidth = viewport.width / image.w
  const byHeight = viewport.height / image.h
  const scale = fit === 'cover' ? Math.max(byWidth, byHeight) : Math.min(byWidth, byHeight)

  const w = image.w * scale
  const h = image.h * scale
  return { x: (viewport.width - w) / 2, y: (viewport.height - h) / 2, w, h }
}

/**
 * Document rectangle → source image rectangle.
 *
 * Needed by blur and redaction: they live in document coordinates, but pixels are cut
 * from the frame, which keeps its own resolution and is drawn scaled. That way blur
 * stays a layer on top of the frame, not a hole burned into it (PLAN.md §4).
 */
export function documentRectToImageRect(
  region: { x: number; y: number; w: number; h: number },
  frame: { x: number; y: number; w: number; h: number },
  image: Content,
): { x: number; y: number; w: number; h: number } | null {
  if (frame.w <= 0 || frame.h <= 0) return null

  const scaleX = image.w / frame.w
  const scaleY = image.h / frame.h

  return {
    x: (region.x - frame.x) * scaleX,
    y: (region.y - frame.y) * scaleY,
    w: region.w * scaleX,
    h: region.h * scaleY,
  }
}
