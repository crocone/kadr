import { describe, expect, it } from 'vitest'

import { guideMarkdown, type MarkdownStep, slugify } from './export'

const step = (patch: Partial<MarkdownStep> = {}): MarkdownStep => ({
  index: 1,
  caption: 'Нажмите «Собрать проект»',
  image: 'step-1.png',
  page: null,
  ...patch,
})

describe('guideMarkdown', () => {
  /**
   * Images used to sit inside list items with three-space indentation — markdown's most
   * fragile construct: the required indent depends on marker width, and step 10 already
   * needs a different one. Now each image is its own paragraph at the left margin.
   */
  it('keeps every image at the left margin, never nested in a list item', () => {
    const text = guideMarkdown('Guide', [step(), step({ index: 10, image: 'step-10.png' })])

    for (const line of text.split('\n')) {
      if (line.includes('![')) expect(line.startsWith('![')).toBe(true)
    }
  })

  it('numbers the steps in headings, so the order survives and gives an outline', () => {
    const text = guideMarkdown('Guide', [step({ index: 2, caption: 'Второй' })])
    expect(text).toContain('## 2. Второй')
  })

  it('fills the alt text, so a lost folder leaves the caption behind', () => {
    expect(guideMarkdown('Guide', [step()])).toContain('![Нажмите «Собрать проект»](step-1.png)')
  })

  it('writes a step without a frame as text alone', () => {
    const text = guideMarkdown('Guide', [step({ image: null })])

    expect(text).toContain('## 1. Нажмите «Собрать проект»')
    expect(text).not.toContain('![')
  })

  it('marks where the page changed', () => {
    const text = guideMarkdown('Guide', [step({ page: 'Кабинет центра' })])
    expect(text).toContain('_Кабинет центра_')
  })

  it('escapes what markdown would otherwise read as markup', () => {
    const text = guideMarkdown('Guide', [step({ caption: 'Нажмите [Файл] * _раз_' })])
    expect(text).toContain('## 1. Нажмите \\[Файл\\] \\* \\_раз\\_')
  })
})

describe('slugify', () => {
  it('keeps cyrillic and turns the rest into dashes', () => {
    expect(slugify('Профиметр — кабинет учебного центра')).toBe('профиметр-кабинет-учебного-центра')
  })

  it('never returns an empty name', () => {
    expect(slugify('!!!')).toBe('guide')
  })
})
