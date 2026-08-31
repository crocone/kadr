import { describe, expect, it } from 'vitest'

import { createDoc } from './create'
import {
  addLayer,
  badgeNumbers,
  createLayer,
  duplicateLayer,
  layerBounds,
  moveLayer,
  removeLayer,
  reorderLayers,
  resizeLayer,
  shiftLayerBy,
  updateLayer,
} from './layers'
import type { BadgeLayer, Doc, Layer } from './types'

function doc(...layers: Layer[]): Doc {
  const base = createDoc({ imageId: 'img_1', imageWidth: 800, imageHeight: 600 })
  return layers.reduce(addLayer, base)
}

const badge = (number: number | null = null): BadgeLayer =>
  ({ ...createLayer('badge'), number }) as BadgeLayer

describe('createLayer', () => {
  it('gives every layer a usable starting look', () => {
    const arrow = createLayer('arrow', { rect: { x: 10, y: 10, w: 100, h: 50 } })

    expect(arrow.kind).toBe('arrow')
    expect(arrow.visible).toBe(true)
    expect(arrow.locked).toBe(false)
  })

  it('takes its geometry from the gesture that made it', () => {
    const shape = createLayer('shape', { rect: { x: 5, y: 6, w: 70, h: 80 } })
    expect(layerBounds(shape)).toEqual({ x: 5, y: 6, w: 70, h: 80 })
  })

  it('hands out distinct ids', () => {
    expect(createLayer('badge').id).not.toBe(createLayer('badge').id)
  })
})

describe('updateLayer', () => {
  it('patches only the named layer', () => {
    const a = createLayer('shape')
    const b = createLayer('shape')
    const next = updateLayer(doc(a, b), a.id, { opacity: 0.5 })

    expect(next.layers[0]?.opacity).toBe(0.5)
    expect(next.layers[1]?.opacity).toBe(1)
  })

  it('refuses to change the kind of a layer through a patch', () => {
    const shape = createLayer('shape')
    const next = updateLayer(doc(shape), shape.id, { kind: 'text' })

    expect(next.layers[0]?.kind).toBe('shape')
  })
})

describe('removeLayer', () => {
  it('drops the layer and leaves the rest in order', () => {
    const [a, b, c] = [createLayer('shape'), createLayer('arrow'), createLayer('text')]
    const next = removeLayer(doc(a, b, c), b.id)

    expect(next.layers.map((layer) => layer.id)).toEqual([a.id, c.id])
  })
})

describe('duplicateLayer', () => {
  it('puts the copy straight above the original', () => {
    const [a, b] = [createLayer('shape'), createLayer('arrow')]
    const { doc: next, id } = duplicateLayer(doc(a, b), a.id)

    expect(next.layers.map((layer) => layer.id)).toEqual([a.id, id, b.id])
  })

  it('offsets the copy, or it would hide under the original', () => {
    const shape = createLayer('shape', { rect: { x: 10, y: 20, w: 100, h: 100 } })
    const { doc: next, id } = duplicateLayer(doc(shape), shape.id, 24)
    const copy = next.layers.find((layer) => layer.id === id)!

    expect(layerBounds(copy)).toMatchObject({ x: 34, y: 44 })
  })

  it('offsets point-based layers too', () => {
    const arrow = createLayer('arrow', { rect: { x: 0, y: 0, w: 100, h: 100 } })
    const { doc: next, id } = duplicateLayer(doc(arrow), arrow.id, 10)
    const copy = next.layers.find((layer) => layer.id === id)!

    expect(layerBounds(copy)).toMatchObject({ x: 10, y: 10 })
  })
})

describe('moveLayer', () => {
  it('walks a layer up and down the stack', () => {
    const [a, b, c] = [createLayer('shape'), createLayer('arrow'), createLayer('text')]
    const start = doc(a, b, c)

    expect(moveLayer(start, a.id, 'up').layers.map((l) => l.id)).toEqual([b.id, a.id, c.id])
    expect(moveLayer(start, c.id, 'down').layers.map((l) => l.id)).toEqual([a.id, c.id, b.id])
    expect(moveLayer(start, a.id, 'top').layers.map((l) => l.id)).toEqual([b.id, c.id, a.id])
    expect(moveLayer(start, c.id, 'bottom').layers.map((l) => l.id)).toEqual([c.id, a.id, b.id])
  })

  it('does nothing at the ends of the stack', () => {
    const [a, b] = [createLayer('shape'), createLayer('arrow')]
    const start = doc(a, b)

    expect(moveLayer(start, a.id, 'down').layers.map((l) => l.id)).toEqual([a.id, b.id])
    expect(moveLayer(start, b.id, 'up').layers.map((l) => l.id)).toEqual([a.id, b.id])
  })
})

describe('reorderLayers', () => {
  it('moves by index, the way a drag in the panel does', () => {
    const [a, b, c] = [createLayer('shape'), createLayer('arrow'), createLayer('text')]

    expect(reorderLayers(doc(a, b, c), 2, 0).layers.map((l) => l.id)).toEqual([c.id, a.id, b.id])
  })

  it('ignores an index outside the stack', () => {
    const a = createLayer('shape')
    expect(reorderLayers(doc(a), 0, 5).layers).toHaveLength(1)
  })
})

