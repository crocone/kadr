import { expect, pageUrl, test } from './fixtures'

/**
 * A document as the background stores it after capture.
 *
 * Written straight into the page's IndexedDB: capture needs a real tab and a user
 * gesture, while the library and editor are tested from what's already saved.
 */
function seedDoc(id: string, title: string, domain: string, updatedAt: number) {
  return {
    version: 1,
    id,
    title,
    createdAt: updatedAt,
    updatedAt,
    source: { url: `https://${domain}/page`, title, domain },
    tags: [],
    domain,
    text: null,
    thumbnail: null,
    canvas: {
      w: 400,
      h: 300,
      preset: 'auto',
      background: { kind: 'gradient', from: '#4f46e5', to: '#a855f7', angle: 135 },
      padding: 64,
      radius: 12,
      shadow: {
        preset: 'soft',
        offsetX: 0,
        offsetY: 18,
        blur: 48,
        opacity: 0.24,
        color: '#0b1020',
      },
      frame: { style: 'none', theme: 'light', url: '', showUrl: true },
      mockup: 'none',
      customMockup: null,
    },
    capture: {
      imageId: 'img_seed',
      width: 272,
      height: 172,
      visible: true,
      scale: 1,
      rotation: 0,
      tilt: { x: 0, y: 0 },
      offset: { x: 0, y: 0 },
      filters: { brightness: 0, contrast: 0, saturation: 0, hue: 0 },
      crop: null,
    },
    layers: [],
  }
}

test('the extension registers its service worker', ({ extensionId }) => {
  expect(extensionId).toMatch(/^[a-z]{32}$/)
})

test('the popup offers every capture mode and the way to the library', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage()
  await page.goto(pageUrl(extensionId, 'popup'))

  for (const label of [
    'Full page',
    'Visible area',
    'Select area',
    'Pick element',
    'Scrolling capture',
  ]) {
    await expect(page.getByText(label, { exact: true })).toBeVisible()
  }
  await expect(page.getByText('Nothing captured yet')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Library' })).toBeVisible()
})

test('the scrolling capture ships without a default shortcut, and says so', async ({
  context,
  extensionId,
}) => {
  // Chrome hands out `suggested_key` to only four commands: the fifth honestly shows
  // it has no key instead of a made-up shortcut.
  const page = await context.newPage()
  await page.goto(pageUrl(extensionId, 'popup'))

  await expect(page.getByRole('button', { name: 'Scrolling capture Not set' })).toBeVisible()
})

test('the welcome page explains the hotkeys', async ({ context, extensionId }) => {
  const page = await context.newPage()
  await page.goto(pageUrl(extensionId, 'welcome'))

  await expect(page.getByRole('heading', { name: 'Kadr is installed' })).toBeVisible()
  await expect(page.getByText('Alt+Shift+A')).toBeVisible()
})

test('the library searches what the database holds', async ({ context, extensionId }) => {
  const page = await context.newPage()
  await page.goto(pageUrl(extensionId, 'library'))
  await expect(page.getByText('The library is empty')).toBeVisible()

  // The page itself has already opened the DB, so the stores exist and the version matches.
  for (const doc of [
    seedDoc('doc_a', 'Checkout', 'shop.dev', 2),
    seedDoc('doc_b', 'Dashboard', 'github.com', 1),
  ]) {
    await page.evaluate(async (stored) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        // No version number: the page already has the DB open at its own version, and
        // requesting an older one is rejected by Chrome with `VersionError`.
        const request = indexedDB.open('kadr')
        request.onsuccess = () => {
          resolve(request.result)
        }
        request.onerror = () => {
          reject(request.error ?? new Error('indexedDB.open failed'))
        }
      })
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('docs', 'readwrite')
        tx.objectStore('docs').put(stored)
        tx.oncomplete = () => {
          resolve()
        }
        tx.onerror = () => {
          reject(tx.error ?? new Error('the seed transaction failed'))
        }
      })
    }, doc)
  }

  await page.reload()
  // Titles are edited in the list view; the grid is for looking, not for forms.
  await page.getByRole('button', { name: 'List' }).click()
  await expect(page.getByRole('textbox', { name: 'Shot title' })).toHaveCount(2)

  await page.getByRole('searchbox', { name: 'Search by domain or text' }).fill('github')
  await expect(page.getByRole('textbox', { name: 'Shot title' })).toHaveCount(1)
  await expect(page.getByRole('textbox', { name: 'Shot title' })).toHaveValue('Dashboard')
})

