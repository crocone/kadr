import { describe, expect, it } from 'vitest'

import { estimateBytes, sizeParts } from './estimate'

describe('estimateBytes', () => {
  it('keeps a 720p PNG in the hundreds of kilobytes', () => {
    const bytes = estimateBytes(1280, 720, { format: 'png', quality: 1 })
    expect(bytes).toBeGreaterThan(300 * 1024)
    expect(bytes).toBeLessThan(700 * 1024)
  })

  it('grows with the square of the area: twice the density is four times the file', () => {
    const single = estimateBytes(640, 360, { format: 'png', quality: 1 })
    const double = estimateBytes(1280, 720, { format: 'png', quality: 1 })
    expect(double).toBe(single * 4)
  })

  it('makes a lossy format lighter than PNG and WebP lighter than JPEG', () => {
    const png = estimateBytes(1280, 720, { format: 'png', quality: 1 })
    const jpeg = estimateBytes(1280, 720, { format: 'jpeg', quality: 0.92 })
    const webp = estimateBytes(1280, 720, { format: 'webp', quality: 0.92 })

    expect(jpeg).toBeLessThan(png)
    expect(webp).toBeLessThan(jpeg)
  })

  it('follows the quality slider', () => {
    const high = estimateBytes(1280, 720, { format: 'jpeg', quality: 0.9 })
    const low = estimateBytes(1280, 720, { format: 'jpeg', quality: 0.5 })
    expect(low).toBeLessThan(high)
  })

  it('answers zero for an empty canvas instead of a stray page overhead', () => {
    expect(estimateBytes(0, 720, { format: 'pdf', quality: 0.9 })).toBe(0)
  })
})

describe('sizeParts', () => {
  it('counts small files in kilobytes', () => {
    expect(sizeParts(480 * 1024)).toEqual({ value: 480, unit: 'kb' })
  })

  it('switches to megabytes with one decimal', () => {
    expect(sizeParts(3.25 * 1024 * 1024)).toEqual({ value: 3.3, unit: 'mb' })
  })

  it('never shows a file as zero kilobytes', () => {
    expect(sizeParts(120)).toEqual({ value: 1, unit: 'kb' })
  })
})
