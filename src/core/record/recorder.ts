/**
 * The recorder itself. It runs in a document, never in the worker.
 *
 * MV3 suspends the service worker after thirty seconds of quiet, and a MediaRecorder in a
 * suspended worker is a recording that stops without telling anyone — which is precisely
 * how every "my recording is 28 seconds long" bug report is written.
 *
 * Which document depends on the source, and not by choice. A tab stream is negotiated by
 * the worker and recorded in the offscreen document. A window or a screen cannot be:
 * Chrome binds the id `chooseDesktopMedia` issues to the very frame that asked for it, so
 * whoever opens the dialog is the only one who may open the stream. That frame is a small
 * window of ours, which therefore hosts the recorder too — see `src/picker`.
 *
 * Two things here are easy to get wrong and expensive to discover later. Tab audio must
 * be piped back to the speakers by hand: `tabCapture` takes the sound out of the tab, so
 * without an `AudioContext` echoing it back, the page goes silent for the person
 * recording it — and they only notice on playback. And the stream can end on its own —
 * Chrome's "stop sharing" bar, the recorded tab closing — which is a normal ending, not
 * an error, and has to produce a finished clip rather than a lost one.
 */
import { sendMessage } from '@/core/messaging'
import type { RecordResult } from '@/core/messaging'

import { bitrateFor, CHUNK_MS, MAX_DURATION_MS, pickMimeType } from './limits'
import { type ChunkWriter, clipFile, mergeChunks, openChunks } from './opfs'
import { probeVideo } from './probe'
import type { ClipId, RecordSource } from './types'

type Session = {
  clipId: ClipId
  recorder: MediaRecorder
  stream: MediaStream
  /** Microphone, when asked for: a second stream, stopped separately. */
  microphone: MediaStream | null
  /** Kept alive only to echo tab audio back to the speakers. */
  audioContext: AudioContext | null
  writer: ChunkWriter
  mime: string
  audio: boolean
  /** Chunks still being written when stop arrives; the merge waits for them. */
  writes: Promise<unknown>[]
  limitTimer: ReturnType<typeof setTimeout> | null
  /** Set while stopping, so the track-ended handler does not report a second ending. */
  finishing: boolean
  /** Wall clock at `recorder.start()`; only used to say how long a self-ended take ran. */
  startedAt: number
  /** Footage before the current run, ms — the sum of the stretches before each pause. */
  before: number
  /** When the current run began; `null` while paused. Feeds the control panel's clock. */
  runStartedAt: number | null
}

let session: Session | null = null

/**
 * Constraints for a Chromium capture stream.
 *
 * The `mandatory` shape is the legacy one, and it is the only one that works: the
 * modern `getDisplayMedia` cannot take a stream id from `chrome.tabCapture`, and the
 * whole point of that id is to capture a tab the user is not looking at.
 */
function constraintsFor(
  streamId: string,
  source: RecordSource,
  audio: boolean,
): MediaStreamConstraints {
  const chromeMediaSource = source === 'tab' ? 'tab' : 'desktop'
  const video = { mandatory: { chromeMediaSource, chromeMediaSourceId: streamId } }

  return {
    audio: audio
      ? ({ mandatory: { chromeMediaSource, chromeMediaSourceId: streamId } } as never)
      : false,
    video: video as never,
  }
}

/**
 * Mixes the microphone into the captured sound.
 *
 * Two audio tracks in one MediaRecorder is not a thing: it records the first and drops
 * the rest silently. So they are summed into one track through a Web Audio graph.
 *
 * `echo` says whether the captured sound also has to be played back. It is true for a tab
 * and false for everything else, and the difference is not a preference: `tabCapture`
 * takes the sound out of the tab, so without playing it back the page goes silent for the
 * person recording it. Desktop audio is a loopback and keeps playing on its own — echoing
 * that one puts a second copy of the system sound into the room, a few milliseconds late.
 * Which is exactly what it sounds like.
 */
