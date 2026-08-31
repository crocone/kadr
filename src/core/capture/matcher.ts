/**
 * Aligns adjacent frames by content, not by scroll coordinate.
 *
 * Regular stitching places a frame at `scrollY` and needs a static DOM. In chats
 * and virtualized lists that is wrong twice over: heights drift, rows appear and
 * vanish, and there may be no "end of page" at all. Here coordinates are not
 * trusted: we look at the pixels of two frames, find the overlap, and keep only
 * the fresh band.
 *
 * Everything runs on a narrow grayscale thumbnail: matching on it is hundreds of
 * times cheaper than on the frame and noticeably more robust — anti-aliasing and
 * subpixel rendering get averaged away.
 *
 * No DOM access and no canvas: input is a ready pixel array, so all the
 * arithmetic is testable in Vitest on synthetic frames.
 */

/** Thumbnail pixels. `ImageData`-compatible without requiring it to exist. */
export type Pixels = { width: number; height: number; data: Uint8ClampedArray }

/**
 * Thumbnail width used for matching.
 *
 * 64 px was enough for a message feed but not for a code page: listing lines,
 * squeezed four times harder, turn into identical gray bands, and the matcher
 * honestly reported "frame unchanged". Twice the width means twice the
 * distinguishable detail per row, at the same fraction-of-a-millisecond cost.
 */
export const THUMB_WIDTH = 128

/**
 * Right-edge band trimmed before matching: the inner container's scrollbar lives
 * there. It moves in every frame and votes against any shift, since it never
 * matches itself.
 */
export const SCROLLBAR_TRIM = 20

/**
 * A row is described by brightness gradients, not brightness values: darker /
 * same / lighter from point to point. Adjacent frames of identical content
 * differ by a few brightness units due to anti-aliasing and repaints, so exact
 * byte equality would detect noise, not shift. Gradients survive that, and a
 * uniform brightening of the frame too.
 *
 * The gradient threshold is a share of the row's own range, not a constant. A
 * fixed four levels worked on a high-contrast feed but killed text: after
 * downscaling, code-line gradients measure in single units, all fell into the
 * dead zone, and any two rows came out identical. Below this threshold a
 * gradient does not count as one.
 */
const MIN_EDGE_DEADZONE = 2
const EDGE_DEADZONE_SHARE = 16

/** Below this brightness range a row counts as background and does not vote. */
const MIN_ROW_RANGE = 10

/** A hash seen more often than this is a repeating pattern: it points nowhere. */
const MAX_ROW_REPEATS = 12

/** Minimum matching rows for a shift to be worth believing at all. */
const MIN_SUPPORT = 6

/** And their share of compared rows: below this it is coincidence, not alignment. */
const MIN_MATCH_RATIO = 0.55

/**
 * Share of rows that may change while the frame still counts as unchanged.
 *
 * Perfectly identical frames do not exist: a cursor blinks, a clock ticks, an
 * avatar finishes loading. Scrolling changes hundreds of rows at once, and the
 * two are impossible to confuse — that is what the "content ended" decision
 * rests on.
 */
const STILL_RATIO = 0.02

/**
 * Overlap below this share of the frame cannot be verified: over a hundred rows
 * anything matches by chance, and a real step always leaves noticeably more.
 */
const MIN_OVERLAP_RATIO = 0.12

/** How many voted candidates to verify; beyond that it is chance matches. */
const MAX_CANDIDATES = 8

/** A sticky band cannot take half the frame: that is the whole page, not a header. */
const MAX_STICKY_RATIO = 0.45

export type FrameSignature = {
  height: number
  /** One hash per thumbnail row. */
  rows: Uint32Array
  /** Row carries content rather than flat background. */
  informative: Uint8Array
  informativeCount: number
}

/** Bands that stay put while the rest moves: header on top, input field below. */
export type StickyBands = { top: number; bottom: number }

export type Match = {
  /**
   * How many rows the content moved up between frames. Positive — scrolled
   * down, negative — up, zero — frames match.
   */
  shift: number
  /** How many rows voted for this shift. */
  support: number
  /** Whether there were enough votes to trust the result. */
  confident: boolean
  sticky: StickyBands
}

