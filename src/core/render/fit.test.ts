import { describe, expect, it } from 'vitest'

import { coverRect, documentRectToImageRect, fitScale } from './fit'

describe('fitScale', () => {
  it('fits the content into the viewport by its tightest side', () => {
    expect(fitScale({ w: 2000, h: 1000 }, { width: 500, height: 500 })).toBe(0.25)
    expect(fitScale({ w: 1000, h: 2000 }, { width: 500, height: 500 })).toBe(0.25)
  })

  it('never scales up past the maximum', () => {
    expect(fitScale({ w: 100, h: 100 }, { width: 500, height: 500 })).toBe(1)
  })

  it('returns null while the viewport is still unmeasured', () => {
    expect(fitScale({ w: 800, h: 600 }, { width: 0, height: 0 })).toBeNull()
    expect(fitScale({ w: 800, h: 600 }, { width: 500, height: 0 })).toBeNull()
  })

  it('returns null for an empty document', () => {
    expect(fitScale({ w: 0, h: 0 }, { width: 500, height: 500 })).toBeNull()
  })

  it('never returns zero, which is what made Konva draw from a 0x0 buffer', () => {
    const scale = fitScale({ w: 32_000, h: 32_000 }, { width: 1, height: 1 })
    expect(scale).not.toBeNull()
    expect(scale).toBeGreaterThan(0)
  })
})

describe('coverRect', () => {
  it('cover fills the viewport and overflows on the long side', () => {
    const rect = coverRect({ w: 100, h: 100 }, { width: 400, height: 200 }, 'cover')

    expect(rect.w).toBe(400)
    expect(rect.h).toBe(400)
    expect(rect.y).toBe(-100)
  })

  it('contain fits entirely and leaves margins', () => {
    const rect = coverRect({ w: 100, h: 100 }, { width: 400, height: 200 }, 'contain')

    expect(rect.h).toBe(200)
    expect(rect.x).toBe(100)
  })

  it('centres either way', () => {
    const rect = coverRect({ w: 200, h: 100 }, { width: 400, height: 400 }, 'contain')
    expect(rect.x + rect.w / 2).toBe(200)
    expect(rect.y + rect.h / 2).toBe(200)
  })

  it('falls back to the viewport for an empty image', () => {
    expect(coverRect({ w: 0, h: 0 }, { width: 300, height: 200 }, 'cover')).toEqual({
      x: 0,
      y: 0,
      w: 300,
      h: 200,
    })
  })
})

describe('documentRectToImageRect', () => {
  const FRAME = { x: 64, y: 64, w: 800, h: 600 }

  it('is a plain shift when the frame is drawn at native size', () => {
    const crop = documentRectToImageRect({ x: 164, y: 114, w: 100, h: 50 }, FRAME, {
      w: 800,
      h: 600,
    })

    expect(crop).toEqual({ x: 100, y: 50, w: 100, h: 50 })
  })

  it('scales into image pixels for a retina frame', () => {
    const crop = documentRectToImageRect({ x: 164, y: 114, w: 100, h: 50 }, FRAME, {
      w: 1600,
      h: 1200,
    })

    expect(crop).toEqual({ x: 200, y: 100, w: 200, h: 100 })
  })

  it('reports coordinates outside the frame rather than clamping them', () => {
    // Clipping is the caller's job: it knows what to do with an overflowing layer.
    const crop = documentRectToImageRect({ x: 0, y: 0, w: 40, h: 40 }, FRAME, { w: 800, h: 600 })
    expect(crop?.x).toBeLessThan(0)
  })

  it('gives up on a frame with no size', () => {
    expect(
      documentRectToImageRect(
        { x: 0, y: 0, w: 1, h: 1 },
        { x: 0, y: 0, w: 0, h: 0 },
        { w: 10, h: 10 },
      ),
    ).toBeNull()
  })
})
