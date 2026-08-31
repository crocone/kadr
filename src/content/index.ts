/**
 * Content script: selection overlays, page metrics, scroll control.
 * Injected on demand under `activeTab` — declarative content_scripts would require
 * host permissions at install time (PLAN.md §8).
 */
import { registerMessageHandlers } from '@/core/messaging'

import { loadLocale } from './i18n'
import { locateElement } from './locate'
import { selectArea } from './overlay/area'
import { runCountdown } from './overlay/countdown'
import { selectElement } from './overlay/element'
import { endRolling, nextRollTarget, rollStep, selectScrollTarget } from './overlay/scroll-target'
import { beginRecording, endRecording } from './scribe/record'
import {
  hideScrollbars,
  preparePage,
  readPageMetrics,
  restorePage,
  scrollToY,
  setFixedHidden,
  warmLazyImages,
} from './page-prep'

declare global {
  interface Window {
    __kadrContentReady?: true
  }
}

export type { PageMetrics } from '@/core/capture/types'

if (!window.__kadrContentReady) {
  window.__kadrContentReady = true
  void loadLocale()

  registerMessageHandlers({
    ping: () => ({ ok: true, from: 'content' }),

    // Hide the scrollbar on every measurement: it never belongs in a frame,
    // whereas freezing the page is only needed for some modes.
    'content:metrics': async () => {
      await hideScrollbars()
      return { ok: true, metrics: readPageMetrics() }
    },

    'content:prepare': async () => ({ ok: true, metrics: await preparePage() }),

    'content:restore': async () => {
      await restorePage()
      return { ok: true }
    },

    'content:scrollTo': async ({ y }) => ({ ok: true, scrollY: await scrollToY(y) }),

    'content:setFixedHidden': async ({ hidden }) => {
      await setFixedHidden(hidden)
      return { ok: true }
    },

    'content:warmLazyImages': async () => ({ ok: true, metrics: await warmLazyImages() }),

    'content:countdown': async ({ seconds }) => {
      await runCountdown(seconds)
      return { ok: true }
    },

    'content:selectArea': ({ frameUrl, frameId, devicePixelRatio }) =>
      selectArea(frameUrl, frameId, devicePixelRatio),

    'content:selectElement': () => selectElement(),

    'content:findElement': ({ ref }) => locateElement(ref),

    'content:selectScrollTarget': () => selectScrollTarget(),

    'content:rollStep': async ({ top, frames, rows }) => ({
      ok: true,
      ...(await rollStep(top, frames, rows)),
    }),

    'content:rollNextTarget': () => nextRollTarget(),

    'content:scribeBegin': ({ steps, dropped }) => {
      beginRecording(steps, dropped)
      return { ok: true }
    },

    'content:scribeEnd': () => {
      endRecording()
      return { ok: true }
    },

    'content:rollDone': async () => {
      await endRolling()
      return { ok: true }
    },
  })
}