function luminance(r: number, g: number, b: number): number {
  // Integer approximation of Rec. 601: no dividing by 255 in a hot loop.
  return (r * 77 + g * 151 + b * 28) >> 8
}

/**
 * Row hashes and the informative flag. FNV-1a: short, table-free, and uniform
 * enough for 64 bytes per row.
 */
export function signatureOf(image: Pixels): FrameSignature {
  const { width, height, data } = image
  const rows = new Uint32Array(height)
  const informative = new Uint8Array(height)
  let informativeCount = 0

  // Row brightnesses are computed once: both the range and the gradients need
  // them, and the gradient threshold depends on the range — so one pass is not enough.
  const line = new Uint8Array(width)

  for (let y = 0; y < height; y++) {
    let min = 255
    let max = 0

    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4
      const value = luminance(data[offset] ?? 0, data[offset + 1] ?? 0, data[offset + 2] ?? 0)
      line[x] = value
      if (value < min) min = value
      if (value > max) max = value
    }

    const deadzone = Math.max(MIN_EDGE_DEADZONE, (max - min) / EDGE_DEADZONE_SHARE)
    let hash = 0x811c9dc5
    for (let x = 1; x < width; x++) {
      const delta = (line[x] ?? 0) - (line[x - 1] ?? 0)
      const edge = delta > deadzone ? 2 : delta < -deadzone ? 0 : 1
      hash = (hash ^ edge) >>> 0
      hash = Math.imul(hash, 0x01000193) >>> 0
    }

    rows[y] = hash
    if (max - min >= MIN_ROW_RANGE) {
      informative[y] = 1
      informativeCount++
    }
  }

  return { height, rows, informative, informativeCount }
}

/** Hash-to-rows index. Overly frequent hashes are dropped: they cannot tell positions apart. */
function indexRows(signature: FrameSignature): Map<number, number[]> {
  const index = new Map<number, number[]>()

  for (let y = 0; y < signature.height; y++) {
    if (!signature.informative[y]) continue
    const hash = signature.rows[y] ?? 0
    const found = index.get(hash)
    if (found) found.push(y)
    else index.set(hash, [y])
  }

  for (const [hash, list] of index) {
    if (list.length > MAX_ROW_REPEATS) index.delete(hash)
  }
  return index
}

/**
 * Shift candidates: every informative row of the second frame votes for the
 * shift that aligns it with a row of the first. O(rows) via the hash table.
 *
 * Voting alone cannot decide: in a chat half the rows are repeating background,
 * which easily builds a majority for a shift that never happened. Votes only
 * suggest where to look; the overlap check chooses.
 */
function candidateShifts(a: FrameSignature, b: FrameSignature): number[] {
  const index = indexRows(a)
  const votes = new Map<number, number>()

  for (let y = 0; y < b.height; y++) {
    if (!b.informative[y]) continue
    const candidates = index.get(b.rows[y] ?? 0)
    if (!candidates) continue

    for (const source of candidates) {
      const shift = source - y
      votes.set(shift, (votes.get(shift) ?? 0) + 1)
    }
  }

  return [...votes]
    .sort((first, second) => second[1] - first[1])
    .slice(0, MAX_CANDIDATES)
    .map(([shift]) => shift)
}

/**
 * Shift verification: how many overlap rows actually match.
 *
 * This answers "do the frames really align like this": votes count matches
 * anywhere, while here rows are checked in place, one to one.
 */
export function scoreShift(
  a: FrameSignature,
  b: FrameSignature,
  shift: number,
): { matched: number; compared: number; overlap: number } {
  const from = Math.max(0, -shift)
  const to = Math.min(b.height, a.height - shift)

  let matched = 0
  let compared = 0
  for (let y = from; y < to; y++) {
    // Flat background matches any other flat background, so only rows where at
    // least one frame has content are counted.
    if (!b.informative[y] && !a.informative[y + shift]) continue
    // A row that sits in the same place in both frames is a header or input
    // field. It says nothing about the shift and only skews the score: under
    // any non-zero shift it is bound not to match.
    if (shift !== 0 && b.rows[y] === a.rows[y]) continue
    compared++
    if (b.rows[y] === a.rows[y + shift]) matched++
  }

  return { matched, compared, overlap: Math.max(0, to - from) }
}

