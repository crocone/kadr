/**
 * Recording timeline: what the user did, where, and when.
 *
 * One type serves two phases. Scribe records clicks and input; phase 7 will add scroll
 * and cursor to the same steps and get an auto-zoom timeline without rewriting a line.
 * That's why a step is modeled as a page event, not as "picture with caption" — the
 * caption and frame are consequences, not the essence.
 *
 * Input field values are never stored in any form. Only the fact "something was typed
 * here" is recorded — enough for both the guide and auto-zoom, while a password or
 * card number leaking into a file helps nothing.
 *
 * Pure module: no DOM, no DB, just types and ordering arithmetic.
 */
import type { DocId, ImageId, Point, Rect } from '@/core/doc/types'
import type { ElementRef } from '@/core/dom/selector'

import type { ElementKind } from './caption'
import type { ScribeStyle } from './style'

export type StepId = string
export type GuideId = string

/**
 * What happened.
 *
 * `input` is recorded on `change`, not per keystroke: otherwise each field would yield
 * dozens of steps, and "press p, press a, press s" is not a guide. `navigate` is a
 * consequence, not a user action: it marks a page transition so the finished guide
 * shows where one page ended and the next began.
 */
export type StepKind = 'click' | 'input' | 'submit' | 'navigate' | 'key'

export type StepViewport = { w: number; h: number; dpr: number }

export type ScribeStep = {
  id: StepId
  guideId: GuideId
  /** 1-based order; also the badge number on the frame. */
  index: number
  kind: StepKind
  at: number
  /** Event point in viewport coordinates — same space the frame was captured in. */
  point: Point | null
  /** Acted-on element: the outline is drawn around it, and phase 7 will zoom to it. */
  element: ElementRef | null
  /**
   * What the element was to the user: button, link, field. Computed at recording time,
   * while role and type are still at hand — the fingerprint's tag alone can't recover them.
   */
  target: ElementKind | null
  /** Element rect in viewport coordinates at event time. */
  rect: Rect | null
  url: string
  title: string
  /**
   * Step frame. `null` is legitimate: the rate limiter allows two frames a second,
   * so a rapid burst of clicks stays in the guide as captions without pictures.
   * Better than throttling the recording to capture speed and shooting something
   * other than what was clicked.
   */
  imageId: ImageId | null
  viewport: StepViewport | null
  caption: string
  /** Caption was hand-edited: rebuilds don't overwrite it. */
  captionEdited: boolean
  /** Step document: created when the guide is built, `null` until then. */
  docId: DocId | null
}

/**
 * A step as the page sends it: no number, no frame, no id. The background adds all of
 * that — it alone knows how many steps are recorded and whether a frame was captured
 * for this click.
 */
export type ScribeEvent = {
  kind: StepKind
  at: number
  point: Point | null
  element: ElementRef | null
  target: ElementKind | null
  rect: Rect | null
  url: string
  title: string
  viewport: StepViewport
}

export type SessionStatus = 'recording' | 'done'

export type ScribeSession = {
  id: GuideId
  title: string
  startedAt: number
  updatedAt: number
  status: SessionStatus
  /**
   * Tab being recorded. Survives link navigation: the content script is re-injected
   * into the same tab and continues the same session.
   */
  tabId: number | null
  /** Recording origin: permission was granted for it; leaving the domain stops recording. */
  origin: string
  /** Frames the rate limiter blocked: shown in the HUD and in the guide. */
  droppedFrames: number
  /**
   * Annotation style. Optional: guides recorded before styles existed have none in the
   * DB and render with the default.
   */
  style?: ScribeStyle
}

/** Numbers run consecutively from 1: a gap reads as a lost step. */
export function renumber(steps: readonly ScribeStep[]): ScribeStep[] {
  return steps.map((step, at) => (step.index === at + 1 ? step : { ...step, index: at + 1 }))
}

export function sortSteps(steps: readonly ScribeStep[]): ScribeStep[] {
  return [...steps].sort((a, b) => a.index - b.index || a.at - b.at)
}

/** Drag a step within the list. Bounds are clamped: dropping outside the list is not a delete. */
export function moveStep(steps: readonly ScribeStep[], from: number, to: number): ScribeStep[] {
  const ordered = sortSteps(steps)
  if (from < 0 || from >= ordered.length) return ordered

  const target = Math.min(Math.max(to, 0), ordered.length - 1)
  if (target === from) return ordered

  const moved = [...ordered]
  moved.splice(target, 0, ...moved.splice(from, 1))
  return renumber(moved)
}

export function removeStep(steps: readonly ScribeStep[], id: StepId): ScribeStep[] {
  return renumber(sortSteps(steps).filter((step) => step.id !== id))
}

export function setCaption(
  steps: readonly ScribeStep[],
  id: StepId,
  caption: string,
): ScribeStep[] {
  return steps.map((step) => (step.id === id ? { ...step, caption, captionEdited: true } : step))
}

/**
 * Page transitions. A step is marked when its URL differs from the previous one: the
 * finished guide splits into sections on these — without them, ten steps across three
 * pages read as one continuous strip.
 */
export function pageBreaks(steps: readonly ScribeStep[]): Set<StepId> {
  const breaks = new Set<StepId>()
  let previous: string | null = null

  for (const step of sortSteps(steps)) {
    const page = urlWithoutHash(step.url)
    if (previous !== null && page !== previous) breaks.add(step.id)
    previous = page
  }
  return breaks
}

function urlWithoutHash(url: string): string {
  const hash = url.indexOf('#')
  return hash === -1 ? url : url.slice(0, hash)
}
