import { describe, expect, it } from 'vitest'

import { isCapturableUrl } from './pages'

describe('isCapturableUrl', () => {
  it('accepts ordinary web pages', () => {
    expect(isCapturableUrl('https://example.com/page')).toBe(true)
    expect(isCapturableUrl('http://localhost:3000/')).toBe(true)
    expect(isCapturableUrl('file:///C:/tmp/report.html')).toBe(true)
  })

  it('rejects browser-internal pages', () => {
    expect(isCapturableUrl('chrome://extensions')).toBe(false)
    expect(isCapturableUrl('chrome-extension://abc/page.html')).toBe(false)
    expect(isCapturableUrl('devtools://devtools/bundled/inspector.html')).toBe(false)
    expect(isCapturableUrl('about:blank')).toBe(false)
  })

  it('rejects extension galleries, where injection is blocked', () => {
    expect(isCapturableUrl('https://chromewebstore.google.com/detail/x')).toBe(false)
    expect(isCapturableUrl('https://addons.opera.com/extensions/')).toBe(false)
  })

  it('rejects a missing or malformed url', () => {
    expect(isCapturableUrl(undefined)).toBe(false)
    expect(isCapturableUrl('nonsense')).toBe(false)
  })
})
