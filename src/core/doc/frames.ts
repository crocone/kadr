/**
 * Geometry of browser frames and device mockups.
 *
 * A frame never moves the capture: the shot stays put and the chrome is drawn
 * around it. So this module only deals in sizes — how much to add on top for the
 * browser bar and around the edges for the device body.
 *
 * Proportions derive from the capture width instead of fixed pixels: a 44 px bar
 * looks like a thread on a 2560 px shot and like half the picture on a 400 px one.
 *
 * Frames are drawn in code. No third-party mockups in the repo, ever:
 * device bodies are someone else's industrial designs and images, and a rounded
 * rectangle of the right proportions is enough here.
 */
import type {
  BrowserFrameStyle,
  CustomMockup,
  Decoration,
  DeviceMockup,
  Doc,
  Point,
  Rect,
} from './types'

/** Browser bar height as a fraction of capture width, with pixel floor and ceiling. */
export function chromeHeight(width: number): number {
  return Math.max(28, Math.min(76, Math.round(width * 0.052)))
}

export type DeviceSpec = {
  /** Body bezel as a fraction of the screen's shorter side. */
  bezel: number
  /** Body and screen corner radii as fractions of the screen's shorter side. */
  bodyRadius: number
  screenRadius: number
  /** Cutout: island, punch-hole, notch, or none. */
  cutout: 'island' | 'hole' | 'notch' | 'none'
  /** Bottom base — laptop only. */
  base: boolean
  /** The device's own screen aspect ratio, width to height. */
  aspect: number
}

export const DEVICES: Record<Exclude<DeviceMockup, 'none'>, DeviceSpec> = {
  'iphone-16-pro': {
    bezel: 0.035,
    bodyRadius: 0.16,
    screenRadius: 0.13,
    cutout: 'island',
    base: false,
    aspect: 1179 / 2556,
  },
  'pixel-9-pro': {
    bezel: 0.032,
    bodyRadius: 0.11,
    screenRadius: 0.09,
    cutout: 'hole',
    base: false,
    aspect: 1280 / 2856,
  },
  'ipad-pro-m4': {
    bezel: 0.045,
    bodyRadius: 0.06,
    screenRadius: 0.045,
    cutout: 'none',
    base: false,
    aspect: 2064 / 2752,
  },
  'macbook-pro': {
    bezel: 0.012,
    bodyRadius: 0.02,
    screenRadius: 0.015,
    cutout: 'notch',
    base: true,
    aspect: 3456 / 2234,
  },
  custom: {
    bezel: 0.04,
    bodyRadius: 0.05,
    screenRadius: 0.03,
    cutout: 'none',
    base: false,
    aspect: 16 / 9,
  },
}

/** Laptop base: height and overhang as fractions of screen width. */
export const BASE = { height: 0.028, overhang: 0.075 } as const

/**
 * The box the capture occupies together with its chrome.
 *
 * Needed for fitting and centring: without it the browser bar would slide past
 * the canvas top edge, because the canvas would only count the shot itself.
 */
export function decoratedRect(
  screen: Rect,
  frame: BrowserFrameStyle,
  mockup: DeviceMockup,
  custom: CustomMockup | null = null,
): Rect {
  if (mockup === 'custom') return custom ? customMockupRect(screen, custom) : screen

  if (mockup !== 'none') {
    const spec = DEVICES[mockup]
    const bezel = Math.min(screen.w, screen.h) * spec.bezel
    const base = spec.base ? screen.w * BASE.height : 0
    const overhang = spec.base ? screen.w * BASE.overhang : 0

    return {
      x: screen.x - bezel - overhang,
      y: screen.y - bezel,
      w: screen.w + bezel * 2 + overhang * 2,
      h: screen.h + bezel * 2 + base,
    }
  }

  if (frame === 'none') return screen

  const head = chromeHeight(screen.w)
  return { x: screen.x, y: screen.y - head, w: screen.w, h: screen.h + head }
}

