/**
 * captureVisibleTab allows at most two frames per second and errors on excess
 * instead of waiting. The limiter keeps the pause itself.
 */
export type Clock = {
  now: () => number
  sleep: (ms: number) => Promise<void>
}

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}

export class RateLimiter {
  private lastAt: number | null = null

  constructor(
    private readonly intervalMs: number,
    private readonly clock: Clock = realClock,
  ) {}

  /** Waits exactly as long as remains until the next allowed call. */
  async acquire(): Promise<void> {
    const now = this.clock.now()
    if (this.lastAt !== null) {
      const wait = this.intervalMs - (now - this.lastAt)
      if (wait > 0) {
        await this.clock.sleep(wait)
        this.lastAt = this.clock.now()
        return
      }
    }
    this.lastAt = now
  }
}

/** The quota error arrives as text — there is no other way to identify it. */
export function isQuotaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND')
}
