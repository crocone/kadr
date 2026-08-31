/**
 * Capture orchestration. Every "how many frames and what to do with them" decision is
 * made here; core/capture assembles the pixels, the content script prepares the page.
 *
 * The MV3 service worker can be suspended, so results go straight to IndexedDB and the
 * editor tab is opened by document id (PLAN.md §8).
 */
import {
  CAPTURE_INTERVAL_MS,
  CaptureFailure,
  clampRect,
  createChunkSink,
  cropBitmap,
  centreScrollY,
  cssRectToDeviceRect,
  dataUrlToBitmap,
  downscaleRegion,
  elementCaptureStrategy,
  isQuotaError,
  makeThumbnail,
  type PageMetrics,
  pageRectToViewportRect,
  RateLimiter,
  runRolling,
  SCROLLBAR_TRIM,
  signatureOf,
  stepFor,
  stitchFullPage,
  THUMB_WIDTH,
} from '@/core/capture'
import type { CaptureRecipe } from '@/core/capture/recipe'
import { createDoc, domainOf, newImageId } from '@/core/doc'
import type { DocId, Rect } from '@/core/doc/types'
import { translate } from '@/core/i18n'
import type { ElementRef } from '@/core/dom/selector'
import type { Locale, MessageKey } from '@/core/i18n'
import {
  type CaptureMode,
  type SelectionAction,
  sendTabMessage,
  type TableCopy,
} from '@/core/messaging'
import { buildFilename } from '@/core/render/filename'
import { MAX_CANVAS_AREA, MAX_CANVAS_SIDE } from '@/core/render/limits'
import { putDoc, putImage } from '@/core/storage/db'
import { readSettings } from '@/core/storage/settings'

import { clearBadge, showBusy, showError, showProgress } from './badge'
import { downloadBlob } from './deliver'
import { keepServiceWorkerAlive } from './keep-alive'
import { isCapturableUrl } from './pages'

const limiter = new RateLimiter(CAPTURE_INTERVAL_MS)

export type CaptureTab = { id: number; windowId: number; url: string; title: string }

/**
 * Where the selection comes from: ask the user via an overlay, or take it from a recipe.
 *
 * Before this fork every mode called its own overlay, and retaking the same shot
 * without a human was impossible. Now the choice is a parameter and the capture path is
 * shared: click-driven and recipe-driven runs use the same code and cannot drift apart.
 */
export type Choice = { source: 'interactive' } | { source: 'recipe'; recipe: CaptureRecipe }

const INTERACTIVE: Choice = { source: 'interactive' }

export type Capture = {
  blob: Blob
  width: number
  height: number
  dpr: number
  title?: string
  /** Where the result goes: picked with a button on the overlay panel. */
  action?: SelectionAction
  /** Whether the copy reached the clipboard: the overlay writes it, the background only reports failure. */
  copied?: boolean
  /** What to tell the user about the outcome: truncated at the canvas limit, did not scroll, … */
  note?: MessageKey
  /**
   * Recipe parts only the mode itself knows: what was selected and where it scrolled.
   * The rest — URL, viewport width, DPR, delay — is filled in by `runCapture`, which
   * has all of that at hand anyway.
   */
  element?: ElementRef
  area?: Rect
}

/**
 * Picking an element may yield a table on the clipboard instead of a frame. A separate
 * type rather than a field on `Capture`: a table has no blob and no dimensions, and has
 * no business pretending to be a shot.
 */
type TableResult = { table: TableCopy }

type CaptureResult = Capture | TableResult

function isTable(result: CaptureResult): result is TableResult {
  return 'table' in result
}

/**
 * What the capture produced: the editor opens only for "Edit".
 *
 * There may be no document at all: a table goes to the clipboard as text and there is
 * no shot to put in the library. Hence `docId` is explicitly nullable, not "probably there".
 */
export type CaptureOutcome =
  | {
      docId: DocId
      action: SelectionAction
      copied?: boolean
      /** Capture succeeded with a caveat, shown on the action-icon badge. */
      note?: MessageKey
    }
  | { docId: null; action: 'copy'; copied: boolean; table: TableCopy }

