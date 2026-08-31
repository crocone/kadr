/**
 * Guide export.
 *
 * No new dependencies. Markdown is text plus an image folder via `chrome.downloads`:
 * the subfolder comes from the filename — there is no dedicated API for it, and none is
 * needed. PDF reuses the regular export writer, just one page per step. The long image
 * reuses the existing `arrangeFrames(doc, 'column')` layout.
 */
import { arrangeFrames } from '@/core/doc/arrange'
import { createDoc } from '@/core/doc/create'
import { newImageId } from '@/core/doc/ids'
import { createLayer } from '@/core/doc/layers'
import type { Doc, Layer } from '@/core/doc/types'
import { buildPdf, PAGE_SIZES, pageForImage } from '@/core/render/pdf'
import { canvasToPdfImage, saveBlob } from '@/core/render/export'
import { buildStepDoc } from '@/core/scribe/build'
import { resolveStyle, type ScribeStyle } from '@/core/scribe/style'
import type { ScribeSession, ScribeStep } from '@/core/scribe/timeline'
import { pageBreaks } from '@/core/scribe/timeline'
import { getImage, putImage } from '@/core/storage/db'

import { renderDocBlob, renderDocOffscreen } from './render'

export type GuideFormat = 'markdown' | 'pdf' | 'image'

/** Folder/file name: no slashes, edge dots, or anything else that breaks the download path. */
export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return slug || 'guide'
}

/** Zero-padded file number: otherwise step 10 sorts between 1 and 2 in the folder. */
function pad(index: number, total: number): string {
  return String(index).padStart(String(total).length, '0')
}

/**
 * The step document is rebuilt for export rather than taken from the library: the
 * style may have just changed, and the file must match what is on screen.
 */
async function docOf(step: ScribeStep, style?: ScribeStyle): Promise<Doc | null> {
  if (!step.imageId) return null
  const image = await getImage(step.imageId)
  if (!image) return null

  return buildStepDoc(
    step,
    {
      imageId: step.imageId,
      width: Math.round(image.width / image.dpr),
      height: Math.round(image.height / image.dpr),
    },
    resolveStyle(style),
  )
}

export type ExportProgress = (done: number, total: number) => void

/**
 * Guide frames are never exported wider than this.
 *
 * A 2688-CSS-px monitor at DPR 2 yields 5376 px and ~3 MB per step — ten steps become
 * 30 MB nobody can open or attach. 2560 px is plenty for reading UI and for print.
 */
const MAX_WIDTH = 2560

/** Render scale that keeps the document within the width limit. */
function scaleFor(doc: Doc): number {
  return Math.min(2, MAX_WIDTH / doc.canvas.w)
}

export type MarkdownStep = {
  index: number
  caption: string
  /** Image filename next to the document; `null` when the step has no frame. */
  image: string | null
  /** Page title, when the page changed at this step. */
  page: string | null
}

