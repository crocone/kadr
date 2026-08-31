import { describe, expect, it } from 'vitest'

import { createDoc } from './create'
import { eraseAlong, eraseObjectAt, erasePartAt, strokeHit, subtractCircle } from './erase'
import { addLayer, createLayer } from './layers'
import type { DrawLayer } from './types'

function stroke(points: number[], patch: Partial<DrawLayer> = {}): DrawLayer {
  return { ...(createLayer('draw') as DrawLayer), points, width: 4, ...patch }
}

const doc = createDoc({ imageId: 'img_1', imageWidth: 800, imageHeight: 600 })

describe('strokeHit', () => {
  it('hits the line between two nodes, not only the nodes', () => {
    expect(strokeHit(stroke([0, 0, 100, 0, 200, 0]), { x: 50, y: 0 }, 2)).toBe(true)
  })

  it('misses a point further away than the reach', () => {
    expect(strokeHit(stroke([0, 0, 100, 0, 200, 0]), { x: 50, y: 40 }, 2)).toBe(false)
  })

  // A thick line is easier to reach: its visible trail is half a width wider than its axis.
  it('counts the stroke width as reach', () => {
    const point = { x: 50, y: 10 }
    expect(strokeHit(stroke([0, 0, 100, 0], { width: 4 }), point, 2)).toBe(false)
    expect(strokeHit(stroke([0, 0, 100, 0], { width: 24 }), point, 2)).toBe(true)
  })

  it('treats a one-point stroke as a dot', () => {
    expect(strokeHit(stroke([10, 10]), { x: 11, y: 11 }, 4)).toBe(true)
    expect(strokeHit(stroke([10, 10]), { x: 60, y: 60 }, 4)).toBe(false)
  })

  it('has nothing to hit in an empty stroke', () => {
    expect(strokeHit(stroke([]), { x: 0, y: 0 }, 10)).toBe(false)
  })
})

describe('eraseObjectAt', () => {
  it('removes the stroke under the point', () => {
    const withStroke = addLayer(doc, stroke([0, 0, 100, 0]))

    expect(eraseObjectAt(withStroke, { x: 50, y: 0 }, 6).layers).toHaveLength(0)
  })

  it('keeps everything that is not a stroke', () => {
    const withShape = addLayer(doc, createLayer('shape', { rect: { x: 0, y: 0, w: 100, h: 100 } }))

    expect(eraseObjectAt(withShape, { x: 50, y: 50 }, 6).layers).toHaveLength(1)
  })

  it('spares a locked stroke', () => {
    const locked = addLayer(doc, stroke([0, 0, 100, 0], { locked: true }))

    expect(eraseObjectAt(locked, { x: 50, y: 0 }, 6).layers).toHaveLength(1)
  })

  // Nothing erased — same object: otherwise every mouse move would be an edit.
  it('returns the same document when nothing was hit', () => {
    const withStroke = addLayer(doc, stroke([0, 0, 100, 0]))

    expect(eraseObjectAt(withStroke, { x: 500, y: 500 }, 6)).toBe(withStroke)
  })

  it('removes several strokes at once', () => {
    const two = addLayer(addLayer(doc, stroke([0, 0, 100, 0])), stroke([0, 4, 100, 4]))

    expect(eraseObjectAt(two, { x: 50, y: 2 }, 6).layers).toHaveLength(0)
  })
})

describe('subtractCircle', () => {
  const line = [0, 0, 100, 0]

  it('leaves an untouched line exactly as it was', () => {
    expect(subtractCircle(line, { x: 50, y: 500 }, 10)).toEqual([line])
  })

  // A circle in the middle cuts the line in two, with edges where the eraser passed.
  it('cuts a line in two where it passes through the middle', () => {
    const runs = subtractCircle(line, { x: 50, y: 0 }, 10)

    expect(runs).toEqual([
      [0, 0, 40, 0],
      [60, 0, 100, 0],
    ])
  })

  it('trims the end it covers', () => {
    expect(subtractCircle(line, { x: 100, y: 0 }, 20)).toEqual([[0, 0, 80, 0]])
  })

  it('trims the start it covers', () => {
    expect(subtractCircle(line, { x: 0, y: 0 }, 20)).toEqual([[20, 0, 100, 0]])
  })

  it('leaves nothing of a line it covers whole', () => {
    expect(subtractCircle(line, { x: 50, y: 0 }, 200)).toEqual([])
  })

  // A single-point stub can't be drawn, so it isn't kept.
  it('drops a piece too short to draw', () => {
    expect(subtractCircle([0, 0, 100, 0], { x: 1, y: 0 }, 40)).toEqual([[41, 0, 100, 0]])
  })

  it('cuts a corner without losing the rest of the path', () => {
    const path = [0, 0, 100, 0, 100, 100]
    const runs = subtractCircle(path, { x: 100, y: 0 }, 20)

    expect(runs).toEqual([
      [0, 0, 80, 0],
      [100, 20, 100, 100],
    ])
  })

  it('erases a lone dot it covers, and spares one it misses', () => {
    expect(subtractCircle([10, 10], { x: 12, y: 10 }, 5)).toEqual([])
    expect(subtractCircle([10, 10], { x: 90, y: 10 }, 5)).toEqual([[10, 10]])
  })

  it('has nothing to subtract from an empty stroke', () => {
    expect(subtractCircle([], { x: 0, y: 0 }, 10)).toEqual([])
  })
})

