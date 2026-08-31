/**
 * Reshooting from a recipe: refresh a document's frame without recapturing by hand
 *.
 *
 * Everything is shot in a dedicated window, not in the user's tab. The reason is
 * technical and hard: `captureVisibleTab` shoots the window's active tab, so a batch of
 * five documents from one domain would otherwise flip through the user's working window
 * before their eyes — five times, with their tabs in between. Our own window opens,
 * does its job and closes.
 *
 * The window width comes from the recipe: a frame taken at 1440 and reshot at 1280 is a
 * different frame, with the menu moved and a different layout. Chrome sets the window's
 * outer size but we need the inner one, so after the first load the window is measured
 * and adjusted.
 */
import contentScriptPath from '@/content/index?iife'
import {
  aspectDrift,
  type CaptureRecipe,
  isRepeatable,
  MAX_QUIET_DRIFT,
} from '@/core/capture/recipe'
import { CaptureFailure, type CaptureError } from '@/core/capture/types'
import { makeThumbnail } from '@/core/capture/image'
import { newImageId } from '@/core/doc'
import { replaceCapture } from '@/core/doc/capture-ops'
import type { DocId } from '@/core/doc/types'
import { sendTabMessage } from '@/core/messaging'
import { hasAllUrls } from '@/core/permissions/host-access'
import { getDoc, putDoc, putImage } from '@/core/storage/db'

import { captureByRecipe, type CaptureTab } from './capture'
import { ensureContentScript } from './content-script'

export type ReshootFailure = CaptureError | 'no-recipe' | 'no-permission' | 'no-document'

export type ReshootResult =
  | {
      ok: true
      docId: DocId
      /**
       * How far the aspect ratio drifted. Above `MAX_QUIET_DRIFT` the editor says so
       * out loud: annotations are fitted by the size ratio, and on a badly changed
       * frame they no longer point at the right things.
       */
      drift: number
    }
  | { ok: false; docId: DocId; reason: ReshootFailure }

/**
 * Pause after `complete` for rendering to settle.
 *
 * `complete` means "resources loaded", not "the page looks the way it looks". Fonts
 * swap in, images decode, a React app is only starting to paint its first screen.
 * Without the pause a loading skeleton regularly ends up in the frame.
 */
const SETTLE_MS = 700

/** Do not wait longer than this: after a minute the page either loaded or never will. */
const LOAD_TIMEOUT_MS = 60_000

/**
 * Caps on a page reply and on one document's whole capture.
 *
 * `chrome.tabs.sendMessage` has no timeout: a silent tab hangs the call forever.
 * Reshoots used to stall exactly like that — window left open, badge frozen, no error
 * at all. Silence must end in an error, not an endless wait.
 */
const REPLY_TIMEOUT_MS = 15_000
const SHOT_TIMEOUT_MS = 180_000

function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new CaptureFailure('capture-failed', `${what} did not answer within ${ms}ms`))
    }, ms)

    work.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      },
    )
  })
}

/**
 * Whether the target page has actually loaded.
 *
 * A blank tab is also "complete" — it was, even before we sent it to the URL. Without
 * this check the wait ended instantly and `about:blank` got captured instead of the page.
 */
function isLoaded(tab: chrome.tabs.Tab): boolean {
  return tab.status === 'complete' && (tab.url ?? '') !== 'about:blank'
}

async function waitForLoad(tabId: number): Promise<void> {
  await new Promise<void>((resolve) => {
    const timer = setTimeout(finish, LOAD_TIMEOUT_MS)

    function finish() {
      clearTimeout(timer)
      chrome.tabs.onUpdated.removeListener(listener)
      resolve()
    }

    function listener(updatedId: number, _info: chrome.tabs.OnUpdatedInfo, tab: chrome.tabs.Tab) {
      if (updatedId === tabId && isLoaded(tab)) finish()
    }

    chrome.tabs.onUpdated.addListener(listener)
    // The tab may have finished loading while the listener was being attached.
    void chrome.tabs.get(tabId).then((tab) => {
      if (isLoaded(tab)) finish()
    })
  })
}

export type ReshootWindow = {
  windowId: number
  tabId: number
  /** Viewport width the window is already fitted to: no point fitting twice. */
  fittedTo: number | null
}

/**
 * The reshoot window. Opened visible and focused on purpose: Chrome does not paint a
 * minimized or covered window, and `captureVisibleTab` returns a stale frame from it —
 * the same "it moved but the picture did not change" case as in scrolling capture.
 */
export async function openReshootWindow(recipe: CaptureRecipe): Promise<ReshootWindow> {
  const created = await chrome.windows.create({
    url: 'about:blank',
    type: 'normal',
    focused: true,
    width: recipe.viewportWidth + 16,
    height: recipe.viewportHeight + 120,
  })

  const tabId = created?.tabs?.[0]?.id
  if (!created?.id || tabId === undefined) throw new CaptureFailure('capture-failed')

  return { windowId: created.id, tabId, fittedTo: null }
}

/**
 * Fit the window to the recipe's viewport width.
 *
 * Chrome can only set the window's outer size, and the frame and scrollbar eat a
 * different number of pixels on different systems. So the window is measured from the
 * inside first, then shifted by the difference — one pass; a second changes nothing.
 */
