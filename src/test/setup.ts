import 'fake-indexeddb/auto'

import { beforeEach, vi } from 'vitest'

import { resetDbForTests } from '@/core/storage/db'

/**
 * Minimal chrome mock: tests touch storage.local, i18n and the command list.
 * Anything not mocked must fail loudly instead of silently returning undefined.
 */
/** Default `chrome.commands.getAll` reply: same as declared in the manifest. */
const COMMANDS: chrome.commands.Command[] = [
  { name: 'capture-fullpage', shortcut: 'Alt+Shift+F' },
  { name: 'capture-visible', shortcut: 'Alt+Shift+V' },
  { name: 'capture-area', shortcut: 'Alt+Shift+A' },
  { name: 'capture-element', shortcut: 'Alt+Shift+E' },
  // Scrolling capture gets no suggested shortcut: Chrome allows only four.
  { name: 'capture-scroll', shortcut: '' },
]

function createChromeMock() {
  let storage: Record<string, unknown> = {}
  const listeners = new Set<
    (changes: Record<string, chrome.storage.StorageChange>, area: chrome.storage.AreaName) => void
  >()

  const api = {
    i18n: { getUILanguage: () => 'en-US' },
    runtime: {
      sendMessage: vi.fn(() => Promise.resolve({ ok: true })),
      openOptionsPage: vi.fn(() => Promise.resolve()),
      getURL: (path: string) => `chrome-extension://kadr-test/${path}`,
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    // The popup asks Chrome for the actually assigned shortcuts: default to what the
    // manifest declares; a conflict is stubbed by the test itself.
    commands: { getAll: vi.fn(() => Promise.resolve(COMMANDS)) },
    // The popup queries the active tab up front: the site permission is requested from
    // the click handler, and an `await` before that point would consume the gesture window.
    tabs: {
      create: vi.fn(() => Promise.resolve({})),
      query: vi.fn(() => Promise.resolve([] as chrome.tabs.Tab[])),
    },
    storage: {
      local: {
        get: (key: string) => Promise.resolve(key in storage ? { [key]: storage[key] } : {}),
        set: (items: Record<string, unknown>) => {
          const changes: Record<string, chrome.storage.StorageChange> = {}
          for (const [key, value] of Object.entries(items)) {
            changes[key] = { oldValue: storage[key], newValue: value }
            storage[key] = value
          }
          for (const listener of listeners) listener(changes, 'local')
          return Promise.resolve()
        },
      },
      onChanged: {
        addListener: (listener: Parameters<typeof listeners.add>[0]) => listeners.add(listener),
        removeListener: (listener: Parameters<typeof listeners.add>[0]) =>
          listeners.delete(listener),
      },
    },
  }

  return {
    api,
    reset() {
      storage = {}
      listeners.clear()
      // `restoreMocks` in the config strips implementations from `vi.fn`, so default
      // replies are restored here: otherwise a test gets undefined where the mock
      // promised a command list.
      api.commands.getAll.mockImplementation(() => Promise.resolve(COMMANDS))
      api.runtime.sendMessage.mockImplementation(() => Promise.resolve({ ok: true }))
      api.runtime.openOptionsPage.mockImplementation(() => Promise.resolve())
      api.tabs.create.mockImplementation(() => Promise.resolve({}))
      api.tabs.query.mockImplementation(() => Promise.resolve([] as chrome.tabs.Tab[]))
    },
  }
}

const chromeMock = createChromeMock()
vi.stubGlobal('chrome', chromeMock.api)

beforeEach(async () => {
  chromeMock.reset()
  await resetDbForTests()
  await new Promise<void>((done) => {
    const request = indexedDB.deleteDatabase('kadr')
    request.onsuccess = request.onerror = request.onblocked = () => done()
  })
})
