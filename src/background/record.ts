/**
 * Screen-recording orchestration.
 *
 * The worker does everything that needs an extension API and nothing that needs to run
 * for ten minutes straight: it negotiates the stream id, wakes the offscreen document,
 * keeps the pointer to the active recording in session storage, collects the event
 * timeline from the page, and writes the clip record when it is over. The recording
 * itself is offscreen, because this worker will be suspended long before the recording
 * ends.
 *
 * The event timeline is collected here rather than accumulated in the page for the same
 * reason Scribe writes its steps immediately: a navigation destroys the content script
 * along with anything it was holding, and the auto-zoom for the second half of the clip
 * would go with it.
 */
import contentScriptPath from '@/content/index?iife'
import { CaptureFailure } from '@/core/capture/types'
import { domainOf, newImageId } from '@/core/doc'
import { defaultEdit, DEFAULT_DECORATION } from '@/core/record/defaults'
import { MAX_DURATION_MS, MIN_HEADROOM_BYTES } from '@/core/record/limits'
import { deleteChunks, storageHeadroom, unmergedRecordings } from '@/core/record/opfs'
import {
  type ActiveRecording,
  clearRecording,
  elapsedOf,
  readRecording,
  timelineTime,
  writeRecording,
} from '@/core/record/session'
import { capEvents, clampEvents, type RecordEvent, toFrameSpace } from '@/core/record/timeline'
import type { Clip, ClipId, RecordSource } from '@/core/record/types'
import { hasOrigin, originPatternOf } from '@/core/permissions/host-access'
import { hasRecordingPermission } from '@/core/permissions/recording'
import { type RecordResult, type RecordStatus, sendMessage, sendTabMessage } from '@/core/messaging'
import { getClip, putClip, putImage } from '@/core/storage/db'

import { showBusy, clearBadge } from './badge'
import { ensureContentScript } from './content-script'
import { keepServiceWorkerAlive } from './keep-alive'

const OFFSCREEN_PAGE = 'src/offscreen/index.html'
const PICKER_PAGE = 'src/picker/index.html'

/** Nobody spends two minutes choosing a window; past that the dialog is gone or stuck. */
const PICKER_TIMEOUT_MS = 120_000

/** Where the page's events pile up while recording. Cleared when the clip is written. */
const EVENTS_KEY = 'record:events'

/**
 * Session storage has a quota, and cursor samples are the only thing here numerous
 * enough to threaten it. Twelve thousand events is roughly ten minutes of a thinned
 * pointer plus everything else, well inside the limit.
 */
const MAX_EVENTS = 12_000

function newClipId(): ClipId {
  return `clip_${crypto.randomUUID()}`
}

/**
 * One offscreen document per extension, and Chrome throws rather than answering if you
 * ask for a second. Creation races against itself too — two starts in the same tick —
 * so the promise is memoized for as long as this worker lives.
 */
let creating: Promise<void> | null = null

async function ensureOffscreen(): Promise<void> {
  if (await offscreenAlive()) return

  creating ??= chrome.offscreen
    .createDocument({
      url: OFFSCREEN_PAGE,
      reasons: [chrome.offscreen.Reason.USER_MEDIA, chrome.offscreen.Reason.DISPLAY_MEDIA],
      justification: 'Recording a tab or the screen with MediaRecorder',
    })
    .finally(() => {
      creating = null
    })

  await creating
}

/**
 * Tears down whichever document was hosting the recorder.
 *
 * Both are closed, not just the one in use: the offscreen document and the recorder
 * window are alternatives, and after a start that failed halfway either could be left
 * standing with a capture stream in it. A stream nobody owns is what makes the next
 * recording fail with a message about the previous one.
 */
async function closeRecorderHost(windowId: number | null): Promise<void> {
  await chrome.offscreen.closeDocument().catch(() => undefined)
  if (windowId !== null) await chrome.windows.remove(windowId).catch(() => undefined)
}

/**
 * The stream id for a tab, and whether sound comes with it.
 *
 * Only a tab. `chrome.tabCapture` lives in the worker and nowhere else, so this is the
 * one source it can negotiate. A window or a screen is chosen by the offscreen document
 * instead — see `offscreen:recordStart`, where the reason is written out.
 */
/**
 * The recorder window: what it reported, and how to wait for it.
 *
 * Held in worker memory on purpose — it is only alive for the seconds between opening the
 * window and hearing back, and the keep-alive covers that gap.
 */
let pending: ((started: { ok: boolean; cancelled?: boolean; error?: string }) => void) | null = null

