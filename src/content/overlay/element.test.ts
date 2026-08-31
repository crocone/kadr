// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'

import { selectElement } from './element'

function hosts(): Element[] {
  return [...document.documentElement.querySelectorAll('[data-kadr-overlay]')]
}

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
})