/** The only place captureVisibleTab is called: the rate limit lives in one spot. */
async function captureVisibleDataUrl(windowId: number): Promise<string> {
  await limiter.acquire()
  try {
    return await chrome.tabs.captureVisibleTab(windowId, { format: 'png' })
  } catch (error) {
    if (!isQuotaError(error)) throw error
    // Another caller may have used up the quota — wait a full interval and retry once.
    await new Promise((resolve) => setTimeout(resolve, CAPTURE_INTERVAL_MS))
    return await chrome.tabs.captureVisibleTab(windowId, { format: 'png' })
  }
}

async function captureVisibleFrame(windowId: number): Promise<ImageBitmap> {
  return dataUrlToBitmap(await captureVisibleDataUrl(windowId))
}

/**
 * Frames shown to the selection overlay. Pressing Space scrolls the page, the overlay
 * asks for a fresh shot — and its reply carries the id of the frame the marquee was
 * finally drawn on. Sending the multi-megabyte data URL back would cost twice as much.
 *
 * No point keeping more than two: each weighs megabytes and only the latest matters.
 */
let frameSeq = 0
const frames = new Map<number, string>()

export async function refreshFrame(
  windowId: number,
): Promise<{ frameUrl: string; frameId: number }> {
  const frameUrl = await captureVisibleDataUrl(windowId)
  const frameId = (frameSeq += 1)
  frames.set(frameId, frameUrl)
  for (const id of frames.keys()) if (id < frameId - 1) frames.delete(id)
  return { frameUrl, frameId }
}

async function bitmapToCapture(bitmap: ImageBitmap, dpr: number): Promise<Capture> {
  const blob = await cropBitmap(bitmap, { x: 0, y: 0, w: bitmap.width, h: bitmap.height })
  const capture = { blob, width: bitmap.width, height: bitmap.height, dpr }
  bitmap.close()
  return capture
}

/**
 * One frame of the tab's visible part. Exported for Scribe: the two-frames-per-second
 * limiter must be shared by the whole extension, and it lives here.
 */
export async function captureTabFrame(
  windowId: number,
  dpr: number,
): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await captureVisibleFrame(windowId)
  const { blob, width, height } = await bitmapToCapture(bitmap, dpr)
  return { blob, width, height }
}

async function captureVisible(tab: CaptureTab, metrics: PageMetrics): Promise<Capture> {
  const bitmap = await captureVisibleFrame(tab.windowId)
  return bitmapToCapture(bitmap, metrics.devicePixelRatio)
}

/**
 * Area selection works on a frozen frame: the overlay shows already-captured pixels, so
 * the crop matches the marquee exactly and the magnifier shows what ends up in the file.
 */
async function captureArea(
  tab: CaptureTab,
  metrics: PageMetrics,
  choice: Choice,
): Promise<Capture> {
  // In a recipe nobody drives the marquee: the area is stored in page coordinates and
  // captured just like an element — scroll to it and crop, or stitch the whole page.
  if (choice.source === 'recipe') {
    const area = choice.recipe.area
    if (!area) throw new CaptureFailure('capture-failed')
    return { ...(await captureElementRect(tab, metrics, area)), area }
  }

  const first = await refreshFrame(tab.windowId)
  try {
    const selection = await sendTabMessage(tab.id, 'content:selectArea', {
      frameUrl: first.frameUrl,
      frameId: first.frameId,
      devicePixelRatio: metrics.devicePixelRatio,
    })
    if (!selection.ok) throw new CaptureFailure('cancelled')

    // Alt in the overlay selects the whole element: it may not fit the viewport, so the
    // element strategy takes over instead of cropping the frame. The page must be frozen
    // first — areas shoot the live page, elements are stitched from several frames.
    if (selection.scope === 'page') {
      const prepared = await sendTabMessage(tab.id, 'content:prepare', {})
      return await captureElementRect(tab, prepared.metrics, selection.rect, selection.label)
    }

    // Use the frame the marquee was drawn on: scrolling with Space replaces it.
    const frameUrl = frames.get(selection.frameId ?? first.frameId) ?? first.frameUrl
    const bitmap = await dataUrlToBitmap(frameUrl)
    const rect = clampRect(
      cssRectToDeviceRect(selection.rect, metrics.devicePixelRatio),
      bitmap.width,
      bitmap.height,
    )
    const blob = await cropBitmap(bitmap, rect)
    bitmap.close()

    return {
      blob,
      width: rect.w,
      height: rect.h,
      dpr: metrics.devicePixelRatio,
      action: selection.action ?? 'edit',
      ...(selection.copied === undefined ? {} : { copied: selection.copied }),
      // The marquee was drawn in viewport coordinates, but the recipe needs page
      // coordinates: without the scroll offset a reshoot would capture the same screen
      // band no matter where the text is. Use the scroll at selection time, not at
      // metrics time: Space scrolls the page after the metrics were taken.
      area: {
        ...selection.rect,
        x: selection.rect.x + (selection.scroll?.x ?? metrics.scrollX),
        y: selection.rect.y + (selection.scroll?.y ?? metrics.scrollY),
      },
    }
  } finally {
    // Frames weigh megabytes and are useless once selection is over — including an Esc
    // cancel, after which the service worker lives on for a while.
    frames.clear()
  }
}

