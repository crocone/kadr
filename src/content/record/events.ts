/**
 * The event timeline of a screen recording, collected from the page.
 *
 * This is what the video cannot contain. It records pixels, with no way to know that
 * they changed because someone clicked a button rather than because an ad rotated. The
 * camera moves and the click ripples both come from here.
 *
 * The pointer is deliberately not sampled. Chromium composites the real cursor into the
 * captured frame, so a path recorded here could only ever draw a second one next to it —
 * and sampling it cost a message every forty milliseconds for the privilege.
 *
 * There is no HUD, and that is deliberate. Everything the extension draws on a recorded
 * page ends up in the video for good: a "recording…" badge in the corner of a clip is a
 * watermark nobody asked for. The action badge says REC and the popup stops it.
 *
 * As with Scribe, listeners sit in the capture phase and intercept nothing — no
 * `preventDefault`, no `stopPropagation`. A recorder that breaks the page it is
 * recording has failed twice.
 *
 * Nothing typed is ever recorded. A `key` event says a key was pressed; a `focus` event
 * says a field was entered. Neither carries what was in it.
 */
import { sendMessage } from '@/core/messaging'
import type { RecordEvent } from '@/core/record/timeline'

/** How often a batch goes to the worker. One message a second, not one per sample. */
const FLUSH_MS = 1000

/** Scroll fires at frame rate; the camera only needs to know the page moved. */
const SCROLL_SAMPLE_MS = 150

type Recorder = {
  buffer: RecordEvent[]
  timer: ReturnType<typeof setInterval>
  detach: () => void
  lastScrollAt: number
}

let active: Recorder | null = null

/**
 * Viewport fractions rather than pixels. The frame is captured at the device pixel
 * ratio, cropped in the editor and scaled again on export — a pixel coordinate would
 * survive none of those, and a fraction survives all three.
 *
 * The divisor is `innerWidth`, not `clientWidth`: a tab capture records the scrollbar
 * along with the page, so the frame is the wider of the two. Dividing by the narrower
 * one stretches every coordinate by the width of the scrollbar — about one and a half
 * per cent, which is very visible on a camera that is supposed to centre on a button.
 */
function viewport(): { width: number; height: number } {
  return {
    width: window.innerWidth || document.documentElement.clientWidth || 1,
    height: window.innerHeight || document.documentElement.clientHeight || 1,
  }
}

function fraction(x: number, y: number): { x: number; y: number } {
  const { width, height } = viewport()
  return { x: x / width, y: y / height }
}

function rectOf(element: Element): RecordEvent['rect'] {
  const box = element.getBoundingClientRect()
  if (box.width <= 0 || box.height <= 0) return null

  const { width, height } = viewport()
  return { x: box.left / width, y: box.top / height, w: box.width / width, h: box.height / height }
}

function push(event: RecordEvent): void {
  active?.buffer.push(event)
}

/**
 * Sends what has piled up. A failed send drops the batch rather than retrying: the
 * worker may have been restarting, and a timeline missing a click is worth far less
 * trouble than one that grows without bound waiting to be delivered.
 */
async function flush(): Promise<void> {
  const recorder = active
  if (!recorder || recorder.buffer.length === 0) return

  const batch = recorder.buffer
  recorder.buffer = []
  const { width, height } = viewport()
  try {
    await sendMessage('record:events', { events: batch, viewport: { w: width, h: height } })
  } catch (error) {
    console.warn('[kadr] event batch lost', error)
  }
}

export function beginEventRecording(): void {
  if (active) return

  /**
   * The click is taken on `pointerdown`, like Scribe's: between it and `click` the page
   * has already reacted, and the element the camera should frame may be gone.
   */
  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return
    const target = event.target instanceof Element ? event.target : null

    push({
      kind: 'click',
      at: Date.now(),
      point: fraction(event.clientX, event.clientY),
      rect: target ? rectOf(target) : null,
    })
  }

  const onScroll = (event: Event) => {
    const recorder = active
    if (!recorder || event.timeStamp - recorder.lastScrollAt < SCROLL_SAMPLE_MS) return
    recorder.lastScrollAt = event.timeStamp

    push({ kind: 'scroll', at: Date.now(), point: null, rect: null })
  }

  const onFocusIn = (event: FocusEvent) => {
    const target = event.target
    if (
      !(target instanceof HTMLInputElement) &&
      !(target instanceof HTMLTextAreaElement) &&
      !(target instanceof HTMLSelectElement)
    ) {
      return
    }
    push({ kind: 'focus', at: Date.now(), point: null, rect: rectOf(target) })
  }

  /**
   * That a key was pressed, and nothing else — no code, no character, no modifiers. It
   * exists so a stretch of typing does not read as dead air to the pause detector.
   */
  const onKeyDown = () => {
    push({ kind: 'key', at: Date.now(), point: null, rect: null })
  }

  window.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true })
  window.addEventListener('scroll', onScroll, { capture: true, passive: true })
  window.addEventListener('focusin', onFocusIn, true)
  window.addEventListener('keydown', onKeyDown, { capture: true, passive: true })

  active = {
    buffer: [],
    timer: setInterval(() => {
      void flush()
    }, FLUSH_MS),
    lastScrollAt: 0,
    detach: () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('focusin', onFocusIn, true)
      window.removeEventListener('keydown', onKeyDown, true)
    },
  }
}

/**
 * Stops recording and returns once the last batch has actually been delivered.
 *
 * The wait is the point. The worker asks the page to stop, then immediately stops the
 * recorder and reads the timeline out of session storage — so a final batch that is
 * merely in flight arrives after the clip has already been written, and the last clicks
 * of every recording go missing. They are the ones most worth having.
 */
export async function endEventRecording(): Promise<void> {
  const recorder = active
  if (!recorder) return

  recorder.detach()
  clearInterval(recorder.timer)
  // The buffer is taken synchronously inside `flush`, so it goes out even though the
  // recorder is cleared straight after.
  const sent = flush()
  active = null
  await sent
}

export function isRecordingEvents(): boolean {
  return active !== null
}
