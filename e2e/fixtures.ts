import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { type BrowserContext, test as base, chromium } from '@playwright/test'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = resolve(root, 'dist')

/**
 * Chrome with the extension installed.
 *
 * The profile is temporary and disposable: tests write to IndexedDB and
 * chrome.storage, and doing that in a shared profile would make results vary between
 * runs. The extension id comes from its service worker URL — it isn't known upfront.
 */
export const test = base.extend<{ context: BrowserContext; extensionId: string }>({
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
    })
    await use(context)
    await context.close()
  },

  extensionId: async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))
    await use(new URL(worker.url()).host)
  },
})

export const expect = test.expect

/** Extension page URL: same paths as in `vite.config.ts`. */
export function pageUrl(extensionId: string, page: string): string {
  return `chrome-extension://${extensionId}/src/${page}/index.html`
}
