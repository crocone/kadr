/**
 * Recognized words and the way back from a match to pixels.
 *
 * OCR yields words with rectangles, while PII detection runs over one joined string
 * and returns character offsets. This module is the bridge between the two — pure,
 * so it can be tested on five words instead of real recognition.
 */
import type { Rect } from '@/core/doc/types'

export type Word = { text: string; box: Rect }

/** Joined text plus which slice of it belongs to which word. */
export type Joined = {
  text: string
  spans: { start: number; end: number; box: Rect }[]
}

/** Single-space separator so offsets stay predictable. */
const SEPARATOR = ' '

export function joinWords(words: readonly Word[]): Joined {
  const spans: Joined['spans'] = []
  let text = ''

  for (const word of words) {
    if (word.text === '') continue
    if (text !== '') text += SEPARATOR

    const start = text.length
    text += word.text
    spans.push({ start, end: text.length, box: word.box })
  }

  return { text, spans }
}

/**
 * Rectangles of words touched by a text range.
 *
 * Touched, not fully contained: an email wraps onto two lines and a phone number
 * comes back as three words — all of them must be covered or half stays visible.
 */
export function boxesForRange(joined: Joined, start: number, end: number): Rect[] {
  return joined.spans.filter((span) => span.start < end && start < span.end).map((span) => span.box)
}

/**
 * Bounding rectangle. Exact for words on one line; for a wrapped match it comes out
 * wider — but redacting extra space is safer than missing some.
 */
export function mergeBoxes(boxes: readonly Rect[]): Rect | null {
  if (boxes.length === 0) return null

  const left = Math.min(...boxes.map((box) => box.x))
  const top = Math.min(...boxes.map((box) => box.y))
  const right = Math.max(...boxes.map((box) => box.x + box.w))
  const bottom = Math.max(...boxes.map((box) => box.y + box.h))

  return { x: left, y: top, w: right - left, h: bottom - top }
}

/**
 * Whether two words sit on the same line, judged by vertical overlap: OCR coordinates
 * jitter by a pixel or two, so exact equality won't do.
 */
export function sameLine(a: Rect, b: Rect): boolean {
  const overlap = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return overlap > Math.min(a.h, b.h) * 0.5
}

/**
 * Groups rectangles by line and merges each line separately.
 *
 * A wrapped match then yields two neat patches instead of one covering half the
 * screen: a single bounding box for a line-broken email would also cover everything
 * between the lines.
 */
export function mergeByLines(boxes: readonly Rect[]): Rect[] {
  const lines: Rect[][] = []

  for (const box of boxes) {
    const line = lines.find((candidate) => candidate.some((other) => sameLine(other, box)))
    if (line) line.push(box)
    else lines.push([box])
  }

  return lines
    .map((line) => mergeBoxes(line))
    .filter((rect): rect is Rect => rect !== null)
    .sort((a, b) => a.y - b.y || a.x - b.x)
}

/** Maps a rectangle from image pixels to document coordinates. */
export function toDocumentRect(box: Rect, image: { w: number; h: number }, frame: Rect): Rect {
  const kx = frame.w / image.w
  const ky = frame.h / image.h

  return { x: frame.x + box.x * kx, y: frame.y + box.y * ky, w: box.w * kx, h: box.h * ky }
}
