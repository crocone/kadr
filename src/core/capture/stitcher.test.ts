import { describe, expect, it, vi } from 'vitest'

import { planFullPageCapture } from './plan'
import { runStitch } from './stitcher'
import type { PageMetrics } from './types'

/**
 * Step order is tested separately from pixels: node has no OffscreenCanvas, and
 * the bug was precisely in the sequence — the fixed header was hidden after
 * scrolling to the second frame, the frame got captured before the repaint,
 * and the header appeared in the shot twice.
 */
function metrics(overrides: Partial<PageMetrics> = {}): PageMetrics {
  return {
    scrollWidth: 1000,
    scrollHeight: 2400,
    viewportWidth: 1000,
    viewportHeight: 800,
    devicePixelRatio: 1,
    scrollX: 0,
    scrollY: 0,
    ...overrides,
  }
}

function recorder(scrollResults?: number[]) {
  const calls: string[] = []
  const drawn: number[] = []
  let frameNo = 0
  let scrollNo = 0

  const deps = {
    scrollTo: vi.fn((y: number) => {
      const actual = scrollResults?.[scrollNo++] ?? y
      calls.push(`scroll:${actual}`)
      return Promise.resolve(actual)
    }),
    captureFrame: vi.fn(() => {
      calls.push(`capture:${frameNo++}`)
      return Promise.resolve({ close: vi.fn() } as unknown as ImageBitmap)
    }),
    setFixedHidden: vi.fn((hidden: boolean) => {
      calls.push(`fixed:${hidden ? 'hide' : 'show'}`)
      return Promise.resolve()
    }),
  }

  const sink = {
    drawFrame: (_frame: ImageBitmap, y: number) => {
      drawn.push(y)
    },
  }

  return { calls, drawn, deps, sink }
}

describe('runStitch', () => {
  it('hides fixed elements only after the first frame is in the can', async () => {
    const { calls, deps, sink } = recorder()

    await runStitch(planFullPageCapture(metrics()), deps, sink)

    expect(calls.slice(0, 4)).toEqual(['scroll:0', 'capture:0', 'fixed:hide', 'scroll:800'])
  })

  it('hides them exactly once and restores them at the end', async () => {
    const { calls, deps, sink } = recorder()

    await runStitch(planFullPageCapture(metrics()), deps, sink)

    expect(calls.filter((call) => call === 'fixed:hide')).toHaveLength(1)
    expect(calls.at(-1)).toBe('fixed:show')
  })

  it('draws every frame at the scroll position the page actually reached', async () => {
    // The last step lands at the page end, not at a viewport multiple.
    const { drawn, deps, sink } = recorder()

    await runStitch(planFullPageCapture(metrics()), deps, sink)

    expect(drawn).toEqual([0, 800, 1600])
    expect(deps.captureFrame).toHaveBeenCalledTimes(3)
  })

  it('trusts the reported scroll position over the requested one', async () => {
    // The page may not scroll all the way: short document, anchor, someone's handler.
    const { drawn, deps, sink } = recorder([0, 780, 1500])

    await runStitch(planFullPageCapture(metrics()), deps, sink)

    expect(drawn).toEqual([0, 780, 1500])
  })

  it('scales draw positions by the device pixel ratio', async () => {
    const { drawn, deps, sink } = recorder()

    await runStitch(planFullPageCapture(metrics({ devicePixelRatio: 2 })), deps, sink)

    expect(drawn).toEqual([0, 1600, 3200])
  })

  it('reports progress once per frame', async () => {
    const { deps, sink } = recorder()
    const onProgress = vi.fn()

    await runStitch(planFullPageCapture(metrics()), { ...deps, onProgress }, sink)

    expect(onProgress.mock.calls).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ])
  })
})
