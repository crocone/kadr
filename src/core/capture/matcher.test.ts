import { describe, expect, it } from 'vitest'

import { findStickyBands, matchFrames, type Pixels, signatureOf, THUMB_WIDTH } from './matcher'

/**
 * Synthetic frames: a row is defined by its number, `null` means flat background.
 * The row number is the "page content", so the shift between frames is known in
 * advance and can be checked against what the matcher found.
 */
type Row = number | null

function rowValues(row: Row): number[] {
  if (row === null) return Array.from({ length: THUMB_WIDTH }, () => 128)
  // Avalanche mixing: neighboring rows and points must not look alike, or the
  // test would be checking its own arithmetic instead of the matcher.
  return Array.from({ length: THUMB_WIDTH }, (_, x) => {
    let h = Math.imul(row + 1, 0x9e3779b1) ^ Math.imul(x + 1, 0x85ebca6b)
    h = Math.imul(h ^ (h >>> 15), 0xc2b2ae35)
    return (h ^ (h >>> 13)) & 0xff
  })
}

function frameOf(rows: readonly Row[]): Pixels {
  const data = new Uint8ClampedArray(THUMB_WIDTH * rows.length * 4)
  rows.forEach((row, y) => {
    rowValues(row).forEach((value, x) => {
      const offset = (y * THUMB_WIDTH + x) * 4
      data[offset] = value
      data[offset + 1] = value
      data[offset + 2] = value
      data[offset + 3] = 255
    })
  })
  return { width: THUMB_WIDTH, height: rows.length, data }
}

/** A slice of the "page": rows starting at `from`, `count` total. */
const page = (from: number, count: number): Row[] =>
  Array.from({ length: count }, (_, index) => from + index)

const signature = (rows: readonly Row[]) => signatureOf(frameOf(rows))

const match = (a: readonly Row[], b: readonly Row[]) => matchFrames(signature(a), signature(b))

describe('signatureOf', () => {
  it('marks a flat row as carrying nothing', () => {
    const found = signature([1, null, 2, null])
    expect([...found.informative]).toEqual([1, 0, 1, 0])
    expect(found.informativeCount).toBe(2)
  })

  it('gives the same row the same hash in different frames', () => {
    expect(signature([7, 8]).rows[0]).toBe(signature([5, 7]).rows[1])
  })

  it('survives the noise of a redrawn frame', () => {
    // Adjacent frames of identical content differ by a few brightness units:
    // anti-aliasing, subpixel rendering, repaints. The hash survives that.
    const clean = frameOf([12])
    const noisy = frameOf([12])
    for (let index = 0; index < noisy.data.length; index += 4) {
      noisy.data[index] = (noisy.data[index] ?? 0) + 1
      noisy.data[index + 1] = (noisy.data[index + 1] ?? 0) + 1
      noisy.data[index + 2] = (noisy.data[index + 2] ?? 0) + 1
    }
    expect(signatureOf(noisy).rows[0]).toBe(signatureOf(clean).rows[0])
  })
})

describe('matchFrames', () => {
  it('finds no shift between two identical frames', () => {
    const found = match(page(0, 40), page(0, 40))
    expect(found.shift).toBe(0)
    expect(found.confident).toBe(true)
  })

  it('measures a scroll down as a positive shift', () => {
    const found = match(page(0, 40), page(12, 40))
    expect(found.shift).toBe(12)
    expect(found.confident).toBe(true)
  })

  it('measures a scroll up as a negative shift', () => {
    const found = match(page(12, 40), page(0, 40))
    expect(found.shift).toBe(-12)
    expect(found.confident).toBe(true)
  })

  it('keeps working when part of the frame keeps changing', () => {
    // A video or GIF mid-list: those rows match under no shift, but the rest
    // still build a majority.
    const before = [...page(0, 40)]
    const after = [...page(10, 40)]
    for (let y = 5; y < 12; y++) after[y] = 900 + y

    const found = matchFrames(signatureOf(frameOf(before)), signatureOf(frameOf(after)))
    expect(found.shift).toBe(10)
    expect(found.confident).toBe(true)
  })

  it('admits it when the frames do not overlap at all', () => {
    const found = match(page(0, 40), page(500, 40))
    expect(found.confident).toBe(false)
  })

  it('calls two blank frames unchanged, because they are', () => {
    const blank = Array.from({ length: 40 }, () => null)
    const found = match(blank, blank)

    expect(found.shift).toBe(0)
    expect(found.confident).toBe(true)
  })

  it('finds the shift when most of the screen stands still', () => {
    // This is what an app with a sidebar looks like: only the content column
    // moves, most rows are identical in both frames. Zero shift used to beat
    // the real one on those static rows alone, and the capture stopped on the
    // very first screen.
    const still = page(9000, 60)
    const found = match([...still, ...page(0, 40)], [...still, ...page(12, 40)])

    expect(found.shift).toBe(12)
    expect(found.confident).toBe(true)
  })

  it('does not invent a shift out of a repeating pattern', () => {
    // A striped background repeats across the frame and matches itself at any
    // even shift. The right answer is "frame did not move", not a random shift.
    const striped = Array.from({ length: 40 }, (_, y) => (y % 2 === 0 ? 1 : 2))
    expect(match(striped, striped).shift).toBe(0)
  })
})

