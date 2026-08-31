/**
 * The responsive series on real browser APIs.
 *
 * The capture schedule lives in `responsive.ts` and is covered by tests; this file is
 * only the wiring: window, tab, storage, document. Split for exactly that reason — the
 * schedule cannot be tested against the real `chrome.windows`.
 */
import {
  blobToBitmap,
  CAPTURE_INTERVAL_MS,
  CaptureFailure,
  makeThumbnail,
  RateLimiter,
} from '@/core/capture'
import { arrangeFrames } from '@/core/doc/arrange'
import { createDoc, domainOf, newImageId } from '@/core/doc'
import { addLayer, createLayer } from '@/core/doc/layers'
import type { DocId, ImageLayer } from '@/core/doc/types'
import { sendTabMessage } from '@/core/messaging'
import { putDoc, putImage } from '@/core/storage/db'

import type { CaptureTab } from './capture'
import { captureSeries, type Shot, type WindowState, widthsFrom } from './responsive'

/** Its own limiter: the series and a regular capture never run at the same time. */
const limiter = new RateLimiter(CAPTURE_INTERVAL_MS)

async function captureViewport(windowId: number) {
  await limiter.acquire()
  const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' })
  const blob = await (await fetch(dataUrl)).blob()
  const bitmap = await blobToBitmap(blob)
  const size = { width: bitmap.width, height: bitmap.height }
  bitmap.close()

  return { blob, ...size }
}

/**
 * Shoots the series into a single document: the first frame becomes the document's
 * shot, the rest become layers arranged in a row.
 *
 * One document, not three: a series is viewed side by side — that is how it is compared
 * and handed to a designer as one image. It can always be split back apart; the frames
 * remain separate objects.
 */
export async function runResponsiveSeries(
  tab: CaptureTab,
  widths?: readonly number[],
  onProgress?: (done: number, total: number) => void,
): Promise<DocId> {
  const list = widthsFrom(widths)

  const shots = await captureSeries(list, {
    windowBounds: async () => {
      const window = await chrome.windows.get(tab.windowId)
      if (!window.width) throw new CaptureFailure('capture-failed')
      return {
        width: window.width,
        height: window.height ?? 0,
        state: (window.state as WindowState | undefined) ?? 'normal',
      }
    },
    setWindowState: async (state) => {
      await chrome.windows.update(tab.windowId, { state })
    },
    resizeWindow: async (width) => {
      await chrome.windows.update(tab.windowId, { width: Math.round(width), state: 'normal' })
    },
    viewportWidth: async () => {
      const { metrics } = await sendTabMessage(tab.id, 'content:metrics', {})
      return metrics.viewportWidth
    },
    captureViewport: () => captureViewport(tab.windowId),
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    ...(onProgress ? { onProgress } : {}),
  })

  // The pre-shot measurement hides the scrollbar — putting it back is on us: the page
  // stays open and should not live with our style edits.
  await sendTabMessage(tab.id, 'content:restore', {}).catch(() => undefined)

  const first = shots[0]
  if (!first) throw new CaptureFailure('capture-failed')

  return saveSeries(tab, shots, first)
}

async function saveSeries(tab: CaptureTab, shots: readonly Shot[], first: Shot): Promise<DocId> {
  const now = Date.now()
  const source = { url: tab.url, title: tab.title, domain: domainOf(tab.url) }

  const stored = await Promise.all(
    shots.map(async (shot) => {
      const imageId = newImageId()
      await putImage({
        id: imageId,
        blob: shot.blob,
        width: shot.pixels.w,
        height: shot.pixels.h,
        dpr: 1,
        createdAt: now,
        source,
      })
      return { imageId, shot }
    }),
  )

  const bitmap = await blobToBitmap(first.blob)
  const thumbnail = await makeThumbnail(bitmap)
  bitmap.close()

  let doc = createDoc({
    imageId: stored[0]!.imageId,
    imageWidth: first.pixels.w,
    imageHeight: first.pixels.h,
    source,
    title: `${tab.title} · ${shots.map((shot) => shot.viewport).join(' / ')}`,
    now,
  })

  // Frames are stored at their pixel sizes: the layout will fit the canvas itself, and
  // pre-scaling them would throw away sharpness before the first edit.
  for (const { imageId, shot } of stored.slice(1)) {
    const layer = createLayer('image', {
      rect: { x: 0, y: 0, w: shot.pixels.w, h: shot.pixels.h },
    }) as ImageLayer

    doc = addLayer(doc, { ...layer, imageId, name: `${shot.viewport} px` })
  }

  doc = arrangeFrames(doc, 'row')

  await putDoc({ ...doc, domain: source.domain, text: null, thumbnail })
  return doc.id
}
