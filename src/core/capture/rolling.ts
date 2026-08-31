/**
 * Content-driven stitch session: scrolls the container, matches adjacent frames,
 * and keeps only the fresh band from each.
 *
 * The result height is unknown up front, and keeping whole frames is not an
 * option: a hundred viewport frames are hundreds of megabytes. So right after
 * matching, a frame becomes a band and goes to the sink; the bands' total weight
 * equals the final image, with not a single duplicate.
 *
 * The traversal knows nothing about canvases or tabs: frames, thumbnails, and
 * scrolling come in as dependencies, like in `runStitch`. So band order is
 * verified by a test, not by eyeballing the finished sheet.
 */
import { type FrameSignature, matchFrames, type StickyBands } from './matcher'

export type RollDirection = 'down' | 'up'

/**
 * Scroll-step answer: where we ended up and whether Stop was pressed.
 *
 * "Hit the bottom" is deliberately not asked here. The container's bottom is not
 * the end of the conversation: chats append history exactly when you reach it,
 * and stopping by coordinate used to cut long chats in half. What stops the
 * capture is an unchanged picture — same rule as in the rest of the matching.
 */
export type RollScroll = { scrollTop: number; stopped: boolean }

export type RollingDeps<F> = {
  captureFrame: () => Promise<F>
  /** Frame thumbnail used for matching: width 64, height same as the frame. */
  signature: (frame: F) => FrameSignature
  scrollTo: (top: number) => Promise<RollScroll>
  /**
   * Take the next scrollable container. Called when the picture stops changing:
   * the chosen one may be wrong — a code block inside a message, or an invisible
   * wrapper that dutifully accepts `scrollTop` and goes nowhere.
   */
  switchTarget?: () => Promise<{ ok: boolean; scrollTop: number }>
  /** Frame no longer needed: for ImageBitmap that is `close()`. */
  release?: (frame: F) => void
  onProgress?: (frames: number, rows: number) => void
}

/** Bands arrive in capture order; where to put them is the sink's business. */
export type RollingSink<F> = {
  /** Frame rows [from, to), in physical pixels. */
  push: (frame: F, from: number, to: number) => void
}

export type RollingOptions = {
  direction: RollDirection
  /** Frame height in physical pixels: the height of the area bands are cut from. */
  frameHeight: number
  /** Scroll step in CSS pixels. */
  step: number
  /** Scroll position we started from. */
  startTop: number
  devicePixelRatio: number
  /** Result height limit in physical pixels. */
  maxRows: number
  maxFrames?: number
  /**
   * Margin from the edge new content arrives at, in physical pixels.
   *
   * Right at the edge the frame is usually not painted yet: lazy images have
   * only started loading, `content-visibility` lists show placeholders. Bands
   * are cut with a margin rather than flush — those rows land in the next frame
   * one step later, fully painted. The deferred margin is recovered from the
   * last frame.
   */
  edgeMargin?: number
}

export type RollingStop = 'user' | 'end' | 'limit' | 'frames'

export type RollingResult = {
  frames: number
  /** Result height in physical pixels. */
  rows: number
  /** Times matching failed and a band was placed by the scroll-delta estimate. */
  seams: number
  sticky: StickyBands
  stoppedBy: RollingStop
}

/**
 * How many consecutive unchanged frames end the capture.
 *
 * Not on the first: right at the bottom the feed goes off to fetch more, and the
 * first unchanged frame more often means "still loading" than "done". Each extra
 * attempt costs one capture interval, so three give the page over 1.5 s of grace.
 */
const STALL_LIMIT = 3

/** Default step: 70% of the container height — enough overlap for any matching. */
export const STEP_RATIO = 0.7

export function stepFor(viewportHeight: number): number {
  return Math.max(1, Math.round(viewportHeight * STEP_RATIO))
}

