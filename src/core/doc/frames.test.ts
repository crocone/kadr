import { describe, expect, it } from 'vitest'

import { createDoc } from './create'
import {
  captureDecoration,
  chromeHeight,
  decoratedRect,
  decoratedRectFor,
  DEVICES,
  displayUrl,
  faviconFor,
  customMockupRect,
  hasDecoration,
  screenCorners,
  TILT_LIMIT,
  tiltSkew,
} from './frames'
import type { Doc, Rect } from './types'

const SCREEN: Rect = { x: 100, y: 100, w: 1000, h: 600 }

const doc = (patch: Partial<Doc['canvas']> = {}): Doc => {
  const base = createDoc({ imageId: 'img_1', imageWidth: 1000, imageHeight: 600 })
  return { ...base, canvas: { ...base.canvas, ...patch } }
}

/** Capture decoration: tests set it via the canvas, just like the editor does. */
const decoration = (patch: Partial<Doc['canvas']> = {}) => captureDecoration(doc(patch))

describe('chromeHeight', () => {
  // A 44 px bar looks like a thread on a 2560 shot and like half the frame on a 400 one.
  it('grows with the frame', () => {
    expect(chromeHeight(1600)).toBeGreaterThan(chromeHeight(800))
  })

  it('stays readable on a tiny frame and modest on a huge one', () => {
    expect(chromeHeight(120)).toBe(34)
    expect(chromeHeight(6000)).toBe(104)
  })
})

describe('decoratedRect', () => {
  it('adds nothing when there is no frame', () => {
    expect(decoratedRect(SCREEN, 'none', 'none')).toEqual(SCREEN)
  })

  // The bar grows upwards: the shot stays exactly where it was.
  it('grows upwards for a browser frame', () => {
    const box = decoratedRect(SCREEN, 'macos', 'none')

    expect(box.y).toBeLessThan(SCREEN.y)
    expect(box.x).toBe(SCREEN.x)
    expect(box.w).toBe(SCREEN.w)
    expect(box.h).toBe(SCREEN.h + chromeHeight(SCREEN.w))
  })

  it('grows on every side for a device', () => {
    const box = decoratedRect(SCREEN, 'none', 'iphone-16-pro')

    expect(box.x).toBeLessThan(SCREEN.x)
    expect(box.y).toBeLessThan(SCREEN.y)
    expect(box.w).toBeGreaterThan(SCREEN.w)
    expect(box.h).toBeGreaterThan(SCREEN.h)
  })

  // A laptop has a base at the bottom, so the body isn't vertically symmetric.
  it('leaves room for the laptop base', () => {
    const box = decoratedRect(SCREEN, 'none', 'macbook-pro')
    const above = SCREEN.y - box.y
    const below = box.y + box.h - (SCREEN.y + SCREEN.h)

    expect(below).toBeGreaterThan(above)
  })

  it('lets the device win over the browser frame', () => {
    expect(decoratedRect(SCREEN, 'macos', 'ipad-pro-m4')).toEqual(
      decoratedRect(SCREEN, 'none', 'ipad-pro-m4'),
    )
  })
})

describe('screenCorners', () => {
  it('keeps the plain radius without a frame', () => {
    expect(screenCorners(decoration({ radius: 12 }), SCREEN)).toBe(12)
  })

  // Under a browser bar the top corners are square: the bar rounds them itself.
  it('squares the top corners under a browser frame', () => {
    const corners = screenCorners(
      decoration({ radius: 12, frame: { style: 'macos', theme: 'dark', url: '', showUrl: true } }),
      SCREEN,
    )

    expect(corners).toEqual([0, 0, 12, 12])
  })

  it('follows the device instead of the document radius', () => {
    const corners = screenCorners(decoration({ radius: 0, mockup: 'iphone-16-pro' }), SCREEN)

    expect(corners).toBeCloseTo(600 * DEVICES['iphone-16-pro'].screenRadius)
  })
})

describe('hasDecoration', () => {
  it('is false for a bare screenshot', () => {
    expect(hasDecoration(decoration())).toBe(false)
  })

  it('is true for either kind of frame', () => {
    expect(hasDecoration(decoration({ mockup: 'pixel-9-pro' }))).toBe(true)
    expect(
      hasDecoration(
        decoration({ frame: { style: 'windows11', theme: 'light', url: '', showUrl: true } }),
      ),
    ).toBe(true)
  })
})

