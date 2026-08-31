import { DEFAULT_CANVAS, DEFAULT_CAPTURE } from './defaults'
import { newDocId } from './ids'
import type { Doc, ImageId } from './types'

export type CreateDocInput = {
  imageId: ImageId
  imageWidth: number
  imageHeight: number
  source?: Doc['source']
  title?: string
  now?: number
}

/** Domain for the library index and file names; empty string for internal URLs. */
export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

export function createDoc(input: CreateDocInput): Doc {
  const now = input.now ?? Date.now()
  const padding = DEFAULT_CANVAS.padding
  const source = input.source ?? null

  return {
    version: 1,
    id: newDocId(),
    title: input.title ?? source?.title ?? 'Untitled',
    createdAt: now,
    updatedAt: now,
    source,
    tags: [],
    canvas: {
      ...DEFAULT_CANVAS,
      w: input.imageWidth + padding * 2,
      h: input.imageHeight + padding * 2,
    },
    capture: {
      ...DEFAULT_CAPTURE,
      imageId: input.imageId,
      width: input.imageWidth,
      height: input.imageHeight,
    },
    layers: [],
  }
}

/**
 * Documents captured before the explicit capture size existed don't have one.
 * Recover it from the canvas: back then the capture filled everything but the padding.
 */
export function migrateDoc(doc: Doc): Doc {
  const sized =
    doc.capture.width > 0 && doc.capture.height > 0
      ? doc.capture
      : {
          ...doc.capture,
          width: Math.max(1, doc.canvas.w - doc.canvas.padding * 2),
          height: Math.max(1, doc.canvas.h - doc.canvas.padding * 2),
        }

  // Capture visibility came later: old documents obviously have it shown.
  const capture = typeof sized.visible === 'boolean' ? sized : { ...sized, visible: true }
  return capture === doc.capture ? doc : { ...doc, capture }
}
