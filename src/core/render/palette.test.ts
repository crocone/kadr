import { describe, expect, it } from 'vitest'

import { hexToRgb, rgbToHsl } from './color'
import { dominantColors, gradientFromColors, pickAccents } from './palette'

/** Builds an RGBA array from a list of "colour x count". */
function pixels(...runs: [hex: string, count: number][]): Uint8ClampedArray {
  const data: number[] = []
  for (const [hex, count] of runs) {
    const { r, g, b } = hexToRgb(hex)!
    for (let i = 0; i < count; i++) data.push(r, g, b, 255)
  }
  return new Uint8ClampedArray(data)
}

describe('dominantColors', () => {
  it('ranks colours by how much of the frame they cover', () => {
    const found = dominantColors(pixels(['#ffffff', 100], ['#4f46e5', 40], ['#dc2626', 10]))

    expect(found[0]?.weight).toBe(100)
    expect(found.map((entry) => entry.weight)).toEqual([100, 40, 10])
  })

  it('merges near-identical shades into one bucket', () => {
    const found = dominantColors(pixels(['#4f46e5', 20], ['#4e45e4', 20]))

    expect(found).toHaveLength(1)
    expect(found[0]?.weight).toBe(40)
  })

  it('ignores transparent pixels', () => {
    const data = new Uint8ClampedArray([255, 0, 0, 0, 0, 0, 255, 255])
    expect(dominantColors(data)).toHaveLength(1)
  })

  it('keeps only the requested number of entries', () => {
    const found = dominantColors(
      pixels(['#ffffff', 5], ['#000000', 4], ['#4f46e5', 3], ['#16a34a', 2]),
      2,
    )
    expect(found).toHaveLength(2)
  })
})

describe('pickAccents', () => {
  it('drops paper, ink and grey chrome', () => {
    const accents = pickAccents(
      dominantColors(pixels(['#ffffff', 100], ['#111111', 50], ['#808080', 40], ['#4f46e5', 10])),
    )

    expect(accents).toHaveLength(1)
    expect(rgbToHsl(accents[0]!).h).toBeGreaterThan(200)
  })
})

describe('gradientFromColors', () => {
  it('builds a gradient from the two strongest accents', () => {
    const gradient = gradientFromColors(
      dominantColors(pixels(['#ffffff', 200], ['#4f46e5', 60], ['#dc2626', 30])),
    )

    expect(gradient?.kind).toBe('gradient')
    expect(gradient?.from).not.toBe(gradient?.to)
  })

  it('invents a second colour when the frame has only one accent', () => {
    const gradient = gradientFromColors(dominantColors(pixels(['#ffffff', 200], ['#4f46e5', 60])))

    expect(gradient).not.toBeNull()
    expect(gradient?.from).not.toBe(gradient?.to)
  })

  it('gives up on a frame with no colour at all', () => {
    expect(
      gradientFromColors(dominantColors(pixels(['#ffffff', 100], ['#000000', 100]))),
    ).toBeNull()
  })
})