/**
 * How many rows changed between frames.
 *
 * The "frame unchanged" decision rests on this number: scrolling changes
 * hundreds of rows at once, a blinking cursor a handful — impossible to confuse.
 */
export function changedRows(a: FrameSignature, b: FrameSignature): number {
  const height = Math.min(a.height, b.height)
  let changed = 0
  for (let y = 0; y < height; y++) if (a.rows[y] !== b.rows[y]) changed++
  return changed
}

/**
 * Sticky bands: edge rows that match at zero shift while everything else moved.
 * That is the channel header on top and the input field below — things that must
 * appear once in the result, not in every stitched band.
 *
 * A band counts only if it holds at least one informative row: flat background
 * at the edge always matches itself, and treating it as a header would cut real
 * content.
 */
export function findStickyBands(a: FrameSignature, b: FrameSignature): StickyBands {
  const height = Math.min(a.height, b.height)
  const limit = Math.floor(height * MAX_STICKY_RATIO)

  let top = 0
  let topHasContent = false
  while (top < limit && a.rows[top] === b.rows[top]) {
    if (a.informative[top]) topHasContent = true
    top++
  }

  let bottom = 0
  let bottomHasContent = false
  while (bottom < limit) {
    const y = height - 1 - bottom
    if (a.rows[y] !== b.rows[y]) break
    if (a.informative[y]) bottomHasContent = true
    bottom++
  }

  return {
    top: topHasContent ? top : 0,
    bottom: bottomHasContent ? bottom : 0,
  }
}

/**
 * Shift between frames plus the sticky bands around it.
 *
 * Voting proposes candidates, verification chooses: the winning shift is the one
 * with the most matching overlap rows, and only if the majority of them match.
 * Without this check stitching occasionally took a shift smaller than the real
 * one — and the finished sheet showed a repeated screen of conversation.
 *
 * `hint` is the scroll-delta estimate. It joins as a candidate too: unreliable
 * on its own (virtual lists rewrite `scrollTop` under themselves), but it passes
 * verification exactly when it is right.
 *
 * `confident: false` means matching did not converge: a video or GIF in frame,
 * or a jump larger than the overlap. What to do next is the stitch session's call.
 */
export function matchFrames(a: FrameSignature, b: FrameSignature, hint?: number): Match {
  const height = Math.min(a.height, b.height)
  const minOverlap = Math.ceil(height * MIN_OVERLAP_RATIO)

  /**
   * "Frame unchanged" is decided separately and first — by changed-row count,
   * not alongside the other shifts.
   *
   * Zero cannot compete with a real shift on match count: on a page with a wide
   * static part — sidebar, header, input field — most rows match at zero shift
   * simply because they never moved. Zero used to beat the real shift, the
   * capture declared "content ended" and stopped on the very first screen.
   */
  const changed = changedRows(a, b)
  if (changed <= Math.max(MIN_SUPPORT, Math.round(height * STILL_RATIO))) {
    return { shift: 0, support: height - changed, confident: true, sticky: { top: 0, bottom: 0 } }
  }

  const seen = new Set<number>(candidateShifts(a, b))
  if (typeof hint === 'number' && Number.isFinite(hint)) seen.add(Math.round(hint))
  seen.delete(0)

  let shift = 0
  let support = 0
  let confident = false

  // From here shifts have one job: explain those changed rows. Static rows do
  // not count at all (`scoreShift` drops them), so every candidate stands on the
  // same base and comparing them is fair.
  for (const candidate of seen) {
    const { matched, compared, overlap } = scoreShift(a, b, candidate)
    if (overlap < minOverlap || compared < MIN_SUPPORT) continue
    if (matched / compared < MIN_MATCH_RATIO) continue

    if (matched > support) {
      shift = candidate
      support = matched
      confident = true
    }
  }

  // Sticky bands make sense only when the rest actually moved: on a pair of
  // identical frames the whole frame would be "sticky".
  const sticky = confident && shift !== 0 ? findStickyBands(a, b) : { top: 0, bottom: 0 }

  const usable = height - sticky.top - sticky.bottom
  if (usable <= 0) return { shift, support, confident, sticky: { top: 0, bottom: 0 } }

  return { shift, support, confident, sticky }
}
