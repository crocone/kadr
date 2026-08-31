import { describe, expect, it, vi } from 'vitest'

import type { FrameSignature } from './matcher'
import { createChunkSink, type RollingOptions, runRolling, stepFor } from './rolling'

/**
 * Virtual list: the page has a header, a row feed, and an input field. A frame
 * is a window into that feed, so both the shift between frames and the correct
 * result are known in advance.
 *
 * No pixels here: the session needs only frame signatures, which are row hashes.
 * A row is represented by its number, so the test checks assembly, not drawing.
 */
const FRAME_HEIGHT = 40
const HEADER = 4
const FOOTER = 3
const CONTENT = FRAME_HEIGHT - HEADER - FOOTER
const PAGE_ROWS = 300
const MAX_TOP = PAGE_ROWS - CONTENT

const header = Array.from({ length: HEADER }, (_, index) => 900_000 + index)
const footer = Array.from({ length: FOOTER }, (_, index) => 800_000 + index)

type Frame = { id: number; rows: number[] }

function frameAt(scrollTop: number, id: number): Frame {
  const content = Array.from({ length: CONTENT }, (_, index) => scrollTop + index)
  return { id, rows: [...header, ...content, ...footer] }
}

function signatureOfRows(rows: readonly number[]): FrameSignature {
  return {
    height: rows.length,
    rows: Uint32Array.from(rows, (row) => Math.imul(row + 1, 0x9e3779b1) >>> 0),
    informative: Uint8Array.from(rows, () => 1),
    informativeCount: rows.length,
  }
}

type Push = { frame: Frame; from: number; to: number }

/** Recording sink: bands accumulate in capture order, like the real one. */
function recorder() {
  const pushes: Push[] = []
  return {
    pushes,
    sink: {
      push: (frame: Frame, from: number, to: number) => {
        pushes.push({ frame, from, to })
      },
    },
    /** Final sheet as rows: upward bands are laid out in reverse order. */
    sheet(direction: 'down' | 'up' = 'down'): number[] {
      const strips = pushes.map(({ frame, from, to }) => frame.rows.slice(from, to))
      return (direction === 'up' ? strips.reverse() : strips).flat()
    },
  }
}

type ScrollBehaviour = {
  stopAfter?: number
  frames?: (top: number, id: number) => Frame
  /** Where the container sits when the session starts; non-zero when scrolling up. */
  start?: number
}

function deps(behaviour: ScrollBehaviour = {}) {
  let top = behaviour.start ?? 0
  let id = 0
  let scrolls = 0
  const asked: number[] = []

  return {
    asked,
    frameCount: () => id,
    captureFrame: () => Promise.resolve((behaviour.frames ?? frameAt)(top, ++id)),
    signature: (frame: Frame) => signatureOfRows(frame.rows),
    scrollTo: (next: number) => {
      asked.push(next)
      scrolls++
      top = Math.max(0, Math.min(Math.round(next), MAX_TOP))
      return Promise.resolve({
        scrollTop: top,
        stopped: behaviour.stopAfter !== undefined && scrolls > behaviour.stopAfter,
      })
    },
  }
}

const options = (patch: Partial<RollingOptions> = {}): RollingOptions => ({
  direction: 'down',
  frameHeight: FRAME_HEIGHT,
  step: 20,
  startTop: 0,
  devicePixelRatio: 1,
  maxRows: 100_000,
  ...patch,
})

/** The expected result: header once, all rows in order, input field once. */
const expected = (rows: number) => [
  ...header,
  ...Array.from({ length: rows }, (_, index) => index),
  ...footer,
]

