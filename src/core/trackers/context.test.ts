import { describe, expect, it } from 'vitest'

import { browserName, issueBody, osName, type ShotContext } from './context'

const CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36'

describe('browserName', () => {
  it('does not take Yandex, Edge and Opera for Chrome', () => {
    expect(browserName(`${CHROME} YaBrowser/25.6.0.0`)).toBe('Yandex Browser 25')
    expect(browserName(`${CHROME} Edg/139.0.0.0`)).toBe('Edge 139')
    expect(browserName(`${CHROME} OPR/121.0.0.0`)).toBe('Opera 121')
    expect(browserName(CHROME)).toBe('Chrome 139')
  })

  it('says so plainly when the agent is unknown', () => {
    expect(browserName('curl/8.5.0')).toBe('Unknown browser')
  })
})

describe('osName', () => {
  it('reads the system out of the agent', () => {
    expect(osName(CHROME)).toBe('Windows 10/11')
    expect(osName('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5)')).toBe('macOS')
  })
})

describe('issueBody', () => {
  const context: ShotContext = {
    url: 'https://shop.dev/cart',
    shot: { w: 1440, h: 900 },
    screen: { w: 2560, h: 1440 },
    dpr: 2,
    userAgent: CHROME,
    capturedAt: new Date('2026-08-31T10:00:00.000Z'),
  }

  it('puts the description first and the context after it', () => {
    const body = issueBody('Submit does nothing.', context)

    expect(body.startsWith('Submit does nothing.')).toBe(true)
    expect(body).toContain('| Page | https://shop.dev/cart |')
    expect(body).toContain('| Shot | 1440×900 @ 2× |')
    expect(body).toContain('| Screen | 2560×1440 |')
    expect(body).toContain('Chrome 139 · Windows 10/11')
    expect(body).toContain('2026-08-31T10:00:00.000Z')
  })

  it('holds the table together when there is neither text nor sizes', () => {
    const body = issueBody('  ', { ...context, url: '', shot: null, screen: null })

    expect(body.startsWith('| | |')).toBe(true)
    expect(body).toContain('| Page | — |')
    expect(body).toContain('| Screen | — |')
  })
})
