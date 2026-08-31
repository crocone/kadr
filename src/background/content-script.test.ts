import { describe, expect, it, vi } from 'vitest'

import { CaptureFailure } from '@/core/capture/types'

import { type ContentScriptDeps, ensureReady } from './content-script'

/**
 * Regression for the very first phase-1 bug: CRXJS injects a loader that pulls the
 * module in via dynamic import(), so right after executeScript there are no handlers
 * yet, and the next message failed with "Receiving end does not exist".
 */
function deps(overrides: Partial<ContentScriptDeps> = {}) {
  let clock = 0
  const base: ContentScriptDeps = {
    ping: vi.fn(() => Promise.resolve(false)),
    inject: vi.fn(() => Promise.resolve()),
    sleep: vi.fn((ms: number) => {
      clock += ms
      return Promise.resolve()
    }),
    now: () => clock,
  }
  return { ...base, ...overrides }
}

/** A ping that answers `false` a given number of times, then `true`. */
function pingReadyAfter(failures: number) {
  let calls = 0
  return vi.fn(() => Promise.resolve(calls++ >= failures))
}

describe('ensureReady', () => {
  it('does nothing when the content script already answers', async () => {
    const d = deps({ ping: vi.fn(() => Promise.resolve(true)) })

    await ensureReady(d)

    expect(d.inject).not.toHaveBeenCalled()
  })

  it('waits for the script to come up after injecting it', async () => {
    const ping = pingReadyAfter(3)
    const d = deps({ ping })

    await ensureReady(d)

    expect(d.inject).toHaveBeenCalledOnce()
    // The first ping checks "maybe it is already alive", then three polls after the
    // inject with two sleeps in between: after the last, successful one there is
    // nothing left to wait for.
    expect(ping).toHaveBeenCalledTimes(4)
    expect(d.sleep).toHaveBeenCalledTimes(2)
  })

  it('gives up with content-unreachable when the script never answers', async () => {
    const d = deps()

    await expect(ensureReady(d, 200, 50)).rejects.toMatchObject({
      name: 'CaptureFailure',
      reason: 'content-unreachable',
    })
  })

  it('reports a blocked injection as content-unreachable', async () => {
    const d = deps({ inject: vi.fn(() => Promise.reject(new Error('Cannot access contents'))) })

    const failure = await ensureReady(d).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(CaptureFailure)
    expect((failure as CaptureFailure).message).toContain('Cannot access contents')
  })

  it('does not sleep past the deadline before failing', async () => {
    const d = deps()

    await ensureReady(d, 100, 50).catch(() => undefined)

    // 0 ms — ping, sleep; 50 — ping, sleep; 100 — ping and exit on deadline.
    expect(d.sleep).toHaveBeenCalledTimes(2)
  })
})
