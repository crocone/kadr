/**
 * Numbers people read: clip length and file size.
 *
 * Both appear in three places — the recording HUD, the popup, the library card — and
 * three implementations would eventually disagree about whether 90 seconds is "1:30"
 * or "01:30".
 *
 * Pure module.
 */

/**
 * `m:ss` under an hour, `h:mm:ss` above it. No leading zero on the first number: a
 * recording is a minute and a half, not zero hours one minute thirty.
 */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const seconds = total % 60
  const minutes = Math.floor(total / 60) % 60
  const hours = Math.floor(total / 3600)

  const pad = (value: number) => String(value).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`
}

/**
 * Milliseconds with a tenth of a second, for the editor timeline. A trim handle moves
 * in frames, and `0:04` for every position between four and five seconds is not a
 * readout anybody can trim by.
 */
export function formatPrecise(ms: number): string {
  const tenths = Math.floor(Math.abs(ms) / 100) % 10
  return `${formatDuration(ms)}.${tenths}`
}

const UNITS = ['B', 'KB', 'MB', 'GB'] as const

/** File size at three significant figures — enough to compare, short enough to fit a card. */
export function formatSize(bytes: number): string {
  let value = Math.max(0, bytes)
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  const rounded = value >= 100 || unit === 0 ? Math.round(value) : Math.round(value * 10) / 10
  return `${rounded} ${UNITS[unit]}`
}
