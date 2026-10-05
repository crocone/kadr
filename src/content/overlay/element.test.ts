// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { selectElement } from './element'
import { overlayRootsForTests } from './host'

function hosts(): Element[] {
  return [...document.documentElement.querySelectorAll('[data-kadr-overlay]')]
}

function badges(): HTMLElement[] {
  return overlayRootsForTests().flatMap((root) => [...root.querySelectorAll<HTMLElement>('.table')])
}

beforeEach(() => {
  document.body.innerHTML = ''
})

afterEach(() => {
  for (const host of hosts()) host.remove()
})

describe('selectElement', () => {
  it('mounts an overlay and takes it down on Escape', async () => {
    const selection = selectElement()
    await Promise.resolve()
    expect(hosts()).toHaveLength(1)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

    await expect(selection).resolves.toEqual({ ok: false, cancelled: true })
    expect(hosts()).toHaveLength(0)
  })

  /**
   * The badges are there before the cursor moves: on a dense grid the pick lands on a
   * cell or a scroll wrapper, and a badge that only appears on hover was unhittable.
   */
  it('puts a copy badge over every table as soon as it opens', async () => {
    document.body.innerHTML = `
      <table><tr><th>Name</th></tr><tr><td>a</td></tr></table>
      <table><tr><th>Name</th></tr><tr><td>b</td></tr></table>
    `
    const selection = selectElement()
    await Promise.resolve()

    expect(badges()).toHaveLength(2)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await selection
  })

  it('copies the table its own badge belongs to', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })

    document.body.innerHTML = `
      <table><tr><th>Name</th></tr><tr><td>a</td></tr></table>
      <table><tr><th>Name</th></tr><tr><td>b</td></tr><tr><td>c</td></tr></table>
    `
    const selection = selectElement()
    await Promise.resolve()

    badges()[1]!
      .querySelector<HTMLElement>('.chip[data-format="csv"]')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }))

    await expect(selection).resolves.toEqual({
      ok: true,
      table: { format: 'csv', rows: 2, copied: true },
    })
    expect(writeText).toHaveBeenCalledWith('Name\r\nb\r\nc')
    vi.unstubAllGlobals()
  })
})
