/**
 * Service worker: hotkeys, context menu, capture orchestration.
 *
 * In MV3 the worker can be suspended at any moment, so this file keeps no state —
 * anything that must survive suspension goes to IndexedDB or chrome.storage.local (PLAN.md §8).
 */
import contentScriptPath from '@/content/index?iife'
import { CaptureFailure } from '@/core/capture/types'
import { DEFAULT_LOCALE, resolveSystemLocale, translate } from '@/core/i18n'
import type { Locale } from '@/core/i18n'
import { CAPTURE_COMMANDS, type CaptureMode, registerMessageHandlers } from '@/core/messaging'
import { readSettings } from '@/core/storage/settings'

import { clearBadge, showDone, showError, showProgress } from './badge'
import {
  type CaptureOutcome,
  type CaptureTab,
  refreshFrame,
  reportFailure,
  resolveTab,
  runCapture,
} from './capture'
import { captureModeForMenuItem, createContextMenus } from './context-menus'
import { ensureContentScript } from './content-script'
import { keepServiceWorkerAlive } from './keep-alive'
import { reshootDocs } from './reshoot'
import {
  onTabRemoved,
  onTabUpdated,
  recordStep,
  scribeStatus,
  startScribe,
  stopScribe,
} from './scribe'
import { runResponsiveSeries } from './responsive-run'

const EDITOR_PAGE = 'src/editor/index.html'
const GUIDE_PAGE = 'src/guide/index.html'
const LIBRARY_PAGE = 'src/library/index.html'
const WELCOME_PAGE = 'src/welcome/index.html'

async function currentLocale(): Promise<Locale> {
  const settings = await readSettings().catch(() => null)
  if (settings && settings.locale !== 'system') return settings.locale
  return chrome.i18n?.getUILanguage
    ? resolveSystemLocale(chrome.i18n.getUILanguage())
    : DEFAULT_LOCALE
}

async function openEditor(docId?: string): Promise<void> {
  const url = chrome.runtime.getURL(docId ? `${EDITOR_PAGE}?doc=${docId}` : EDITOR_PAGE)
  await chrome.tabs.create({ url })
}

/**
 * "Edit" opens a tab, but copy and download would otherwise finish silently, so they
 * report through the action-icon badge.
 */
async function reportOutcome(outcome: CaptureOutcome): Promise<void> {
  // Table copy: no shot, nothing to open — the row-count badge is the whole response.
  if (outcome.docId === null) {
    const locale = await currentLocale()
    if (!outcome.copied) {
      showError(translate(locale, 'capture.error.clipboard'))
      return
    }
    showDone(
      translate(locale, 'capture.table.copied', {
        format: outcome.table.format.toUpperCase(),
        n: outcome.table.rows,
      }),
    )
    return
  }

  if (outcome.action === 'edit') {
    await openEditor(outcome.docId)
    // Capture succeeded with a caveat (e.g. hit the canvas limit). Handing over a
    // truncated sheet silently would leave the user guessing where the rest went.
    if (outcome.note) showDone(translate(await currentLocale(), outcome.note))
    return
  }
  const locale = await currentLocale()
  if (outcome.action === 'copy' && outcome.copied === false) {
    showError(translate(locale, 'capture.error.clipboard'))
    return
  }
  showDone(translate(locale, outcome.action === 'copy' ? 'capture.copied' : 'capture.downloaded'))
}

/**
 * Checks that must pass before answering the popup (page, tab, script) run synchronously
 * with the reply. The capture itself outlives the popup, so its result arrives as an
 * editor tab and errors show on the action-icon badge.
 */
async function startCapture(mode: CaptureMode, tabId?: number): Promise<CaptureTab> {
  const tab = await resolveTab(tabId)
  await ensureContentScript(tab.id, contentScriptPath)

  void runCapture(mode, tab)
    .then(async (outcome) => {
      await reportOutcome(outcome)
    })
    .catch(async (error: unknown) => {
      reportFailure(error, await currentLocale())
    })

  return tab
}

/**
 * The series outlives the popup and resizes the window, so progress goes to the badge:
 * otherwise the first seconds look like "nothing happened, but the window is jumping".
 */
async function startResponsiveSeries(tabId?: number): Promise<void> {
  const tab = await resolveTab(tabId)
  await ensureContentScript(tab.id, contentScriptPath)

  const stopKeepAlive = keepServiceWorkerAlive()

  void runResponsiveSeries(tab, undefined, (done, total) => {
    showProgress(done, total)
  })
    .then(async (docId) => {
      clearBadge()
      await openEditor(docId)
    })
    .catch(async (error: unknown) => {
      reportFailure(error, await currentLocale())
    })
    .finally(() => {
      stopKeepAlive()
    })
}

