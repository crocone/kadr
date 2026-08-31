import { describe, expect, it } from 'vitest'

import { moveStep, pageBreaks, removeStep, renumber, type ScribeStep, setCaption } from './timeline'

function step(id: string, index: number, url = 'https://example.com/a'): ScribeStep {
  return {
    id,
    guideId: 'g1',
    index,
    kind: 'click',
    at: index * 1000,
    point: null,
    element: null,
    target: null,
    rect: null,
    url,
    title: 'Example',
    imageId: null,
    viewport: null,
    caption: `step ${index}`,
    captionEdited: false,
    docId: null,
  }
}

const steps = [step('a', 1), step('b', 2), step('c', 3)]

describe('renumber', () => {
  it('closes the gap a deleted step leaves behind', () => {
    expect(renumber([step('a', 1), step('c', 7)]).map((s) => s.index)).toEqual([1, 2])
  })

  it('leaves an already correct list untouched, object identity included', () => {
    expect(renumber(steps)[0]).toBe(steps[0])
  })
})

describe('moveStep', () => {
  it('drags a step down and renumbers what it passed', () => {
    expect(moveStep(steps, 0, 2).map((s) => s.id)).toEqual(['b', 'c', 'a'])
    expect(moveStep(steps, 0, 2).map((s) => s.index)).toEqual([1, 2, 3])
  })

  it('drags a step up', () => {
    expect(moveStep(steps, 2, 0).map((s) => s.id)).toEqual(['c', 'a', 'b'])
  })

  it('treats a drop past the end as a drop on the end, not as a deletion', () => {
    expect(moveStep(steps, 0, 99).map((s) => s.id)).toEqual(['b', 'c', 'a'])
  })
})

describe('removeStep', () => {
  it('drops the step and closes the numbering', () => {
    const left = removeStep(steps, 'b')
    expect(left.map((s) => s.id)).toEqual(['a', 'c'])
    expect(left.map((s) => s.index)).toEqual([1, 2])
  })
})

describe('setCaption', () => {
  it('marks the caption as hand-written, so a rebuild will not overwrite it', () => {
    const edited = setCaption(steps, 'b', 'Press Save')
    expect(edited[1]).toMatchObject({ caption: 'Press Save', captionEdited: true })
    expect(edited[0]?.captionEdited).toBe(false)
  })
})

describe('pageBreaks', () => {
  it('marks the step where the page changed', () => {
    const walk = [
      step('a', 1, 'https://example.com/one'),
      step('b', 2, 'https://example.com/one'),
      step('c', 3, 'https://example.com/two'),
    ]
    expect([...pageBreaks(walk)]).toEqual(['c'])
  })

  it('ignores a hash change, which is the same page scrolled', () => {
    const walk = [
      step('a', 1, 'https://example.com/one'),
      step('b', 2, 'https://example.com/one#section'),
    ]
    expect(pageBreaks(walk).size).toBe(0)
  })
})
