import { describe, expect, it } from 'vitest'

import { aspectDrift, type CaptureRecipe, isRepeatable } from './recipe'

const recipe = (patch: Partial<CaptureRecipe> = {}): CaptureRecipe => ({
  mode: 'fullPage',
  url: 'https://example.com/docs',
  element: null,
  area: null,
  viewportWidth: 1440,
  viewportHeight: 900,
  devicePixelRatio: 2,
  delayMs: 0,
  direction: null,
  capturedAt: 1_000,
  ...patch,
})

const ref = { selector: '#save', fingerprint: { tag: 'button', label: 'Save', w: 100, h: 40 } }

describe('isRepeatable', () => {
  it('refuses a shot taken before recipes existed', () => {
    expect(isRepeatable(undefined)).toBe(false)
    expect(isRepeatable(null)).toBe(false)
  })

  it('refuses a scrolling capture, which is a chain of live decisions', () => {
    expect(isRepeatable(recipe({ mode: 'scroll' }))).toBe(false)
  })

  it('refuses an element shot that lost its selector', () => {
    expect(isRepeatable(recipe({ mode: 'element' }))).toBe(false)
    expect(isRepeatable(recipe({ mode: 'element', element: ref }))).toBe(true)
  })

  it('refuses a page the browser cannot open again', () => {
    expect(isRepeatable(recipe({ url: 'chrome://extensions' }))).toBe(false)
    expect(isRepeatable(recipe({ url: 'file:///tmp/page.html' }))).toBe(false)
  })
})

describe('aspectDrift', () => {
  it('is zero for the same shape at a different size', () => {
    expect(aspectDrift({ width: 1200, height: 800 }, { width: 600, height: 400 })).toBe(0)
  })

  it('grows as the page changes shape', () => {
    expect(aspectDrift({ width: 1200, height: 800 }, { width: 1200, height: 1600 })).toBeCloseTo(
      0.5,
    )
  })

  it('stays at zero for an empty frame instead of dividing by it', () => {
    expect(aspectDrift({ width: 0, height: 0 }, { width: 100, height: 50 })).toBe(0)
  })
})