/**
 * The element arrives in page coordinates. If it fits the viewport — scroll to it and
 * take one frame; if not — stitch the whole page and crop it out.
 *
 * Sticky elements are deliberately not hidden here: the user may have picked the header itself.
 */
async function captureElement(
  tab: CaptureTab,
  metrics: PageMetrics,
  choice: Choice,
): Promise<CaptureResult> {
  if (choice.source === 'recipe') {
    const ref = choice.recipe.element
    if (!ref) throw new CaptureFailure('capture-failed')

    const found = await sendTabMessage(tab.id, 'content:findElement', { ref })
    // Not found means saying so. Capturing "something similar" would silently swap a
    // frame in the docs, and only the reader would notice — not the person reshooting.
    if (!found.ok) throw new CaptureFailure('element-not-found')

    return { ...(await captureElementRect(tab, metrics, found.rect)), element: ref }
  }

  const selection = await sendTabMessage(tab.id, 'content:selectElement', {})
  if (!selection.ok) throw new CaptureFailure('cancelled')

  // A table was under the cursor and the user picked a format: there is no frame at all.
  if (selection.table) return { table: selection.table }

  return {
    ...(await captureElementRect(tab, metrics, selection.rect, selection.label)),
    ...(selection.element ? { element: selection.element } : {}),
  }
}

/** Shared body for both element-capture entry points: element mode and Alt in area mode. */
async function captureElementRect(
  tab: CaptureTab,
  metrics: PageMetrics,
  pageRect: Rect,
  label?: string,
): Promise<Capture> {
  const cropFrom = async (bitmap: ImageBitmap, rectInFrame: typeof pageRect): Promise<Capture> => {
    const rect = clampRect(
      cssRectToDeviceRect(rectInFrame, metrics.devicePixelRatio),
      bitmap.width,
      bitmap.height,
    )
    const blob = await cropBitmap(bitmap, rect)
    bitmap.close()
    return {
      blob,
      width: rect.w,
      height: rect.h,
      dpr: metrics.devicePixelRatio,
      ...(label ? { title: label } : {}),
    }
  }

  if (elementCaptureStrategy(pageRect, metrics) === 'single-frame') {
    const { scrollY } = await sendTabMessage(tab.id, 'content:scrollTo', {
      y: centreScrollY(pageRect, metrics),
    })

    const bitmap = await captureVisibleFrame(tab.windowId)
    return cropFrom(bitmap, pageRectToViewportRect(pageRect, metrics.scrollX, scrollY))
  }

  const full = await captureFullPage(tab, metrics)
  return cropFrom(await createImageBitmap(full.blob), pageRect)
}

/**
 * Worst-case number of consecutive frames. At 550 ms per frame that is about two
 * minutes: nobody watches an auto-scrolling chat longer than that, and an infinite
 * feed is infinite literally.
 */
const MAX_ROLL_FRAMES = 240

/**
 * Margin, in CSS pixels, from the edge where new content arrives.
 *
 * Right at the edge the feed is usually still rendering: images have only started
 * loading and a virtualized list shows a placeholder. The band is cut slightly higher,
 * so those rows enter a frame one step later — fully rendered.
 */
const EDGE_MARGIN_PX = 48

