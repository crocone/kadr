import { describe, expect, it } from 'vitest'

import {
  ARROW_STYLES,
  type ArrowStyle,
  arrowShape,
  controlPointOf,
  defaultControlPoint,
  elbowPoints,
  isCurved,
  withControlPoint,
} from './arrows'
import { createLayer } from './layers'
import type { ArrowLayer, Point } from './types'

const FROM: Point = { x: 100, y: 100 }
const TO: Point = { x: 300, y: 200 }

function arrow(style: ArrowStyle, points: Point[] = [FROM, TO], width = 6): ArrowLayer {
  const layer = createLayer('arrow') as ArrowLayer
  return { ...layer, style, width, points }
}

describe('defaultControlPoint', () => {
  it('sits off the chord, or the curve would be a straight line', () => {
    const control = defaultControlPoint(FROM, TO)
    const midpoint = { x: 200, y: 150 }

    expect(control).not.toEqual(midpoint)
  })

  it('bends further for a longer arrow', () => {
    const near = defaultControlPoint({ x: 0, y: 0 }, { x: 10, y: 0 })
    const far = defaultControlPoint({ x: 0, y: 0 }, { x: 1000, y: 0 })

    expect(Math.abs(far.y)).toBeGreaterThan(Math.abs(near.y))
  })

  it('bends to the same side whichever way the arrow points', () => {
    expect(defaultControlPoint(FROM, TO).y - 150).toBeGreaterThan(0)
    expect(defaultControlPoint(TO, FROM).y - 150).toBeLessThan(0)
  })
})

describe('elbowPoints', () => {
  it('turns once, horizontally then vertically', () => {
    expect(elbowPoints(FROM, TO)).toEqual([FROM, { x: 300, y: 100 }, TO])
  })
})

describe('arrowShape', () => {
  it('starts and ends where the layer says, in every style', () => {
    for (const style of ARROW_STYLES) {
      const { points } = arrowShape(arrow(style))

      expect(points.slice(0, 2)).toEqual([FROM.x, FROM.y])
      expect(points.slice(-2)).toEqual([TO.x, TO.y])
    }
  })

  it('keeps a straight arrow to two points', () => {
    expect(arrowShape(arrow('straight')).points).toHaveLength(4)
  })

  it('adds a control point for a curve and smooths it', () => {
    const shape = arrowShape(arrow('curved'))

    expect(shape.points).toHaveLength(6)
    expect(shape.tension).toBeGreaterThan(0)
  })

  it('points both ways only for the double style', () => {
    expect(arrowShape(arrow('double')).pointerAtBeginning).toBe(true)
    for (const style of ARROW_STYLES.filter((s) => s !== 'double')) {
      expect(arrowShape(arrow(style)).pointerAtBeginning).toBe(false)
    }
  })

  it('scales thin and thick around the layer width', () => {
    expect(arrowShape(arrow('thin', [FROM, TO], 10)).width).toBeLessThan(10)
    expect(arrowShape(arrow('thick', [FROM, TO], 10)).width).toBeGreaterThan(10)
  })

  it('never draws a hairline, however thin the style', () => {
    expect(arrowShape(arrow('thin', [FROM, TO], 1)).width).toBeGreaterThanOrEqual(1)
  })

  it('dashes only the sketch style, with gaps that scale with the stroke', () => {
    const sketch = arrowShape(arrow('sketch', [FROM, TO], 10))

    expect(sketch.dash).not.toBeNull()
    expect(Math.min(...sketch.dash!)).toBeGreaterThan(10)
    expect(arrowShape(arrow('straight')).dash).toBeNull()
  })
})

describe('controlPointOf', () => {
  it('computes the bend when nobody has moved it', () => {
    const layer = arrow('curved', [FROM, TO])

    expect(controlPointOf(layer)).toEqual(defaultControlPoint(FROM, TO))
  })

  // The middle point is the handle: once it's been dragged, no computation is needed.
  it('prefers the point the user dragged', () => {
    const layer = arrow('curved', [FROM, { x: 5, y: 5 }, TO])

    expect(controlPointOf(layer)).toEqual({ x: 5, y: 5 })
  })

  it('bends a sketch less than a curve', () => {
    const straightish = controlPointOf(arrow('sketch', [FROM, TO]))
    const curved = controlPointOf(arrow('curved', [FROM, TO]))

    expect(Math.abs(straightish.y - 150)).toBeLessThan(Math.abs(curved.y - 150))
  })

  it('has a handle only where there is something to bend', () => {
    expect(isCurved(arrow('curved', [FROM, TO]))).toBe(true)
    expect(isCurved(arrow('sketch', [FROM, TO]))).toBe(true)
    expect(isCurved(arrow('straight', [FROM, TO]))).toBe(false)
    expect(isCurved(arrow('elbow', [FROM, TO]))).toBe(false)
  })
})

describe('withControlPoint', () => {
  it('keeps the ends and replaces the middle', () => {
    const layer = arrow('curved', [FROM, { x: 5, y: 5 }, TO])

    expect(withControlPoint(layer, { x: 9, y: 9 })).toEqual([FROM, { x: 9, y: 9 }, TO])
  })

  it('adds a middle to an arrow that had none', () => {
    expect(withControlPoint(arrow('curved', [FROM, TO]), { x: 9, y: 9 })).toEqual([
      FROM,
      { x: 9, y: 9 },
      TO,
    ])
  })
})
