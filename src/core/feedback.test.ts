import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  markInstalled,
  markPromptSeen,
  PROMPT_AFTER_EXPORTS,
  readFeedbackState,
  recordExport,
  shouldShowPrompt,
  storeReviewUrl,
} from './feedback'

const DAY = 24 * 60 * 60 * 1000

function fakeStorage() {
  let data: Record<string, unknown> = {}
  return {
    get: vi.fn((key: string) => Promise.resolve({ [key]: data[key] })),
    set: vi.fn((patch: Record<string, unknown>) => {
      data = { ...data, ...patch }
      return Promise.resolve()
    }),
  }
}

beforeEach(() => {
  vi.stubGlobal('chrome', {
    storage: { local: fakeStorage() },
    runtime: { id: 'abc' },
  })
})

describe('shouldShowPrompt', () => {
  const ready = { exports: PROMPT_AFTER_EXPORTS, installedAt: 0, promptSeen: false }

  it('waits for enough exports', () => {
    expect(shouldShowPrompt({ ...ready, exports: PROMPT_AFTER_EXPORTS - 1 }, 10 * DAY)).toBe(false)
    expect(shouldShowPrompt(ready, 10 * DAY)).toBe(true)
  })

  it('stays quiet in the first days after install', () => {
    expect(shouldShowPrompt(ready, 2 * DAY)).toBe(false)
    expect(shouldShowPrompt(ready, 3 * DAY)).toBe(true)
  })

  it('shows once', () => {
    expect(shouldShowPrompt({ ...ready, promptSeen: true }, 10 * DAY)).toBe(false)
  })

  it('treats a missing install date as an old install', () => {
    expect(shouldShowPrompt({ ...ready, installedAt: null }, 0)).toBe(true)
  })
})

describe('state', () => {
  it('counts exports and remembers the first install only', async () => {
    await markInstalled(100)
    await markInstalled(200)
    await recordExport()
    await recordExport()
    await markPromptSeen()

    expect(await readFeedbackState()).toEqual({ exports: 2, installedAt: 100, promptSeen: true })
  })
})

describe('storeReviewUrl', () => {
  it('points at the reviews tab of this extension', () => {
    expect(storeReviewUrl()).toBe('https://chromewebstore.google.com/detail/abc/reviews')
  })
})
