/**
 * Builds a step into a regular document (PLAN.md §6.5).
 *
 * No new layer kinds: the element outline is a `shape`, the number a `badge`, the
 * caption a `text`. The editor already knows how to move, recolor, and export all of
 * these, so a built step opens like any other screenshot. A parallel model for guides
 * would mean a second editor and a second export path.
 *
 * The module is pure: step + frame dimensions in, document out. It never touches the
 * image DB — that's the caller's job.
 */
import { frameRect } from '@/core/doc/canvas-presets'
import { createDoc } from '@/core/doc/create'
import { createLayer } from '@/core/doc/layers'
import type { Doc, Layer, Point, Rect } from '@/core/doc/types'

import { DEFAULT_SCRIBE_STYLE, resolveStyle, type ScribeStyle } from './style'
import type { ScribeStep } from './timeline'

/**
 * Caption band height. Derived from the font size rather than fixed: a fixed band
 * would clip large captions and leave dead space under small ones.
 */
function captionBand(style: ScribeStyle): number {
  return Math.round(style.caption ? style.captionSize * 2.6 : 0)
}

export type StepImage = {
  imageId: string
  /** Frame size in CSS pixels: physical size divided by DPR, same as at capture time. */
  width: number
  height: number
}

/**
 * Outline around the step's element.
 *
 * The rect is in viewport coordinates and the frame was captured from that same
 * viewport, so no conversion is needed — just shift by the canvas offset. Grow it
 * slightly: a tight outline reads as part of the UI, not as pointing at it.
 */
function targetRect(step: ScribeStep, frame: Rect): Rect | null {
  if (!step.rect || step.rect.w <= 0 || step.rect.h <= 0) return null

  const grow = 6
  const x = step.rect.x + frame.x - grow
  const y = step.rect.y + frame.y - grow
  const w = step.rect.w + grow * 2
  const h = step.rect.h + grow * 2

  // The element may be outside the frame: the page could have scrolled between click and capture.
  const left = Math.max(frame.x, x)
  const top = Math.max(frame.y, y)
  const right = Math.min(frame.x + frame.w, x + w)
  const bottom = Math.min(frame.y + frame.h, y + h)
  if (right - left <= 1 || bottom - top <= 1) return null

  return { x: left, y: top, w: right - left, h: bottom - top }
}

/**
 * Step-number placement: left of the outline, fully outside it.
 *
 * The old corner placement (half inside) assumed a large element; on a 14px checkbox
 * the badge was bigger than its target and covered it entirely. No room on the left —
 * go above; no room there either — fall back to the corner (a button in the page's
 * top-left corner has nowhere else).
 */
function badgeAt(box: Rect, frame: Rect, size: number): Point {
  const gap = 8
  const centreY = box.y + Math.min(box.h / 2, size)

  if (box.x - gap - size >= frame.x) {
    return { x: box.x - gap - size / 2, y: centreY }
  }
  if (box.y - gap - size >= frame.y) {
    return { x: box.x + Math.min(box.w / 2, size), y: box.y - gap - size / 2 }
  }
  return { x: box.x, y: box.y }
}

/**
 * Document for one step: frame, element outline, number, and caption.
 *
 * A step without a frame yields no document at all — there's nothing to outline.
 * It stays a caption-only row in the guide, which beats an empty canvas with a number.
 */
export function buildStepDoc(
  step: ScribeStep,
  image: StepImage,
  style: ScribeStyle = DEFAULT_SCRIBE_STYLE,
  now = Date.now(),
): Doc | null {
  if (!step.imageId) return null

  const look = resolveStyle(style)
  const band = captionBand(look)

  const created = createDoc({
    imageId: image.imageId,
    imageWidth: image.width,
    imageHeight: image.height,
    source: { url: step.url, title: step.title, domain: domainOfUrl(step.url) },
    title: `${step.index}. ${step.caption}`,
    now,
  })

  /**
   * Canvas grows by the caption band — and the frame is raised by half of it.
   *
   * The second part is mandatory: the frame is centered on the canvas, so a canvas
   * that "grows down" actually grows both ways and drops the frame by half the extra
   * height. Without the offset, outline/badge/caption landed 32px above their target.
   */
  const doc: Doc = {
    ...created,
    canvas: { ...created.canvas, h: created.canvas.h + band },
    capture: { ...created.capture, offset: { x: 0, y: -band / 2 } },
  }

  // Ask the same function the renderer uses for the frame position: computing it
  // a second way is exactly what caused the mismatch before.
  const frame = frameRect(doc)
  const layers: Layer[] = []

  const box = targetRect(step, frame)
  if (box && look.outline) {
    const outline = createLayer('shape', { rect: box })
    if (outline.kind === 'shape') {
      layers.push({
        ...outline,
        name: TARGET_NAME,
        stroke: look.accent,
        strokeWidth: look.outlineWidth,
        fill: null,
      })
    }
  }

  if (box && look.badge) {
    const badge = createLayer('badge', { at: badgeAt(box, frame, look.badgeSize) })
    if (badge.kind === 'badge') {
      layers.push({
        ...badge,
        name: badgeName(step.index),
        number: step.index,
        style: look.badgeStyle,
        color: look.accent,
        size: look.badgeSize,
      })
    }
  }

  if (look.caption) {
    const caption = createLayer('text', {
      at: { x: frame.x, y: frame.y + frame.h + (band - look.captionSize) / 2 },
    })
    if (caption.kind === 'text') {
      layers.push({
        ...caption,
        name: CAPTION_NAME,
        text: step.caption,
        fontSize: look.captionSize,
        fontWeight: 500,
        color: look.captionColor,
        width: frame.w,
      })
    }
  }

  return { ...doc, layers }
}

function domainOfUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/** Layer names the builder assigns; also how we detect whether a human edited the doc. */
export const TARGET_NAME = 'Target'
export const CAPTION_NAME = 'Caption'

export function badgeName(index: number): string {
  return `Step ${index}`
}

/**
 * Whether the doc is untouched by a human.
 *
 * A style change rebuilds steps — but only ones with no manual additions. We must not
 * erase someone's arrow for the sake of a different outline color: styling is cheap to
 * redo, a lost edit is unrecoverable.
 */
export function isGeneratedStepDoc(doc: Doc, step: ScribeStep): boolean {
  const allowed = new Set([TARGET_NAME, CAPTION_NAME, badgeName(step.index)])
  return doc.layers.every((layer) => allowed.has(layer.name))
}

/** Steps that can produce an image at all: the rest stay caption-only rows. */
export function stepsWithFrames(steps: readonly ScribeStep[]): ScribeStep[] {
  return steps.filter((step) => step.imageId !== null)
}
