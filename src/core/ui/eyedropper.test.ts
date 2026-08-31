import { afterEach, describe, expect, it, vi } from 'vitest'

import { eyedropperAvailable, pickColorFromScreen } from './eyedropper'

afterEach(() => {
  vi.unstubAllGlobals()
})

function stubPicker(open: () => Promise<{ sRGBHex: string }>) {
  vi.stubGlobal(
    'EyeDropper',
    class {
      open = open
    },
  )
}

describe('eyedropper', () => {
  it('is unavailable when the browser has no picker', () => {
    expect(eyedropperAvailable()).toBe(false)
  })

  it('is available once the browser provides one', () => {
    stubPicker(() => Promise.resolve({ sRGBHex: '#112233' }))

    expect(eyedropperAvailable()).toBe(true)
  })

  it('returns the picked colour', async () => {
    stubPicker(() => Promise.resolve({ sRGBHex: '#ff8800' }))

    await expect(pickColorFromScreen()).resolves.toBe('#ff8800')
  })

  // Escape mid-pick is a normal outcome, not a failure.
  it('returns nothing when the pick is cancelled', async () => {
    stubPicker(() => Promise.reject(new DOMException('cancelled', 'AbortError')))

    await expect(pickColorFromScreen()).resolves.toBeNull()
  })

  it('returns nothing where there is no picker at all', async () => {
    await expect(pickColorFromScreen()).resolves.toBeNull()
  })
})
