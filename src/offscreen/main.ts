/**
 * Offscreen document: clipboard, tab recording and heavy rendering outside the service
 * worker. The MV3 worker suspends and would cut a recording short, so MediaRecorder can
 * only live in a document.
 *
 * It hosts tab recordings only. A window or a screen goes to the picker window instead:
 * Chrome lets only the frame that opened the source dialog open the stream behind it, and
 * this document may not open that dialog at all — an offscreen document is given
 * `chrome.runtime` and no other extension API.
 */
import { registerMessageHandlers } from '@/core/messaging'
import { registerRecorderHandlers } from '@/core/record/host'
import { isRecording } from '@/core/record/recorder'

registerMessageHandlers({ ping: () => ({ ok: true, from: 'offscreen' }) })
registerRecorderHandlers()

/**
 * The worker closes this document when the recording is over. If it forgets — a crash,
 * an update — the document would sit here holding a capture stream. Not worth a
 * heartbeat: a document with no recording in it costs nothing, and this log is how we
 * find out it happened.
 */
window.addEventListener('pagehide', () => {
  if (isRecording()) console.warn('[kadr] offscreen closed mid-recording')
})
