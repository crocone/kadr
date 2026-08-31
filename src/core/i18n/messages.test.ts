import { describe, expect, it } from 'vitest'

import { LOCALES } from './locales'
import { messages } from './messages'

const placeholders = (template: string): string[] =>
  [...template.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? '').sort()

/**
 * Half the audience arrives via Yandex Browser, so Russian is a first-class language
 * here, not an afterthought. A forgotten key falls back to the English
 * string and just looks unfinished in the UI — this test catches that.
 */
describe('messages', () => {
  const english = messages.en as Record<string, string>

  for (const locale of LOCALES) {
    const dictionary = messages[locale] as Record<string, string>

    it(`${locale} has a string for every key and no extra ones`, () => {
      expect(Object.keys(dictionary).sort()).toEqual(Object.keys(english).sort())
    })

    it(`${locale} keeps every placeholder`, () => {
      for (const [key, template] of Object.entries(english)) {
        expect({ key, params: placeholders(dictionary[key] ?? '') }).toEqual({
          key,
          params: placeholders(template),
        })
      }
    })

    it(`${locale} has no empty strings`, () => {
      for (const [key, value] of Object.entries(dictionary)) {
        expect({ key, empty: value.trim() === '' }).toEqual({ key, empty: false })
      }
    })
  }
})
