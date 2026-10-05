/**
 * Pointer to the recording in progress.
 *
 * `chrome.storage.session`, for the same reasons Scribe keeps its pointer there: worker
 * memory is lost on suspension, and IndexedDB is too durable — a browser restart must
 * not resurrect a recording whose stream died with the window it was capturing.
 *
 * The elapsed clock is stored as "milliseconds finished before the current run" plus
 * "when the current run began". That is the only shape that survives a pause: a single
 * `startedAt` would keep counting through it, and a single `elapsed` would need someone
 * awake to keep adding to it.
 */
import type { ClipId, RecordSource } from './types'

const KEY = 'record:active'

export type ActiveRecording = {
  clipId: ClipId
  source: RecordSource
  /** Recorded tab, or `null` for a window or screen capture. */
  tabId: number | null
  /** Origin the event timeline is allowed on; empty when it has no permission. */
  origin: string
  /** When the current run began. `null` while paused. */
  startedAt: number | null
  /** Milliseconds recorded before the current run. */
  before: number
  /** Whether the page is sending an event timeline at all. */
  timeline: boolean
  /**
   * Page viewport in CSS pixels, as last reported by the recorded tab. Kept so the
   * finished clip can tell where the page sits inside a frame that may be larger.
   */
  viewport: { w: number; h: number } | null
  /**
   * Window hosting the recorder, for a window or screen capture; `null` when the
   * offscreen document holds it. Kept here rather than in worker memory because the
   * window has to be closed when the recording ends, and the worker will have been
   * suspended several times by then.
   */
  hostWindowId: number | null
}

export async function readRecording(): Promise<ActiveRecording | null> {
  const stored = await chrome.storage.session.get(KEY)
  return (stored[KEY] as ActiveRecording | undefined) ?? null
}

export async function writeRecording(active: ActiveRecording): Promise<void> {
  await chrome.storage.session.set({ [KEY]: active })
}

export async function clearRecording(): Promise<void> {
  await chrome.storage.session.remove(KEY)
}

/** How much has been recorded, in ms. */
export function elapsedOf(active: ActiveRecording, now = Date.now()): number {
  return active.before + (active.startedAt === null ? 0 : Math.max(0, now - active.startedAt))
}

/**
 * Event times are relative to the start of the recording, and a paused stretch does not
 * exist in the file. So an event that arrives at wall-clock time `now` belongs at the
 * elapsed time — which is exactly the clock the recorder is writing.
 */
export function timelineTime(active: ActiveRecording, at: number): number {
  return elapsedOf(active, at)
}
