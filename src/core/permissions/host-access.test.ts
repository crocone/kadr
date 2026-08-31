import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ensureOrigin, ensureOrigins, grantedOrigins, originPatternOf } from './host-access'

const contains = vi.fn()
const request = vi.fn()
const getAll = vi.fn()

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('chrome', { permissions: { contains, request, getAll } })
})

describe('originPatternOf', () => {
  it('keeps the scheme, the host and the port', () => {
    expect(originPatternOf('https://docs.example.com:8443/guide?x=1')).toBe(
      'https://docs.example.com:8443/*',
    )
  })

  it('refuses everything that is not a web page', () => {
    expect(originPatternOf('chrome://extensions')).toBeNull()
    expect(originPatternOf('file:///tmp/page.html')).toBeNull()
    expect(originPatternOf('not a url')).toBeNull()
  })
})

describe('ensureOrigin', () => {
  it('asks for one site, never for every site', async () => {
    contains.mockResolvedValue(false)
    request.mockResolvedValue(true)

    await expect(ensureOrigin('https://example.com/a/b')).resolves.toBe(true)
    expect(request).toHaveBeenCalledWith({ origins: ['https://example.com/*'] })
  })

  it('does not ask again once the site is granted', async () => {
    contains.mockResolvedValue(true)

    await expect(ensureOrigin('https://example.com/')).resolves.toBe(true)
    expect(request).not.toHaveBeenCalled()
  })

  it('reports a refusal as a plain no, because saying no is not a failure', async () => {
    contains.mockResolvedValue(false)
    request.mockResolvedValue(false)

    await expect(ensureOrigin('https://example.com/')).resolves.toBe(false)
  })

  it('survives a call made outside a user gesture', async () => {
    contains.mockResolvedValue(false)
    request.mockRejectedValue(new Error('This function must be called during a user gesture'))

    await expect(ensureOrigin('https://example.com/')).resolves.toBe(false)
  })
})

describe('ensureOrigins', () => {
  it('collapses a batch of one domain into a single prompt', async () => {
    contains.mockResolvedValue(false)
    request.mockResolvedValue(true)

    await ensureOrigins([
      'https://example.com/a',
      'https://example.com/b',
      'https://other.com/c',
      'chrome://extensions',
    ])

    expect(request).toHaveBeenCalledWith({
      origins: ['https://example.com/*', 'https://other.com/*'],
    })
  })
})

describe('grantedOrigins', () => {
  it('hides the all-urls pattern the manifest has to declare', async () => {
    getAll.mockResolvedValue({ origins: ['<all_urls>', 'https://example.com/*'] })
    await expect(grantedOrigins()).resolves.toEqual(['https://example.com/*'])
  })
})
