import { describe, expect, it } from 'vitest'

import { formatDuration, formatPrecise, formatSize } from './format'

describe('formatDuration', () => {
  it('reads as minutes and seconds under an hour', () => {
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(9500)).toBe('0:10')
    expect(formatDuration(90_000)).toBe('1:30')
    expect(formatDuration(599_000)).toBe('9:59')
  })

  it('grows an hours field only when there are hours', () => {
    expect(formatDuration(3_600_000)).toBe('1:00:00')
    expect(formatDuration(3_661_000)).toBe('1:01:01')
  })

  it('does not go negative', () => {
    expect(formatDuration(-5000)).toBe('0:00')
  })
})

describe('formatPrecise', () => {
  it('keeps a tenth of a second for the timeline', () => {
    expect(formatPrecise(4300)).toBe('0:04.3')
    expect(formatPrecise(0)).toBe('0:00.0')
  })
})

describe('formatSize', () => {
  it('scales the unit', () => {
    expect(formatSize(512)).toBe('512 B')
    expect(formatSize(2048)).toBe('2 KB')
    expect(formatSize(1024 * 1024 * 3.5)).toBe('3.5 MB')
    expect(formatSize(1024 ** 3 * 2)).toBe('2 GB')
  })

  it('drops the decimal once the number is big enough to carry itself', () => {
    expect(formatSize(1024 * 150)).toBe('150 KB')
  })
})