/**
 * Box of a custom mockup: the image is stretched so its screen zone lands exactly
 * on the capture. Computed as the inverse ratio — however many times the capture
 * is smaller than the zone, the mockup is that much larger than the capture.
 */
export function customMockupRect(screen: Rect, custom: CustomMockup): Rect {
  const zone = custom.screen
  if (zone.w <= 0 || zone.h <= 0) return screen

  const w = screen.w / zone.w
  const h = screen.h / zone.h

  return { x: screen.x - zone.x * w, y: screen.y - zone.y * h, w, h }
}

/** Same, from a decoration: the capture takes it from the canvas, an image layer from itself. */
export function decoratedRectFor(decoration: Decoration, screen: Rect): Rect {
  return decoratedRect(screen, decoration.frame.style, decoration.mockup, decoration.customMockup)
}

/** The document capture's decoration; stored on the canvas — historically, and rightly so. */
export function captureDecoration(doc: Doc): Decoration {
  return {
    frame: doc.canvas.frame,
    mockup: doc.canvas.mockup,
    customMockup: doc.canvas.customMockup,
    radius: doc.canvas.radius,
    shadow: doc.canvas.shadow,
  }
}

export function decoratedRectOf(doc: Doc, screen: Rect): Rect {
  return decoratedRectFor(captureDecoration(doc), screen)
}

export function hasDecoration(decoration: Decoration | null): boolean {
  return decoration !== null && (decoration.mockup !== 'none' || decoration.frame.style !== 'none')
}

/**
 * Corner rounding of the shot under its chrome.
 *
 * Under a browser bar the top corners stay square: the bar rounds them itself,
 * and a second rounding inside the first looks like a defect. In a device, the
 * screen is rounded to match the body.
 */
export function screenCorners(decoration: Decoration, screen: Rect): number | number[] {
  // A custom mockup image draws its own rounding — a second one on top is noise.
  if (decoration.mockup === 'custom') return 0

  if (decoration.mockup !== 'none') {
    const spec = DEVICES[decoration.mockup]
    return Math.min(screen.w, screen.h) * spec.screenRadius
  }

  const radius = decoration.radius
  return decoration.frame.style === 'none' ? radius : [0, 0, radius, radius]
}

/**
 * Address for the browser URL bar. An empty URL falls back to the shot's domain:
 * that's what's usually wanted, and retyping it is a wasted step.
 */
export function displayUrl(url: string, domain: string | null): string {
  const typed = url.trim()
  // Empty string means "not set", not "set to empty" — so the domain kicks in.
  const shown = typed === '' ? (domain ?? '') : typed

  return shown.replace(/^https?:\/\//, '')
}

/**
 * Favicon letter and colour, derived from the address.
 *
 * A real site icon would have to be fetched from the network, and the extension
 * doesn't go online. A domain letter in a coloured square reads just
 * as well and doesn't lie: it's obviously drawn, not passed off as the real icon.
 */
export function faviconFor(url: string): { letter: string; color: string } {
  const host = displayUrl(url, null).split('/')[0] ?? ''
  const name = host.replace(/^www\./, '')
  const letter = (name[0] ?? '•').toUpperCase()

  let hash = 0
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) % 360

  return { letter, color: `hsl(${hash} 62% 52%)` }
}

/**
 * Capture tilt as Konva skew.
 *
 * A 2D canvas has no real perspective, and faking it with a matrix for the sake
 * of two sliders isn't worth it: skew gives the same "card at an angle", while
 * rotation and the frame keep computing as before. The angle is clamped — beyond
 * it the capture folds over.
 */
export const TILT_LIMIT = 35

export function tiltSkew(tilt: Point): { skewX: number; skewY: number } {
  const clamp = (value: number) => Math.max(-TILT_LIMIT, Math.min(TILT_LIMIT, value))

  return {
    skewX: Math.tan((clamp(tilt.y) * Math.PI) / 180),
    skewY: Math.tan((clamp(tilt.x) * Math.PI) / 180),
  }
}
