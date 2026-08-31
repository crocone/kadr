import { describe, expect, it } from 'vitest'

import { type Pixels, signatureOf, THUMB_WIDTH } from './matcher'
import { type RollingOptions, runRolling } from './rolling'

/**
 * Scroll capture end to end: from pixels to the finished sheet.
 *
 * Unlike `rolling.test.ts`, frame signatures are not stubbed here — they are
 * computed from real pixels. So this checks exactly what it was all built for:
 * a virtualized list whose DOM never holds all the rows still assembles into
 * one frame where every row appears exactly once.
 */
const FRAME_HEIGHT = 60
const HEADER = 6
const FOOTER = 5
const CONTENT = FRAME_HEIGHT - HEADER - FOOTER
const PAGE_ROWS = 400
const MAX_TOP = PAGE_ROWS - CONTENT

const header = Array.from({ length: HEADER }, (_, index) => 900_000 + index)
const footer = Array.from({ length: FOOTER }, (_, index) => 800_000 + index)

/** A list row: its number defines the pattern, so the image shows which row it is. */
function rowPixels(row: number): number[] {
  return Array.from({ length: THUMB_WIDTH }, (_, x) => {
    let hash = Math.imul(row + 1, 0x9e3779b1) ^ Math.imul(x + 1, 0x85ebca6b)
    hash = Math.imul(hash ^ (hash >>> 15), 0xc2b2ae35)
    return (hash ^ (hash >>> 13)) & 0xff
  })
}

type Frame = { rows: number[]; pixels: Pixels }

function frameAt(scrollTop: number): Frame {
  const rows = [
    ...header,
    ...Array.from({ length: CONTENT }, (_, index) => scrollTop + index),
    ...footer,
  ]

  const data = new Uint8ClampedArray(THUMB_WIDTH * rows.length * 4)
  rows.forEach((row, y) => {
    rowPixels(row).forEach((value, x) => {
      const offset = (y * THUMB_WIDTH + x) * 4
      data[offset] = value
      data[offset + 1] = value
      data[offset + 2] = value
      data[offset + 3] = 255
    })
  })

  return { rows, pixels: { width: THUMB_WIDTH, height: rows.length, data } }
}

const options: RollingOptions = {
  direction: 'down',
  frameHeight: FRAME_HEIGHT,
  step: 40,
  startTop: 0,
  devicePixelRatio: 1,
  maxRows: 100_000,
}

async function capture(patch: Partial<RollingOptions> = {}, contentTop?: (top: number) => number) {
  let top = patch.startTop ?? 0
  const strips: number[][] = []

  const result = await runRolling<Frame>(
    {
      captureFrame: () => Promise.resolve(frameAt(contentTop ? contentTop(top) : top)),
      signature: (frame) => signatureOf(frame.pixels),
      scrollTo: (next) => {
        top = Math.max(0, Math.min(Math.round(next), MAX_TOP))
        return Promise.resolve({ scrollTop: top, stopped: false })
      },
    },
    { push: (frame, from, to) => strips.push(frame.rows.slice(from, to)) },
    { ...options, ...patch },
  )

  const direction = patch.direction ?? options.direction
  return { result, sheet: (direction === 'up' ? strips.reverse() : strips).flat() }
}

describe('scrolling capture, end to end', () => {
  it('cuts the strips away from the edge and still loses nothing', async () => {
    // Edge margin: right at the edge the frame is usually still painting, so
    // bands are cut higher — the deferred rows come from the last frame.
    const { result, sheet } = await capture({ edgeMargin: 6 })

    expect(result.stoppedBy).toBe('end')
    expect(sheet).toEqual([
      ...header,
      ...Array.from({ length: PAGE_ROWS }, (_, index) => index),
      ...footer,
    ])
  })

  it('keeps a chat scrolled up whole when the strips are cut away from the edge', async () => {
    const { sheet } = await capture({
      direction: 'up',
      startTop: 300,
      maxFrames: 4,
      edgeMargin: 6,
    })

    expect(sheet).toEqual([
      ...header,
      ...Array.from({ length: CONTENT + 120 }, (_, index) => 180 + index),
      ...footer,
    ])
  })

  it('collects every row of a virtualised list exactly once', async () => {
    const { result, sheet } = await capture()

    expect(result.stoppedBy).toBe('end')
    expect(result.seams).toBe(0)
    expect(sheet).toEqual([
      ...header,
      ...Array.from({ length: PAGE_ROWS }, (_, index) => index),
      ...footer,
    ])
    // No row twice: coordinate-based stitching is guilty of exactly that.
    expect(new Set(sheet).size).toBe(sheet.length)
  })

  it('finds the header and the input box by itself', async () => {
    const { result } = await capture()
    expect(result.sticky).toEqual({ top: HEADER, bottom: FOOTER })
  })

  it('walks a chat up into the history and keeps the rows in order', async () => {
    const { result, sheet } = await capture({ direction: 'up', startTop: 300, maxFrames: 4 })

    expect(result.seams).toBe(0)
    expect(sheet).toEqual([
      ...header,
      ...Array.from({ length: CONTENT + 120 }, (_, index) => 180 + index),
      ...footer,
    ])
  })

  it('does not repeat a screen when the container lies about how far it scrolled', async () => {
    // A virtualized list rewrites `scrollTop` under itself: it reports one shift
    // while the content moves another. Bands used to be placed by that number —
    // and the sheet got a repeated screen of conversation. Now the estimate is
    // only a candidate.
    const { sheet } = await capture({ maxFrames: 5 }, (top) => Math.round(top / 2))

    expect(new Set(sheet).size).toBe(sheet.length)
  })

  it('recovers from a step that overshot the overlap by taking a shorter one', async () => {
    // Step longer than the visible part: no overlap and matching fails. A retry
    // at half the step restores the overlap — and there is no seam in the end.
    const { result } = await capture({ step: CONTENT + 10, maxFrames: 3 })

    expect(result.seams).toBe(0)
  })

  it('falls back to the scroll delta when even the shorter step misses', async () => {
    // Here even the half step misses: stitching goes by the scroll delta, the
    // seam is counted, and the frame height stays honest — no silently broken image.
    const { result, sheet } = await capture({ step: CONTENT * 2 + 20, maxFrames: 3 })

    expect(result.seams).toBeGreaterThan(0)
    expect(sheet.length).toBe(result.rows)
  })
})