/** Called by the recorder window once it has picked a source and opened the stream. */
export function hostStarted(started: { ok: boolean; cancelled?: boolean; error?: string }): void {
  pending?.(started)
}

/**
 * Opens the recorder window for a window or screen recording and waits for it to start.
 *
 * The window does the picking and the recording both, and it is the only arrangement
 * Chrome allows. `chooseDesktopMedia` will not run in a service worker without naming a
 * tab; an id named against a tab may only be opened inside that tab; the offscreen
 * document has no access to the API at all; a popup is closed by the dialog taking focus.
 * And even from a plain window the id is bound to the frame that asked, so the asking and
 * the opening cannot be split across two documents.
 *
 * It is sized for the dialog Chrome renders inside it — a small window clips the source
 * list, which is worse than no window at all.
 */
async function startInWindow(request: {
  clipId: ClipId
  source: RecordSource
  microphone: boolean
}): Promise<number | null> {
  const url = chrome.runtime.getURL(
    `${PICKER_PAGE}?source=${request.source}&clip=${request.clipId}&mic=${request.microphone ? '1' : '0'}`,
  )
  const created = await chrome.windows.create({
    url,
    type: 'popup',
    focused: true,
    width: 760,
    height: 620,
  })
  const windowId = created?.id ?? null

  const stopKeepAlive = keepServiceWorkerAlive()
  let cleanup: (() => void) | null = null

  const started = await new Promise<{ ok: boolean; cancelled?: boolean; error?: string }>(
    (resolve) => {
      pending = resolve

      // Closing the window instead of answering the dialog is a cancellation, and nothing
      // else would ever resolve this.
      const onClosed = (closed: number) => {
        if (closed === windowId) resolve({ ok: false, cancelled: true })
      }
      chrome.windows.onRemoved.addListener(onClosed)

      const timer = setTimeout(() => {
        resolve({ ok: false, error: 'the source picker never answered' })
      }, PICKER_TIMEOUT_MS)

      cleanup = () => {
        clearTimeout(timer)
        chrome.windows.onRemoved.removeListener(onClosed)
      }
    },
  ).finally(() => {
    pending = null
    cleanup?.()
    stopKeepAlive()
  })

  if (started.ok) {
    // The window is not touched from here: it places itself once recording starts — a
    // corner panel for a window take, minimized for a screen take, where anything
    // visible would end up inside the frame. It knows the screen size; this worker
    // does not.
    return windowId
  }

  if (windowId !== null) await chrome.windows.remove(windowId).catch(() => undefined)
  if (started.cancelled) throw new CaptureFailure('cancelled', 'source picker dismissed')
  throw new CaptureFailure('capture-failed', started.error ?? 'the recorder window failed')
}

async function tabStreamId(tab: chrome.tabs.Tab | null): Promise<string> {
  if (tab?.id === undefined) throw new CaptureFailure('no-active-tab', 'no tab to record')
  try {
    return await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id })
  } catch (error) {
    // Chrome says "Error starting tab capture" and nothing more. It means one of a small
    // set of things — a browser or Web Store page, a tab the extension was never invoked
    // on, or a tab something else is already capturing — and the message the user gets
    // names them, because the browser's own does not.
    throw new CaptureFailure('tab-capture-refused', String(error))
  }
}

async function readEvents(): Promise<RecordEvent[]> {
  const stored = await chrome.storage.session.get(EVENTS_KEY)
  return (stored[EVENTS_KEY] as RecordEvent[] | undefined) ?? []
}

async function clearEvents(): Promise<void> {
  await chrome.storage.session.remove(EVENTS_KEY)
}

/**
 * Starts a recording. The permission is checked, never requested: `permissions.request`
 * needs a user gesture, which a service worker cannot have — the popup asks before it
 * ever sends this message.
 */
