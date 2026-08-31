import { describe, expect, it } from 'vitest'

import type { ImageFilters } from '@/core/doc/types'

import { cssFilterString, isNeutral, NEUTRAL } from './filters'

const filters = (patch: Partial<ImageFilters> = {}): ImageFilters => ({ ...NEUTRAL, ...patch })

describe('isNeutral', () => {
  it('is true only when nothing is set', () => {
    expect(isNeutral(NEUTRAL)).toBe(true)
    expect(isNeutral(filters({ hue: 1 }))).toBe(false)
    expect(isNeutral(filters({ brightness: -1 }))).toBe(false)
  })
})

describe('cssFilterString', () => {
  it('says none rather than an empty string when nothing is set', () => {
    expect(cssFilterString(NEUTRAL)).toBe('none')
  })

  it('leaves untouched channels out of the string', () => {
    expect(cssFilterString(filters({ contrast: 20 }))).toBe('contrast(1.200)')
  })

  it('maps the range so zero means unchanged', () => {
    expect(cssFilterString(filters({ brightness: 0, contrast: 0 }))).toBe('none')
    expect(cssFilterString(filters({ brightness: 100 }))).toBe('brightness(2.000)')
    expect(cssFilterString(filters({ brightness: -100 }))).toBe('brightness(0.000)')
  })

  it('never goes negative, which would be an invalid filter', () => {
    expect(cssFilterString(filters({ saturation: -400 }))).toBe('saturate(0.000)')
  })

  it('writes the hue in degrees', () => {
    expect(cssFilterString(filters({ hue: -45 }))).toBe('hue-rotate(-45deg)')
  })

  it('combines everything in one string', () => {
    const value = cssFilterString(
      filters({ brightness: 10, contrast: 10, saturation: 10, hue: 10 }),
    )

    expect(value.split(' ')).toHaveLength(4)
    expect(value).toContain('hue-rotate(10deg)')
  })
})
