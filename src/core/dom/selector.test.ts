// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'

import {
  buildSelector,
  findByRef,
  fingerprintOf,
  labelOf,
  looksGenerated,
  refOf,
  similarity,
} from './selector'

function mount(html: string): HTMLElement {
  document.body.innerHTML = html
  return document.body
}

/** jsdom doesn't do layout, so size is set by hand where it matters. */
function withSize(element: Element, w: number, h: number): Element {
  element.getBoundingClientRect = () => ({ width: w, height: h }) as DOMRect
  return element
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('looksGenerated', () => {
  it('keeps hand-written ids', () => {
    expect(looksGenerated('main')).toBe(false)
    expect(looksGenerated('sidebar-nav')).toBe(false)
    expect(looksGenerated('user_profile')).toBe(false)
  })

  it('rejects framework-issued ids', () => {
    expect(looksGenerated(':r3:')).toBe(true)
    expect(looksGenerated('radix-:r1:')).toBe(true)
    expect(looksGenerated('ember42')).toBe(true)
    expect(looksGenerated('css-1a2b3c4d')).toBe(true)
    expect(looksGenerated('item-184623')).toBe(true)
    expect(looksGenerated('7up')).toBe(true)
    expect(looksGenerated('')).toBe(true)
  })
})

describe('buildSelector', () => {
  it('prefers a hand-written id', () => {
    const root = mount('<div id="main"><button id="save">Save</button></div>')
    expect(buildSelector(root.querySelector('#save')!)).toBe('#save')
  })

  it('skips a generated id and falls back to the test attribute', () => {
    const root = mount('<div><button id=":r3:" data-testid="save-btn">Save</button></div>')
    expect(buildSelector(root.querySelector('button')!)).toBe('[data-testid="save-btn"]')
  })

  it('anchors the path at the nearest stable ancestor', () => {
    const root = mount(`
      <div id="app">
        <section><p>one</p><p>two</p></section>
      </div>
    `)
    const target = root.querySelectorAll('p')[1]!
    expect(buildSelector(target)).toBe('#app > section:nth-of-type(1) > p:nth-of-type(2)')
  })

  it('counts only siblings of the same tag', () => {
    const root = mount('<div id="box"><span>a</span><b>b</b><span>c</span></div>')
    const target = root.querySelectorAll('span')[1]!
    expect(buildSelector(target)).toBe('#box > span:nth-of-type(2)')
  })

  it('resolves back to the very element it was built from', () => {
    mount(`
      <main>
        <ul><li><a href="#">one</a></li><li><a href="#">two</a></li></ul>
      </main>
    `)
    const target = document.querySelectorAll('a')[1]!
    expect(document.querySelector(buildSelector(target))).toBe(target)
  })
})

describe('labelOf', () => {
  it('takes the accessible name before the visible text', () => {
    const root = mount('<button aria-label="Close dialog">×</button>')
    expect(labelOf(root.querySelector('button')!)).toBe('Close dialog')
  })

  it('falls back to the visible text with the whitespace collapsed', () => {
    const root = mount('<button>  Save\n  changes </button>')
    expect(labelOf(root.querySelector('button')!)).toBe('Save changes')
  })

  /**
   * The infamous "consent": a checkbox has no text of its own, and without the
   * adjacent label an instruction step got the `name` attribute as its name — a
   * word for the server, not for a human.
   */
  it('takes the text of the label a checkbox belongs to, never its name attribute', () => {
    const root = mount(
      '<label><input type="checkbox" name="consent"> Согласие на обработку данных</label>',
    )
    expect(labelOf(root.querySelector('input')!)).toBe('Согласие на обработку данных')
  })

  it('follows a label bound by "for"', () => {
    const root = mount('<label for="mail">Почта</label><input id="mail" name="email">')
    expect(labelOf(root.querySelector('input')!)).toBe('Почта')
  })

  it('reads aria-labelledby the way a screen reader would', () => {
    const root = mount(
      '<h2 id="t">Настройки центра</h2><div role="group" aria-labelledby="t"></div>',
    )
    expect(labelOf(root.querySelector('[role=group]')!)).toBe('Настройки центра')
  })

  it('cuts a long label on a word boundary instead of mid-word', () => {
    const full =
      'Отправляя форму, даю согласие на обработку персональных данных в соответствии с политикой конфиденциальности'
    const root = mount(`<button aria-label="${full}"></button>`)
    const label = labelOf(root.querySelector('button')!)

    expect(label.endsWith('…')).toBe(true)
    expect(label.length).toBeLessThan(full.length)

    // Cut exactly at a space: the next character of the source string is a space,
    // so the label's last word is whole, not a stub.
    const kept = label.slice(0, -1)
    expect(full.startsWith(kept)).toBe(true)
    expect(full[kept.length]).toBe(' ')
  })
})

describe('similarity', () => {
  const recorded = { tag: 'button', label: 'Save', w: 100, h: 40 }

  it('scores an identical element at one', () => {
    expect(similarity({ ...recorded }, recorded)).toBe(1)
  })

  it('survives a resize, because responsive layouts change widths', () => {
    expect(similarity({ ...recorded, w: 130 }, recorded)).toBeGreaterThan(0.9)
  })

  it('drops below the threshold once the tag differs', () => {
    expect(similarity({ ...recorded, tag: 'div' }, recorded)).toBeLessThan(0.55)
  })
})

describe('findByRef', () => {
  it('finds the element again after a sibling was inserted above it', () => {
    mount('<div id="app"><p>one</p><p>two</p></div>')
    const target = withSize(document.querySelectorAll('p')[1]!, 200, 20)
    const ref = refOf(target)

    document.querySelector('#app')!.insertAdjacentHTML('afterbegin', '<p>zero</p>')
    for (const p of document.querySelectorAll('p')) withSize(p, 200, 20)

    const found = findByRef(ref, document)
    expect(found?.element.textContent).toBe('two')
  })

  it('refuses a node that no longer looks like the recorded one', () => {
    mount('<div id="app"><button>Save</button></div>')
    const ref = refOf(withSize(document.querySelector('button')!, 100, 40))

    document.body.innerHTML = '<div id="app"><span>Something else</span></div>'
    expect(findByRef(ref, document)).toBeNull()
  })

  it('accepts the direct hit even when the label was reworded a little', () => {
    mount('<div id="app"><button id="save">Save</button></div>')
    const ref = refOf(withSize(document.querySelector('#save')!, 100, 40))

    document.querySelector('#save')!.textContent = 'Save changes'
    withSize(document.querySelector('#save')!, 100, 40)

    expect(findByRef(ref, document)?.element.id).toBe('save')
  })
})

describe('fingerprintOf', () => {
  it('accepts a size measured elsewhere, because the overlay already has one', () => {
    const root = mount('<button aria-label="Send">→</button>')
    expect(fingerprintOf(root.querySelector('button')!, { w: 48.4, h: 24.6 })).toEqual({
      tag: 'button',
      label: 'Send',
      w: 48,
      h: 25,
    })
  })
})
