/**
 * Typed messages between popup, service worker, and content script.
 * One union for the whole extension: add a mode and the compiler finds every
 * place that has to handle it.
 */
import type { RollDirection } from '@/core/capture/rolling'
import type { CaptureError, PageMetrics } from '@/core/capture/types'
import type { DocId, Rect } from '@/core/doc/types'
import type { ElementRef } from '@/core/dom/selector'
import type { RecordEvent } from '@/core/record/timeline'
import type { ClipId, RecordSource } from '@/core/record/types'
import type { GuideId, ScribeEvent } from '@/core/scribe/timeline'
import type { TableFormat } from '@/core/table/format'

export type CaptureMode = 'fullPage' | 'visible' | 'area' | 'element' | 'scroll'

/**
 * The same list `CaptureFailure` throws, under the name the message layer uses. It was
 * written out twice for a while, and the copies drifted the first time a reason was
 * added — an alias cannot.
 */
export type CaptureErrorCode = CaptureError

export const CAPTURE_MODES: readonly CaptureMode[] = [
  'fullPage',
  'visible',
  'area',
  'element',
  'scroll',
]

/** Maps menu items and hotkeys to capture modes. */
export const CAPTURE_COMMANDS: Record<string, CaptureMode> = {
  'capture-fullpage': 'fullPage',
  'capture-visible': 'visible',
  'capture-area': 'area',
  'capture-element': 'element',
  'capture-scroll': 'scroll',
}

/**
 * What to do with the captured frame, picked on the toolbar under the selection.
 * Before that toolbar, every capture ended in an open editor.
 */
export type SelectionAction = 'edit' | 'copy' | 'download'

/**
 * Which coordinate space the rect is in. `viewport` is cropped from the frozen
 * frame; `page` means page coordinates — the element may not fit the viewport,
 * and the background decides whether to scroll or stitch.
 */
export type SelectionScope = 'viewport' | 'page'

/**
 * Result of copying a table. No frame at all: element selection is no longer
 * "always a screenshot" — the table leaves as text straight from the content script.
 */
export type TableCopy = {
  format: TableFormat
  /** Data rows, header excluded — the number the user saw on the button. */
  rows: number
  copied: boolean
}

/** Response to area/element selection; the user may have pressed Esc. */
export type SelectionResponse =
  | {
      ok: true
      rect: Rect
      label?: string
      /** Ref to the selected element so a reshoot can find it again. */
      element?: ElementRef
      action?: SelectionAction
      scope?: SelectionScope
      /** Frame to crop from: scrolling with Space re-captures the page. */
      frameId?: number
      /**
       * Page scroll at selection time. Not the same as when metrics were taken:
       * Space scrolls the live page, and without this number the recipe would
       * remember the same screen band but with different content.
       */
      scroll?: { x: number; y: number }
      /**
       * Whether the copy reached the clipboard. The overlay writes it right in the
       * click handler: the Clipboard API needs a user gesture and a focused document,
       * and the service worker has neither. The background can only report failure.
       */
      copied?: boolean
      table?: undefined
    }
  | { ok: false; cancelled: true }

/**
 * Element selection can do what area selection cannot: copy the table under the
 * cursor as text. So the table variant lives here, not in the shared response —
 * the area overlay never returns it.
 */
export type ElementSelectionResponse = SelectionResponse | { ok: true; table: TableCopy }

/**
 * Response to scroll-capture target selection. Lives here rather than in the
 * content script: both sides share the type, and the background must not import
 * a DOM module.
 */
export type ScrollTargetResponse =
  | {
      ok: true
      /** Capture area in viewport CSS pixels; strips are cut from it. */
      rect: Rect
      direction: RollDirection
      scrollTop: number
      viewportHeight: number
      /**
       * How many pixels of the area the HUD covers. It stays up for the whole
       * capture, so this band is cut out of `rect` — the background re-shoots it
       * with one final frame after the overlay is gone.
       */
      hudBand: number
    }
  | { ok: false; cancelled: true }

export type RollStepResult = { scrollTop: number; stopped: boolean }

/**
 * Result of reshooting one document, in the shape that survives serialization
 * between page and background: the failure reason is a string, not an exception.
 */
export type ReshootOutcome =
  { ok: true; docId: DocId; drift: number } | { ok: false; docId: DocId; reason: string }

/**
 * Response to finding a recorded element. A miss is a legitimate outcome, not an
 * error: a page behind auth shows a login form, and an honest "not found" beats
 * a frame of someone else's content.
 */
