/**
 * Click ripples.
 *
 * The other half of this module used to draw the pointer itself, smoothed and resized —
 * the Screen Studio trick. It came out because the premise behind it does not hold in a
 * browser extension: Chromium composites the real cursor into the captured frame, for a
 * tab as much as for a window, and nothing in `getUserMedia` can ask it not to. The
 * `cursor` constraint exists only on `getDisplayMedia`, which needs a user gesture that
 * an offscreen document can never have. So a drawn pointer was never the pointer — it
 * was a second one, a few pixels off the first, and no amount of clock correction turns
 * two cursors into one.
 *
 * The rings stay, because nothing in the frame already draws those: a click leaves no
 * mark of its own, and knowing where one landed is most of what a bug report is for.
 *
 * Stateless — position at a moment, not a stream. The exporter renders frames in
 * whatever order it likes and must get the same answer as the player.
 *
 * Pure module.
 */
import type { Point } from '@/core/doc/types'

import type { RecordEvent } from './timeline'

export type ClickPulse = {
  at: Point
  /** 0 at the click, 1 when the ripple has faded out. */
  progress: number
}

/**
 * Click ripples alive at a moment. Plural because double-clicks exist and their two
 * rings overlapping is exactly what a double-click should look like.
 */
export function clickPulses(
  events: readonly RecordEvent[],
  at: number,
  duration: number,
): ClickPulse[] {
  const pulses: ClickPulse[] = []

  for (const event of events) {
    if (event.kind !== 'click' || !event.point) continue
    const age = at - event.at
    if (age < 0 || age > duration) continue
    pulses.push({ at: event.point, progress: age / duration })
  }
  return pulses
}
