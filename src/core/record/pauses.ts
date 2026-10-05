/**
 * Dead air: the stretches where nothing happened.
 *
 * A pause is a gap between actions — a click, a scroll, a key, a field focus. Cursor
 * movement is deliberately not an action: a pointer wandering across a static page
 * while its owner reads is exactly the footage people want gone, and counting it as
 * activity would leave every such stretch in the clip.
 *
 * The lead and the tail are why a cut does not read as a glitch. The pause is trimmed
 * from both ends, so the viewer sees the click land, a beat, then the next thing —
 * rather than the click and the result in the same frame.
 *
 * Nothing here removes anything. It proposes spans; the editor shows them and the user
 * accepts. Silently deleting seconds of someone's recording is not a feature.
 *
 * Pure module.
 */
import { normalizeSpans, spanLength } from './edit'
import type { RecordEvent } from './timeline'
import type { ClipEdit, TimeSpan } from './types'

export type PauseOptions = {
  /** Shorter gaps stay: cutting a second out of a demo saves nothing and costs continuity. */
  minPause: number
  /** Kept after the last action, ms. */
  lead: number
  /** Kept before the next action, ms. */
  tail: number
}

export const DEFAULT_PAUSE_OPTIONS: PauseOptions = { minPause: 1500, lead: 400, tail: 300 }

const ACTIONS = new Set(['click', 'scroll', 'key', 'focus'])

/**
 * Cuttable spans inside the trimmed range.
 *
 * The head and the tail of the recording count too: the seconds spent finding the stop
 * button are the most reliably useless footage in any clip.
 */
export function findPauses(
  events: readonly RecordEvent[],
  edit: ClipEdit,
  options: PauseOptions = DEFAULT_PAUSE_OPTIONS,
): TimeSpan[] {
  const { start, end } = edit.trim
  const actions = events
    .filter((event) => ACTIONS.has(event.kind) && event.at >= start && event.at <= end)
    .map((event) => event.at)
    .sort((a, b) => a - b)

  const marks = [start, ...actions, end]
  const found: TimeSpan[] = []

  for (let i = 0; i < marks.length - 1; i++) {
    const from = marks[i]!
    const to = marks[i + 1]!
    if (to - from < options.minPause) continue

    // The very first and very last gaps have no action on one side, so nothing needs
    // protecting there: trim right up to the boundary.
    const cutFrom = i === 0 ? from : from + options.lead
    const cutTo = i === marks.length - 2 ? to : to - options.tail
    if (cutTo - cutFrom > 0) found.push({ start: cutFrom, end: cutTo })
  }

  return normalizeSpans(found, edit.trim)
}

/** How much shorter the clip gets — the number on the "cut pauses" button. */
export function pauseSavings(spans: readonly TimeSpan[]): number {
  return spans.reduce((total, span) => total + spanLength(span), 0)
}