/**
 * Scrolling capture: frames are stitched by content, not by scroll position (PLAN.md §3).
 *
 * The key difference from `fullPage`: there a plan is computed from the page height,
 * here there is no height at all. A virtualized list does not say how many rows it has
 * and an infinite feed keeps adding them, so the session just scrolls and watches what
 * changed until it hits the bottom, the canvas limit, or "Stop".
 */
async function captureScroll(tab: CaptureTab, metrics: PageMetrics): Promise<Capture> {
  const target = await sendTabMessage(tab.id, 'content:selectScrollTarget', {})
  if (!target.ok) throw new CaptureFailure('cancelled')

  const dpr = metrics.devicePixelRatio
  const frameSize = {
    w: Math.round(metrics.viewportWidth * dpr),
    h: Math.round(metrics.viewportHeight * dpr),
  }
  const crop = clampRect(cssRectToDeviceRect(target.rect, dpr), frameSize.w, frameSize.h)

  // The inner container's scrollbar is already trimmed from the capture area, but
  // overlay scrollbars have zero width and nothing to trim: the right edge is always
  // excluded from the matching area — the thumb moves in every frame and votes against
  // any shift.
  const matchRect = { ...crop, w: Math.max(1, crop.w - Math.round(SCROLLBAR_TRIM)) }

  const sink = createChunkSink(crop, target.direction)
  let shown = { frames: 1, rows: 0 }
  let note: MessageKey | undefined
  let at = target.scrollTop
  /** Whether the container ever moved: decides what to say about a failure. */
  let everMoved = false

  try {
    const result = await runRolling<ImageBitmap>(
      {
        captureFrame: () => captureVisibleFrame(tab.windowId),
        signature: (frame) => signatureOf(downscaleRegion(frame, matchRect, THUMB_WIDTH)),
        scrollTo: async (top) => {
          const before = at
          const step = await sendTabMessage(tab.id, 'content:rollStep', { top, ...shown })
          at = step.scrollTop
          if (step.scrollTop !== before) everMoved = true
          return { scrollTop: step.scrollTop, stopped: step.stopped }
        },
        switchTarget: async () => {
          return await sendTabMessage(tab.id, 'content:rollNextTarget', {})
        },
        release: (frame) => {
          frame.close()
        },
        onProgress: (frames, rows) => {
          shown = { frames, rows }
          showBusy(String(frames))
        },
      },
      {
        push: (frame, from, to) => {
          sink.push(frame, from, to)
        },
      },
      {
        direction: target.direction,
        frameHeight: crop.h,
        step: stepFor(target.viewportHeight),
        startTop: target.scrollTop,
        devicePixelRatio: dpr,
        maxRows: Math.min(MAX_CANVAS_SIDE, Math.floor(MAX_CANVAS_AREA / crop.w)),
        maxFrames: MAX_ROLL_FRAMES,
        edgeMargin: Math.round(EDGE_MARGIN_PX * dpr),
      },
    )

    // A single frame is a failure with two distinct causes. The container never moved —
    // the user scrolled the wrong thing. It moved but the frames came out identical —
    // the tab was not repainting: Chrome does not paint a minimized or covered page,
    // and the shot comes back unchanged.
    if (result.stoppedBy === 'limit') note = 'capture.truncated'
    else if (result.frames === 1) note = everMoved ? 'capture.notRepainted' : 'capture.notScrolled'

    if (result.seams > 0) {
      console.warn(`[kadr] rolling capture: ${result.seams} frames joined by scroll delta`)
    }
  } finally {
    // The overlay is removed before the last frame: an uncaptured band sat under the
    // HUD, and it can only be shot once the HUD is gone from the page.
    await sendTabMessage(tab.id, 'content:rollDone', {}).catch(() => undefined)
  }

  await appendHudBand(
    tab,
    sink,
    crop,
    Math.round(target.hudBand * dpr),
    target.direction,
    frameSize,
  )
  return { ...(await bitmapToCapture(sink.compose(), dpr)), ...(note ? { note } : {}) }
}

/**
 * The band the HUD covered for the whole capture. It arrives last and so lands at the
 * edge the scroll was heading to: down — at the very bottom of the sheet, up — at the
 * very top ("up" bands are laid out in reverse order).
 */