export async function runRolling<F>(
  deps: RollingDeps<F>,
  sink: RollingSink<F>,
  options: RollingOptions,
): Promise<RollingResult> {
  const { direction, frameHeight, devicePixelRatio: dpr, maxRows } = options
  const sign = direction === 'down' ? 1 : -1
  const step = Math.max(1, Math.round(options.step))
  const margin = Math.max(0, Math.min(options.edgeMargin ?? 0, Math.floor(frameHeight / 4)))

  let top = options.startTop
  let previous = await deps.captureFrame()
  let previousSignature = deps.signature(previous)

  let frames = 1
  let rows = 0
  let seams = 0
  let stalls = 0
  let sticky: StickyBands = { top: 0, bottom: 0 }
  let flushed = false
  let stoppedBy: RollingStop = 'end'

  /**
   * The first frame is not laid down immediately: until the first match
   * converges, its sticky bands are unknown — and they must be cut exactly once.
   */
  const flushFirst = (bands: StickyBands) => {
    sticky = bands
    const from = direction === 'down' ? 0 : bands.top + margin
    const to = direction === 'down' ? frameHeight - bands.bottom - margin : frameHeight
    sink.push(previous, from, to)
    rows += to - from
    flushed = true
  }

  for (;;) {
    let status = await deps.scrollTo(top + sign * step)
    if (status.stopped) {
      stoppedBy = 'user'
      break
    }

    let moved = status.scrollTop - top
    let frame = await deps.captureFrame()
    let signature = deps.signature(frame)
    let match = matchFrames(previousSignature, signature, Math.round(moved * dpr))

    // Matching failed — the jump may exceed the overlap. Retry once at half the
    // step: that fixes both a too-long step and a frame caught mid-paint. On a
    // second failure the band is placed by the scroll-delta estimate.
    if (!match.confident && moved !== 0) {
      deps.release?.(frame)
      const retry = await deps.scrollTo(top + sign * Math.max(1, Math.round(step / 2)))
      if (retry.stopped) {
        stoppedBy = 'user'
        break
      }

      status = retry
      moved = retry.scrollTop - top
      frame = await deps.captureFrame()
      signature = deps.signature(frame)
      match = matchFrames(previousSignature, signature, Math.round(moved * dpr))
    }

    // Unchanged picture — either content ended or the feed went to fetch more.
    // Only time tells them apart, so we don't quit right away. This also covers
    // the case where scroll froze and frames didn't match: nothing to guess
    // from, but waiting one more step is worth it.
    if ((match.confident && match.shift === 0) || (!match.confident && moved === 0)) {
      deps.release?.(frame)
      top = status.scrollTop

      // Before giving up, try the next container: a stall more often means
      // "scrolling the wrong thing" than "content ended". Candidates are
      // finite, so the loop is too.
      const next = await deps.switchTarget?.()
      if (next?.ok) {
        top = next.scrollTop
        stalls = 0
        continue
      }

      if (++stalls >= STALL_LIMIT) break
      continue
    }

    // A shift against the scroll direction is not a shift but a coincidence:
    // the page cannot move up while being scrolled down. The scroll delta is no
    // cross-check either: virtual lists rewrite `scrollTop` for themselves and
    // report zero where the content moved a whole screen.
    const trusted = match.confident && Math.sign(match.shift) === sign
    const estimated = Math.round(moved * dpr)
    const shift = Math.abs(trusted ? match.shift : estimated)
    if (!trusted) seams++

    // Sticky bands are determined once, from the first converged match, and
    // never change. Otherwise they "breathe": one pair finds the header, the
    // next doesn't — bands get cut with different margins, and every divergence
    // leaves a visible seam.
    if (!flushed) flushFirst(trusted ? match.sticky : { top: 0, bottom: 0 })
    const bands = sticky

    const usable = Math.max(1, frameHeight - bands.top - bands.bottom - margin)
    // Jump larger than the overlap: some content made it into no frame at all.
    if (shift > usable) seams++

    const take = Math.min(shift, usable, maxRows - rows)
    if (take <= 0) {
      deps.release?.(frame)
      stoppedBy = 'limit'
      break
    }

    const from =
      direction === 'down' ? frameHeight - bands.bottom - margin - take : bands.top + margin
    sink.push(frame, from, from + take)
    rows += take
    frames++

    stalls = 0
    deps.release?.(previous)
    previous = frame
    previousSignature = signature
    top = status.scrollTop
    deps.onProgress?.(frames, rows)

    if (rows >= maxRows) {
      stoppedBy = 'limit'
      break
    }
    if (options.maxFrames && frames >= options.maxFrames) {
      stoppedBy = 'frames'
      break
    }
  }

  if (!flushed) {
    // No shift ever happened: what remains is a plain single frame.
    sink.push(previous, 0, frameHeight)
    rows += frameHeight
  } else {
    // Deferred margin: edge rows never taken from any frame because content was
    // still painting there. In the last frame they are real — and they slot into
    // exactly the seam that expects them.
    if (margin > 0) {
      if (direction === 'down') {
        const edge = frameHeight - sticky.bottom
        sink.push(previous, edge - margin, edge)
      } else {
        sink.push(previous, sticky.top, sticky.top + margin)
      }
      rows += margin
    }

    // Sticky band from the last frame: the input field below when scrolling
    // down, the header above when scrolling up. It never appears mid-stitch.
    const band = direction === 'down' ? sticky.bottom : sticky.top
    if (band > 0) {
      if (direction === 'down') sink.push(previous, frameHeight - band, frameHeight)
      else sink.push(previous, 0, band)
      rows += band
    }
  }

  deps.release?.(previous)
  return { frames, rows, seams, sticky, stoppedBy }
}

