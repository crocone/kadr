/**
 * What happened on the page while the camera was rolling.
 *
 * This is the phase-7 half of the timeline `core/scribe/timeline.ts` started: a step
 * there is a page event with a time and a point, and so is an event here. Scribe needs
 * a caption and a frame per step; the recorder needs neither and cares about scrolls and
 * keystrokes that a guide has no use for — so the two stay separate types over one idea,
 * rather than one type carrying fields that are always null on one side.
 *
 * Coordinates are fractions of the viewport, not pixels. The video frame is captured at
 * the device pixel ratio, gets cropped in the editor and scaled again on export; a
 * pixel point recorded on the page would be wrong after the first of those. A fraction
 * survives all three.
 *
 * Field values are never recorded — same rule as Scribe. A `focus` event says a field
 * was entered and nothing more.
 *
 * Pure module: no DOM, no DB.
 */
import type { Point, Rect } from '@/core/doc/types'

/**
 * `move` is no longer recorded — the captured frame carries the real cursor, so a
 * sampled path could only draw a second one. The kind stays in the union because clips
 * recorded before that decision still have such events in them, and the ceiling below
 * still knows to shed them first.
 */
export type RecordEventKind = 'click' | 'move' | 'scroll' | 'focus' | 'key'

export type RecordEvent = {
  kind: RecordEventKind
  /** Ms from the start of the recording. */
  at: number
  /** Fraction of the viewport, 0..1. `null` for events with no place — a key press. */
  point: Point | null
  /** Acted-on element, in the same fractional space. The camera frames this, not the point. */
  rect: Rect | null
}

/** Events arrive from the page in bursts and can overlap after a re-inject. */
export function sortEvents(events: readonly RecordEvent[]): RecordEvent[] {
  return [...events].sort((a, b) => a.at - b.at)
}

export function eventsOfKind(events: readonly RecordEvent[], kind: RecordEventKind): RecordEvent[] {
  return events.filter((event) => event.kind === kind)
}

/**
 * Events inside a span, `end` exclusive. Used everywhere the editor asks "what
 * happened here" — pause detection, zoom building, the click ripples.
 */
export function eventsIn(
  events: readonly RecordEvent[],
  start: number,
  end: number,
): RecordEvent[] {
  return events.filter((event) => event.at >= start && event.at < end)
}

/**
 * Fit the timeline inside the recording.
 *
 * Events land slightly outside it at both ends, and neither end is the page's fault: the
 * clock correction shifts everything by a few hundred milliseconds, and the page keeps
 * sending for a moment after stop — that message is already in flight when the recorder
 * shuts down. Both are pulled to the boundary rather than thrown away. Discarding them
 * cost real clicks: the first one or two of a recording sat a fraction before zero after
 * the shift and vanished, which is exactly the kind of loss nobody can explain later.
 *
 * Only what is nowhere near the recording is dropped — a stray event from a previous
 * session, which has no boundary worth pulling it to.
 */
export function clampEvents(events: readonly RecordEvent[], duration: number): RecordEvent[] {
  const slack = Math.max(2000, duration * 0.1)

  return sortEvents(events)
    .filter((event) => event.at >= -slack && event.at <= duration + slack)
    .map((event) =>
      event.at >= 0 && event.at <= duration
        ? event
        : { ...event, at: Math.min(duration, Math.max(0, event.at)) },
    )
}

/**
 * Hard ceiling on how many events one recording may hold.
 *
 * The timeline is kept in `chrome.storage.session` while recording, and that has a
 * quota: filling it would start failing writes, which is a silent way to lose the end
 * of a recording. When the ceiling is hit, cursor samples are dropped first and oldest
 * first — the camera degrades to a slightly coarser path, while every click, scroll and
 * keystroke survives. The alternative, dropping whatever arrived last, would throw away
 * exactly the part still being recorded.
 */
export function capEvents(events: readonly RecordEvent[], max: number): RecordEvent[] {
  if (events.length <= max) return [...events]

  const kept = sortEvents(events)
  let excess = kept.length - max

  const thinned = kept.filter((event) => {
    if (excess > 0 && event.kind === 'move') {
      excess -= 1
      return false
    }
    return true
  })

  // Nothing but actions left and still over the ceiling: a recording with ten thousand
  // clicks in it is not a recording anyone will edit, so the oldest ones go.
  return thinned.length <= max ? thinned : thinned.slice(thinned.length - max)
}

/**
 * Where the page actually sits inside the recorded frame, in frame fractions.
 *
 * The two are not always the same rectangle. A capture stream has a fixed size
 * negotiated when it starts, and when its aspect does not match the page's, the browser
 * fits the page inside and pads the rest — the black band along the top of such a
 * recording is exactly that padding. Coordinates recorded as fractions of the viewport
 * then land as fractions of the whole frame, which stretches every one of them away from
 * the centre. It is invisible in the middle of the picture and worst at the very top and
 * bottom, which is where it was noticed.
 */
export function pageRect(
  viewport: { w: number; h: number },
  frame: { w: number; h: number },
): Rect {
  if (viewport.w <= 0 || viewport.h <= 0 || frame.w <= 0 || frame.h <= 0) {
    return { x: 0, y: 0, w: 1, h: 1 }
  }

  const scale = Math.min(frame.w / viewport.w, frame.h / viewport.h)
  const w = (viewport.w * scale) / frame.w
  const h = (viewport.h * scale) / frame.h

  // Padding is split evenly: the fitted content is centred in the frame.
  return { x: (1 - w) / 2, y: (1 - h) / 2, w, h }
}

/**
 * Rewrites viewport fractions as frame fractions, once, when the clip is written.
 *
 * Doing it here rather than at every draw means the camera, the rings and anything added
 * later all read the same coordinate space, and none of them has to know that a frame is
 * ever bigger than the page it holds.
 */
export function toFrameSpace(
  events: readonly RecordEvent[],
  viewport: { w: number; h: number } | null,
  frame: { w: number; h: number },
): RecordEvent[] {
  if (!viewport) return [...events]

  const page = pageRect(viewport, frame)
  if (page.x === 0 && page.y === 0 && page.w === 1 && page.h === 1) return [...events]

  const at = (point: Point): Point => ({
    x: page.x + point.x * page.w,
    y: page.y + point.y * page.h,
  })

  return events.map((event) => ({
    ...event,
    point: event.point ? at(event.point) : null,
    rect: event.rect
      ? {
          ...at({ x: event.rect.x, y: event.rect.y }),
          w: event.rect.w * page.w,
          h: event.rect.h * page.h,
        }
      : null,
  }))
}
