import { describe, expect, it } from 'vitest'

import { DEFAULT_FONT, FONT_CATEGORIES, FONTS, fontByStack, searchFonts } from './fonts'

describe('fonts', () => {
  it('covers every category', () => {
    for (const category of FONT_CATEGORIES) {
      expect(FONTS.some((font) => font.category === category)).toBe(true)
    }
  })

  // The stack goes straight into font-family: empty or truncated breaks rendering.
  it('gives every face a fallback stack', () => {
    for (const font of FONTS) {
      expect(font.stack.split(',').length).toBeGreaterThan(1)
    }
  })

  it('has unique identifiers', () => {
    expect(new Set(FONTS.map((font) => font.id)).size).toBe(FONTS.length)
  })

  it('finds the face a layer refers to', () => {
    expect(fontByStack(DEFAULT_FONT.stack)?.id).toBe(DEFAULT_FONT.id)
  })

  it('returns everything for an empty query', () => {
    expect(searchFonts('')).toHaveLength(FONTS.length)
  })

  it('searches by name, ignoring case', () => {
    expect(searchFonts('GEORG').map((font) => font.id)).toEqual(['georgia'])
  })

  it('narrows to one category', () => {
    expect(searchFonts('', 'mono').every((font) => font.category === 'mono')).toBe(true)
  })

  it('combines the query with the category', () => {
    expect(searchFonts('courier', 'serif')).toEqual([])
    expect(searchFonts('courier', 'mono').map((font) => font.id)).toEqual(['courier'])
  })

  it('finds nothing for a query nobody matches', () => {
    expect(searchFonts('пенальти')).toEqual([])
  })
})
