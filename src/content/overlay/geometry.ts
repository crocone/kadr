/**
 * Selection frame arithmetic: construction, ratios, handles, moving.
 *
 * Everything here is pure functions over rects in viewport coordinates. DOM, events,
 * and styling live in `area.ts`: the frame is easier to verify with a test than by
 * eye, and a one-pixel corner error only shows up in the finished file.
 */
export type Rect = { x: number; y: number; w: number; h: number }
export type Point = { x: number; y: number }

/** Eight handles: four corners and four edge midpoints. */
export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

export const HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

/** Handle position as fractions of the frame size. */
export const HANDLE_ORIGIN: Record<Handle, Point> = {
  nw: { x: 0, y: 0 },
  n: { x: 0.5, y: 0 },
  ne: { x: 1, y: 0 },
  e: { x: 1, y: 0.5 },
  se: { x: 1, y: 1 },
  s: { x: 0.5, y: 1 },
  sw: { x: 0, y: 1 },
  w: { x: 0, y: 0.5 },
}

/** Ratio presets from the mockup. `free` is unconstrained, `screen` takes the whole viewport. */
export type Preset = 'free' | '16:9' | '1:1' | '4:3' | 'screen'

export const PRESETS: readonly Preset[] = ['16:9', '1:1', '4:3', 'free', 'screen']

const RATIOS: Record<Preset, number | null> = {
  free: null,
  '16:9': 16 / 9,
  '1:1': 1,
  '4:3': 4 / 3,
  screen: null,
}

export function ratioOf(preset: Preset): number | null {
  return RATIOS[preset]
}

export function rectFrom(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  }
}

/**
 * Frame from the press point to the cursor at a given ratio.
 *
 * The side dragged further (in ratio terms) leads: otherwise a diagonal drag would
 * flip the frame between "wide" and "tall" on every pixel.
 */
export function drawRect(anchor: Point, point: Point, ratio: number | null): Rect {
  if (ratio === null) return rectFrom(anchor, point)

  const dx = point.x - anchor.x
  const dy = point.y - anchor.y
  const wantedByWidth = Math.abs(dx)
  const wantedByHeight = Math.abs(dy) * ratio
  const w = Math.max(wantedByWidth, wantedByHeight)
  const h = w / ratio

  return rectFrom(anchor, {
    x: anchor.x + (dx < 0 ? -w : w),
    y: anchor.y + (dy < 0 ? -h : h),
  })
}

/**
 * Handle dragging. The opposite edge stays put — what you expect when grabbing a corner.
 *
 * With a ratio on, corners are computed from the fixed opposite corner, while edge
 * handles drive only their own axis: the other grows symmetrically around the centre.
 */
export function resizeRect(rect: Rect, handle: Handle, point: Point, ratio: number | null): Rect {
  const origin = HANDLE_ORIGIN[handle]
  const horizontal = origin.x !== 0.5
  const vertical = origin.y !== 0.5

  let left = rect.x
  let top = rect.y
  let right = rect.x + rect.w
  let bottom = rect.y + rect.h

  if (horizontal) {
    if (origin.x === 0) left = point.x
    else right = point.x
  }
  if (vertical) {
    if (origin.y === 0) top = point.y
    else bottom = point.y
  }

  const plain = rectFrom({ x: left, y: top }, { x: right, y: bottom })
  if (ratio === null) return plain

  // Fixed point: for a corner, the opposite corner; for an edge, the frame centre.
  const anchor = {
    x: horizontal ? (origin.x === 0 ? rect.x + rect.w : rect.x) : rect.x + rect.w / 2,
    y: vertical ? (origin.y === 0 ? rect.y + rect.h : rect.y) : rect.y + rect.h / 2,
  }

  if (horizontal && vertical) return drawRect(anchor, point, ratio)

  // Edge handle: the leading side is given, the other is derived from the ratio
  // and split evenly on both sides of the centre.
  const w = horizontal ? plain.w : plain.h * ratio
  const h = horizontal ? plain.w / ratio : plain.h

  return {
    x: horizontal ? plain.x : anchor.x - w / 2,
    y: vertical ? plain.y : anchor.y - h / 2,
    w,
    h,
  }
}

/** Moves the whole frame: size is preserved, so it stops at the viewport edge. */
export function moveRect(rect: Rect, dx: number, dy: number, bounds: Point): Rect {
  return {
    x: Math.min(Math.max(0, rect.x + dx), Math.max(0, bounds.x - rect.w)),
    y: Math.min(Math.max(0, rect.y + dy), Math.max(0, bounds.y - rect.h)),
    w: rect.w,
    h: rect.h,
  }
}

/** Clips to the viewport: there are no frame pixels beyond the window edge anyway. */
export function clampRect(rect: Rect, bounds: Point): Rect {
  const x = Math.min(Math.max(0, rect.x), bounds.x)
  const y = Math.min(Math.max(0, rect.y), bounds.y)
  return {
    x,
    y,
    w: Math.min(rect.w + Math.min(0, rect.x), bounds.x - x),
    h: Math.min(rect.h + Math.min(0, rect.y), bounds.y - y),
  }
}

/** Full-viewport frame — the "whole screen" preset. */
export function fullRect(bounds: Point): Rect {
  return { x: 0, y: 0, w: bounds.x, h: bounds.y }
}

/**
 * Size badge: density multiplier and the future file size in physical pixels.
 * These are the numbers that end up in the PNG — CSS pixels would lie on retina.
 */
export function sizeLabel(rect: Rect, devicePixelRatio: number): string {
  const w = Math.round(rect.w * devicePixelRatio)
  const h = Math.round(rect.h * devicePixelRatio)
  return devicePixelRatio === 1 ? `${w} × ${h}` : `×${devicePixelRatio} → ${w} × ${h}`
}
