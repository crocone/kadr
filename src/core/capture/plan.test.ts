import { describe, expect, it } from 'vitest'

import {
  CAPTURE_INTERVAL_MS,
  centreScrollY,
  clampRect,
  cssRectToDeviceRect,
  elementCaptureStrategy,
  MAX_CANVAS_SIDE,
  pageRectToViewportRect,
  planFullPageCapture,
  thumbnailSize,
} from './plan'
import type { PageMetrics } from './types'

function metrics(overrides: Partial<PageMetrics> = {}): PageMetrics {
  return {
    scrollWidth: 1280,
    scrollHeight: 3000,
    viewportWidth: 1280,
    viewportHeight: 800,
    devicePixelRatio: 1,
    scrollX: 0,
    scrollY: 0,
    ...overrides,
  }
}

describe('planFullPageCapture', () => {
  it('covers the page and pins the last frame to the bottom', () => {
    const plan = planFullPageCapture(metrics())

    expect(plan.steps.map((step) => step.scrollY)).toEqual([0, 800, 1600, 2200])
    expect(plan.canvasHeight).toBe(3000)
    expect(plan.truncated).toBe(false)
  })

  it('takes a single frame when the page fits in the viewport', () => {
    const plan = planFullPageCapture(metrics({ scrollHeight: 600 }))

    expect(plan.steps).toEqual([{ index: 0, scrollY: 0 }])
    expect(plan.canvasHeight).toBe(800)
  })

  it('scales the canvas by devicePixelRatio', () => {
    const plan = planFullPageCapture(metrics({ devicePixelRatio: 2, scrollHeight: 1600 }))

    expect(plan.canvasWidth).toBe(2560)
    expect(plan.canvasHeight).toBe(3200)
    expect(plan.steps).toHaveLength(2)
  })

  it('truncates a page taller than the canvas limit and says so', () => {
    const plan = planFullPageCapture(metrics({ scrollHeight: 500_000 }))

    expect(plan.truncated).toBe(true)
    expect(plan.canvasHeight).toBeLessThanOrEqual(MAX_CANVAS_SIDE)
  })

  it('estimates the wall clock from the captureVisibleTab rate limit', () => {
    const plan = planFullPageCapture(metrics())
    expect(plan.estimatedMs).toBe(plan.steps.length * CAPTURE_INTERVAL_MS)
  })
})

describe('cssRectToDeviceRect', () => {
  it('is a no-op at dpr 1', () => {
    expect(cssRectToDeviceRect({ x: 10, y: 20, w: 30, h: 40 }, 1)).toEqual({
      x: 10,
      y: 20,
      w: 30,
      h: 40,
    })
  })

  it('rounds outwards so a selection never loses an edge pixel', () => {
    expect(cssRectToDeviceRect({ x: 10.4, y: 20.6, w: 30.2, h: 40.9 }, 2)).toEqual({
      x: 20,
      y: 41,
      w: 62,
      h: 82,
    })
  })
})

describe('clampRect', () => {
  it('keeps a rect inside the frame', () => {
    expect(clampRect({ x: 900, y: 700, w: 500, h: 400 }, 1000, 800)).toEqual({
      x: 900,
      y: 700,
      w: 100,
      h: 100,
    })
  })

  it('pulls a negative origin back to zero', () => {
    expect(clampRect({ x: -50, y: -10, w: 100, h: 100 }, 1000, 800)).toEqual({
      x: 0,
      y: 0,
      w: 100,
      h: 100,
    })
  })
})

describe('thumbnailSize', () => {
  it('fits the long side into the box, keeping the aspect ratio', () => {
    expect(thumbnailSize(1600, 900, 320)).toEqual({ width: 320, height: 180 })
    expect(thumbnailSize(900, 1600, 320)).toEqual({ width: 180, height: 320 })
  })

  it('never upscales', () => {
    expect(thumbnailSize(100, 50, 320)).toEqual({ width: 100, height: 50 })
  })
})

describe('elementCaptureStrategy', () => {
  it('takes a single frame when the element fits', () => {
    expect(elementCaptureStrategy({ x: 0, y: 2000, w: 600, h: 400 }, metrics())).toBe(
      'single-frame',
    )
  })

  it('falls back to the full page when the element is taller than the viewport', () => {
    expect(elementCaptureStrategy({ x: 0, y: 0, w: 600, h: 1200 }, metrics())).toBe('full-page')
  })

  it('falls back to the full page when the element is wider than the viewport', () => {
    expect(elementCaptureStrategy({ x: 0, y: 0, w: 1400, h: 200 }, metrics())).toBe('full-page')
  })
})

describe('centreScrollY', () => {
  it('centres the element in the viewport', () => {
    expect(centreScrollY({ x: 0, y: 1000, w: 100, h: 200 }, metrics())).toBe(700)
  })

  it('does not scroll past the top of the page', () => {
    expect(centreScrollY({ x: 0, y: 10, w: 100, h: 100 }, metrics())).toBe(0)
  })

  it('does not scroll past the bottom of the page', () => {
    expect(centreScrollY({ x: 0, y: 2900, w: 100, h: 100 }, metrics())).toBe(2200)
  })
})

describe('pageRectToViewportRect', () => {
  it('subtracts the scroll position', () => {
    expect(pageRectToViewportRect({ x: 40, y: 1000, w: 100, h: 200 }, 0, 700)).toEqual({
      x: 40,
      y: 300,
      w: 100,
      h: 200,
    })
  })
})