function startCaptureFromGesture(mode: CaptureMode, tabId?: number): void {
  void startCapture(mode, tabId).catch(async (error: unknown) => {
    reportFailure(error, await currentLocale())
  })
}

chrome.runtime.onInstalled.addListener((details) => {
  void createContextMenus()

  // Onboarding is shown once, on install only: a welcome tab on every update is exactly
  // the kind of annoyance extensions get uninstalled for.
  if (details.reason === 'install') {
    void chrome.tabs.create({ url: chrome.runtime.getURL(WELCOME_PAGE) })
  }
})

chrome.runtime.onStartup.addListener(() => {
  void createContextMenus()
})

/**
 * Use the tab that arrived with the command. In a service worker `currentWindow` is the
 * last focused window, not the one where the keys were pressed: with two windows open
 * the selection overlay used to pop up in the wrong one. It is also exactly the tab
 * Chrome granted `activeTab` for this gesture.
 */
chrome.commands.onCommand.addListener((command, tab) => {
  const mode = CAPTURE_COMMANDS[command]
  if (mode) startCaptureFromGesture(mode, tab?.id)
})

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const mode = captureModeForMenuItem(info.menuItemId)
  if (mode) startCaptureFromGesture(mode, tab?.id)
})

/**
 * Guide recording survives navigation: the content script dies with its listeners on
 * every page load, and only the background can bring it back.
 */
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  void currentLocale().then((locale) => onTabUpdated(tabId, info, tab, locale))
})

chrome.tabs.onRemoved.addListener((tabId) => {
  void onTabRemoved(tabId)
})

registerMessageHandlers({
  ping: () => ({ ok: true, from: 'background' }),

  'scribe:start': async ({ tabId }) => {
    try {
      const tab = await resolveTab(tabId)
      return { ok: true, guideId: await startScribe(tab) }
    } catch (error) {
      const reason = error instanceof CaptureFailure ? error.reason : 'capture-failed'
      reportFailure(error, await currentLocale())
      return { ok: false, error: reason }
    }
  },

  'scribe:stop': async () => {
    const guideId = await stopScribe()
    // Open the finished guide right away: a recording without its steps reviewed is
    // useless, and finding it later in the library would be manual work.
    if (guideId) {
      await chrome.tabs.create({
        url: chrome.runtime.getURL(`${GUIDE_PAGE}?guide=${guideId}`),
      })
    }
    return { ok: true, guideId }
  },

  'scribe:step': async ({ event }, sender) => {
    const counted = await recordStep(event, sender, await currentLocale())
    return counted ? { ok: true, ...counted } : { ok: false }
  },

  'scribe:status': () => scribeStatus(),

  'editor:open': async ({ docId }) => {
    await openEditor(docId)
    return { ok: true }
  },

  /**
   * A reshoot outlives the initiating tab but must still reply to it: the editor waits
   * for the new frame to reload the document. So keep the worker alive and answer when
   * done, not immediately — a batch of five documents takes seconds, not minutes.
   */
  'reshoot:run': async ({ docIds }) => {
    const stopKeepAlive = keepServiceWorkerAlive()
    try {
      const results = await reshootDocs(docIds, showProgress)
      return {
        ok: true,
        results: results.map((result) =>
          result.ok
            ? { ok: true as const, docId: result.docId, drift: result.drift }
            : { ok: false as const, docId: result.docId, reason: result.reason },
        ),
      }
    } finally {
      stopKeepAlive()
      clearBadge()
    }
  },

  'library:open': async () => {
    await chrome.tabs.create({ url: chrome.runtime.getURL(LIBRARY_PAGE) })
    return { ok: true }
  },

  /**
   * Fresh frame for the selection overlay: pressing Space scrolls the page and the
   * snapshot under the marquee goes stale. The window id comes from the sender —
   * asking the content script for it would mean taking the tab's word for it.
   */
  'capture:frame': async (_request, sender) => {
    const windowId = sender.tab?.windowId
    if (windowId === undefined) return { ok: false }
    return { ok: true, ...(await refreshFrame(windowId)) }
  },

  'capture:responsive': async ({ tabId }) => {
    try {
      await startResponsiveSeries(tabId)
      return { ok: true }
    } catch (error) {
      const reason = error instanceof CaptureFailure ? error.reason : 'capture-failed'
      if (reason === 'capture-failed') console.error('[kadr] series could not start', error)
      return { ok: false, error: reason }
    }
  },

  'capture:start': async ({ mode, tabId }) => {
    try {
      await startCapture(mode, tabId)
      return { ok: true }
    } catch (error) {
      const reason = error instanceof CaptureFailure ? error.reason : 'capture-failed'
      if (reason === 'capture-failed') console.error('[kadr] capture could not start', error)
      return { ok: false, error: reason }
    }
  },
})