function mixAudio(
  captured: MediaStream,
  microphone: MediaStream | null,
  echo: boolean,
): { track: MediaStreamTrack | null; context: AudioContext | null } {
  const capturedAudio = captured.getAudioTracks()
  if (capturedAudio.length === 0 && !microphone) return { track: null, context: null }

  const context = new AudioContext()
  const destination = context.createMediaStreamDestination()
  // A context that starts suspended — no user gesture reached this document — mixes
  // silence, and a silent mix records as a perfectly valid, perfectly quiet track.
  if (context.state === 'suspended') void context.resume().catch(() => undefined)

  if (capturedAudio.length > 0) {
    const source = context.createMediaStreamSource(new MediaStream(capturedAudio))
    source.connect(destination)
    if (echo) source.connect(context.destination)
  }
  if (microphone) {
    context.createMediaStreamSource(microphone).connect(destination)
    // The microphone is deliberately not connected to `context.destination`: that is
    // how you hand someone a recording session with their own voice echoing back.
  }

  return { track: destination.stream.getAudioTracks()[0] ?? null, context }
}

/**
 * Chrome's own source picker, opened from here rather than from the worker.
 *
 * `chooseDesktopMedia` refuses to run in a service worker without a target tab, and the
 * id it issues against a tab may only be opened by frames inside that tab — so the one
 * the worker could get was precisely the one this document could not use, and every
 * window and screen recording died in `getUserMedia` with "Error starting tab capture".
 * Asked for here, with no tab, the id belongs to the extension and the caller is also the
 * consumer.
 */
async function pickDesktopSource(
  source: RecordSource,
): Promise<{ streamId: string; audio: boolean }> {
  const picker = chrome.desktopCapture as typeof chrome.desktopCapture | undefined
  if (!picker?.chooseDesktopMedia) {
    throw new Error('chrome.desktopCapture is not available in the offscreen document')
  }

  // Screen sharing can carry system sound; a single window never does.
  const sources: `${chrome.desktopCapture.DesktopCaptureSourceType}`[] =
    source === 'screen' ? ['screen', 'audio'] : ['window']

  return await new Promise((resolve, reject) => {
    picker.chooseDesktopMedia(sources, (streamId, options) => {
      const failure = chrome.runtime.lastError
      if (failure) {
        reject(new Error(failure.message ?? 'the source picker failed'))
        return
      }
      resolve({ streamId: streamId || '', audio: options?.canRequestAudioTrack === true })
    })
  })
}

/** Dismissing the picker is an answer, not a fault; the worker tells the two apart by this. */
export class PickerDismissed extends Error {
  constructor() {
    super('source picker dismissed')
    this.name = 'PickerDismissed'
  }
}

/** The stream died on its own: Chrome's stop-sharing bar, or the recorded tab closing. */
function watchSource(stream: MediaStream): void {
  for (const track of stream.getVideoTracks()) {
    track.addEventListener('ended', () => {
      void finish('source-ended')
    })
  }
}