export type FindElementResponse =
  { ok: true; rect: Rect; similarity: number } | { ok: false; reason: 'not-found' }

/**
 * State of the recording in progress, as the popup and the page HUD see it. Elapsed
 * time is not in here on purpose: it is `Date.now() - startedAt` minus the pauses, and
 * a number sent once would be stale before it was drawn.
 */
export type RecordStatus = {
  recording: boolean
  clipId: ClipId | null
  source: RecordSource | null
  startedAt: number | null
  paused: boolean
  /** Ms already recorded before the current run — the sum of the parts before each pause. */
  before: number
  /** Automatic stop, ms. The HUD counts down to it. */
  limit: number
}

/**
 * What the offscreen document has to say once the file is on disk. The frame is a data
 * URL rather than a blob: messages are structured-cloned through the extension bus, and
 * a `Blob` does not survive the trip.
 */
export type RecordResult = {
  file: string
  size: number
  duration: number
  /**
   * Wall clock at the moment the recorder actually stopped.
   *
   * This is the anchor that puts the event timeline in step with the video. The encoder
   * warms up for a few hundred milliseconds after `start()`, so the file is shorter than
   * the wall-clock span and its zero point is later than the moment we began counting.
   * The end, though, is exact — so `stoppedAt - duration` is where the file really
   * begins, and the whole timeline is shifted onto that.
   */
  stoppedAt: number
  width: number
  height: number
  poster: string | null
  mime: string
  audio: boolean
}

