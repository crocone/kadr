import { describe, expect, it } from 'vitest'

import {
  boxesForRange,
  joinWords,
  mergeBoxes,
  mergeByLines,
  sameLine,
  toDocumentRect,
  type Word,
} from './words'

const word = (text: string, x: number, y = 0, w = text.length * 10, h = 12): Word => ({
  text,
  box: { x, y, w, h },
})

describe('joinWords', () => {
  it('glues words with a single space', () => {
    expect(joinWords([word('почта', 0), word('ivan@example.com', 60)]).text).toBe(
      'почта ivan@example.com',
    )
  })

  it('remembers where every word sits in the joined text', () => {
    const joined = joinWords([word('a', 0), word('bb', 20)])

    expect(joined.spans[0]).toMatchObject({ start: 0, end: 1 })
    expect(joined.spans[1]).toMatchObject({ start: 2, end: 4 })
  })

  it('skips empty words: OCR returns them for stray marks', () => {
    expect(joinWords([word('a', 0), { text: '', box: { x: 5, y: 0, w: 1, h: 1 } }]).text).toBe('a')
  })

  it('has nothing to join in an empty page', () => {
    expect(joinWords([])).toEqual({ text: '', spans: [] })
  })
})

describe('boxesForRange', () => {
  const joined = joinWords([word('позвоните', 0), word('+7', 100), word('912', 130)])

  // A phone number comes back as three words: all must be covered or half stays visible.
  it('takes every word the range touches, not only those inside it', () => {
    const start = joined.text.indexOf('+7')
    expect(boxesForRange(joined, start, joined.text.length)).toHaveLength(2)
  })

  it('takes a word the range only clips', () => {
    expect(boxesForRange(joined, 0, 1)).toHaveLength(1)
  })

  it('takes nothing for a range past the text', () => {
    expect(boxesForRange(joined, 999, 1000)).toEqual([])
  })
})

describe('mergeBoxes', () => {
  it('covers everything it was given', () => {
    const merged = mergeBoxes([
      { x: 10, y: 0, w: 20, h: 12 },
      { x: 40, y: 4, w: 10, h: 12 },
    ])

    expect(merged).toEqual({ x: 10, y: 0, w: 40, h: 16 })
  })

  it('has nothing to merge in an empty list', () => {
    expect(mergeBoxes([])).toBeNull()
  })
})

describe('sameLine', () => {
  // OCR coordinates jitter by a pixel or two: exact equality won't do.
  it('forgives a couple of pixels', () => {
    expect(sameLine({ x: 0, y: 10, w: 5, h: 12 }, { x: 30, y: 12, w: 5, h: 12 })).toBe(true)
  })

  it('tells a different line apart', () => {
    expect(sameLine({ x: 0, y: 0, w: 5, h: 12 }, { x: 0, y: 30, w: 5, h: 12 })).toBe(false)
  })
})

describe('mergeByLines', () => {
  // One bounding box for a wrapped match would also cover everything between the lines.
  it('gives a wrapped find one plate per line', () => {
    const merged = mergeByLines([
      { x: 200, y: 0, w: 40, h: 12 },
      { x: 0, y: 20, w: 30, h: 12 },
    ])

    expect(merged).toHaveLength(2)
    expect(merged[0]?.y).toBe(0)
  })

  it('merges what stands on one line', () => {
    const merged = mergeByLines([
      { x: 0, y: 0, w: 30, h: 12 },
      { x: 40, y: 1, w: 30, h: 12 },
    ])

    expect(merged).toHaveLength(1)
    expect(merged[0]?.w).toBe(70)
  })

  it('has nothing to merge in an empty list', () => {
    expect(mergeByLines([])).toEqual([])
  })
})

describe('toDocumentRect', () => {
  // OCR works in image pixels while the blur layer lives in document coordinates.
  it('scales a box from image pixels into the frame', () => {
    const rect = toDocumentRect(
      { x: 100, y: 50, w: 200, h: 20 },
      { w: 1000, h: 500 },
      { x: 40, y: 40, w: 500, h: 250 },
    )

    expect(rect).toEqual({ x: 90, y: 65, w: 100, h: 10 })
  })

  it('keeps a box unchanged when the frame is the image', () => {
    const box = { x: 10, y: 20, w: 30, h: 40 }

    expect(toDocumentRect(box, { w: 100, h: 100 }, { x: 0, y: 0, w: 100, h: 100 })).toEqual(box)
  })
})
