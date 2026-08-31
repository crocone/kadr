/**
 * Typed messages between popup, service worker, content script, and offscreen.
 * One union for the whole extension: add a mode and the compiler finds every
 * place that has to handle it.
 */
import type { RollDirection } from '@/core/capture/rolling'
import type { PageMetrics } from '@/core/capture/types'
import type { DocId, Rect } from '@/core/doc/types'
import type { ElementRef } from '@/core/dom/selector'
import type { GuideId, ScribeEvent } from '@/core/scribe/timeline'
import type { TableFormat } from '@/core/table/format'

export type CaptureMode = 'fullPage' | 'visible' | 'area' | 'element' | 'scroll'

export type CaptureErrorCode =
  | 'unsupported-page'
  | 'cancelled'
  | 'no-active-tab'
  | 'content-unreachable'
  | 'capture-failed'
  | 'element-not-found'

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
   * Scroll capture (PLAN.md §3). Pick target and direction: whole page or an
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
   * Reshoot documents from their recipes (PLAN.md §6.5). The initiating page
   * requests site permission from a user gesture: Chrome rejects
   * `permissions.request` without one, and a service worker can never have a gesture.
   */
  'reshoot:run': {
    request: { docIds: DocId[] }
    response: { ok: true; results: ReshootOutcome[] } | { ok: false; error: CaptureErrorCode }
  }

  /**
   * Scribe: start recording a guide on the active tab (PLAN.md §6.5). The popup
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

  /** Open the shot library in its own tab. */
  'library:open': {
    request: Record<string, never>
    response: { ok: true }
  }
  /** Liveness check of the content script before injecting a second copy. */
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