describe('a page of code', () => {
  /**
   * A listing line squeezed into the thumbnail is a pale gray band: text gets
   * averaged, gradients measure in single units. Lines differ only by length
   * and indent — exactly the page where the matcher used to report "frame
   * unchanged" because every row hashed the same.
   */
  function codeRow(line: number): number[] {
    const indent = 2 + (line % 4) * 3
    const length = 24 + ((line * 7) % 60)
    return Array.from({ length: THUMB_WIDTH }, (_, x) => {
      const inside = x >= indent && x < indent + length
      // Soft contrast: gray text on white, which is what averaging produces.
      return inside ? 214 - ((line * 13 + x * 5) % 12) : 246
    })
  }

  const codeFrame = (from: number, count: number): Pixels => {
    const rows = Array.from({ length: count }, (_, index) => codeRow(from + index))
    const data = new Uint8ClampedArray(THUMB_WIDTH * count * 4)
    rows.forEach((values, y) => {
      values.forEach((value, x) => {
        const offset = (y * THUMB_WIDTH + x) * 4
        data[offset] = value
        data[offset + 1] = value
        data[offset + 2] = value
        data[offset + 3] = 255
      })
    })
    return { width: THUMB_WIDTH, height: count, data }
  }

  it('tells one line of a listing from another', () => {
    const found = signatureOf(codeFrame(0, 40))
    expect(new Set(found.rows).size).toBeGreaterThan(20)
  })

  it('measures the scroll of a page that is nothing but code', () => {
    const found = matchFrames(signatureOf(codeFrame(0, 40)), signatureOf(codeFrame(9, 40)))

    expect(found.shift).toBe(9)
    expect(found.confident).toBe(true)
  })

  it('does not call a scrolled listing unchanged', () => {
    // Exactly the old breakage: a real shift, but the matcher saw zero — and
    // the capture ended on the first screen of a long answer.
    const found = matchFrames(signatureOf(codeFrame(0, 40)), signatureOf(codeFrame(20, 40)))
    expect(found.shift).not.toBe(0)
  })
})

describe('sticky bands', () => {
  /** A chat frame: channel header, message feed, input field. */
  const chat = (from: number) => [...page(9000, 4), ...page(from, 30), ...page(8000, 3)]

  it('finds the header and the input box that stay put', () => {
    const found = match(chat(0), chat(10))

    expect(found.shift).toBe(10)
    expect(found.sticky).toEqual({ top: 4, bottom: 3 })
  })

  it('does not call a flat edge sticky', () => {
    const flatTop = (from: number) => [null, null, null, ...page(from, 30)]
    expect(match(flatTop(0), flatTop(10)).sticky.top).toBe(0)
  })

  it('finds nothing sticky between two identical frames', () => {
    // Otherwise on a pair of identical frames the whole frame would be "sticky".
    expect(match(chat(0), chat(0)).sticky).toEqual({ top: 0, bottom: 0 })
  })

  it('refuses a band that would eat half the frame', () => {
    const half = Array.from({ length: 40 }, (_, y) => (y < 30 ? 5000 + y : y))
    const other = Array.from({ length: 40 }, (_, y) => (y < 30 ? 5000 + y : y + 100))
    expect(findStickyBands(signature(half), signature(other)).top).toBeLessThanOrEqual(18)
  })
})
