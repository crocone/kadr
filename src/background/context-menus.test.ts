import { beforeEach, describe, expect, it, vi } from 'vitest'

import { captureModeForMenuItem, createContextMenus } from './context-menus'

/** Live menu items: `create` on a taken id fails the same way Chrome's does. */
function fakeMenus() {
  const items = new Set<string>()
  let creating = 0

  return {
    items,
    /** How many create passes run right now: the queue must keep it at one. */
    maxParallel: () => creating,
    api: {
      removeAll: vi.fn(async () => {
        // Removing the menu is async — the race happened exactly in this gap.
        await Promise.resolve()
        items.clear()
      }),
      create: vi.fn((props: { id: string }, done?: () => void) => {
        creating += 1
        if (items.has(props.id)) {
          lastError = { message: `Cannot create item with duplicate id ${props.id}` }
        } else {
          items.add(props.id)
          lastError = undefined
        }
        done?.()
        lastError = undefined
        creating -= 1
        return props.id
      }),
    },
  }
}

let lastError: { message: string } | undefined

beforeEach(() => {
  lastError = undefined
})

describe('createContextMenus', () => {
  it('builds the whole menu once', async () => {
    const menus = fakeMenus()
    vi.stubGlobal('chrome', {
      contextMenus: menus.api,
      i18n: { getUILanguage: () => 'ru-RU' },
      runtime: {
        get lastError() {
          return lastError
        },
      },
    })

    await createContextMenus()

    expect([...menus.items]).toEqual([
      'kadr-root',
      'capture-fullpage',
      'capture-visible',
      'capture-area',
      'capture-element',
      'capture-scroll',
    ])
  })

  /**
   * On a browser update `onInstalled` and `onStartup` arrive almost simultaneously.
   * Two unsynchronized calls used to interleave on the async `removeAll`, and the
   * second ran into items the first had just created — Chrome spat "Cannot create item
   * with duplicate id" for every id.
   */
  it('queues a second build instead of racing the first', async () => {
    const menus = fakeMenus()
    const duplicates: string[] = []

    vi.stubGlobal('chrome', {
      contextMenus: menus.api,
      i18n: { getUILanguage: () => 'en-US' },
      runtime: {
        get lastError() {
          if (lastError) duplicates.push(lastError.message)
          return lastError
        },
      },
    })

    await Promise.all([createContextMenus(), createContextMenus()])

    expect(duplicates).toEqual([])
    expect(menus.items.size).toBe(6)
  })
})

describe('captureModeForMenuItem', () => {
  it('maps a menu id to the mode it captures', () => {
    expect(captureModeForMenuItem('capture-area')).toBe('area')
    expect(captureModeForMenuItem('something-else')).toBeUndefined()
  })
})
