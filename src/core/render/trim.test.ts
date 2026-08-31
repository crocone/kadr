import { describe, expect, it } from 'vitest'

import { contentBounds, type Sample, WHOLE, worthTrimming } from './trim'

type Rgb = { r: number; g: number; b: number }

const WHITE: Rgb = { r: 255, g: 255, b: 255 }
const BLACK: Rgb = { r: 0, g: 0, b: 0 }
const BLUE: Rgb = { r: 40, g: 60, b: 200 }

/** A frame built from rows of colours, so the test image reads at a glance. */
function sample(rows: Rgb[][]): Sample {
  const width = rows[0]?.length ?? 0
  const data: number[] = []

  for (const row of rows) {
    for (const colour of row) data.push(colour.r, colour.g, colour.b, 255)
  }

  return { data, width, height: rows.length }
}

describe('contentBounds', () => {
  it('trims flat margins on every side', () => {
    const image = sample([
      [WHITE, WHITE, WHITE, WHITE],
      [WHITE, BLUE, BLUE, WHITE],
      [WHITE, WHITE, WHITE, WHITE],
    ])

    expect(contentBounds(image)).toEqual({ x: 0.25, y: 1 / 3, w: 0.5, h: 1 / 3 })
  })

  // A JPEG "uniform" margin varies by a point or two — it is still a margin.
  it('forgives compression noise in the margin', () => {
    const almost = { r: 253, g: 254, b: 255 }
    const image = sample([
      [WHITE, almost, WHITE],
      [WHITE, BLACK, WHITE],
    ])

    expect(contentBounds(image).w).toBeCloseTo(1 / 3)
  })

  it('leaves a picture without margins alone', () => {
    const image = sample([
      [BLUE, BLACK],
      [BLACK, BLUE],
    ])

    expect(contentBounds(image)).toEqual(WHOLE)
  })

  // Trimming a flat frame into nothing is not what the button is expected to do.
  it('returns a flat picture whole', () => {
    const image = sample([
      [WHITE, WHITE],
      [WHITE, WHITE],
    ])

    expect(contentBounds(image)).toEqual(WHOLE)
  })

  it('has nothing to trim in an empty picture', () => {
    expect(contentBounds({ data: [], width: 0, height: 0 })).toEqual(WHOLE)
  })

  it('trims a margin on one side only', () => {
    const image = sample([
      [WHITE, WHITE, BLUE],
      [WHITE, WHITE, BLUE],
    ])

    expect(contentBounds(image)).toMatchObject({ x: 2 / 3, y: 0, h: 1 })
  })

  // A strict tolerance separates close shades; a loose one merges them into one margin.
  it('obeys the tolerance it is given', () => {
    const image = sample([
      [WHITE, { r: 245, g: 245, b: 245 }],
      [WHITE, { r: 245, g: 245, b: 245 }],
    ])

    expect(contentBounds(image, 2)).not.toEqual(WHOLE)
    expect(contentBounds(image, 20)).toEqual(WHOLE)
  })
})

describe('worthTrimming', () => {
  it('says no when there is nothing to cut', () => {
    expect(worthTrimming(WHOLE)).toBe(false)
  })

  it('says yes for a real margin', () => {
    expect(worthTrimming({ x: 0.1, y: 0, w: 0.9, h: 1 })).toBe(true)
  })

  // A one-pixel edge is rounding, not a margin: not worth touching the canvas for.
  it('ignores a margin of a pixel', () => {
    expect(worthTrimming({ x: 0.002, y: 0, w: 0.997, h: 1 })).toBe(false)
  })
})
