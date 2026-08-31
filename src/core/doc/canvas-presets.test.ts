import { describe, expect, it } from 'vitest'

import { applyCanvasPreset, fitCaptureScale, frameRect, safeZonesFor } from './canvas-presets'
import { createDoc } from './create'
import type { Doc } from './types'

function doc(overrides: Partial<Doc['capture']> = {}): Doc {
  const base = createDoc({ imageId: 'img_1', imageWidth: 1200, imageHeight: 800 })
  return { ...base, capture: { ...base.capture, ...overrides } }
}

describe('applyCanvasPreset', () => {
  it('hugs the frame on auto', () => {
    const result = applyCanvasPreset(doc(), 'auto')

    expect(result.canvas.w).toBe(1200 + 128)
    expect(result.canvas.h).toBe(800 + 128)
  })

  it('follows the frame scale on auto', () => {
    const result = applyCanvasPreset(doc({ scale: 0.5 }), 'auto')

    expect(result.canvas.w).toBe(600 + 128)
  })

  it('grows the canvas to a ratio instead of stretching the shot', () => {
    const result = applyCanvasPreset(doc(), '16:9')

    expect(result.canvas.w / result.canvas.h).toBeCloseTo(16 / 9, 2)
    // The capture is untouched: only the canvas around it changed.
    expect(result.capture.scale).toBe(1)
    expect(result.canvas.w).toBeGreaterThanOrEqual(1200 + 128)
    expect(result.canvas.h).toBeGreaterThanOrEqual(800 + 128)
  })

  it('keeps a tall ratio wide enough for the frame', () => {
    const result = applyCanvasPreset(doc(), '9:16')

    expect(result.canvas.w).toBeGreaterThanOrEqual(1200 + 128)
    expect(result.canvas.h / result.canvas.w).toBeCloseTo(16 / 9, 2)
  })

  it('pins a social size exactly and shrinks the frame to fit', () => {
    const result = applyCanvasPreset(doc(), 'x')

    expect([result.canvas.w, result.canvas.h]).toEqual([1600, 900])
    expect(result.capture.scale).toBeLessThan(1)
    expect(result.capture.height * result.capture.scale).toBeLessThanOrEqual(900 - 128)
  })

  it('recentres the frame', () => {
    const moved = doc({ offset: { x: 200, y: -80 } })
    expect(applyCanvasPreset(moved, '1:1').capture.offset).toEqual({ x: 0, y: 0 })
  })

  it('leaves the canvas alone on custom', () => {
    const custom = applyCanvasPreset(doc(), 'custom')
    expect([custom.canvas.w, custom.canvas.h]).toEqual([1328, 928])
  })
})

describe('fitCaptureScale', () => {
  it('fits by the tighter side', () => {
    expect(fitCaptureScale(doc(), 1600, 900)).toBeCloseTo((900 - 128) / 800, 4)
  })
})

describe('frameRect', () => {
  it('centres the frame in the canvas', () => {
    const rect = frameRect(applyCanvasPreset(doc(), '16:9'))
    const canvas = applyCanvasPreset(doc(), '16:9').canvas

    expect(rect.x + rect.w / 2).toBeCloseTo(canvas.w / 2, 5)
    expect(rect.y + rect.h / 2).toBeCloseTo(canvas.h / 2, 5)
  })

  it('applies the manual offset on top of centring', () => {
    const rect = frameRect(doc({ offset: { x: 40, y: 10 } }))
    expect(rect.x).toBeCloseTo((1328 - 1200) / 2 + 40, 5)
  })
})

describe('safeZonesFor', () => {
  it('marks the YouTube timestamp corner', () => {
    const zones = safeZonesFor('youtube')
    expect(zones.some((zone) => zone.kind === 'overlay')).toBe(true)
  })

  it('has nothing to say about a plain ratio', () => {
    expect(safeZonesFor('16:9')).toEqual([])
  })
})
