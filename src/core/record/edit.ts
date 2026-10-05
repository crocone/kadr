/**
 * Two clocks and the arithmetic between them.
 *
 * Source time is where everything recorded lives: the video file, the events, the
 * zooms. Output time is what the viewer sees after the clip has been trimmed, had its
 * pauses cut out and been sped up. Every seek, every scrubber pixel and every exported
 * frame crosses between the two, so the crossing happens here and nowhere else — a
 * second implementation in the player would drift from the exporter, and the bug would
 * only show up in the finished file.
 *
 * Cuts are stored as the spans that are gone, not as the spans that stay. That way
 * `trim` and `cuts` stay independent: dragging the trim handle does not have to rewrite
 * every cut, and undoing a cut is removing one item from a list.
 *
 * Pure module: numbers in, numbers out.
 */
import type { ClipEdit, TimeSpan } from './types'

export const MIN_SPEED = 0.25
export const MAX_SPEED = 4

export function spanLength(span: TimeSpan): number {
  return Math.max(0, span.end - span.start)
}

/**
 * Sorted, merged, clamped to the bounds. Spans arrive from a dragged handle and from
 * pause detection, so overlaps are normal — and an unmerged overlap would be counted
 * twice by every length sum below.
 */
export function normalizeSpans(spans: readonly TimeSpan[], bounds: TimeSpan): TimeSpan[] {
  const clamped = spans
    .map((span) => ({
      start: Math.max(bounds.start, Math.min(span.start, span.end)),
      end: Math.min(bounds.end, Math.max(span.start, span.end)),
    }))
    .filter((span) => spanLength(span) > 0)
    .sort((a, b) => a.start - b.start)

  const merged: TimeSpan[] = []
  for (const span of clamped) {
    const last = merged.at(-1)
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end)
    else merged.push({ ...span })
  }
  return merged
}

/** What survives editing, in source time and in order. */
export function keptSpans(edit: ClipEdit): TimeSpan[] {
  const cuts = normalizeSpans(edit.cuts, edit.trim)
  const kept: TimeSpan[] = []
  let at = edit.trim.start

  for (const cut of cuts) {
    if (cut.start > at) kept.push({ start: at, end: cut.start })
    at = Math.max(at, cut.end)
  }
  if (edit.trim.end > at) kept.push({ start: at, end: edit.trim.end })
  return kept
}

/** Length of the kept material, before the speed change. */
export function keptDuration(edit: ClipEdit): number {
  return keptSpans(edit).reduce((total, span) => total + spanLength(span), 0)
}

/** What the viewer's clock will read at the end. */
export function outputDuration(edit: ClipEdit): number {
  return keptDuration(edit) / clampSpeed(edit.speed)
}

export function clampSpeed(speed: number): number {
  if (!Number.isFinite(speed) || speed <= 0) return 1
  return Math.min(MAX_SPEED, Math.max(MIN_SPEED, speed))
}

/**
 * Source time to output time. `null` means the moment was cut away — a legitimate
 * answer, not a failure: the auto-zoom asks this about every click, and clicks inside a
 * removed pause simply have no place on the new timeline.
 */
export function toOutput(edit: ClipEdit, source: number): number | null {
  let before = 0
  for (const span of keptSpans(edit)) {
    if (source < span.start) return null
    if (source < span.end) return (before + (source - span.start)) / clampSpeed(edit.speed)
    before += spanLength(span)
  }
  return null
}

/**
 * The same conversion for things that must land somewhere regardless — a zoom whose
 * anchor fell inside a cut still has to start at the seam rather than vanish.
 */
export function toOutputNearest(edit: ClipEdit, source: number): number {
  const spans = keptSpans(edit)
  if (spans.length === 0) return 0

  let before = 0
  for (const span of spans) {
    if (source < span.start) return before / clampSpeed(edit.speed)
    if (source < span.end) return (before + (source - span.start)) / clampSpeed(edit.speed)
    before += spanLength(span)
  }
  return before / clampSpeed(edit.speed)
}

/**
 * Output time back to source time: this is what the player seeks to and what the
 * exporter asks the decoder for. Past the end it returns the last frame rather than
 * running off into the trimmed tail — the alternative is a final frame of material the
 * user cut.
 */
export function toSource(edit: ClipEdit, output: number): number {
  const spans = keptSpans(edit)
  if (spans.length === 0) return edit.trim.start

  let left = Math.max(0, output) * clampSpeed(edit.speed)
  for (const span of spans) {
    const length = spanLength(span)
    if (left < length) return span.start + left
    left -= length
  }
  return spans.at(-1)!.end
}

/** Is this source moment on the cutting-room floor? */
export function isCut(edit: ClipEdit, source: number): boolean {
  if (source < edit.trim.start || source >= edit.trim.end) return true
  return normalizeSpans(edit.cuts, edit.trim).some((cut) => source >= cut.start && source < cut.end)
}

export function addCut(edit: ClipEdit, span: TimeSpan): ClipEdit {
  return { ...edit, cuts: normalizeSpans([...edit.cuts, span], edit.trim) }
}

export function removeCut(edit: ClipEdit, at: number): ClipEdit {
  return { ...edit, cuts: edit.cuts.filter((cut) => at < cut.start || at >= cut.end) }
}

/**
 * Replaces one cut, leaving the list unnormalized on purpose.
 *
 * Normalizing merges overlaps, and merging while a handle is being dragged renumbers the
 * list under the hand holding it — the cut being dragged becomes a different cut halfway
 * through the gesture. So a drag rewrites in place and `tidyCuts` runs once, when the
 * pointer is released.
 */
export function replaceCut(edit: ClipEdit, index: number, span: TimeSpan): ClipEdit {
  if (index < 0 || index >= edit.cuts.length) return edit

  const start = Math.max(edit.trim.start, Math.min(span.start, span.end))
  const end = Math.min(edit.trim.end, Math.max(span.start, span.end))
  const cuts = edit.cuts.map((cut, at) => (at === index ? { start, end } : cut))

  return { ...edit, cuts }
}

/** Sorts, merges and clamps the cuts. Called once a drag is over, not during it. */
export function tidyCuts(edit: ClipEdit): ClipEdit {
  return { ...edit, cuts: normalizeSpans(edit.cuts, edit.trim) }
}

/**
 * Move the trim handles. Cuts are re-normalized against the new bounds: a cut left
 * hanging outside the trim would count against nothing and reappear the moment the
 * handle moved back.
 */
export function setTrim(edit: ClipEdit, trim: TimeSpan): ClipEdit {
  const bounded = {
    start: Math.max(0, Math.min(trim.start, trim.end)),
    end: Math.max(trim.start, trim.end),
  }
  return { ...edit, trim: bounded, cuts: normalizeSpans(edit.cuts, bounded) }
}