async function appendHudBand(
  tab: CaptureTab,
  sink: { push: (frame: ImageBitmap, from: number, to: number) => void },
  crop: Rect,
  band: number,
  direction: 'down' | 'up',
  frame: { w: number; h: number },
): Promise<void> {
  const room = direction === 'down' ? frame.h - (crop.y + crop.h) : crop.y
  const take = Math.min(band, room)
  if (take <= 0) return

  const tail = await captureVisibleFrame(tab.windowId)
  // The band sits flush against the capture area but outside it: the sink counts rows
  // from the area's edge, so "up" rows go negative.
  if (direction === 'down') sink.push(tail, crop.h, crop.h + take)
  else sink.push(tail, -take, 0)
  tail.close()
}

async function captureFullPage(tab: CaptureTab, initial: PageMetrics): Promise<Capture> {
  showBusy('...')

  // Warming up lazy images changes the page height, so re-read the metrics.
  const warmed = await sendTabMessage(tab.id, 'content:warmLazyImages', {})
  const metrics = warmed.metrics ?? initial

  const { bitmap, plan } = await stitchFullPage(metrics, {
    scrollTo: async (y) => (await sendTabMessage(tab.id, 'content:scrollTo', { y })).scrollY,
    captureFrame: () => captureVisibleFrame(tab.windowId),
    setFixedHidden: async (hidden) => {
      await sendTabMessage(tab.id, 'content:setFixedHidden', { hidden })
    },
    onProgress: showProgress,
  })

  if (plan.truncated) console.warn('[kadr] page taller than the canvas limit, bottom trimmed')

  return {
    ...(await bitmapToCapture(bitmap, metrics.devicePixelRatio)),
    ...(plan.truncated ? { note: 'capture.truncated' as const } : {}),
  }
}

const CAPTURERS: Record<
  CaptureMode,
  (tab: CaptureTab, metrics: PageMetrics, choice: Choice) => Promise<CaptureResult>
> = {
  visible: captureVisible,
  area: captureArea,
  element: captureElement,
  fullPage: captureFullPage,
  scroll: captureScroll,
}

/** Modes that need a frozen page: animations, smooth scrolling, parallax. */
const NEEDS_FROZEN_PAGE: Record<CaptureMode, boolean> = {
  visible: false,
  area: false,
  element: true,
  fullPage: true,
  // A frozen page is half the matching battle: with animations running, neighbouring
  // frames diverge on their own and there is nothing left to match.
  scroll: true,
}

/**
 * Capture without saving: prepare the page, shoot, restore the page.
 *
 * Split from `runCapture` for the sake of reshooting: it already has a document, and
 * creating a second one just to throw it away would be odd. It also makes visible that
 * the click path and the recipe path differ by exactly one parameter.
 */
async function shoot(
  mode: CaptureMode,
  tab: CaptureTab,
  choice: Choice,
  delaySec: number,
): Promise<{ result: CaptureResult; metrics: PageMetrics }> {
  try {
    // The countdown is for the user: time to open a menu or hover the cursor. A reshoot
    // has nothing and nobody to wait for; it has its own settle delay.
    if (choice.source === 'interactive' && delaySec > 0) {
      await sendTabMessage(tab.id, 'content:countdown', { seconds: delaySec })
    }

    const prepared = NEEDS_FROZEN_PAGE[mode]
      ? await sendTabMessage(tab.id, 'content:prepare', {})
      : await sendTabMessage(tab.id, 'content:metrics', {})

    return {
      result: await CAPTURERS[mode](tab, prepared.metrics, choice),
      metrics: prepared.metrics,
    }
  } finally {
    // Alt in area mode escalates to the element strategy and freezes the page mid-run,
    // so restore is always called: on an unprepared page it is a no-op.
    await sendTabMessage(tab.id, 'content:restore', {}).catch(() => undefined)
  }
}

/**
 * Repeat a capture from a recipe. The frame is returned as is: the reshoot decides
 * where it goes — it has the document at hand and does not need a new one.
 */
export async function captureByRecipe(tab: CaptureTab, recipe: CaptureRecipe): Promise<Capture> {
  const { result } = await shoot(recipe.mode, tab, { source: 'recipe', recipe }, 0)
  // A table can only come from the overlay, and reshoots never show one.
  if (isTable(result)) throw new CaptureFailure('capture-failed')
  return result
}

