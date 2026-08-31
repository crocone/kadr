import { describe, expect, it } from 'vitest'

import { badgeLabel, roman } from './badges'

describe('roman', () => {
  it('writes the plain numbers', () => {
    expect(roman(1)).toBe('I')
    expect(roman(4)).toBe('IV')
    expect(roman(9)).toBe('IX')
    expect(roman(14)).toBe('XIV')
    expect(roman(40)).toBe('XL')
  })

  it('writes numbers a step list actually reaches', () => {
    expect(roman(2)).toBe('II')
    expect(roman(7)).toBe('VII')
    expect(roman(12)).toBe('XII')
  })

  // Zero has no roman form: better empty than an invented sign.
  it('has nothing to write for zero and below', () => {
    expect(roman(0)).toBe('')
    expect(roman(-3)).toBe('')
  })

  it('rounds down a fractional number rather than inventing a symbol', () => {
    expect(roman(3.7)).toBe('III')
  })
})

describe('badgeLabel', () => {
  it('numbers by default', () => {
    expect(badgeLabel(3, 'number')).toBe('3')
  })

  it('switches to roman', () => {
    expect(badgeLabel(3, 'roman')).toBe('III')
  })

  // A bullet needs no number: it's a dot, not an order.
  it('draws the same dot whatever the number', () => {
    expect(badgeLabel(1, 'bullet')).toBe(badgeLabel(9, 'bullet'))
  })
})