export async function startRecording(request: {
  clipId: ClipId
  streamId: string | null
  source: RecordSource
  audio: boolean
  microphone: boolean
}): Promise<void> {
  if (session) throw new Error('already recording')

  const picked = request.streamId
    ? { streamId: request.streamId, audio: request.audio }
    : await pickDesktopSource(request.source)
  if (!picked.streamId) throw new PickerDismissed()

  // Named separately from the throw so the worker's log says which of the two things
  // Chrome refused: handing over the stream, or recording it.
  const captured = await navigator.mediaDevices
    .getUserMedia(constraintsFor(picked.streamId, request.source, picked.audio))
    .catch((error: unknown) => {
      throw new Error(`getUserMedia refused the ${request.source} stream: ${String(error)}`)
    })

  let microphone: MediaStream | null = null
  if (request.microphone) {
    /**
     * Echo cancellation is asked for explicitly rather than left to the default.
     *
     * A screen recording with a voice-over has the system sound in it twice over: once
     * captured directly, once picked up by the microphone from the speakers a few
     * milliseconds later. Cancellation is what keeps the second copy out; noise
     * suppression and gain control come along because a voice-over is exactly the case
     * they were built for.
     *
     * A refused microphone does not cancel the recording: the picture is the point, and
     * asking someone to start over because they mis-clicked a prompt is not a fix.
     */
    microphone = await navigator.mediaDevices
      .getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      .catch((error: unknown) => {
        // Loud on purpose. An offscreen document cannot show the permission prompt, so
        // a microphone never allowed elsewhere fails here quietly — and "the recording
        // has no sound" is the only symptom anyone sees.
        console.warn('[kadr] recorder: the microphone was refused', error)
        return null
      })
  }

  const { track: audioTrack, context } = mixAudio(captured, microphone, request.source === 'tab')
  const stream = new MediaStream([
    ...captured.getVideoTracks(),
    ...(audioTrack ? [audioTrack] : []),
  ])
  console.info('[kadr] recorder: sound', {
    source: captured.getAudioTracks().length,
    microphone: microphone !== null,
  })

  const video = captured.getVideoTracks()[0]
  const settings = video?.getSettings() ?? {}
  const mime = pickMimeType()
  const bitrate = bitrateFor(
    settings.width ?? 1280,
    settings.height ?? 720,
    settings.frameRate ?? 30,
  )
  // An empty mime means the browser liked none of the candidates — then it is left to
  // pick for itself rather than being handed a string it already refused.
  const recorder = new MediaRecorder(
    stream,
    mime ? { mimeType: mime, videoBitsPerSecond: bitrate } : { videoBitsPerSecond: bitrate },
  )

  const writer = await openChunks(request.clipId)

  const current: Session = {
    clipId: request.clipId,
    recorder,
    stream: captured,
    microphone,
    audioContext: context,
    writer,
    mime: recorder.mimeType || mime,
    audio: audioTrack !== null,
    writes: [],
    limitTimer: null,
    finishing: false,
    startedAt: Date.now(),
    before: 0,
    runStartedAt: Date.now(),
  }
  session = current

  recorder.ondataavailable = (event) => {
    if (event.data.size === 0) return
    // Each chunk is written and closed on its own: a crash costs the last two seconds,
    // not the whole recording.
    const write = writer.write(event.data).catch((error: unknown) => {
      console.error('[kadr] chunk lost', error)
    })
    current.writes.push(write)
  }

  recorder.onerror = (event) => {
    console.error('[kadr] recorder failed', event)
    void finish('error')
  }

  watchSource(captured)
  recorder.start(CHUNK_MS)

  // The ceiling is enforced here rather than in the worker: the worker may be asleep
  // when it comes due, and a timer that only fires if someone is awake is not a limit.
  current.limitTimer = setTimeout(() => {
    void finish('limit')
  }, MAX_DURATION_MS)
}

export function pauseRecording(paused: boolean): boolean {
  if (!session) return false
  const now = Date.now()
  if (paused && session.recorder.state === 'recording') {
    session.recorder.pause()
    if (session.runStartedAt !== null) {
      session.before += now - session.runStartedAt
      session.runStartedAt = null
    }
  }
  if (!paused && session.recorder.state === 'paused') {
    session.recorder.resume()
    session.runStartedAt = now
  }
  return session.recorder.state === 'paused'
}

export type HostStatus = {
  recording: boolean
  paused: boolean
  /** Footage so far, ms. */
  elapsed: number
}

/**
 * The clock as this document sees it. The worker keeps its own for the event timeline;
 * this one exists so the control panel in the picker window can tick twice a second
 * without waking the worker twice a second.
 */
export function hostStatus(): HostStatus {
  if (!session) return { recording: false, paused: false, elapsed: 0 }
  const run = session.runStartedAt === null ? 0 : Date.now() - session.runStartedAt
  return {
    recording: true,
    paused: session.recorder.state === 'paused',
    elapsed: session.before + run,
  }
}

/** Waits for the recorder to hand over everything it still holds. */
function lastChunk(recorder: MediaRecorder): Promise<void> {
  if (recorder.state === 'inactive') return Promise.resolve()
  return new Promise((resolve) => {
    recorder.addEventListener(
      'stop',
      () => {
        resolve()
      },
      { once: true },
    )
    recorder.stop()
  })
}

function releaseTracks(current: Session): void {
  for (const track of current.stream.getTracks()) track.stop()
  for (const track of current.microphone?.getTracks() ?? []) track.stop()
  void current.audioContext?.close().catch(() => undefined)
  if (current.limitTimer !== null) clearTimeout(current.limitTimer)
}

/**
 * Parts on disk to a finished file, plus everything the clip record needs to know
 * about it.
 *
 * Shared by the ordinary stop and by recovery, because after a crash the parts are all
 * that is left and turning them into a clip is the entire job. The duration is read
 * back out of the file rather than counted on the wall clock — see `record/probe`.
 */
