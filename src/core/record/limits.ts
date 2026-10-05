/**
 * What the recorder refuses to do, and why.
 *
 * A screen recorder with no ceiling is a disk-filling machine: the browser hands out a
 * generous quota under `unlimitedStorage`, and an unattended tab left recording
 * overnight would use all of it. The limit is not a licence tier — it is the point past
 * which the feature stops being useful anyway. Nobody debugs from a two-hour clip.
 *
 * Pure module: no MediaRecorder here except the codec probe, which asks the browser and
 * takes its answer.
 */

/** Ten minutes. Long enough for any bug report, short enough to stay a file people send. */
export const MAX_DURATION_MS = 10 * 60_000

/** The HUD starts counting down here rather than stopping without warning. */
export const WARN_BEFORE_MS = 30_000

/** Chunk size, ms. Also the granularity a crash can cost. */
export const CHUNK_MS = 2000

/** Refuse to start with less than this free: a recording that dies on a full disk is worse. */
export const MIN_HEADROOM_BYTES = 512 * 1024 * 1024

/**
 * Codec preference, best first.
 *
 * VP9 for the picture: at the same bitrate it is visibly cleaner on text, and a screen
 * recording is mostly text. Opus for the sound because WebM offers nothing else worth
 * having. Everything after the first entry is a fallback for a browser that says no —
 * `isTypeSupported` is asked rather than assumed, since the list a build ships with
 * depends on how it was compiled.
 */
export const MIME_PREFERENCE = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
] as const

export function pickMimeType(
  supported: (type: string) => boolean = (type) => MediaRecorder.isTypeSupported(type),
): string {
  return MIME_PREFERENCE.find((type) => supported(type)) ?? ''
}

/**
 * Bitrate for a screen recording, bits per second.
 *
 * Screen content is not camera content: large flat areas, then a scroll that changes
 * every pixel at once. Encoders tuned by pixel count alone either waste half the file
 * on a static page or smear the text the moment it moves. The number below is a
 * compromise anchored on pixels per second, clamped at both ends — under 1 Mbps text
 * turns to mush, over 12 Mbps nobody can attach the file to anything.
 */
export function bitrateFor(width: number, height: number, fps: number): number {
  const perSecond = width * height * fps
  return Math.round(Math.min(12_000_000, Math.max(1_000_000, perSecond * 0.11)))
}

/** Whether the recording should stop on its own. */
export function overDuration(elapsed: number, limit = MAX_DURATION_MS): boolean {
  return elapsed >= limit
}

/** Seconds left before the automatic stop; `null` while the warning is not due yet. */
export function warningAt(elapsed: number, limit = MAX_DURATION_MS): number | null {
  const left = limit - elapsed
  return left <= WARN_BEFORE_MS ? Math.max(0, Math.ceil(left / 1000)) : null
}