export async function startRecording(request: {
  source: RecordSource
  tab: chrome.tabs.Tab | null
  microphone: boolean
}): Promise<ClipId> {
  if (await readRecording()) throw new CaptureFailure('already-recording', 'a recording is running')

  if (!(await hasRecordingPermission(request.source))) {
    throw new CaptureFailure('no-recording-permission', 'recording permission not granted')
  }
  if ((await storageHeadroom()) < MIN_HEADROOM_BYTES) {
    throw new CaptureFailure('no-space', 'not enough room for a recording')
  }

  const clipId = newClipId()

  /**
   * Anything left holding a stream from a recording that ended badly goes first. Chrome
   * refuses to hand out a second stream for a tab it is already capturing, and says only
   * "Error starting tab capture" about it.
   */
  await closeRecorderHost(null)

  /**
   * Two paths, and the split is Chrome's, not ours.
   *
   * A tab stream is negotiated here, because `chrome.tabCapture` exists only in the
   * worker, and recorded in the offscreen document. A window or a screen is picked and
   * recorded by one window of ours: the id from `chooseDesktopMedia` is bound to the frame
   * that asked for it, so the asking and the opening cannot live in different documents.
   */
  let hostWindowId: number | null = null

  if (request.source === 'tab') {
    // The document is opened before the stream id is asked for: an id expires within
    // seconds, and creating an offscreen document is exactly the kind of delay that
    // outlives one.
    await ensureOffscreen()

    const streamId = await tabStreamId(request.tab).catch(async (error: unknown) => {
      await closeRecorderHost(null)
      throw error
    })

    const started = await sendMessage('recorder:start', {
      clipId,
      streamId,
      source: request.source,
      audio: true,
      microphone: request.microphone,
    })

    if (!started.ok) {
      await deleteChunks(clipId)
      await closeRecorderHost(null)
      console.error('[kadr] record: the recorder refused the stream', started.error)
      throw new CaptureFailure('capture-failed', started.error)
    }
  } else {
    hostWindowId = await startInWindow({
      clipId,
      source: request.source,
      microphone: request.microphone,
    }).catch(async (error: unknown) => {
      await deleteChunks(clipId)
      throw error
    })
  }

  const url = request.tab?.url ?? ''
  const active: ActiveRecording = {
    clipId,
    source: request.source,
    tabId: request.source === 'tab' ? (request.tab?.id ?? null) : null,
    origin: (await hasOrigin(url)) ? (originPatternOf(url) ?? '') : '',
    startedAt: Date.now(),
    before: 0,
    timeline: false,
    viewport: null,
    hostWindowId,
  }

  await clearEvents()
  await writeRecording(active)
  showBusy('REC')

  // The timeline is a bonus, not a precondition: a page that refuses the script still
  // records perfectly well, it just gets no auto-zoom and no drawn cursor.
  if (active.tabId !== null) {
    await beginTimeline(active).catch((error: unknown) => {
      console.warn('[kadr] recording without an event timeline', error)
    })
  }

  return clipId
}

async function beginTimeline(active: ActiveRecording): Promise<void> {
  if (active.tabId === null) return

  await ensureContentScript(active.tabId, contentScriptPath)
  await sendTabMessage(active.tabId, 'content:recordBegin', {})
  await writeRecording({ ...active, timeline: true })
}

/**
 * Anything further out than this is not clock skew, it is a broken measurement — a probe
 * that failed, a recording that ended in a way we did not model — and shifting the
 * timeline by it would be worse than leaving it alone.
 */
const MAX_ALIGN_MS = 5000

/**
 * Puts the event timeline in step with the video.
 *
 * Events are stamped against a clock that starts when the worker is told the recorder
 * started, and that moment is not where the file begins: `getUserMedia` hands over a
 * track, the encoder warms up, the first frame lands some way in — and the message
 * saying so travels back to the worker afterwards. The gap can fall either way, so the
 * correction is signed rather than one-directional. Assuming a direction was how the
 * click rings ended up landing a step behind the pointer that made them.
 *
 * The end of the recording is the reliable anchor, since the last frame and the stop are
 * the same moment. Everything is shifted by the difference between the elapsed clock at
 * that moment and the length the file actually turned out to be.
 */
function alignEvents(
  events: readonly RecordEvent[],
  active: ActiveRecording,
  result: RecordResult,
): RecordEvent[] {
  const drift = elapsedOf(active, result.stoppedAt) - result.duration
  if (!Number.isFinite(drift) || Math.abs(drift) > MAX_ALIGN_MS) return [...events]

  return events.map((event) => ({ ...event, at: event.at - drift }))
}

/**
 * Turns a finished recording into a clip record.
 *
 * Shared by the ordinary stop, by an ending nobody asked for — Chrome's stop-sharing
 * bar, the recorded tab closing, the duration limit — and by recovery after a crash.
 * The difference between those is one of who noticed, not of what has to happen next.
 *
 * It writes the record and stops there. Clearing the session pointer is the caller's
 * business, because recovery can be writing a clip from a dead session while a live
 * recording is running, and clearing that one's pointer would end it.
 */
