import { describe, expect, it } from 'vitest'

import { docPiiKind, findingsFrom, PADDING, rectsOf } from './redact'
import type { Word } from './words'

const IMAGE = { w: 1000, h: 500 }
const FRAME = { x: 0, y: 0, w: 1000, h: 500 }

const word = (text: string, x: number, y = 0, w = text.length * 10, h = 14): Word => ({
  text,
  box: { x, y, w, h },
})

describe('findingsFrom', () => {
  it('finds an email and gives it a plate', () => {
    const found = findingsFrom([word('почта', 0), word('ivan@example.com', 60)], IMAGE, FRAME)

    expect(found).toHaveLength(1)
    expect(found[0]?.kind).toBe('email')
    expect(found[0]?.rects).toHaveLength(1)
  })

  it('covers the word it found, with a little room', () => {
    const [finding] = findingsFrom([word('ivan@example.com', 100, 40)], IMAGE, FRAME)
    const [rect] = finding!.rects

    expect(rect?.x).toBe(100 - PADDING)
    expect(rect?.y).toBe(40 - PADDING)
  })

  // A phone number comes back as three words: half a redaction is no redaction.
  it('covers every word of a find split across words', () => {
    const [finding] = findingsFrom(
      [word('+7', 0, 0, 20), word('912', 30, 0, 30), word('3456789', 70, 0, 70)],
      IMAGE,
      FRAME,
    )

    expect(finding?.kind).toBe('phone')
    expect(finding?.rects[0]?.w).toBeGreaterThan(120)
  })

  // A match assembled from words can wrap: the start of a phone number stays on one
  // line, the tail moves to the next. A single bounding box would also cover
  // everything between the lines.
  it('gives a wrapped find one plate per line', () => {
    const [finding] = findingsFrom(
      [word('+7', 900, 0, 20), word('912', 940, 0, 30), word('3456789', 0, 40, 70)],
      IMAGE,
      FRAME,
    )

    expect(finding?.kind).toBe('phone')
    expect(finding?.rects).toHaveLength(2)
  })

  it('translates pixels into document coordinates', () => {
    const [finding] = findingsFrom(
      [word('ivan@example.com', 100, 100, 200, 20)],
      IMAGE,
      { x: 0, y: 0, w: 500, h: 250 },
      0,
    )

    expect(finding?.rects[0]).toEqual({ x: 50, y: 50, w: 100, h: 10 })
  })

  it('finds several different things on one screen', () => {
    const found = findingsFrom(
      [word('ivan@example.com', 0), word('192.168.0.1', 200, 40)],
      IMAGE,
      FRAME,
    )

    expect(found.map((finding) => finding.kind)).toEqual(['email', 'ip'])
  })

  // A false positive blurs a piece of the UI — worse than a miss.
  it('finds nothing on an ordinary screen', () => {
    expect(findingsFrom([word('Полный', 0), word('комплект', 80)], IMAGE, FRAME)).toEqual([])
  })

  it('has nothing to find on an empty page', () => {
    expect(findingsFrom([], IMAGE, FRAME)).toEqual([])
  })
})

describe('rectsOf', () => {
  it('counts every plate of every finding', () => {
    const found = findingsFrom(
      [word('ivan@example.com', 0), word('192.168.0.1', 200, 40)],
      IMAGE,
      FRAME,
    )

    expect(rectsOf(found)).toHaveLength(2)
  })

  it('has nothing to count without findings', () => {
    expect(rectsOf([])).toEqual([])
  })
})

describe('docPiiKind', () => {
  it('carries the kinds the document knows straight through', () => {
    expect(docPiiKind('email')).toBe('email')
    expect(docPiiKind('phone')).toBe('phone')
    expect(docPiiKind('card')).toBe('card')
  })

  it('maps what the document has no cell for, rather than losing it', () => {
    // An IBAN is payment details; API key and JWT are tokens; an IP is "other".
    expect(docPiiKind('iban')).toBe('card')
    expect(docPiiKind('jwt')).toBe('token')
    expect(docPiiKind('apiKey')).toBe('token')
    expect(docPiiKind('ip')).toBe('other')
  })
})