describe('displayUrl', () => {
  it('drops the scheme: nobody reads it in a screenshot', () => {
    expect(displayUrl('https://example.com/page', null)).toBe('example.com/page')
  })

  it('falls back to the domain of the shot', () => {
    expect(displayUrl('', 'example.com')).toBe('example.com')
  })

  it('has nothing to show without either', () => {
    expect(displayUrl('  ', null)).toBe('')
  })
})

describe('faviconFor', () => {
  it('takes the first letter of the host, without www', () => {
    expect(faviconFor('https://www.github.com/x').letter).toBe('G')
  })

  // The colour derives from the name, so the same site is always the same colour.
  it('gives the same site the same colour', () => {
    expect(faviconFor('https://example.com/a').color).toBe(faviconFor('example.com/b').color)
  })

  it('gives different sites different colours', () => {
    expect(faviconFor('github.com').color).not.toBe(faviconFor('example.com').color)
  })

  it('has something to draw for an empty address', () => {
    expect(faviconFor('').letter).toBe('•')
  })
})

describe('tiltSkew', () => {
  it('leaves an untilted frame alone', () => {
    expect(tiltSkew({ x: 0, y: 0 })).toEqual({ skewX: 0, skewY: 0 })
  })

  it('tilts each axis its own way', () => {
    expect(tiltSkew({ x: 10, y: 0 }).skewY).toBeGreaterThan(0)
    expect(tiltSkew({ x: 0, y: 10 }).skewX).toBeGreaterThan(0)
    expect(tiltSkew({ x: -10, y: 0 }).skewY).toBeLessThan(0)
  })

  // Beyond the limit the frame folds into itself, so the angle is clamped.
  it('stops at the limit', () => {
    expect(tiltSkew({ x: 400, y: 0 }).skewY).toBeCloseTo(tiltSkew({ x: TILT_LIMIT, y: 0 }).skewY)
  })
})

describe('customMockupRect', () => {
  const custom = { imageId: 'img_m', screen: { x: 0.2, y: 0.1, w: 0.5, h: 0.4 } }

  // The picture is stretched so its screen zone lands exactly on the frame:
  // a zone half the width means a mockup twice as wide as the frame.
  it('scales the picture so its screen zone lands on the frame', () => {
    const box = customMockupRect(SCREEN, custom)

    expect(box.w).toBeCloseTo(SCREEN.w / 0.5)
    expect(box.h).toBeCloseTo(SCREEN.h / 0.4)
  })

  it('shifts the picture so the zone starts where the frame does', () => {
    const box = customMockupRect(SCREEN, custom)

    expect(box.x + custom.screen.x * box.w).toBeCloseTo(SCREEN.x)
    expect(box.y + custom.screen.y * box.h).toBeCloseTo(SCREEN.y)
  })

  it('falls back to the frame itself when the zone is empty', () => {
    expect(customMockupRect(SCREEN, { imageId: 'x', screen: { x: 0, y: 0, w: 0, h: 0 } })).toEqual(
      SCREEN,
    )
  })

  it('draws no radius of its own over a custom mockup', () => {
    expect(screenCorners(decoration({ radius: 20, mockup: 'custom' }), SCREEN)).toBe(0)
  })
})

describe('decoration on layers', () => {
  // In a responsive series frames are equals: an image layer has its own frame, not a shared one.
  it('is read from the layer, not from the canvas', () => {
    const own = {
      ...captureDecoration(doc()),
      frame: { style: 'windows11' as const, theme: 'light' as const, url: '', showUrl: true },
    }

    expect(hasDecoration(own)).toBe(true)
    expect(decoratedRectFor(own, SCREEN).h).toBeGreaterThan(SCREEN.h)
  })

  it('means no frame at all when a layer has none', () => {
    expect(hasDecoration(null)).toBe(false)
  })

  it('sizes a device frame around a layer the same way as around the shot', () => {
    const withDevice = { ...captureDecoration(doc()), mockup: 'iphone-16-pro' as const }

    expect(decoratedRectFor(withDevice, SCREEN)).toEqual(
      decoratedRect(SCREEN, 'none', 'iphone-16-pro'),
    )
  })
})
