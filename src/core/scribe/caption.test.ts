import { describe, expect, it } from 'vitest'

import { captionOf, elementKindOf, withCaptions } from './caption'
import type { ScribeStep } from './timeline'

function step(patch: Partial<ScribeStep> = {}): ScribeStep {
  return {
    id: 's1',
    guideId: 'g1',
    index: 1,
    kind: 'click',
    at: 0,
    point: null,
    element: { selector: '#x', fingerprint: { tag: 'button', label: 'Save', w: 80, h: 32 } },
    target: 'button',
    rect: null,
    url: 'https://example.com/',
    title: 'Example',
    imageId: null,
    viewport: null,
    caption: '',
    captionEdited: false,
    docId: null,
    ...patch,
  }
}

describe('elementKindOf', () => {
  it('believes the role over the tag, because design systems build buttons out of divs', () => {
    expect(elementKindOf({ tag: 'div', role: 'button' })).toBe('button')
    expect(elementKindOf({ tag: 'span', role: 'checkbox' })).toBe('checkbox')
  })

  it('splits the input types apart', () => {
    expect(elementKindOf({ tag: 'input', type: 'text' })).toBe('field')
    expect(elementKindOf({ tag: 'input', type: 'checkbox' })).toBe('checkbox')
    expect(elementKindOf({ tag: 'input', type: 'submit' })).toBe('button')
  })

  it('calls a link with nowhere to go a button, because that is what it is', () => {
    expect(elementKindOf({ tag: 'a', href: true })).toBe('link')
    expect(elementKindOf({ tag: 'a', href: false })).toBe('button')
  })
})

describe('captionOf', () => {
  it('names the element and says what to do with it', () => {
    expect(captionOf(step(), 'en')).toBe('Click «Save»')
    expect(captionOf(step(), 'ru')).toBe('Нажмите «Save»')
  })

  it('falls back to the kind alone when the element has no name at all', () => {
    const blind = step({
      element: { selector: '#x', fingerprint: { tag: 'button', label: '', w: 40, h: 40 } },
    })
    expect(captionOf(blind, 'en')).toBe('Click the button')
  })

  it('never claims to know what was typed into a field', () => {
    const typed = step({
      kind: 'input',
      target: 'field',
      element: { selector: '#e', fingerprint: { tag: 'input', label: 'Email', w: 200, h: 32 } },
    })
    expect(captionOf(typed, 'en')).toBe('Fill in «Email»')
  })

  it('trims a label long enough to be a paragraph', () => {
    const wordy = step({
      element: {
        selector: '#x',
        fingerprint: { tag: 'button', label: 'a'.repeat(200), w: 40, h: 40 },
      },
    })
    expect(captionOf(wordy, 'en').length).toBeLessThan(80)
  })

  it('marks a page change by the title of the page', () => {
    expect(captionOf(step({ kind: 'navigate', title: 'Billing' }), 'en')).toBe('Go to “Billing”')
  })
})

describe('withCaptions', () => {
  it('leaves a hand-written caption alone', () => {
    const steps = [step({ caption: 'Mine', captionEdited: true }), step({ id: 's2' })]
    const filled = withCaptions(steps, 'en')

    expect(filled[0]?.caption).toBe('Mine')
    expect(filled[1]?.caption).toBe('Click «Save»')
  })
})