export type MessageMap = {
  /**
   * Responsive series: three widths in a row as one document. Separate from
   * `capture:start` because its outcome is not a frame but a document assembled
   * from several.
   */
  'capture:responsive': {
    request: { tabId?: number }
    response: { ok: true } | { ok: false; error: CaptureErrorCode }
  }

  /**
   * Popup, hotkey, or menu item asks to capture the active tab. The response
   * arrives right after the start: stitching a long page outlives the popup.
   */
  'capture:start': {
    request: { mode: CaptureMode; tabId?: number }
    response: { ok: true } | { ok: false; error: CaptureErrorCode }
  }

  /**
   * Selection overlay asks for a fresh frame of the tab: Space scrolls the page,
   * so the frozen frame under the selection goes stale. The shot stays in the
   * background and only its id travels — sending a megabyte data URL back in the
   * response would double the cost.
   */
  'capture:frame': {
    request: Record<string, never>
    response: { ok: true; frameUrl: string; frameId: number } | { ok: false }
  }

  // --- Messages to the content script ---

  'content:metrics': {
    request: Record<string, never>
    response: { ok: true; metrics: PageMetrics }
  }
  /** Freezes the page before a frame series: animations, smooth scroll, parallax. */
  'content:prepare': {
    request: Record<string, never>
    response: { ok: true; metrics: PageMetrics }
  }
  'content:restore': {
    request: Record<string, never>
    response: { ok: true }
  }
  'content:scrollTo': {
    request: { y: number }
    response: { ok: true; scrollY: number }
  }
  /** Hides `position: fixed` elements. Sticky ones become static back in prepare. */
  'content:setFixedHidden': {
    request: { hidden: boolean }
    response: { ok: true }
  }
  /** Runs the page down to the bottom so lazy images get a chance to load. */
  'content:warmLazyImages': {
    request: Record<string, never>
    response: { ok: true; metrics: PageMetrics }
  }
  'content:countdown': {
    request: { seconds: number }
    response: { ok: true }
  }
  /** Selection overlay over the frozen frame: pixel-exact crop and magnifier. */
  'content:selectArea': {
    request: { frameUrl: string; frameId: number; devicePixelRatio: number }
    response: SelectionResponse
  }
  'content:selectElement': {
    request: Record<string, never>
    response: ElementSelectionResponse
  }
  /**
   * Find the recorded element and return its rect in page coordinates. Waits a
   * few seconds for the node: lazy layouts render half the page after `complete`.
   */
  'content:findElement': {
    request: { ref: ElementRef }
    response: FindElementResponse
  }
  /**
   * Scroll capture. Pick target and direction: whole page or an
   * inner container, down or up through history.
   */
  'content:selectScrollTarget': {
    request: Record<string, never>
    response: ScrollTargetResponse
  }
  /**
   * One capture step: scroll the target and wait for paint. `top: null` means the
   * first frame — shoot from where we stand. The response carries the actual
   * position and whether Stop was pressed: the background knows nothing about the
   * HUD and asks about it here.
   */
  'content:rollStep': {
    request: { top: number | null; frames: number; rows: number }
    response: { ok: true } & RollStepResult
  }
  /**
   * Switch to the next scrollable container: the chosen one accepts scroll but
   * the picture does not change — so what scrolls is not what is being captured.
   */
  'content:rollNextTarget': {
    request: Record<string, never>
    response: { ok: boolean; scrollTop: number }
  }
  /** Capture is over: the HUD comes down, the chosen target is forgotten. */
  'content:rollDone': {
    request: Record<string, never>
    response: { ok: true }
  }
  /** Open the editor on a document; without docId — an empty editor. */
  'editor:open': {
    request: { docId?: DocId }
    response: { ok: true }
  }
  /**
   * Reshoot documents from their recipes. The initiating page
   * requests site permission from a user gesture: Chrome rejects
   * `permissions.request` without one, and a service worker can never have a gesture.
   */
  'reshoot:run': {
    request: { docIds: DocId[] }
    response: { ok: true; results: ReshootOutcome[] } | { ok: false; error: CaptureErrorCode }
  }

  /**
   * Scribe: start recording a guide on the active tab. The popup
   * requests site permission from a user gesture — without it the recording dies
   * on the first link navigation, when `activeTab` expires.
   */
  'scribe:start': {
    request: { tabId?: number }
    response: { ok: true; guideId: GuideId } | { ok: false; error: CaptureErrorCode }
  }
  'scribe:stop': {
    request: Record<string, never>
    response: { ok: true; guideId: GuideId | null }
  }
  /**
   * A step from the page. The background shoots the frame for it: the content
   * script has no `captureVisibleTab`, and the two-frames-per-second limiter must
   * be a single one for the whole extension.
   */
  'scribe:step': {
    request: { event: ScribeEvent }
    response: { ok: true; steps: number; dropped: number } | { ok: false }
  }
  /** Is recording on: asked by the popup and by the script re-injected after navigation. */
  'scribe:status': {
    request: Record<string, never>
    response: { recording: boolean; guideId: GuideId | null; steps: number; dropped: number }
  }

  /** Turn on recording on the page: listeners and HUD. */
  'content:scribeBegin': {
    request: { steps: number; dropped: number }
    response: { ok: true }
  }
  'content:scribeEnd': {
    request: Record<string, never>
    response: { ok: true }
  }

  /**
   * Screen recording: start capturing the tab, a window, or the whole screen.
   *
   * The `tabCapture` permission is optional and asked for on this same click — a
   * heavy permission requested at install time is a listing nobody accepts. The site
   * permission is asked for alongside it and may be refused: without it the event
   * timeline dies at the first navigation, and the clip is still a clip, just without
   * auto-zoom past that point.
   */
  'record:start': {
    request: { source: RecordSource; tabId?: number; microphone?: boolean }
    response: { ok: true; clipId: ClipId } | { ok: false; error: CaptureErrorCode }
  }
  'record:stop': {
    request: Record<string, never>
    response: { ok: true; clipId: ClipId | null }
  }
  'record:pause': {
    request: { paused: boolean }
    response: { ok: true; paused: boolean }
  }
  /** Asked by the popup and by the HUD after a navigation re-injects the script. */
  'record:status': {
    request: Record<string, never>
    response: RecordStatus
  }
  /**
   * A batch of page events. Batched, not one per event: the cursor is sampled 25 times
   * a second, and a message round trip per sample would cost more than the recording.
   *
   * Times arrive as wall clock and are converted to recording time by the worker. The
   * page cannot do it itself: it does not know about pauses, and seconds that are not in
   * the file must not be in the timeline either.
   */
  'record:events': {
    request: {
      events: RecordEvent[]
      /**
       * Viewport the coordinates were measured against, in CSS pixels. The worker needs
       * it because the recorded frame is not always the same rectangle as the page: a
       * capture stream of a different aspect fits the page inside and pads the rest, and
       * without the page's own size there is no way to tell the two apart.
       */
      viewport: { w: number; h: number }
    }
    response: { ok: true } | { ok: false }
  }

  /**
   * Start recording page events. No HUD comes with it, deliberately: a tab capture
   * records the page, and anything the extension draws on that page is in the video for
   * good. The badge says REC and the popup stops it.
   */
  'content:recordBegin': {
    request: Record<string, never>
    response: { ok: true }
  }
  'content:recordEnd': {
    request: Record<string, never>
    response: { ok: true }
  }

  // --- Messages to whichever document is hosting the recorder ---

  /**
   * The service worker cannot hold a MediaRecorder: MV3 suspends it and the recording
   * would stop mid-sentence. So everything from `getUserMedia` to the last chunk happens
   * in a document — the offscreen one for a tab, and the picker window for a window or a
   * screen, because Chrome will only let the frame that opened the source dialog open the
   * stream behind it.
   */
  'recorder:start': {
    request: {
      clipId: ClipId
      /**
       * Stream to record, or `null` to let the offscreen document choose one itself.
       *
       * A tab stream is negotiated by the worker, because `chrome.tabCapture` lives
       * there. A window or a screen cannot be: `chooseDesktopMedia` demands a target tab
       * when called from a service worker, and an id issued against a tab may only be
       * used by frames inside that tab — never by an offscreen document. Asked for from
       * here instead, with no tab, the id belongs to the extension and the document that
       * asked can actually open it.
       */
      streamId: string | null
      source: RecordSource
      /** Tab audio: kept playing to the user as well, or the page goes silent while recording. */
      audio: boolean
      microphone: boolean
    }
    response: { ok: true } | { ok: false; error: string; cancelled?: boolean }
  }
  'recorder:stop': {
    request: Record<string, never>
    response: { ok: true; result: RecordResult } | { ok: false; error: string }
  }
  'recorder:pause': {
    request: { paused: boolean }
    response: { ok: true; paused: boolean }
  }
  /**
   * Salvage the parts of a recording whose session died. In a document rather than in the
   * worker because reading a duration and a poster frame out of a file needs a `<video>`
   * element, and the worker has no DOM.
   */
  'recorder:recover': {
    request: { clipId: ClipId }
    response: { ok: true; result: RecordResult } | { ok: false; error: string }
  }
  /**
   * The recording ended without us asking: Chrome's own "stop sharing" button, the
   * recorded tab closed, or the duration limit ran out. Sent from the offscreen
   * document to the worker, which finishes the clip exactly as it would on a normal stop.
   */
  'record:ended': {
    request: { clipId: ClipId; reason: 'source-ended' | 'limit' | 'error'; result?: RecordResult }
    response: { ok: true }
  }

  /**
   * The recorder window reporting how its start went.
   *
   * It picks the source and opens the stream itself, so the worker learns both at once.
   * `cancelled` means the dialog was dismissed — an answer, not a failure.
   */
  'record:hostStarted': {
    request: { clipId: ClipId; ok: boolean; cancelled?: boolean; error?: string }
    response: { ok: true }
  }

  /** Open the clip editor on a recording. */
  'clip:open': {
    request: { clipId: ClipId }
    response: { ok: true }
  }

  /** Open the shot library in its own tab. */
  'library:open': {
    request: Record<string, never>
    response: { ok: true }
  }
  /** Liveness check of extension contexts, including the content script before reinjection. */
  ping: {
    request: Record<string, never>
    response: { ok: true; from: 'background' | 'content' | 'offscreen' }
  }
}