/** Chunk height. Bands accumulate in fixed-height canvases, not one growing canvas. */
export const CHUNK_HEIGHT = 4096

export type ChunkSink = RollingSink<ImageBitmap> & {
  /** Composes the accumulated bands into one frame. */
  compose: () => ImageBitmap
}

type Chunk = { canvas: OffscreenCanvas; ctx: OffscreenCanvasRenderingContext2D; filled: number }

/**
 * Band sink backed by fixed-height canvases.
 *
 * `OffscreenCanvas` cannot grow and the final height is known only at the end,
 * so bands accumulate in chunks and are composed once. Direction is handled
 * here: when scrolling up, bands arrive bottom-to-top, so chunks fill from the
 * bottom edge and are laid out in reverse at the end.
 */
export function createChunkSink(
  crop: { x: number; y: number; w: number },
  direction: RollDirection,
  chunkHeight = CHUNK_HEIGHT,
): ChunkSink {
  const chunks: Chunk[] = []
  const up = direction === 'up'

  const newChunk = (): Chunk => {
    const canvas = new OffscreenCanvas(crop.w, chunkHeight)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('OffscreenCanvas 2d context unavailable')
    const chunk = { canvas, ctx, filled: 0 }
    chunks.push(chunk)
    return chunk
  }

  const current = (): Chunk => {
    const last = chunks.at(-1)
    return !last || last.filled >= chunkHeight ? newChunk() : last
  }

  const drawPart = (frame: ImageBitmap, from: number, height: number) => {
    const chunk = current()
    const dy = up ? chunkHeight - chunk.filled - height : chunk.filled
    // Bands come in capture-area coordinates but are cut from the whole frame.
    chunk.ctx.drawImage(frame, crop.x, crop.y + from, crop.w, height, 0, dy, crop.w, height)
    chunk.filled += height
  }

  return {
    push(frame, from, to) {
      let height = to - from
      while (height > 0) {
        const chunk = current()
        const room = Math.min(height, chunkHeight - chunk.filled)
        // Scrolling up fills from the bottom: the band's lower edge goes into
        // the current chunk, the rest into the next one, stacked above it.
        if (up) drawPart(frame, to - room, room)
        else drawPart(frame, from, room)

        if (up) to -= room
        else from += room
        height -= room
      }
    },

    compose() {
      const total = chunks.reduce((sum, chunk) => sum + chunk.filled, 0)
      const canvas = new OffscreenCanvas(crop.w, Math.max(1, total))
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('OffscreenCanvas 2d context unavailable')

      const ordered = up ? [...chunks].reverse() : chunks
      let y = 0
      for (const chunk of ordered) {
        const from = up ? chunkHeight - chunk.filled : 0
        ctx.drawImage(chunk.canvas, 0, from, crop.w, chunk.filled, 0, y, crop.w, chunk.filled)
        y += chunk.filled
      }
      return canvas.transferToImageBitmap()
    },
  }
}
