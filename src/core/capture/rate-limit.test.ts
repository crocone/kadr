import { describe, expect, it } from 'vitest'

import { type Clock, isQuotaError, RateLimiter } from './rate-limit'

function fakeClock() {
  let current = 1000
  const slept: number[] = []
  const clock: Clock = {
    now: () => current,
    sleep: (ms) => {
      slept.push(ms)
      current += ms
      return Promise.resolve()
    },
  }
  return { clock, slept, advance: (ms: number) => (current += ms) }
}

describe('RateLimiter', () => {
  it('lets the first call through immediately', async () => {
    const { clock, slept } = fakeClock()
    await new RateLimiter(500, clock).acquire()
    expect(slept).toEqual([])
  })

  it('waits out the remainder of the interval', async () => {
    const { clock, slept, advance } = fakeClock()
    const limiter = new RateLimiter(500, clock)

    await limiter.acquire()
    advance(200)
    await limiter.acquire()

    expect(slept).toEqual([300])
  })

  it('does not wait when the caller was already slow', async () => {
    const { clock, slept, advance } = fakeClock()
    const limiter = new RateLimiter(500, clock)

    await limiter.acquire()
    advance(900)
    await limiter.acquire()

    expect(slept).toEqual([])
  })

  it('keeps the spacing across a run of calls', async () => {
    const { clock, slept } = fakeClock()
    const limiter = new RateLimiter(500, clock)

    for (let i = 0; i < 4; i++) await limiter.acquire()

    expect(slept).toEqual([500, 500, 500])
  })
})

describe('isQuotaError', () => {
  it('recognises the captureVisibleTab quota message', () => {
    expect(isQuotaError(new Error('MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND quota exceeded'))).toBe(
      true,
    )
    expect(isQuotaError(new Error('Cannot access contents of the page'))).toBe(false)
  })
})