async function writeClip(
  active: ActiveRecording,
  result: RecordResult,
  events: readonly RecordEvent[],
): Promise<ClipId | null> {
  // Two corrections, in order: the clock, then the coordinate space. Both are known only
  // now — the first needs the finished file's length, the second its pixel size.
  const timed = clampEvents(alignEvents(events, active, result), result.duration)
  const timeline = toFrameSpace(timed, active.viewport, { w: result.width, h: result.height })

  let poster: string | null = null
  if (result.poster) {
    try {
      const blob = await (await fetch(result.poster)).blob()
      poster = newImageId()
      await putImage({
        id: poster,
        blob,
        width: 0,
        height: 0,
        dpr: 1,
        createdAt: Date.now(),
        source: null,
      })
    } catch (error) {
      console.warn('[kadr] poster lost', error)
      poster = null
    }
  }

  const tab = active.tabId === null ? null : await chrome.tabs.get(active.tabId).catch(() => null)
  const url = tab?.url ?? ''
  const now = Date.now()

  const clip: Clip = {
    version: 1,
    id: active.clipId,
    title: clipTitle(tab?.title, url, active.source),
    createdAt: now,
    updatedAt: now,
    source: active.source,
    file: result.file,
    mime: result.mime,
    duration: result.duration,
    width: result.width,
    height: result.height,
    size: result.size,
    audio: result.audio,
    page: url ? { url, title: tab?.title ?? '', domain: domainOf(url) } : null,
    viewport: active.viewport,
    events: timeline,
    edit: defaultEdit(result.duration),
    decoration: { ...DEFAULT_DECORATION },
    poster,
    stillDocId: null,
  }

  await putClip(clip)
  return clip.id
}

/** Writes the clip and ends the session it came from: the ordinary path. */
async function finishClip(active: ActiveRecording, result: RecordResult): Promise<ClipId | null> {
  const clipId = await writeClip(active, result, await readEvents())
  await clearEvents()
  await clearRecording()
  clearBadge()
  return clipId
}

/**
 * The page title if there is one, the domain if there is not, and the kind of recording
 * if there is neither — a window or screen capture has no page behind it at all.
 */
function clipTitle(title: string | undefined, url: string, source: RecordSource): string {
  if (title) return title
  const domain = domainOf(url)
  if (domain) return domain
  return source === 'tab'
    ? 'Tab recording'
    : source === 'window'
      ? 'Window recording'
      : 'Screen recording'
}

/** The stop in flight. A second Stop press joins it rather than racing the host. */
let stopping: Promise<ClipId | null> | null = null

export async function stopRecording(): Promise<ClipId | null> {
  /**
   * Serialized on purpose. Stopping takes seconds — the host merges the parts and probes
   * the file — and a Stop pressed again in that window used to send a second
   * `recorder:stop`, hear "not recording", and go salvaging: which closed the host
   * mid-merge and lost the take it was salvaging.
   */
  stopping ??= stopRecordingNow().finally(() => {
    stopping = null
  })
  return await stopping
}

async function stopRecordingNow(): Promise<ClipId | null> {
  const active = await readRecording()
  if (!active) {
    console.info('[kadr] record: stop with nothing recording')
    return null
  }

  if (active.tabId !== null && active.timeline) {
    await sendTabMessage(active.tabId, 'content:recordEnd', {}).catch(() => undefined)
  }

  /**
   * Brought back on screen before the stop is sent. The host is about to read the
   * finished file's numbers through a `<video>` element, and Chrome does not load media
   * in a window nobody can see — probed minimized, every screen recording came back as
   * 0×0 and 0:00 over a perfectly good file.
   */
  if (active.hostWindowId !== null) {
    await chrome.windows.update(active.hostWindowId, { state: 'normal' }).catch(() => undefined)
  }

  const stopped = await sendMessage('recorder:stop', {}).catch(() => null)
  await closeRecorderHost(active.hostWindowId)

  if (stopped?.ok) return await finishClip(active, stopped.result)

  /**
   * The host could not finish the take: it was reloaded, or it had already ended by
   * itself and forgotten the session.
   *
   * The parts are not deleted. They are the recording — the one thing here that cannot be
   * reproduced — and the fact that a message failed says nothing about the bytes on disk.
   * Deleting them was how a stop that went wrong turned into a recording that was never
   * saved and could not be found afterwards either. Salvaging them instead gives back the
   * take, minus at most the last chunk.
   */
  console.warn('[kadr] record: the host could not stop cleanly, salvaging', stopped?.error)
  await clearEvents()
  await clearRecording()
  clearBadge()

  const [salvaged] = await recoverRecordings()
  return salvaged ?? null
}