async function fitViewport(
  target: ReshootWindow,
  recipe: CaptureRecipe,
  metrics: { viewportWidth: number; viewportHeight: number },
): Promise<void> {
  const dw = recipe.viewportWidth - metrics.viewportWidth
  const dh = recipe.viewportHeight - metrics.viewportHeight
  if (dw === 0 && dh === 0) {
    target.fittedTo = recipe.viewportWidth
    return
  }

  const current = await chrome.windows.get(target.windowId)
  await chrome.windows.update(target.windowId, {
    width: (current.width ?? recipe.viewportWidth) + dw,
    height: (current.height ?? recipe.viewportHeight) + dh,
  })
  target.fittedTo = recipe.viewportWidth
}

export async function closeReshootWindow(target: ReshootWindow): Promise<void> {
  await chrome.windows.remove(target.windowId).catch(() => undefined)
}

async function settle(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * One document. The window is passed in: a per-domain reshoot opens it once for the
 * whole batch, otherwise five documents would mean five windows in a row.
 */
export async function reshootDoc(docId: DocId, target: ReshootWindow): Promise<ReshootResult> {
  const doc = await getDoc(docId)
  if (!doc) return { ok: false, docId, reason: 'no-document' }

  const recipe = doc.recipe
  if (!isRepeatable(recipe)) return { ok: false, docId, reason: 'no-recipe' }
  // The permission is requested by a button, from a user gesture: by the time we get
  // here the answer already exists, and if it is missing there is nothing to shoot —
  // not "let's ask now". It must be access to all sites: `captureVisibleTab` accepts
  // nothing less, see `host-access`.
  if (!(await hasAllUrls())) return { ok: false, docId, reason: 'no-permission' }

  try {
    await chrome.tabs.update(target.tabId, { url: recipe.url })
    await waitForLoad(target.tabId)
    await settle(Math.max(SETTLE_MS, recipe.delayMs))
    await ensureContentScript(target.tabId, contentScriptPath)

    const tab = await chrome.tabs.get(target.tabId)
    const page: CaptureTab = {
      id: target.tabId,
      windowId: target.windowId,
      url: tab.url ?? recipe.url,
      title: tab.title ?? doc.title,
    }

    if (target.fittedTo !== recipe.viewportWidth) {
      const measured = await withTimeout(
        sendTabMessage(target.tabId, 'content:metrics', {}),
        REPLY_TIMEOUT_MS,
        'content:metrics',
      )
      await fitViewport(target, recipe, measured.metrics)
      // The layout reflows after the resize: give it time to repaint.
      await settle(SETTLE_MS)
    }

    // Raise the window right before shooting: Chrome does not paint a covered or
    // minimized window, and `captureVisibleTab` would return a stale frame from it.
    await chrome.windows.update(target.windowId, { focused: true, state: 'normal' })

    const capture = await withTimeout(captureByRecipe(page, recipe), SHOT_TIMEOUT_MS, 'the capture')
    return await storeCapture(docId, capture)
  } catch (error) {
    const reason = error instanceof CaptureFailure ? error.reason : 'capture-failed'
    console.error('[kadr] reshoot failed', error)
    return { ok: false, docId, reason }
  }
}

async function storeCapture(
  docId: DocId,
  capture: { blob: Blob; width: number; height: number; dpr: number },
): Promise<ReshootResult> {
  const doc = await getDoc(docId)
  if (!doc) return { ok: false, docId, reason: 'no-document' }

  const bitmap = await createImageBitmap(capture.blob)
  const thumbnail = await makeThumbnail(bitmap)
  bitmap.close()

  const imageId = newImageId()
  const now = Date.now()

  await putImage({
    id: imageId,
    blob: capture.blob,
    width: capture.width,
    height: capture.height,
    dpr: capture.dpr,
    createdAt: now,
    source: doc.source,
  })

  // The document lives in CSS pixels, the frame in physical ones: same numbers as at capture time.
  const width = Math.round(capture.width / capture.dpr)
  const height = Math.round(capture.height / capture.dpr)
  const drift = aspectDrift(
    { width: doc.capture.width, height: doc.capture.height },
    { width, height },
  )

  const updated = replaceCapture(doc, { imageId, width, height, capturedAt: now })
  // The recognized text belonged to the old frame: keeping it would let library search
  // match words the shot no longer contains.
  await putDoc({ ...doc, ...updated, text: null, thumbnail })

  return { ok: true, docId, drift }
}

/**
 * A batch of documents through one window. Order is preserved, and one failure does not
 * stop the rest: updating four out of five documentation shots beats updating none.
 *
 * The window is closed in `finally` — otherwise a reshoot interrupted mid-batch would
 * leave the user a stray window with an open page and no explanation.
 */
export async function reshootDocs(
  docIds: readonly DocId[],
  onProgress?: (done: number, total: number) => void,
): Promise<ReshootResult[]> {
  const first = await getDoc(docIds[0] ?? '')
  const recipe = first?.recipe
  if (!isRepeatable(recipe)) {
    return docIds.map((docId) => ({ ok: false, docId, reason: 'no-recipe' }) as const)
  }

  const target = await openReshootWindow(recipe)
  const results: ReshootResult[] = []

  try {
    for (const [at, docId] of docIds.entries()) {
      onProgress?.(at, docIds.length)
      results.push(await reshootDoc(docId, target))
    }
    onProgress?.(docIds.length, docIds.length)
  } finally {
    await closeReshootWindow(target)
  }

  return results
}

export { MAX_QUIET_DRIFT }
