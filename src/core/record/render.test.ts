import { describe, expect, it } from 'vitest'

import { defaultEdit, DEFAULT_DECORATION } from './defaults'
import { chromeOf, contentSize, cropOf, outputSize, windowAt } from './render'
import type { Clip, ZoomSpan } from './types'

function clip(overrides: Partial<Clip> = {}): Clip {
  return {
    version: 1,
    id: 'clip_1',
    title: 'Clip',
    createdAt: 0,
    updatedAt: 0,
    source: 'tab',
    file: 'clip_1.webm',
    mime: 'video/webm',
    duration: 10_000,
    width: 1280,
    height: 720,
    size: 1000,
    audio: false,
    page: null,
    viewport: null,
    events: [],
    edit: defaultEdit(10_000),
    decoration: { ...DEFAULT_DECORATION },
    poster: null,
    stillDocId: null,
    ...overrides,
  }
}

const zoom = (at: { x: number; y: number }, scale: number): ZoomSpan => ({
  id: 'z',
  hold: { start: 1000, end: 2000 },
  rampIn: 0,
  rampOut: 0,
  at,
  scale,
  auto: true,
})

describe('cropOf and contentSize', () => {
  it('is the whole frame without a crop', () => {
    expect(cropOf(clip())).toEqual({ x: 0, y: 0, w: 1, h: 1 })
    expect(contentSize(clip())).toEqual({ w: 1280, h: 720 })
  })

  it('shrinks with the crop', () => {
    const cropped = clip()
    cropped.edit.crop = { x: 0.25, y: 0, w: 0.5, h: 0.5 }
    expect(contentSize(cropped)).toEqual({ w: 640, h: 360 })
  })
})

describe('outputSize', () => {
  it('adds the padding on both sides', () => {
    const decorated = clip({ decoration: { ...DEFAULT_DECORATION, padding: 40 } })
    expect(outputSize(decorated)).toEqual({ w: 1360, h: 800 })
  })

  it('keeps both sides even, because encoders demand it', () => {
    const odd = clip({ width: 1281, height: 721 })
    const { w, h } = outputSize(odd)
    expect(w % 2).toBe(0)
    expect(h % 2).toBe(0)
  })

  it('scales', () => {
    expect(outputSize(clip(), 0.5)).toEqual({ w: 640, h: 360 })
  })

  /**
   * The chrome is not padding: it sits straight on top of the picture, and the padding
   * then goes around the pair. Counting it as padding would leave a seam between the
   * toolbar and the page it belongs to.
   */
  it('makes room above the picture for a browser frame', () => {
    const framed = clip({
      decoration: {
        ...DEFAULT_DECORATION,
        frame: { style: 'macos', theme: 'light', url: '', showUrl: true },
      },
    })
    expect(chromeOf(framed)).toBeGreaterThan(0)
    expect(outputSize(framed).h).toBe(720 + chromeOf(framed))
    expect(outputSize(framed).w).toBe(1280)
  })

  it('has no chrome without a frame', () => {
    expect(chromeOf(clip())).toBe(0)
  })
})

describe('windowAt', () => {
  it('is the whole frame with no zoom', () => {
    expect(windowAt(clip(), 500)).toEqual({ x: 0, y: 0, w: 1, h: 1 })
  })

  it('narrows to the zoom and centres on it', () => {
    const zoomed = clip()
    zoomed.edit.zooms = [zoom({ x: 0.5, y: 0.5 }, 2)]
    expect(windowAt(zoomed, 1500)).toEqual({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 })
  })

  it('never runs off the edge of the picture', () => {
    const zoomed = clip()
    zoomed.edit.zooms = [zoom({ x: 0.02, y: 0.98 }, 2)]
    const window = windowAt(zoomed, 1500)
    expect(window.x).toBe(0)
    expect(window.y).toBeCloseTo(0.5, 6)
  })

  it('stays inside the crop rather than inside the original frame', () => {
    const cropped = clip()
    cropped.edit.crop = { x: 0.5, y: 0, w: 0.5, h: 0.5 }
    cropped.edit.zooms = [zoom({ x: 0.5, y: 0.5 }, 2)]

    // The camera wants the centre of the whole frame, which is below the cropped half:
    // the window slides back to the crop's bottom edge instead of showing what was cut.
    const window = windowAt(cropped, 1500)
    expect(window.x).toBe(0.5)
    expect(window.y).toBeCloseTo(0.25, 6)
    expect(window.w).toBe(0.25)
  })
})