/**
 * The offscreen document reporting an ending it noticed first. The clip is written the
 * same way; only the badge differs, because the user did not press anything and needs
 * to be told the recording is over.
 */
export async function recordingEnded(
  clipId: ClipId,
  result: RecordResult | undefined,
): Promise<ClipId | null> {
  const active = await readRecording()
  const known = active?.clipId === clipId

  if (known) {
    if (active.tabId !== null && active.timeline) {
      await sendTabMessage(active.tabId, 'content:recordEnd', {}).catch(() => undefined)
    }
    await closeRecorderHost(active.hostWindowId)
  }

  if (!result) {
    // Same rule as a failed stop: the parts stay, because they are the footage. Recovery
    // picks them up on the next look.
    console.warn('[kadr] record: the recording ended with no result, leaving the parts')
    if (known) {
      await clearEvents()
      await clearRecording()
      clearBadge()
    }
    return null
  }

  /**
   * A finished recording is written even when the worker has no pointer to it.
   *
   * The host can end a take on its own — the source went away, the limit ran out — and it
   * reports that the moment it happens, which may be before the worker has finished
   * writing down that the recording exists at all. Insisting on a matching pointer threw
   * the take away in exactly that window, and every trace of it with the pointer that
   * arrived a moment later. A result in hand is a recording on disk; it gets saved, and
   * the bookkeeping catches up.
   */
  if (!known) {
    // A stop and a self-ending can finish the same take: both get the same result from
    // the host, and whichever wrote the clip first wrote it with the event timeline.
    // Writing again from here would replace it with a copy that has none.
    if (await getClip(clipId)) return clipId

    console.warn('[kadr] record: a recording ended before its pointer was written', clipId)
    await closeRecorderHost(null)
  }

  const owner: ActiveRecording = known
    ? active
    : {
        clipId,
        source: 'screen',
        tabId: null,
        origin: '',
        startedAt: null,
        before: 0,
        timeline: false,
        viewport: null,
        hostWindowId: null,
      }

  const written = await writeClip(owner, result, known ? await readEvents() : [])
  await clearEvents()
  await clearRecording()
  clearBadge()

  return written
}

/**
 * Recordings whose session died: a crashed renderer, a killed browser, an extension
 * update mid-take. The chunks are on disk either way — they are written and closed one
 * at a time precisely so that this is possible — and turning them into clips is the
 * whole of the recovery.
 *
 * Run at startup and whenever the popup asks for status. The second is not redundant:
 * only the offscreen document dies in the common case, and the browser never restarts
 * to tell us about it.
 *
 * A recovered clip has no event timeline. The events lived in session storage, which is
 * gone with the browser — so there is no auto-zoom and no drawn cursor on a salvaged
 * recording, and that is a great deal better than no recording.
 */
export async function recoverRecordings(): Promise<ClipId[]> {
  const abandoned = await unmergedRecordings().catch(() => [])
  if (abandoned.length === 0) return []

  const active = await readRecording()
  // A recording that is genuinely still running owns its parts; leave them alone.
  const live = (await hostAlive(active)) ? (active?.clipId ?? null) : null
  const orphans = abandoned.filter((clipId) => clipId !== live)
  if (orphans.length === 0) return []

  // The pointer belongs to a session that no longer exists.
  if (active && active.clipId !== live) {
    await clearRecording()
    await clearEvents()
    clearBadge()
  }

  await ensureOffscreen()
  const recovered: ClipId[] = []

  for (const clipId of orphans) {
    const answer = await sendMessage('recorder:recover', { clipId }).catch(() => null)
    if (!answer?.ok || answer.result.duration <= 0) {
      // Nothing playable came out — a recording that died in its first moments. Keeping
      // the fragments would be keeping rubbish nothing can open, but it is said out loud:
      // silence here reads as "the recording vanished" to the only person who would know.
      console.warn(
        '[kadr] record: salvaged nothing playable from',
        clipId,
        answer?.ok === false ? answer.error : 'the file had no duration',
      )
      await deleteChunks(clipId)
      continue
    }

    const salvaged: ActiveRecording = {
      clipId,
      source: active?.clipId === clipId ? active.source : 'tab',
      tabId: null,
      origin: '',
      startedAt: null,
      before: 0,
      timeline: false,
      viewport: null,
      hostWindowId: null,
    }
    // No events: the timeline lived in session storage, which a crash took with it. The
    // recovered clip gets no auto-zoom and no drawn cursor, which is the honest state of
    // it rather than someone else's events borrowed to fill the gap.
    const written = await writeClip(salvaged, answer.result, [])
    if (written) recovered.push(written)
  }

  // Only if nothing is recording: a recovery running alongside a live take shares the
  // host with it, and closing it here would stop the recording.
  if (!live) await closeRecorderHost(active?.hostWindowId ?? null)
  return recovered
}