describe('runRolling', () => {
  it('lays a chat out with the header once, the input once and no duplicated rows', async () => {
    const sink = recorder()
    const result = await runRolling(deps(), sink.sink, options({ maxFrames: 4 }))

    expect(result.frames).toBe(4)
    expect(result.sticky).toEqual({ top: HEADER, bottom: FOOTER })
    expect(result.seams).toBe(0)
    // Three 20-row steps on top of the first frame: 33 + 60 feed rows.
    expect(sink.sheet()).toEqual(expected(CONTENT + 60))
  })

  it('runs to the bottom of the container and stops on the picture, not the coordinate', async () => {
    // The container's bottom is not the end of the conversation: chats append
    // history exactly when you reach it. Only an unchanged frame stops the capture.
    const sink = recorder()
    const result = await runRolling(deps(), sink.sink, options())

    expect(result.stoppedBy).toBe('end')
    expect(sink.sheet()).toEqual(expected(PAGE_ROWS))
  })

  it('keeps going when the container grows after reaching its bottom', async () => {
    // This is a feed loading more right at the bottom: the container has
    // "ended", yet one step later it holds several more screens.
    let limit = CONTENT + 20
    let top = 0
    const source = {
      captureFrame: () => Promise.resolve(frameAt(top, 1)),
      signature: (frame: Frame) => signatureOfRows(frame.rows),
      scrollTo: (next: number) => {
        top = Math.max(0, Math.min(Math.round(next), limit - CONTENT))
        if (top >= limit - CONTENT) limit += 20
        return Promise.resolve({ scrollTop: top, stopped: false })
      },
    }

    const sink = recorder()
    const result = await runRolling(source, sink.sink, options({ maxFrames: 5 }))

    expect(result.stoppedBy).toBe('frames')
    expect(new Set(sink.sheet()).size).toBe(sink.sheet().length)
  })

  it('stops on the Stop button and keeps what it already has', async () => {
    const sink = recorder()
    const result = await runRolling(deps({ stopAfter: 2 }), sink.sink, options())

    expect(result.stoppedBy).toBe('user')
    expect(sink.sheet()).toEqual(expected(CONTENT + 40))
  })

  it('stops at the canvas limit instead of growing past it', async () => {
    const sink = recorder()
    const result = await runRolling(deps(), sink.sink, options({ maxRows: 80 }))

    expect(result.stoppedBy).toBe('limit')
    expect(result.rows).toBeLessThanOrEqual(80 + FOOTER)
  })

  it('walks a chat upwards into the history and keeps the order', async () => {
    const sink = recorder()
    const result = await runRolling(
      deps({ start: 200 }),
      sink.sink,
      options({ direction: 'up', startTop: 200, maxFrames: 3 }),
    )

    expect(result.stoppedBy).toBe('frames')
    // Scrolling up assembles bottom-up: the last band is the topmost.
    expect(sink.sheet('up')).toEqual([
      ...header,
      ...Array.from({ length: CONTENT + 40 }, (_, index) => 160 + index),
      ...footer,
    ])
  })

  it('keeps a single frame whole when nothing scrolled at all', async () => {
    const sink = recorder()
    const result = await runRolling(
      deps({ start: MAX_TOP }),
      sink.sink,
      options({ startTop: MAX_TOP }),
    )

    expect(result.frames).toBe(1)
    expect(sink.pushes).toHaveLength(1)
    expect(sink.sheet()).toEqual(frameAt(MAX_TOP, 1).rows)
  })

  it('keeps the sticky bands it found first, so the strips stay cut the same way', async () => {
    // Mid-way the header "disappears" — how panels that hide on fast scroll
    // behave. Recomputing bands for it is not allowed: adjacent bands would be
    // cut with different margins and the seam would show.
    const source = deps({
      frames: (top, id) =>
        id === 3 ? { id, rows: frameAt(top, id).rows.map((row) => row + 1) } : frameAt(top, id),
    })

    const sink = recorder()
    const result = await runRolling(source, sink.sink, options({ maxFrames: 4 }))

    expect(result.sticky).toEqual({ top: HEADER, bottom: FOOTER })
    for (const push of sink.pushes.slice(1, -1)) {
      expect(push.to).toBe(FRAME_HEIGHT - FOOTER)
    }
  })

  it('keeps going when the container reports no scroll but the picture moved', async () => {
    // How virtualized feeds behave: while loading history they rewrite
    // `scrollTop` for themselves, so the number stands still while the content
    // moves a whole screen.
    let step = 0
    const source = {
      captureFrame: () => Promise.resolve(frameAt(step * 20, step + 1)),
      signature: (frame: Frame) => signatureOfRows(frame.rows),
      scrollTo: () => {
        step++
        return Promise.resolve({ scrollTop: 0, stopped: false })
      },
    }

    const sink = recorder()
    const result = await runRolling(source, sink.sink, options({ maxFrames: 3 }))

    expect(result.frames).toBe(3)
    expect(sink.sheet()).toEqual(expected(CONTENT + 40))
  })

  it('gives a slow feed one more step before deciding the chat has ended', async () => {
    // The feed at the bottom went to fetch more: one frame repeated, and on the
    // next step the history loaded. Quitting after the first repeat would cut
    // the chat short.
    let step = 0
    const source = {
      captureFrame: () => Promise.resolve(frameAt(step < 2 ? 0 : 20, step + 1)),
      signature: (frame: Frame) => signatureOfRows(frame.rows),
      scrollTo: () => {
        step++
        return Promise.resolve({ scrollTop: 20, stopped: false })
      },
    }

    const sink = recorder()
    const result = await runRolling(source, sink.sink, options({ maxFrames: 2 }))

    expect(result.frames).toBe(2)
    expect(sink.sheet()).toEqual(expected(CONTENT + 20))
  })

  it('stops when the scroll moves but the picture does not', async () => {
    // A container that scrolled but painted nothing yet: there is nothing to
    // glue at that moment, and even less reason to repeat the frame.
    const sink = recorder()
    const result = await runRolling(
      deps({ frames: (_top, id) => frameAt(0, id) }),
      sink.sink,
      options(),
    )

    expect(result.frames).toBe(1)
    expect(sink.pushes).toHaveLength(1)
    expect(sink.sheet()).toEqual(frameAt(0, 1).rows)
  })

  it('retries with a shorter step, then falls back to the scroll delta and marks a seam', async () => {
    // Frames match under no shift — a page that repaints entirely: a video
    // wall, a live chart, an endless animation.
    let noise = 0
    const source = deps({
      frames: (_top, id) => ({
        id,
        rows: Array.from({ length: FRAME_HEIGHT }, () => (noise += 7)),
      }),
    })

    const sink = recorder()
    const result = await runRolling(source, sink.sink, options({ maxFrames: 2 }))

    expect(source.asked.slice(0, 2)).toEqual([20, 10])
    expect(result.seams).toBeGreaterThan(0)
    // The band still landed — by the actual scroll delta, not by matching.
    expect(sink.pushes.at(-1)).toMatchObject({ from: FRAME_HEIGHT - 10, to: FRAME_HEIGHT })
  })

  it('releases every frame it took', async () => {
    const release = vi.fn()
    const source = deps()

    await runRolling({ ...source, release }, recorder().sink, options({ maxFrames: 3 }))

    expect(release).toHaveBeenCalledTimes(source.frameCount())
  })
})

describe('stepFor', () => {
  it('leaves an overlap the matcher can work with', () => {
    expect(stepFor(1000)).toBe(700)
    expect(stepFor(0)).toBe(1)
  })
})

describe('createChunkSink', () => {
  it('needs a canvas, so it is checked in the browser and not here', () => {
    // No OffscreenCanvas in node: the sink is a thin drawImage wrapper, and its
    // behavior is checked by the extension scenario, not this file.
    expect(typeof createChunkSink).toBe('function')
  })
})