async function assemble(
  clipId: ClipId,
  mime: string,
  audio: boolean,
  stoppedAt: number,
): Promise<RecordResult> {
  const { file, size } = await mergeChunks(clipId)
  const stored = await clipFile(file)

  const empty = { duration: 0, width: 0, height: 0, poster: null }
  const probed = stored
    ? await probeVideo(stored).catch((error: unknown) => {
        // The clip is still written — the bytes are fine — but its record will say 0×0
        // and 0:00 until something with a visible document asks the file again.
        console.warn('[kadr] recorder: the finished file would not answer the probe', error)
        return empty
      })
    : empty

  return {
    file,
    size,
    mime,
    audio,
    stoppedAt,
    duration: probed.duration,
    width: probed.width,
    height: probed.height,
    poster: probed.poster,
  }
}

/**
 * Ends the recording and turns the parts into a file.
 *
 * The merge happens before anything is reported: a clip record pointing at a file that
 * is still a directory of fragments is a record the library cannot draw.
 */
/** The stop in progress. Merging takes seconds, and a second stop must join it, not race it. */
let stopping: Promise<RecordResult> | null = null

/** Whether this document holds a take: recording it, or still merging one that stopped. */
export function ownsRecording(): boolean {
  return session !== null || stopping !== null
}

export async function stopRecording(): Promise<RecordResult> {
  /**
   * The session is surrendered the moment the first stop begins, but the take is not
   * finished until the merge is. A second stop arriving in that window used to hear
   * "not recording" — which the worker took for a failed stop, salvaged, and closed
   * this window mid-merge, losing the recording. It waits for the first stop instead.
   */
  if (stopping) return await stopping

  const current = session
  if (!current) throw new Error('not recording')
  current.finishing = true
  session = null

  const run = (async () => {
    await lastChunk(current.recorder)
    // Taken here and not after the merge: merging and probing a long recording takes
    // seconds, and the timeline anchor has to be the moment the camera stopped.
    const stoppedAt = Date.now()
    releaseTracks(current)
    await Promise.all(current.writes)

    return await assemble(current.clipId, current.mime, current.audio, stoppedAt)
  })()

  stopping = run
  try {
    return await run
  } finally {
    stopping = null
  }
}

/**
 * Salvage of a recording whose session is gone: the tab crashed, the browser was
 * killed, an update restarted the extension mid-take. The parts on disk are complete up
 * to the last one written, so what comes out is the recording minus at most a couple of
 * seconds.
 *
 * The codec and whether there was sound are not recoverable — nobody wrote them down —
 * so they are read back off the file instead: the mime is what MediaRecorder always
 * writes here, and the audio flag is left false rather than guessed, since a clip
 * wrongly claiming sound would export a silent WebM and look broken.
 */
export async function recoverRecording(clipId: ClipId): Promise<RecordResult> {
  return await assemble(clipId, 'video/webm', false, Date.now())
}

/**
 * An ending nobody asked for. The worker is told, and it finishes the clip exactly as
 * it would on a normal stop — the difference is only who noticed first.
 */
async function finish(reason: 'source-ended' | 'limit' | 'error'): Promise<void> {
  const current = session
  if (!current || current.finishing) return

  /**
   * A warning, not a note: this is the difference between "the user pressed stop" and
   * "the source went away", the two are indistinguishable afterwards, and Chrome's error
   * view — the one people actually paste — shows warnings and hides notes.
   */
  console.warn('[kadr] recorder: the recording ended on its own', {
    reason,
    seconds: Math.round((Date.now() - current.startedAt) / 100) / 10,
    video: current.stream.getVideoTracks().map((track) => track.readyState),
  })

  const clipId = current.clipId

  /**
   * Same visibility rule as a worker-driven stop: the probe below reads the file
   * through a `<video>` element, and Chrome does not load media in a minimized window.
   * The offscreen document has no `chrome.windows` at all, hence the guards.
   */
  try {
    const here = await chrome.windows?.getCurrent?.()
    if (here?.id !== undefined && here.state === 'minimized') {
      await chrome.windows.update(here.id, { state: 'normal' })
    }
  } catch {
    // Not a window of ours to restore.
  }

  try {
    const result = await stopRecording()
    await sendMessage('record:ended', { clipId, reason, result })
  } catch (error) {
    console.error('[kadr] recording could not be finished', error)
    await sendMessage('record:ended', { clipId, reason: 'error' }).catch(() => undefined)
  }
}

export function isRecording(): boolean {
  return session !== null
}