/** Noon of the target day: the scenario must not depend on the hour it runs at. */
function noon(daysBack: number): number {
  const date = new Date()
  date.setDate(date.getDate() - daysBack)
  date.setHours(12, 0, 0, 0)
  return date.getTime()
}

test('the library groups the feed by day and hands the selection over as files', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage()
  await page.goto(pageUrl(extensionId, 'library'))
  await page.evaluate(
    async (docs) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('kadr')
        request.onsuccess = () => {
          resolve(request.result)
        }
        request.onerror = () => {
          reject(request.error ?? new Error('indexedDB.open failed'))
        }
      })
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('docs', 'readwrite')
        for (const doc of docs) tx.objectStore('docs').put(doc)
        tx.oncomplete = () => {
          resolve()
        }
        tx.onerror = () => {
          reject(tx.error ?? new Error('the seed transaction failed'))
        }
      })
    },
    [
      seedDoc('doc_today', 'Feed', 'habr.com', noon(0)),
      seedDoc('doc_old', 'Files', 'figma.com', noon(1)),
    ],
  )

  await page.reload()

  const feed = page.getByRole('main')
  await expect(feed.getByText('Today')).toBeVisible()
  await expect(feed.getByText('Yesterday')).toBeVisible()

  // Domain checkboxes combine with OR, so a single checked one keeps its own shot.
  await page.getByLabel('figma.com').check()
  await expect(feed.getByText('Today')).toBeHidden()
  await page.getByLabel('figma.com').uncheck()

  await page.getByLabel('Pick the shot: Feed').check()
  await expect(page.getByText('Selected: 1')).toBeVisible()

  // The key check: the file is rendered by the same scene as the editor — offscreen, without one.
  await page.getByRole('button', { name: 'Download' }).click()
  await expect
    .poll(async () => page.evaluate(async () => (await chrome.downloads.search({})).length), {
      timeout: 15_000,
    })
    .toBe(1)
})

test('the export popover says what the file will be and where it can go', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage()
  // Seeding goes through the library page: it opens the DB itself, so the stores
  // already exist. An empty editor doesn't touch the DB — opening it here would
  // create the database without a single store.
  await page.goto(pageUrl(extensionId, 'library'))
  await page.evaluate(
    async (stored) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('kadr')
        request.onsuccess = () => {
          resolve(request.result)
        }
        request.onerror = () => {
          reject(request.error ?? new Error('indexedDB.open failed'))
        }
      })
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('docs', 'readwrite')
        tx.objectStore('docs').put(stored)
        tx.oncomplete = () => {
          resolve()
        }
        tx.onerror = () => {
          reject(tx.error ?? new Error('the seed transaction failed'))
        }
      })
    },
    seedDoc('doc_export', 'Checkout', 'shop.dev', 1),
  )

  await page.goto(`${pageUrl(extensionId, 'editor')}?doc=doc_export`)

  const popover = page.getByRole('dialog', { name: 'Export' })
  await expect(popover).toBeHidden()

  await page.getByRole('button', { name: 'Download' }).click()
  await expect(popover).toBeVisible()

  // A 400 × 300 canvas at ×1 density: the header answers with the final file size.
  await expect(popover.getByText('400 × 300', { exact: false })).toBeVisible()
  await expect(popover.getByRole('tab', { name: 'PNG' })).toHaveAttribute('aria-selected', 'true')

  // Link already works; the other targets wait for their token and are not clickable.
  await expect(popover.getByLabel('Link')).toBeEnabled()
  await expect(popover.getByLabel('Telegram')).toBeDisabled()

  // Escape closes the popover rather than just clearing the canvas selection.
  await page.keyboard.press('Escape')
  await expect(popover).toBeHidden()
})

test('settings survive a reload, because they live in chrome.storage', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage()
  await page.goto(pageUrl(extensionId, 'options'))

  await page.getByLabel('Theme').selectOption('light')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')

  await page.reload()
  await expect(page.getByLabel('Theme')).toHaveValue('light')
})
