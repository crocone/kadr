import { describe, expect, it } from 'vitest'

import { resolveSystemLocale } from './locales'
import { translate } from './translate'

describe('translate', () => {
  it('returns the localised string', () => {
    expect(translate('ru', 'capture.fullPage')).toBe('Вся страница')
    expect(translate('en', 'capture.fullPage')).toBe('Full page')
  })

  it('substitutes parameters', () => {
    expect(translate('en', 'options.captureDelay.seconds', { n: 5 })).toBe('5 s')
  })

  it('leaves an unknown placeholder untouched', () => {
    expect(translate('en', 'options.captureDelay.seconds', { other: 1 })).toBe('{n} s')
  })
})

describe('resolveSystemLocale', () => {
  it('maps browser languages onto supported locales', () => {
    expect(resolveSystemLocale('ru-RU')).toBe('ru')
    expect(resolveSystemLocale('en-GB')).toBe('en')
    expect(resolveSystemLocale('de-DE')).toBe('en')
  })
})
