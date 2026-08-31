import { describe, expect, it } from 'vitest'

import { asBackdrop, hexToRgb, hslToRgb, rgbToHex, rgbToHsl, shiftHue, withAlpha } from './color'

describe('hexToRgb', () => {
  it('reads six-digit and three-digit hex, with or without the hash', () => {
    expect(hexToRgb('#4f46e5')).toEqual({ r: 79, g: 70, b: 229 })
    expect(hexToRgb('4f46e5')).toEqual({ r: 79, g: 70, b: 229 })
    expect(hexToRgb('#f0a')).toEqual({ r: 255, g: 0, b: 170 })
  })

  it('rejects anything else', () => {
    expect(hexToRgb('#12345')).toBeNull()
    expect(hexToRgb('rebeccapurple')).toBeNull()
  })
})

describe('rgbToHex', () => {
  it('round-trips through hexToRgb', () => {
    for (const hex of ['#000000', '#ffffff', '#4f46e5', '#a855f7']) {
      expect(rgbToHex(hexToRgb(hex)!)).toBe(hex)
    }
  })

  it('clamps out-of-range channels', () => {
    expect(rgbToHex({ r: -20, g: 300, b: 128 })).toBe('#00ff80')
  })
})

describe('rgbToHsl and hslToRgb', () => {
  it('round-trips saturated colours', () => {
    for (const hex of ['#4f46e5', '#16a34a', '#dc2626', '#a855f7']) {
      const rgb = hexToRgb(hex)!
      const back = hslToRgb(rgbToHsl(rgb))
      expect(Math.abs(back.r - rgb.r)).toBeLessThanOrEqual(1)
      expect(Math.abs(back.g - rgb.g)).toBeLessThanOrEqual(1)
      expect(Math.abs(back.b - rgb.b)).toBeLessThanOrEqual(1)
    }
  })

  it('treats grey as unsaturated', () => {
    expect(rgbToHsl({ r: 128, g: 128, b: 128 })).toEqual({ h: 0, s: 0, l: 128 / 255 })
  })
})

describe('asBackdrop', () => {
  it('pulls the colour to the asked lightness', () => {
    const backdrop = asBackdrop({ r: 20, g: 20, b: 90 }, 0.5)
    expect(rgbToHsl(backdrop).l).toBeCloseTo(0.5, 2)
  })

  it('lifts a washed-out colour into a usable range', () => {
    const backdrop = asBackdrop({ r: 130, g: 128, b: 132 }, 0.5)
    // Rounding to eight bits per channel eats a hundredth on the round trip.
    expect(rgbToHsl(backdrop).s).toBeGreaterThan(0.34)
  })

  it('keeps a vivid colour from getting garish', () => {
    const backdrop = asBackdrop({ r: 255, g: 0, b: 0 }, 0.5)
    expect(rgbToHsl(backdrop).s).toBeLessThanOrEqual(0.72)
  })
})

describe('shiftHue', () => {
  it('rotates the hue and wraps around', () => {
    const shifted = shiftHue({ r: 255, g: 0, b: 0 }, 120)
    expect(rgbToHsl(shifted).h).toBeCloseTo(120, 0)
    expect(rgbToHsl(shiftHue({ r: 255, g: 0, b: 0 }, 380)).h).toBeCloseTo(20, 0)
  })
})

describe('withAlpha', () => {
  it('works for six-digit and three-digit hex alike', () => {
    expect(withAlpha('#4f46e5', 0)).toBe('rgba(79, 70, 229, 0)')
    expect(withAlpha('#f0a', 0.5)).toBe('rgba(255, 0, 170, 0.5)')
  })

  it('falls back to transparent rather than emitting a broken colour', () => {
    expect(withAlpha('not a colour', 0.5)).toBe('transparent')
  })
})
