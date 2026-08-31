import { describe, expect, it } from 'vitest'

import {
  clampRect,
  drawRect,
  fullRect,
  moveRect,
  ratioOf,
  rectFrom,
  resizeRect,
  sizeLabel,
} from './geometry'

const bounds = { x: 1000, y: 800 }

describe('rectFrom', () => {
  it('normalises a drag made right-to-left and upwards', () => {
    expect(rectFrom({ x: 400, y: 500 }, { x: 250, y: 300 })).toEqual({
      x: 250,
      y: 300,
      w: 150,
      h: 200,
    })
  })
})

describe('drawRect', () => {
  it('leaves a free drag untouched', () => {
    expect(drawRect({ x: 10, y: 20 }, { x: 110, y: 60 }, null)).toEqual({
      x: 10,
      y: 20,
      w: 100,
      h: 40,
    })
  })

  it('follows the side dragged further, so the frame does not flip mid-drag', () => {
    // Width 160 vs height 20: width leads, height grows to 90.
    expect(drawRect({ x: 0, y: 0 }, { x: 160, y: 20 }, 16 / 9)).toEqual({
      x: 0,
      y: 0,
      w: 160,
      h: 90,
    })
    // And the other way round: height 90 at width 10 dictates a width of 160.
    expect(drawRect({ x: 0, y: 0 }, { x: 10, y: 90 }, 16 / 9)).toEqual({
      x: 0,
      y: 0,
      w: 160,
      h: 90,
    })
  })

  it('grows towards the cursor when the drag goes up and left', () => {
    expect(drawRect({ x: 300, y: 300 }, { x: 140, y: 290 }, 16 / 9)).toEqual({
      x: 140,
      y: 210,
      w: 160,
      h: 90,
    })
  })
})

describe('resizeRect', () => {
  const rect = { x: 100, y: 100, w: 200, h: 100 }

  it('keeps the opposite corner in place', () => {
    expect(resizeRect(rect, 'nw', { x: 60, y: 40 }, null)).toEqual({
      x: 60,
      y: 40,
      w: 240,
      h: 160,
    })
  })

  it('moves one edge only', () => {
    expect(resizeRect(rect, 'e', { x: 400, y: 999 }, null)).toEqual({
      x: 100,
      y: 100,
      w: 300,
      h: 100,
    })
    expect(resizeRect(rect, 'n', { x: 999, y: 60 }, null)).toEqual({
      x: 100,
      y: 60,
      w: 200,
      h: 140,
    })
  })

  it('normalises a corner dragged past the opposite one', () => {
    expect(resizeRect(rect, 'e', { x: 40, y: 0 }, null)).toEqual({
      x: 40,
      y: 100,
      w: 60,
      h: 100,
    })
  })

  it('holds the ratio from the opposite corner', () => {
    const resized = resizeRect(rect, 'se', { x: 420, y: 130 }, 16 / 9)
    expect(resized).toEqual({ x: 100, y: 100, w: 320, h: 180 })
  })

  it('grows a side handle symmetrically around the centre', () => {
    // Width 320 leads; height 180 splits evenly around the centre y = 150.
    expect(resizeRect(rect, 'e', { x: 420, y: 0 }, 16 / 9)).toEqual({
      x: 100,
      y: 60,
      w: 320,
      h: 180,
    })
  })
})

describe('moveRect', () => {
  it('shifts by the delta', () => {
    expect(moveRect({ x: 100, y: 100, w: 200, h: 100 }, 30, -40, bounds)).toEqual({
      x: 130,
      y: 60,
      w: 200,
      h: 100,
    })
  })

  it('stops at the viewport edge instead of shrinking', () => {
    expect(moveRect({ x: 900, y: 20, w: 200, h: 100 }, 500, -500, bounds)).toEqual({
      x: 800,
      y: 0,
      w: 200,
      h: 100,
    })
  })
})

describe('clampRect', () => {
  it('trims what hangs outside the viewport', () => {
    expect(clampRect({ x: -50, y: -20, w: 200, h: 100 }, bounds)).toEqual({
      x: 0,
      y: 0,
      w: 150,
      h: 80,
    })
    expect(clampRect({ x: 950, y: 750, w: 200, h: 100 }, bounds)).toEqual({
      x: 950,
      y: 750,
      w: 50,
      h: 50,
    })
  })

  it('leaves a rect that already fits', () => {
    const rect = { x: 10, y: 10, w: 100, h: 100 }
    expect(clampRect(rect, bounds)).toEqual(rect)
  })
})

describe('fullRect', () => {
  it('covers the whole viewport', () => {
    expect(fullRect(bounds)).toEqual({ x: 0, y: 0, w: 1000, h: 800 })
  })
})

describe('ratioOf', () => {
  it('leaves free and screen unconstrained', () => {
    expect(ratioOf('free')).toBeNull()
    expect(ratioOf('screen')).toBeNull()
    expect(ratioOf('1:1')).toBe(1)
  })
})

describe('sizeLabel', () => {
  it('reports physical pixels with the density multiplier', () => {
    expect(sizeLabel({ x: 0, y: 0, w: 620, h: 380 }, 2)).toBe('×2 → 1240 × 760')
  })

  it('drops the multiplier when there is nothing to multiply', () => {
    expect(sizeLabel({ x: 0, y: 0, w: 620, h: 380 }, 1)).toBe('620 × 380')
  })
})
