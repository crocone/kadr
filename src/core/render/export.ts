/**
 * Document export.
 *
 * Draws the same scene as the preview, not a separate "export" renderer: for the
 * capture the stage temporarily switches to document scale and offset and renders
 * itself whole. That is the PLAN.md §8 promise — the file contains exactly what is on
 * screen; a second renderer would eventually drift from the first.
 */
import type Konva from 'konva'

import type { Doc } from '@/core/doc/types'

import { MAX_CANVAS_AREA, MAX_CANVAS_SIDE, MAX_CLIPBOARD_BYTES } from './limits'
import { buildPdf, PAGE_SIZES, type PageFormat, paginate, type PdfImage } from './pdf'

/**
 * Name of the stage's guide nodes. Export hides nodes with this name so safe-zone
 * guides don't end up in the file. Lives here, not in the editor: core doesn't know
 * about the editor.
 */
export const OVERLAY_NAME = 'kadr-overlay'

export type ExportFormat = 'png' | 'jpeg' | 'webp' | 'pdf'

export const EXPORT_FORMATS: readonly ExportFormat[] = ['png', 'jpeg', 'webp', 'pdf']

export type ExportOptions = {
  format: ExportFormat
  /** 0..1, for JPEG, WebP and images inside a PDF. */
  quality: number
  /** Multiplier on document size: 1 — as is, 2 — twice as large. */
  scale: number
  pageFormat?: PageFormat
}

const MIME: Record<Exclude<ExportFormat, 'pdf'>, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
}

export const EXTENSION: Record<ExportFormat, string> = {
  png: 'png',
  jpeg: 'jpg',
  webp: 'webp',
  pdf: 'pdf',
}

/** How much the document can still be scaled up before hitting the canvas limits. */
export function maxExportScale(doc: Doc, hardLimit = 4): number {
  const { w, h } = doc.canvas
  if (w <= 0 || h <= 0) return 1
  const byArea = Math.sqrt(MAX_CANVAS_AREA / (w * h))
  const bySide = Math.min(MAX_CANVAS_SIDE / w, MAX_CANVAS_SIDE / h)
  return Math.max(0.1, Math.min(byArea, bySide, hardLimit))
}

/**
 * For the capture the stage switches to document coordinates: scale 1, zero offset,
 * canvas size. State is restored in finally — otherwise a failed export would leave
 * the user with a displaced view.
 */
async function asDocumentView<T>(
  stage: Konva.Stage,
  doc: Doc,
  action: () => Promise<T>,
): Promise<T> {
  const saved = {
    x: stage.x(),
    y: stage.y(),
    scaleX: stage.scaleX(),
    scaleY: stage.scaleY(),
    width: stage.width(),
    height: stage.height(),
  }

  // Guides are an on-screen hint; they have no business in the file.
  const overlays = stage.find(`.${OVERLAY_NAME}`).filter((node) => node.visible())

  stage.position({ x: 0, y: 0 })
  stage.scale({ x: 1, y: 1 })
  stage.size({ width: doc.canvas.w, height: doc.canvas.h })
  for (const overlay of overlays) overlay.visible(false)
  stage.draw()

  try {
    return await action()
  } finally {
    stage.position({ x: saved.x, y: saved.y })
    stage.scale({ x: saved.scaleX, y: saved.scaleY })
    stage.size({ width: saved.width, height: saved.height })
    for (const overlay of overlays) overlay.visible(true)
    stage.draw()
  }
}

export async function renderDocument(
  stage: Konva.Stage,
  doc: Doc,
  scale: number,
): Promise<HTMLCanvasElement> {
  const pixelRatio = Math.min(scale, maxExportScale(doc))
  return asDocumentView(stage, doc, () => Promise.resolve(stage.toCanvas({ pixelRatio })))
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error(`Canvas produced no ${mime} blob`))
      },
      mime,
      quality,
    )
  })
}

/** One PDF page: a slice of the frame compressed to JPEG, which PDF embeds without re-encoding. */
async function sliceToJpeg(
  source: HTMLCanvasElement,
  y: number,
  height: number,
  quality: number,
): Promise<PdfImage> {
  const canvas = document.createElement('canvas')
  canvas.width = source.width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('2d context unavailable')

  // White backdrop: JPEG has no alpha, and a transparent background would turn black.
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(source, 0, y, source.width, height, 0, 0, source.width, height)

  const blob = await canvasToBlob(canvas, 'image/jpeg', quality)
  return {
    jpeg: new Uint8Array(await blob.arrayBuffer()),
    width: canvas.width,
    height: canvas.height,
  }
}

/**
 * The whole canvas as a single PDF page. Needed for the guide export: there a page is
 * a step, not a slice of one long capture, and paginating it would be exactly wrong.
 */
export async function canvasToPdfImage(
  canvas: HTMLCanvasElement,
  quality = 0.92,
): Promise<PdfImage> {
  return await sliceToJpeg(canvas, 0, canvas.height, quality)
}

export async function exportDocument(
  stage: Konva.Stage,
  doc: Doc,
  options: ExportOptions,
): Promise<Blob> {
  const canvas = await renderDocument(stage, doc, options.scale)

  if (options.format !== 'pdf') {
    return canvasToBlob(canvas, MIME[options.format], options.quality)
  }

  const page = PAGE_SIZES[options.pageFormat ?? 'a4']
  const slices = paginate(canvas.width, canvas.height, page)
  const images: PdfImage[] = []
  for (const slice of slices) {
    images.push(await sliceToJpeg(canvas, slice.y, slice.height, options.quality))
  }
  return buildPdf(images, page)
}

/**
 * Saves via chrome.downloads: the extension already holds that permission, and the
 * browser handles the downloads folder and name conflicts itself.
 */
export async function saveBlob(blob: Blob, filename: string): Promise<void> {
  const url = URL.createObjectURL(blob)
  try {
    await chrome.downloads.download({ url, filename, saveAs: false })
  } finally {
    // The URL can't be revoked immediately: the download reads it asynchronously.
    setTimeout(() => {
      URL.revokeObjectURL(url)
    }, 60_000)
  }
}

/** The clipboard gets PNG: browsers handle other formats there unpredictably. */
/** Frame too heavy for the clipboard. Its own type: the UI needs a dedicated message. */
export class ClipboardTooLarge extends Error {
  constructor(readonly bytes: number) {
    super(`the image is ${Math.round(bytes / 1024 / 1024)} MB, too much for the clipboard`)
    this.name = 'ClipboardTooLarge'
  }
}

export async function copyImage(blob: Blob): Promise<void> {
  if (blob.size > MAX_CLIPBOARD_BYTES) throw new ClipboardTooLarge(blob.size)
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
}
