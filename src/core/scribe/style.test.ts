import { describe, expect, it } from 'vitest'

import { DEFAULT_SCRIBE_STYLE, resolveStyle, STYLE_LIMITS } from './style'

describe('resolveStyle', () => {
  it('gives a guide recorded before styles the default look', () => {
    expect(resolveStyle(null)).toEqual(DEFAULT_SCRIBE_STYLE)
    expect(resolveStyle(undefined)).toEqual(DEFAULT_SCRIBE_STYLE)
  })

  it('keeps what was chosen and fills in the rest', () => {
    const style = resolveStyle({ accent: '#ff0000', badge: false })

    expect(style.accent).toBe('#ff0000')
    expect(style.badge).toBe(false)
    expect(style.captionSize).toBe(DEFAULT_SCRIBE_STYLE.captionSize)
  })

  it('pulls a size back inside the limits instead of drawing a badge the size of the shot', () => {
    expect(resolveStyle({ badgeSize: 500 }).badgeSize).toBe(STYLE_LIMITS.badgeSize.max)
    expect(resolveStyle({ outlineWidth: 0 }).outlineWidth).toBe(STYLE_LIMITS.outlineWidth.min)
  })
})
