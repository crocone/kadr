import { describe, expect, it } from 'vitest'

import { alignmentDelta, candidateLines, computeSnap } from './snapping'
import type { Rect } from './types'

const CANVAS: Rect = { x: 0, y: 0, w: 1000, h: 800 }

describe('candidateLines', () => {
  it('offers the two edges and the centre', () => {
    expect(candidateLines(CANVAS, 'x')).toEqual([0, 500, 1000])
    expect(candidateLines(CANVAS, 'y')).toEqual([0, 400, 800])
  })
})

describe('computeSnap', () => {
  it('pulls a nearly-centred object onto the centre', () => {
    const moving = { x: 247, y: 196, w: 500, h: 400 }

    const snap = computeSnap(moving, [CANVAS], 8)

    expect(snap.dx).toBe(3)
    expect(snap.dy).toBe(4)
    expect(snap.guides).toEqual([
      { axis: 'x', at: 500 },
      { axis: 'y', at: 400 },
    ])
  })

  it('leaves an object alone when nothing is near', () => {
    // No edge and no centre falls within the threshold on either axis.
    expect(computeSnap({ x: 307, y: 310, w: 111, h: 60 }, [CANVAS], 8)).toEqual({
      dx: 0,
      dy: 0,
      guides: [],
    })
  })

  /** A zero delta is still a snap: the guide shows why the object won't move. */
  it('still reports a guide for something already exactly on a line', () => {
    const snap = computeSnap({ x: 300, y: 300, w: 100, h: 100 }, [CANVAS], 8)

    expect(snap.dy).toBe(0)
    expect(snap.guides).toContainEqual({ axis: 'y', at: 400 })
  })

  it('snaps edge to edge between two objects', () => {
    const other = { x: 600, y: 100, w: 200, h: 200 }
    const moving = { x: 596, y: 400, w: 100, h: 100 }

    const snap = computeSnap(moving, [other], 8)

    expect(snap.dx).toBe(4)
    expect(snap.guides).toContainEqual({ axis: 'x', at: 600 })
  })

  it('takes the nearest line when several are within reach', () => {
    const moving = { x: 3, y: 500, w: 100, h: 100 }
    const near = { x: 0, y: 0, w: 6, h: 10 }

    // Candidates 0, 3 and 6: 3 wins — that's a zero delta.
    expect(computeSnap(moving, [near], 10).dx).toBe(0)
  })

  it('snaps each axis on its own', () => {
    const snap = computeSnap({ x: 2, y: 500, w: 100, h: 100 }, [CANVAS], 8)

    expect(snap.dx).toBe(-2)
    expect(snap.dy).toBe(0)
    expect(snap.guides).toEqual([{ axis: 'x', at: 0 }])
  })

  it('does nothing without candidates or with the threshold off', () => {
    expect(computeSnap({ x: 1, y: 1, w: 10, h: 10 }, [], 8).guides).toEqual([])
    expect(computeSnap({ x: 1, y: 1, w: 10, h: 10 }, [CANVAS], 0).guides).toEqual([])
  })
})

describe('alignmentDelta', () => {
  const rect: Rect = { x: 100, y: 100, w: 200, h: 100 }

  it('moves along one axis only', () => {
    expect(alignmentDelta(rect, CANVAS, 'left')).toEqual({ dx: -100, dy: 0 })
    expect(alignmentDelta(rect, CANVAS, 'top')).toEqual({ dx: 0, dy: -100 })
  })

  it('centres by the middle, not the corner', () => {
    const centred = alignmentDelta(rect, CANVAS, 'centreX')
    expect(rect.x + centred.dx + rect.w / 2).toBe(CANVAS.w / 2)
  })

  it('puts the far edge on the far edge', () => {
    const right = alignmentDelta(rect, CANVAS, 'right')
    expect(rect.x + right.dx + rect.w).toBe(CANVAS.w)

    const bottom = alignmentDelta(rect, CANVAS, 'bottom')
    expect(rect.y + bottom.dy + rect.h).toBe(CANVAS.h)
  })
})