export async function runCapture(
  mode: CaptureMode,
  tab: CaptureTab,
  choice: Choice = INTERACTIVE,
): Promise<CaptureOutcome> {
  const settings = await readSettings()
  const stopKeepAlive = keepServiceWorkerAlive()

  try {
    const { result, metrics } = await shoot(mode, tab, choice, settings.captureDelaySec)

    // The table went to the clipboard as text: no shot, nothing to put in the library.
    if (isTable(result)) {
      return { docId: null, action: 'copy', copied: result.table.copied, table: result.table }
    }

    const capture = result
    const action = capture.action ?? 'edit'

    if (action === 'download') {
      await downloadBlob(
        capture.blob,
        buildFilename(
          settings.filenameTemplate,
          { domain: domainOf(tab.url), title: capture.title ?? tab.title, date: new Date() },
          'png',
        ),
      )
    }

    // The document is saved regardless: copy and download must show up in "Recent" too,
    // otherwise the shot vanishes without a trace.
    return {
      docId: await saveCapture(
        capture,
        tab,
        recipeOf(mode, tab, metrics, capture, settings.captureDelaySec),
      ),
      action,
      ...(capture.copied === undefined ? {} : { copied: capture.copied }),
      ...(capture.note ? { note: capture.note } : {}),
    }
  } finally {
    stopKeepAlive()
    clearBadge()
  }
}

/**
 * The recipe is assembled here, not in each mode: `runCapture` knows the URL, viewport
 * width, DPR and delay; a mode adds only what the user chose.
 *
 * It is written on every capture, even when there is obviously nothing to reshoot:
 * there is no telling in advance which shot will need updating a month from now, and a
 * recipe costs a couple hundred bytes next to a megabyte of image.
 */
function recipeOf(
  mode: CaptureMode,
  tab: CaptureTab,
  metrics: PageMetrics,
  capture: Capture,
  delaySec: number,
): CaptureRecipe {
  return {
    mode,
    url: tab.url,
    element: capture.element ?? null,
    area: capture.area ?? null,
    viewportWidth: metrics.viewportWidth,
    viewportHeight: metrics.viewportHeight,
    devicePixelRatio: metrics.devicePixelRatio,
    delayMs: Math.round(delaySec * 1000),
    direction: null,
    capturedAt: Date.now(),
  }
}

async function saveCapture(
  capture: Capture,
  tab: CaptureTab,
  recipe: CaptureRecipe,
): Promise<DocId> {
  const bitmap = await createImageBitmap(capture.blob)
  const thumbnail = await makeThumbnail(bitmap)
  bitmap.close()

  const imageId = newImageId()
  const source = { url: tab.url, title: tab.title, domain: domainOf(tab.url) }
  const now = Date.now()

  await putImage({
    id: imageId,
    blob: capture.blob,
    width: capture.width,
    height: capture.height,
    dpr: capture.dpr,
    createdAt: now,
    source,
  })

  // The document lives in CSS pixels, the frame in physical ones: export delivers full
  // resolution via pixelRatio, and the preview is not doubled on a retina screen.
  const doc = createDoc({
    imageId,
    imageWidth: Math.round(capture.width / capture.dpr),
    imageHeight: Math.round(capture.height / capture.dpr),
    source,
    title: capture.title ?? tab.title,
    now,
  })

  await putDoc({ ...doc, recipe, domain: source.domain, text: null, thumbnail })
  return doc.id
}

export async function resolveTab(tabId?: number): Promise<CaptureTab> {
  const tab = tabId
    ? await chrome.tabs.get(tabId)
    : (await chrome.tabs.query({ active: true, currentWindow: true }))[0]

  if (!tab?.id) throw new CaptureFailure('no-active-tab')
  if (!isCapturableUrl(tab.url)) throw new CaptureFailure('unsupported-page')

  return { id: tab.id, windowId: tab.windowId, url: tab.url ?? '', title: tab.title ?? '' }
}

/** Cancellation is not an error: the user pressed Esc, no need for a red badge. */
export function reportFailure(error: unknown, locale: Locale): void {
  if (error instanceof CaptureFailure && error.reason === 'cancelled') {
    clearBadge()
    return
  }
  const reason = error instanceof CaptureFailure ? error.reason : 'capture-failed'
  console.error('[kadr] capture failed', error)
  showError(translate(locale, `capture.error.${reason}`))
}