/**
 * Whether the document holding the recording is still there.
 *
 * It is not always the offscreen document: a window or screen capture is hosted by a
 * window of ours. Asking only about the offscreen document declared every live window
 * recording abandoned — so opening the popup, which checks for interrupted recordings,
 * salvaged the take out from under itself and closed the window. From the outside that
 * looked like the recording stopping when the extension icon was clicked, and then the
 * editor never opening, because by the time Stop was pressed there was nothing left to
 * stop.
 */
async function hostAlive(active: ActiveRecording | null): Promise<boolean> {
  if (!active) return false
  if (active.hostWindowId === null) return await offscreenAlive()

  return await chrome.windows.get(active.hostWindowId).then(
    () => true,
    () => false,
  )
}

async function offscreenAlive(): Promise<boolean> {
  const contexts = await chrome.runtime
    .getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })
    .catch(() => [])
  return contexts.length > 0
}

export async function pauseRecording(paused: boolean): Promise<boolean> {
  const active = await readRecording()
  if (!active) return false

  const answer = await sendMessage('recorder:pause', { paused }).catch(() => null)
  if (!answer?.ok) return active.startedAt === null

  const now = Date.now()
  // The clock is banked on pause and restarted on resume: the event timeline must not
  // count seconds the file does not contain.
  const next: ActiveRecording = answer.paused
    ? { ...active, before: elapsedOf(active, now), startedAt: null }
    : { ...active, startedAt: now }

  await writeRecording(next)
  showBusy(answer.paused ? 'II' : 'REC')
  return answer.paused
}

export async function recordingStatus(): Promise<RecordStatus> {
  const active = await readRecording()
  return {
    recording: active !== null,
    clipId: active?.clipId ?? null,
    source: active?.source ?? null,
    startedAt: active?.startedAt ?? null,
    paused: active !== null && active.startedAt === null,
    before: active?.before ?? 0,
    limit: MAX_DURATION_MS,
  }
}

/**
 * A batch of page events.
 *
 * The page stamps them with wall clock and the conversion to recording time happens
 * here, because only this side knows about pauses: a paused stretch does not exist in
 * the file, and an event timed against the wall would land later and later in the clip
 * with every pause taken.
 */
export async function recordEvents(
  events: readonly RecordEvent[],
  viewport: { w: number; h: number },
  sender: chrome.runtime.MessageSender,
): Promise<boolean> {
  const active = await readRecording()
  if (!active || sender.tab?.id !== active.tabId) return false
  // Events from a pause belong to no moment in the file at all.
  if (active.startedAt === null) return true

  // The latest reported viewport wins. A window resized mid-recording changes the page's
  // place in the frame, and the end of a clip is more often the part being looked at.
  if (active.viewport?.w !== viewport.w || active.viewport.h !== viewport.h) {
    await writeRecording({ ...active, viewport })
  }

  const timed = events.map((event) => ({ ...event, at: timelineTime(active, event.at) }))
  const stored = await readEvents()
  const merged = capEvents([...stored, ...timed], MAX_EVENTS)
  await chrome.storage.session.set({ [EVENTS_KEY]: merged })
  return true
}

/**
 * The recorded tab finished loading a new page. The script is put back so the timeline
 * continues — but only where permission allows: without it, `activeTab` has already
 * expired and injecting would fail anyway.
 *
 * The recording itself survives navigation regardless. `tabCapture` follows the tab,
 * not the document.
 */
export async function onRecordedTabUpdated(tabId: number): Promise<void> {
  const active = await readRecording()
  if (active?.tabId !== tabId) return

  /**
   * Tried on every navigation, whatever happened on the last one.
   *
   * This used to give up unless the site permission was held, and nothing asks for that
   * permission when a recording starts — so the timeline died at the first navigation and
   * every click after it went unrecorded. `activeTab` survives a same-origin navigation,
   * which covers most of what a recording actually does, and a page that genuinely
   * refuses the script simply fails here and is tried again at the next load.
   */
  await beginTimeline(active).catch(async () => {
    await writeRecording({ ...active, timeline: false })
  })
}