export type MessageType = keyof MessageMap
export type MessageRequest<T extends MessageType> = MessageMap[T]['request']
export type MessageResponse<T extends MessageType> = MessageMap[T]['response']

export type Message = {
  [T in MessageType]: { type: T } & MessageRequest<T>
}[MessageType]

export async function sendMessage<T extends MessageType>(
  type: T,
  request: MessageRequest<T>,
): Promise<MessageResponse<T>> {
  return await chrome.runtime.sendMessage({ type, ...request })
}

export async function sendTabMessage<T extends MessageType>(
  tabId: number,
  type: T,
  request: MessageRequest<T>,
): Promise<MessageResponse<T>> {
  return await chrome.tabs.sendMessage(tabId, { type, ...request })
}

export type MessageHandlers = {
  [T in MessageType]?: (
    request: MessageRequest<T>,
    sender: chrome.runtime.MessageSender,
  ) => Promise<MessageResponse<T>> | MessageResponse<T>
}

/**
 * Handler registration. The listener returns `true` only when it actually took
 * the message — otherwise Chrome cuts off someone else's async response.
 */
export function registerMessageHandlers(handlers: MessageHandlers): () => void {
  const listener = (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void,
  ): boolean => {
    if (typeof message !== 'object' || message === null || !('type' in message)) return false
    const { type, ...request } = message as { type: MessageType }
    const handler = handlers[type] as
      ((request: unknown, sender: chrome.runtime.MessageSender) => unknown) | undefined
    if (!handler) return false

    void Promise.resolve(handler(request, sender)).then(sendResponse, (error: unknown) => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) })
    })
    return true
  }

  chrome.runtime.onMessage.addListener(listener)
  return () => chrome.runtime.onMessage.removeListener(listener)
}
