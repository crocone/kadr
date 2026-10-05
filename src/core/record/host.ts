/**
 * The message handlers a recording host answers.
 *
 * Two documents host the recorder and they answer identically, so the handlers live here
 * rather than being written twice. Which document it is depends on the source, and not by
 * choice: a tab is recorded in the offscreen document, while a window or a screen has to
 * be recorded in the picker window, because Chrome binds the stream id `chooseDesktopMedia`
 * hands out to the very frame that asked for it.
 *
 * Two hosts can be alive at once all the same — the offscreen document is created for
 * recovery and clipboard work while the picker window records — and a broadcast reaches
 * both. So stop and pause are answered only by the document that owns the take: an idle
 * host answering "not recording" first was an error outracing the real host's result,
 * and the worker salvaged a recording that was stopping perfectly well.
 */
import { registerMessageHandlers } from '@/core/messaging'

import {
  PickerDismissed,
  ownsRecording,
  pauseRecording,
  recoverRecording,
  startRecording,
  stopRecording,
} from './recorder'

export function registerRecorderHandlers(): () => void {
  const unregisterOwned = registerOwnedHandlers()
  const unregister = registerMessageHandlers({
    'recorder:start': async (request) => {
      try {
        await startRecording(request)
        return { ok: true }
      } catch (error) {
        // The message goes back to the worker, so the reason has to be a string: an
        // exception thrown here would reach it as "could not establish connection".
        if (error instanceof PickerDismissed) {
          return { ok: false, error: error.message, cancelled: true }
        }
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },

    'recorder:recover': async ({ clipId }) => {
      try {
        return { ok: true, result: await recoverRecording(clipId) }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
  })

  return () => {
    unregisterOwned()
    unregister()
  }
}

/**
 * Stop and pause, answered only while this document owns the take.
 *
 * Declining is deliberate: a host with nothing to stop leaves the message unanswered so
 * the one that is recording — or still merging — can answer it. When no host owns
 * anything the send fails at the worker, which salvages the parts, exactly as it did
 * when this document answered "not recording" — minus the race that killed live stops.
 */
function registerOwnedHandlers(): () => void {
  const listener = (
    message: unknown,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void,
  ): boolean => {
    if (typeof message !== 'object' || message === null || !('type' in message)) return false
    const { type } = message as { type: string }
    if (type !== 'recorder:stop' && type !== 'recorder:pause') return false
    if (!ownsRecording()) return false

    if (type === 'recorder:pause') {
      const { paused } = message as unknown as { paused: boolean }
      sendResponse({ ok: true, paused: pauseRecording(paused) })
      return true
    }

    void stopRecording().then(
      (result) => {
        console.info('[kadr] recorder: stopped', {
          file: result.file,
          seconds: Math.round(result.duration / 100) / 10,
          size: result.size,
        })
        sendResponse({ ok: true, result })
      },
      (error: unknown) => {
        console.error('[kadr] recorder: could not stop', error)
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) })
      },
    )
    return true
  }

  chrome.runtime.onMessage.addListener(listener)
  return () => {
    chrome.runtime.onMessage.removeListener(listener)
  }
}