/** Captions may contain anything: asterisks, underscores, square brackets. */
function escapeMd(value: string): string {
  return value.replace(/([\\`*_[\]<>])/g, '\\$1')
}

/**
 * Guide markdown text.
 *
 * The markup is deliberately flat: a heading per step, the image as its own paragraph
 * at the left margin. Images used to sit inside numbered-list items with three-space
 * indentation — the most fragile construct markdown has: the required indent depends on
 * marker width ("10." needs four, not three), tabs and spaces count differently, and
 * every viewer treats lazy continuations its own way. The step number lives in the
 * heading, which also gives an outline.
 *
 * Pure function: the caller writes the files, and the markup is testable.
 */
export function guideMarkdown(title: string, steps: readonly MarkdownStep[]): string {
  const lines = [`# ${escapeMd(title)}`, '']

  for (const step of steps) {
    lines.push(`## ${step.index}. ${escapeMd(step.caption)}`, '')

    // Page transition marker: without it, steps from three different pages read as
    // one flow and the reader can't tell where they should be.
    if (step.page) lines.push(`_${escapeMd(step.page)}_`, '')

    // Non-empty alt on purpose: it is both the screen-reader caption and what the
    // reader sees if the image folder gets lost along the way.
    if (step.image) lines.push(`![${escapeMd(step.caption)}](${step.image})`, '')
  }

  return lines.join('\n')
}

/**
 * Markdown with images. File and folder share a name, so the unpacked guide reads and
 * edits like a normal document: `guide.md` next to its own image folder, not a pile of
 * nameless PNGs loose in the downloads directory.
 */
export async function exportMarkdown(
  session: ScribeSession,
  steps: readonly ScribeStep[],
  onProgress?: ExportProgress,
): Promise<void> {
  const folder = slugify(session.title)
  const breaks = pageBreaks(steps)
  const entries: MarkdownStep[] = []

  for (const [at, step] of steps.entries()) {
    onProgress?.(at, steps.length)

    const doc = await docOf(step, session.style)
    const name = doc ? `step-${pad(step.index, steps.length)}.png` : null
    if (doc && name) await saveBlob(await renderDocBlob(doc, scaleFor(doc)), `${folder}/${name}`)

    entries.push({
      index: step.index,
      caption: step.caption,
      image: name,
      page: breaks.has(step.id) ? step.title || step.url : null,
    })
  }

  const markdown = new Blob([guideMarkdown(session.title, entries)], { type: 'text/markdown' })
  await saveBlob(markdown, `${folder}/${folder}.md`)
  onProgress?.(steps.length, steps.length)
}

/** One page per step: the guide reads like a guide, not a cropped sheet. */
export async function exportPdf(
  session: ScribeSession,
  steps: readonly ScribeStep[],
  onProgress?: ExportProgress,
): Promise<void> {
  const pages = []

  for (const [at, step] of steps.entries()) {
    onProgress?.(at, steps.length)
    const doc = await docOf(step, session.style)
    if (!doc) continue
    pages.push(await canvasToPdfImage(await renderDocOffscreen(doc, scaleFor(doc))))
  }

  if (pages.length === 0) return

  // Page shaped like the frame, image centered: a screenshot is wider than tall, and
  // on portrait A4 it filled the top third, leaving two thirds blank on every page.
  const page = pageForImage(pages[0]!, PAGE_SIZES.a4)
  await saveBlob(buildPdf(pages, page, 'middle'), `${slugify(session.title)}.pdf`)
  onProgress?.(steps.length, steps.length)
}

/**
 * One long image: steps stacked as layers in a column.
 *
 * Built as a regular document with image layers rather than pixel-stitching, so the
 * sheet can later be opened in the editor and anything in it moved.
 */
export async function exportLongImage(
  session: ScribeSession,
  steps: readonly ScribeStep[],
  onProgress?: ExportProgress,
): Promise<void> {
  const layers: Layer[] = []
  let first: Doc | null = null
  let y = 0

  for (const [at, step] of steps.entries()) {
    onProgress?.(at, steps.length)
    const doc = await docOf(step, session.style)
    if (!doc) continue

    // Each step is rasterized whole — frame, number, caption — and placed as an image
    // layer. Otherwise every layer of every step would have to be moved into the
    // combined document with recalculated coordinates.
    const scale = scaleFor(doc)
    const blob = await renderDocBlob(doc, scale)
    const imageId = newImageId()
    // Physical size, scale in `dpr` — exactly like a captured frame.
    await putImage({
      id: imageId,
      blob,
      width: Math.round(doc.canvas.w * scale),
      height: Math.round(doc.canvas.h * scale),
      dpr: scale,
      createdAt: Date.now(),
      source: { url: step.url, title: step.title, domain: '' },
    })

    first ??= doc
    const layer = createLayer('image', {
      rect: { x: 0, y, w: doc.canvas.w, h: doc.canvas.h },
    })
    if (layer.kind === 'image') {
      layers.push({ ...layer, imageId, name: `Step ${step.index}`, decoration: null })
    }
    y += doc.canvas.h
  }

  if (!first || layers.length === 0) return

  const sheet: Doc = {
    ...createDoc({ imageId: '', imageWidth: first.canvas.w, imageHeight: 1 }),
    title: session.title,
    // The sheet has no frame of its own: all steps are equal image layers, and
    // `arrangeFrames` lays out exactly those.
    layers,
  }

  const arranged = arrangeFrames(sheet, 'column')
  await saveBlob(await renderDocBlob(arranged, 1), `${slugify(session.title)}.png`)
  onProgress?.(steps.length, steps.length)
}

export async function exportGuide(
  format: GuideFormat,
  session: ScribeSession,
  steps: readonly ScribeStep[],
  onProgress?: ExportProgress,
): Promise<void> {
  if (format === 'markdown') return await exportMarkdown(session, steps, onProgress)
  if (format === 'pdf') return await exportPdf(session, steps, onProgress)
  return await exportLongImage(session, steps, onProgress)
}
