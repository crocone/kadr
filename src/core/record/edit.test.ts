import { describe, expect, it } from 'vitest'

import { defaultEdit } from './defaults'
import {
  addCut,
  isCut,
  replaceCut,
  tidyCuts,
  keptDuration,
  keptSpans,
  normalizeSpans,
  outputDuration,
  removeCut,
  setTrim,
  toOutput,
  toOutputNearest,
  toSource,
} from './edit'
import type { ClipEdit } from './types'

function edit(overrides: Partial<ClipEdit> = {}): ClipEdit {
  return { ...defaultEdit(10_000), ...overrides }
}

describe('normalizeSpans', () => {
  it('sorts, merges overlaps and drops empties', () => {
    const spans = normalizeSpans(
      [
        { start: 800, end: 1200 },
        { start: 200, end: 900 },
        { start: 3000, end: 3000 },
      ],
      { start: 0, end: 5000 },
    )
    expect(spans).toEqual([{ start: 200, end: 1200 }])
  })

  it('clamps to the bounds and repairs reversed spans', () => {
    const spans = normalizeSpans(
      [
        { start: 900, end: 100 },
        { start: 4000, end: 9000 },
      ],
      {
        start: 200,
        end: 5000,
      },
    )
    expect(spans).toEqual([
      { start: 200, end: 900 },
      { start: 4000, end: 5000 },
    ])
  })
})

describe('keptSpans', () => {
  it('is the whole trim when nothing is cut', () => {
    expect(keptSpans(edit())).toEqual([{ start: 0, end: 10_000 }])
  })

  it('splits around a cut', () => {
    const cut = edit({ cuts: [{ start: 3000, end: 4000 }] })
    expect(keptSpans(cut)).toEqual([
      { start: 0, end: 3000 },
      { start: 4000, end: 10_000 },
    ])
  })

  it('leaves nothing when the cut covers the trim', () => {
    const cut = edit({ trim: { start: 1000, end: 2000 }, cuts: [{ start: 0, end: 5000 }] })
    expect(keptSpans(cut)).toEqual([])
    expect(keptDuration(cut)).toBe(0)
  })
})

describe('toOutput', () => {
  it('subtracts the trimmed head', () => {
    const trimmed = edit({ trim: { start: 2000, end: 8000 } })
    expect(toOutput(trimmed, 3000)).toBe(1000)
  })

  it('pulls everything after a cut forward by its length', () => {
    const cut = edit({ cuts: [{ start: 2000, end: 5000 }] })
    expect(toOutput(cut, 1000)).toBe(1000)
    expect(toOutput(cut, 6000)).toBe(3000)
  })

  it('has no answer for a moment that was cut away', () => {
    const cut = edit({ cuts: [{ start: 2000, end: 5000 }] })
    expect(toOutput(cut, 3000)).toBeNull()
    expect(toOutput(edit({ trim: { start: 1000, end: 9000 } }), 500)).toBeNull()
  })

  it('divides by the speed', () => {
    expect(toOutput(edit({ speed: 2 }), 4000)).toBe(2000)
  })
})

describe('toOutputNearest', () => {
  it('lands on the seam instead of vanishing', () => {
    const cut = edit({ cuts: [{ start: 2000, end: 5000 }] })
    expect(toOutputNearest(cut, 3000)).toBe(2000)
    expect(toOutputNearest(cut, 12_000)).toBe(7000)
  })
})

describe('toSource', () => {
  it('round-trips through cuts and speed', () => {
    const cut = edit({ cuts: [{ start: 2000, end: 5000 }], speed: 1.5 })
    for (const source of [0, 500, 1999, 5000, 7000, 9999]) {
      const output = toOutput(cut, source)
      expect(output).not.toBeNull()
      expect(toSource(cut, output!)).toBeCloseTo(source, 6)
    }
  })

  it('stops at the last kept frame rather than running into the trimmed tail', () => {
    const trimmed = edit({ trim: { start: 0, end: 4000 } })
    expect(toSource(trimmed, 99_000)).toBe(4000)
  })

  it('answers for an empty edit without throwing', () => {
    const empty = edit({ trim: { start: 1000, end: 1000 } })
    expect(toSource(empty, 500)).toBe(1000)
  })
})

describe('outputDuration', () => {
  it('counts the cuts out and the speed in', () => {
    const cut = edit({ cuts: [{ start: 1000, end: 3000 }], speed: 2 })
    expect(outputDuration(cut)).toBe(4000)
  })

  it('treats a nonsense speed as 1', () => {
    expect(outputDuration(edit({ speed: 0 }))).toBe(10_000)
  })
})

describe('cuts', () => {
  it('adds and removes by the moment inside', () => {
    const withCut = addCut(edit(), { start: 1000, end: 2000 })
    expect(isCut(withCut, 1500)).toBe(true)
    expect(isCut(removeCut(withCut, 1500), 1500)).toBe(false)
  })

  it('counts anything outside the trim as cut', () => {
    expect(isCut(edit({ trim: { start: 1000, end: 5000 } }), 200)).toBe(true)
  })
})

describe('replaceCut and tidyCuts', () => {
  const two = edit({
    cuts: [
      { start: 1000, end: 2000 },
      { start: 4000, end: 5000 },
    ],
  })

  it('rewrites one span in place, leaving the order alone', () => {
    const moved = replaceCut(two, 0, { start: 4200, end: 4400 })
    expect(moved.cuts).toEqual([
      { start: 4200, end: 4400 },
      { start: 4000, end: 5000 },
    ])
  })

  it('does not merge while the handle is still moving', () => {
    const overlapping = replaceCut(two, 0, { start: 3500, end: 4500 })
    expect(overlapping.cuts).toHaveLength(2)
  })

  it('merges once the drag is over', () => {
    const tidied = tidyCuts(replaceCut(two, 0, { start: 3500, end: 4500 }))
    expect(tidied.cuts).toEqual([{ start: 3500, end: 5000 }])
  })

  it('keeps a dragged span inside the trim', () => {
    const trimmed = { ...two, trim: { start: 500, end: 6000 } }
    expect(replaceCut(trimmed, 1, { start: -400, end: 9000 }).cuts[1]).toEqual({
      start: 500,
      end: 6000,
    })
  })

  it('ignores an index that is not there', () => {
    expect(replaceCut(two, 7, { start: 0, end: 100 })).toBe(two)
  })
})

describe('setTrim', () => {
  it('re-normalizes the cuts against the new bounds', () => {
    const moved = setTrim(edit({ cuts: [{ start: 1000, end: 4000 }] }), { start: 2000, end: 8000 })
    expect(moved.cuts).toEqual([{ start: 2000, end: 4000 }])
  })
})
