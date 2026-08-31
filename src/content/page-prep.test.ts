// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'

import { settle } from './page-prep'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('settle', () => {
  it('waits for a pair of animation frames when the window is being painted', async () => {
    vi.useFakeTimers()
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    })

    let settled = false
    void settle(10).then(() => {
      settled = true
    })

    // First frame: too early.
    frames.shift()?.(0)
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(false)

    frames.shift()?.(0)
    await vi.advanceTimersByTimeAsync(10)
    expect(settled).toBe(true)
  })

  /**
   * The browser does not paint an unfocused window, and `requestAnimationFrame`
   * never fires in it. Re-capture used to deadlock on this: its window lost
   * visibility, the content script never answered, and `chrome.tabs.sendMessage`
   * has no timeout.
   */
  it('gives up on the frames in a window the browser never paints', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', () => 1)

    let settled = false
    void settle(10).then(() => {
      settled = true
    })

    await vi.advanceTimersByTimeAsync(1000)
    expect(settled).toBe(true)
  })
})
