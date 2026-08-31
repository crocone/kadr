import { describe, expect, it } from 'vitest'

import { clampZoom, fitView, initialView, ZOOM_MAX, ZOOM_MIN, zoomAt } from './view'

const PANE = { width: 1000, height: 800 }

describe('initialView', () => {
  it('fits a long page by width and pins it to the top', () => {
    const view = initialView({ w: 1000, h: 20_000 }, PANE)

    expect(view).toEqual({ zoom: 1, x: 0, y: 0 })
  })

  it('scales a wide page down to the pane width', () => {
    const view = initialView({ w: 2000, h: 40_000 }, PANE)

    expect(view?.zoom).toBe(0.5)
    expect(view?.y).toBe(0)
  })

  it('centres a document that fits both ways', () => {
    const view = initialView({ w: 500, h: 400 }, PANE)

    expect(view).toEqual({ zoom: 1, x: 250, y: 200 })
  })

  it('never enlarges past natural size', () => {
    expect(initialView({ w: 100, h: 100 }, PANE)?.zoom).toBe(1)
  })

  it('returns null while the pane is unmeasured', () => {
    expect(initialView({ w: 800, h: 600 }, { width: 0, height: 0 })).toBeNull()
  })
})

describe('fitView', () => {
  it('fits the whole document, however long', () => {
    const view = fitView({ w: 1000, h: 20_000 }, PANE)

    expect(view?.zoom).toBe(0.04)
    expect(view?.y).toBeCloseTo(0)
  })

  it('centres what it fits', () => {
    expect(fitView({ w: 2000, h: 800 }, PANE)).toEqual({ zoom: 0.5, x: 0, y: 200 })
  })
})

describe('zoomAt', () => {
  it('keeps the point under the cursor still', () => {
    const view = { zoom: 1, x: 0, y: 0 }
    const pointer = { x: 300, y: 400 }

    const zoomed = zoomAt(view, pointer, 2)

    // The document point under the cursor is the same before and after.
    expect((pointer.x - zoomed.x) / zoomed.zoom).toBeCloseTo((pointer.x - view.x) / view.zoom)
    expect((pointer.y - zoomed.y) / zoomed.zoom).toBeCloseTo((pointer.y - view.y) / view.zoom)
  })

  it('respects an offset view', () => {
    const view = { zoom: 0.5, x: -120, y: -60 }
    const pointer = { x: 200, y: 150 }

    const zoomed = zoomAt(view, pointer, 1.5)

    expect((pointer.x - zoomed.x) / zoomed.zoom).toBeCloseTo((pointer.x - view.x) / view.zoom)
  })

  it('clamps to the allowed range', () => {
    expect(zoomAt({ zoom: 1, x: 0, y: 0 }, { x: 0, y: 0 }, 5000).zoom).toBe(ZOOM_MAX)
    expect(zoomAt({ zoom: 1, x: 0, y: 0 }, { x: 0, y: 0 }, 0.0001).zoom).toBe(ZOOM_MIN)
  })
})

describe('clampZoom', () => {
  it('keeps a sane value untouched', () => {
    expect(clampZoom(0.75)).toBe(0.75)
  })

  it('lets the view go deep enough to inspect single pixels', () => {
    expect(ZOOM_MAX).toBeGreaterThanOrEqual(32)
  })
})
