import { describe, expect, it, vi } from 'vitest'

import {
  captureSeries,
  RESPONSIVE_WIDTHS,
  type SeriesDeps,
  widthsFrom,
  type WindowState,
} from './responsive'

function deps(patch: Partial<SeriesDeps> = {}) {
  const resized: number[] = []

  const base: SeriesDeps = {
    windowBounds: () => Promise.resolve({ width: 1600, height: 900, state: 'normal' as const }),
    // The window is wider than the viewport by the browser chrome — 16 px here.
    viewportWidth: () => Promise.resolve(1584),
    setWindowState: () => Promise.resolve(),
    resizeWindow: (width) => {
      resized.push(width)
      return Promise.resolve()
    },
    captureViewport: () => Promise.resolve({ blob: new Blob(['x']), width: 1000, height: 700 }),
    wait: () => Promise.resolve(),
    ...patch,
  }

  return { deps: base, resized }
}

describe('captureSeries', () => {
  it('takes one shot per width', async () => {
    const { deps: fake } = deps()

    const shots = await captureSeries([375, 768], fake)

    expect(shots.map((shot) => shot.width)).toEqual([375, 768])
  })

  // The window is wider than the viewport by its own chrome: without the correction
  // every width would be a couple dozen pixels short, and a landing page at 375 would
  // get the wrong layout.
  it('adds the browser frame to the requested viewport width', async () => {
    const { deps: fake, resized } = deps()

    await captureSeries([375], fake)

    expect(resized[0]).toBe(375 + 16)
  })

  it('puts the window back where it was', async () => {
    const { deps: fake, resized } = deps()

    await captureSeries([375, 768], fake)

    expect(resized.at(-1)).toBe(1600)
  })

  // Leaving the user's window narrow is breakage they fix by hand.
  it('puts the window back even when a shot fails', async () => {
    const { deps: fake, resized } = deps({
      captureViewport: () => Promise.reject(new Error('quota')),
    })

    await expect(captureSeries([375], fake)).rejects.toThrow('quota')
    expect(resized.at(-1)).toBe(1600)
  })

  it('waits after resizing, before shooting', async () => {
    const order: string[] = []
    const { deps: fake } = deps({
      resizeWindow: () => {
        order.push('resize')
        return Promise.resolve()
      },
      wait: () => {
        order.push('wait')
        return Promise.resolve()
      },
      captureViewport: () => {
        order.push('shot')
        return Promise.resolve({ blob: new Blob(['x']), width: 10, height: 10 })
      },
    })

    await captureSeries([375], fake)

    expect(order).toEqual(['resize', 'wait', 'shot', 'resize'])
  })

  it('reports progress as it goes', async () => {
    const onProgress = vi.fn()
    const { deps: fake } = deps({ onProgress })

    await captureSeries([375, 768, 1440], fake)

    expect(onProgress).toHaveBeenCalledTimes(3)
    expect(onProgress).toHaveBeenLastCalledWith(3, 3)
  })

  // Chrome silently ignores `width` for a maximized window: without this step the
  // series is three identical desktop frames.
  it('leaves a maximized window before resizing, and puts it back', async () => {
    const calls: string[] = []
    let bounds = { width: 1920, height: 1080, state: 'maximized' as WindowState }

    const { deps: fake } = deps({
      windowBounds: () => Promise.resolve(bounds),
      viewportWidth: () => Promise.resolve(1184),
      setWindowState: (state) => {
        calls.push(`state:${state}`)
        if (state === 'normal') bounds = { width: 1200, height: 800, state: 'normal' }
        return Promise.resolve()
      },
      resizeWindow: (width) => {
        calls.push(`resize:${width}`)
        return Promise.resolve()
      },
    })

    await captureSeries([375], fake)

    // The chrome is computed from the normal window (1200 − 1184), not the maximized one.
    expect(calls).toEqual(['state:normal', 'resize:391', 'resize:1200', 'state:maximized'])
  })

  it('puts a maximized window back even when a shot fails', async () => {
    const calls: string[] = []
    const { deps: fake } = deps({
      windowBounds: () => Promise.resolve({ width: 1920, height: 1080, state: 'maximized' }),
      setWindowState: (state) => {
        calls.push(state)
        return Promise.resolve()
      },
      captureViewport: () => Promise.reject(new Error('quota')),
    })

    await expect(captureSeries([375], fake)).rejects.toThrow('quota')
    expect(calls.at(-1)).toBe('maximized')
  })

  it('leaves a window that was already normal alone', async () => {
    const setWindowState = vi.fn(() => Promise.resolve())
    const { deps: fake } = deps({ setWindowState })

    await captureSeries([375], fake)

    expect(setWindowState).not.toHaveBeenCalled()
  })

  // Chrome may refuse to shrink the window that far, and labelling such a frame
  // "375 px" would be a lie.
  it('records the width it actually got, not the one it asked for', async () => {
    const { deps: fake } = deps({ viewportWidth: () => Promise.resolve(500) })

    const [shot] = await captureSeries([375], fake)

    expect(shot?.width).toBe(375)
    expect(shot?.viewport).toBe(500)
  })

  it('keeps the pixel size of every shot', async () => {
    const { deps: fake } = deps()

    const [shot] = await captureSeries([375], fake)

    expect(shot?.pixels).toEqual({ x: 0, y: 0, w: 1000, h: 700 })
  })
})

describe('widthsFrom', () => {
  it('falls back to the standard three', () => {
    expect(widthsFrom(undefined)).toEqual([...RESPONSIVE_WIDTHS])
    expect(widthsFrom([])).toEqual([...RESPONSIVE_WIDTHS])
  })

  it('sorts and deduplicates what it is given', () => {
    expect(widthsFrom([1440, 375, 375])).toEqual([375, 1440])
  })

  // A one-pixel or billboard-sized width is a typo, not intent.
  it('drops widths no screen has', () => {
    expect(widthsFrom([1, 900, 99999])).toEqual([900])
  })

  it('rounds fractional widths', () => {
    expect(widthsFrom([375.6])).toEqual([376])
  })
})