describe('badgeNumbers', () => {
  it('numbers badges by their order, so steps read bottom to top', () => {
    const [first, second, third] = [badge(), badge(), badge()]
    const numbers = badgeNumbers([first, createLayer('arrow'), second, third])

    expect(numbers.get(first.id)).toBe(1)
    expect(numbers.get(second.id)).toBe(2)
    expect(numbers.get(third.id)).toBe(3)
  })

  /** This is why numbers are derived rather than stored. */
  it('renumbers the rest when a step is deleted', () => {
    const [first, second, third] = [badge(), badge(), badge()]
    const numbers = badgeNumbers([first, third])

    expect(numbers.get(first.id)).toBe(1)
    expect(numbers.get(third.id)).toBe(2)
    expect(numbers.has(second.id)).toBe(false)
  })

  it('respects a number set by hand and skips it in the run', () => {
    const pinned = badge(1)
    const auto = badge()
    const numbers = badgeNumbers([pinned, auto])

    expect(numbers.get(pinned.id)).toBe(1)
    expect(numbers.get(auto.id)).toBe(2)
  })

  it('has nothing to say about other layers', () => {
    expect(badgeNumbers([createLayer('arrow'), createLayer('text')]).size).toBe(0)
  })
})

describe('layerBounds', () => {
  it('wraps an arrow around all of its points', () => {
    const arrow = createLayer('arrow', {
      points: [
        { x: 100, y: 40 },
        { x: 20, y: 90 },
      ],
    })
    expect(layerBounds(arrow)).toEqual({ x: 20, y: 40, w: 80, h: 50 })
  })

  it('has no bounds for an empty stroke', () => {
    expect(layerBounds(createLayer('draw'))).toBeNull()
  })
})

describe('shiftLayerBy', () => {
  it('moves a rectangle keeping its size', () => {
    const layer = createLayer('shape', { rect: { x: 10, y: 20, w: 100, h: 50 } })

    expect(shiftLayerBy(layer, { x: 5, y: -5 })).toEqual({
      rect: { x: 15, y: 15, w: 100, h: 50 },
    })
  })

  it('moves an anchored layer by its point', () => {
    const layer = createLayer('badge', { at: { x: 10, y: 10 } })

    expect(shiftLayerBy(layer, { x: 3, y: 4 })).toEqual({ at: { x: 13, y: 14 } })
  })

  // Stroke points are a flat list: x and y alternate, and so does the shift.
  it('moves every point of a stroke', () => {
    const layer = createLayer('draw', {
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 20 },
      ],
    })

    expect(shiftLayerBy(layer, { x: 1, y: 2 })).toEqual({ points: [1, 2, 11, 22] })
  })

  it('moves both ends of an arrow', () => {
    const layer = createLayer('arrow', {
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
    })

    expect(shiftLayerBy(layer, { x: 2, y: 2 })).toEqual({
      points: [
        { x: 2, y: 2 },
        { x: 12, y: 12 },
      ],
    })
  })
})

describe('resizeLayer', () => {
  const box = { x: 10, y: 20, w: 200, h: 100, rotation: 0 }

  // The transformer drags the text box, not the glyphs: stretched type is deformation.
  it('gives a text layer a wrap width and leaves the size alone', () => {
    const layer = createLayer('text')
    const patch = resizeLayer(layer, box)

    expect(patch).toMatchObject({ at: { x: 10, y: 20 }, width: 200 })
    expect(patch).not.toHaveProperty('fontSize')
  })

  it('never shrinks the wrap width below one glyph', () => {
    const layer = { ...createLayer('text'), fontSize: 40 } as Layer
    const patch = resizeLayer(layer, { ...box, w: 4 })

    expect(patch).toMatchObject({ width: 40 })
  })

  // The badge is round: the smaller side wins, or it would escape the box.
  it('sizes a badge by its shorter side', () => {
    expect(resizeLayer(createLayer('badge'), box)).toMatchObject({ size: 100 })
  })

  it('scales the points of an arrow into the new box', () => {
    const layer = createLayer('arrow', {
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 50 },
      ],
    })

    expect(resizeLayer(layer, box)).toMatchObject({
      points: [
        { x: 10, y: 20 },
        { x: 210, y: 120 },
      ],
    })
  })

  it('scales a stroke, keeping x and y in their own places', () => {
    const layer = createLayer('draw', {
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 50 },
      ],
    })

    expect(resizeLayer(layer, box)).toMatchObject({ points: [10, 20, 210, 120] })
  })

  it('resizes a shape by its rectangle', () => {
    const layer = createLayer('shape', { rect: { x: 0, y: 0, w: 10, h: 10 } })

    expect(resizeLayer(layer, box)).toMatchObject({
      rect: { x: 10, y: 20, w: 200, h: 100 },
    })
  })

  it('carries the rotation of the gesture', () => {
    expect(resizeLayer(createLayer('shape'), { ...box, rotation: 30 })).toMatchObject({
      rotation: 30,
    })
  })
})

describe('layerBounds for text', () => {
  it('takes the set width when there is one', () => {
    const layer = { ...createLayer('text'), width: 300 } as Layer

    expect(layerBounds(layer)?.w).toBe(300)
  })

  // Only Konva knows the exact width after layout — until then, estimate from the longest line.
  it('estimates from the longest line otherwise', () => {
    const short = { ...createLayer('text'), text: 'ab', width: null } as Layer
    const long = { ...createLayer('text'), text: 'abcdefghij', width: null } as Layer

    expect(layerBounds(long)!.w).toBeGreaterThan(layerBounds(short)!.w)
  })

  it('grows in height with every line', () => {
    const one = { ...createLayer('text'), text: 'a' } as Layer
    const three = { ...createLayer('text'), text: 'a\nb\nc' } as Layer

    expect(layerBounds(three)!.h).toBeCloseTo(layerBounds(one)!.h * 3)
  })
})