describe('erasePartAt', () => {
  it('splits a stroke into the pieces that survived', () => {
    const withStroke = addLayer(doc, stroke([0, 0, 100, 0], { width: 0 }))
    const after = erasePartAt(withStroke, { x: 50, y: 0 }, 10)

    expect(after.layers).toHaveLength(2)
    expect(after.layers.every((layer) => layer.kind === 'draw')).toBe(true)
  })

  // A reference to the layer must survive the erase: selection and history point at it.
  it('keeps the identifier on the first piece', () => {
    const original = stroke([0, 0, 100, 0], { width: 0 })
    const after = erasePartAt(addLayer(doc, original), { x: 50, y: 0 }, 10)

    expect(after.layers[0]?.id).toBe(original.id)
    expect(after.layers[1]?.id).not.toBe(original.id)
  })

  it('removes a stroke it covers entirely', () => {
    const withStroke = addLayer(doc, stroke([0, 0, 100, 0]))

    expect(erasePartAt(withStroke, { x: 50, y: 0 }, 500).layers).toHaveLength(0)
  })

  // A thick line is wider than its axis, so the eraser grazes it sooner.
  it('reaches a thick stroke sooner than a thin one', () => {
    const thin = erasePartAt(
      addLayer(doc, stroke([0, 0, 100, 0], { width: 2 })),
      { x: 50, y: 12 },
      6,
    )
    const thick = erasePartAt(
      addLayer(doc, stroke([0, 0, 100, 0], { width: 24 })),
      { x: 50, y: 12 },
      6,
    )

    expect(thin.layers).toHaveLength(1)
    expect(thick.layers).toHaveLength(2)
  })

  it('leaves shapes and text alone: there is nothing to cut', () => {
    const withShape = addLayer(doc, createLayer('shape', { rect: { x: 0, y: 0, w: 100, h: 100 } }))

    expect(erasePartAt(withShape, { x: 50, y: 50 }, 20)).toBe(withShape)
  })

  it('spares a locked stroke', () => {
    const locked = addLayer(doc, stroke([0, 0, 100, 0], { locked: true }))

    expect(erasePartAt(locked, { x: 50, y: 0 }, 10)).toBe(locked)
  })

  it('returns the same document when nothing was touched', () => {
    const withStroke = addLayer(doc, stroke([0, 0, 100, 0]))

    expect(erasePartAt(withStroke, { x: 500, y: 500 }, 10)).toBe(withStroke)
  })
})

describe('eraseAlong', () => {
  // The hand covers a dozen pixels between mouse events: single circles would
  // leave a dashed line of half-erased bits.
  it('wipes the whole path, not just its ends', () => {
    const withStroke = addLayer(doc, stroke([0, 0, 200, 0], { width: 0 }))
    const after = eraseAlong(withStroke, { x: 20, y: 0 }, { x: 180, y: 0 }, 6)

    expect(after.layers).toHaveLength(2)
    const [left, right] = after.layers as [DrawLayer, DrawLayer]
    expect(left.points[2]).toBeCloseTo(14)
    expect(right.points[0]).toBeCloseTo(186)
  })

  it('erases at the spot when the cursor has not moved', () => {
    const withStroke = addLayer(doc, stroke([0, 0, 200, 0], { width: 0 }))
    const still = { x: 100, y: 0 }

    expect(eraseAlong(withStroke, still, still, 10).layers).toHaveLength(2)
  })

  it('removes objects along the path in the whole-object mode', () => {
    const two = addLayer(addLayer(doc, stroke([0, 0, 10, 0])), stroke([190, 0, 200, 0]))

    expect(eraseAlong(two, { x: 5, y: 0 }, { x: 195, y: 0 }, 6, 'object').layers).toHaveLength(0)
  })
})
