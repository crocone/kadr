/**
 * Getting a clip out of the extension: WebM, MP4 or GIF.
 *
 * No ffmpeg.wasm. It is thirty megabytes shipped inside the package to do three jobs
 * the browser already does — and doing them itself is both smaller and faster. WebM is
 * recorded straight off the rendered canvas by `MediaRecorder`; MP4 is encoded by
 * WebCodecs and muxed by `mediabunny`; GIF is quantised by `gifenc`.
 *
 * Every format renders through `drawClipFrame`, the same function the player uses, so
 * the file matches what was on screen — cuts, camera, click rings and all.
 *
 * Sound takes two different roads. WebM records in real time, so its sound is simply
 * the playing element's, gated by a gain node wherever the edit says quiet. MP4 is
 * rendered frame by frame from seeks, and no soundtrack can be assembled from seeks —
 * so its sound is decoded from the file, re-timed across the cuts and the speed change
 * by `clip/sound`, and encoded alongside the picture. GIF has no sound to lose.
 *
 * MP4 and GIF are slower than playback: each frame is a seek, and a seek on a WebM
 * without seek points is not instant. That is what the progress bar is for.
 */
import { GIFEncoder, applyPalette, quantize } from 'gifenc'
import { BufferTarget, CanvasSource, Mp4OutputFormat, Output, QUALITY_HIGH } from 'mediabunny'

import { keptDuration, outputDuration, toSource } from '@/core/record/edit'
import { drawClipFrame, outputSize } from '@/core/record/render'
import { hasSound, isSilent } from '@/core/record/sound'
import type { Clip } from '@/core/record/types'
import { saveBlob } from '@/core/render/export'
import { slugify } from '@/core/render/filename'

import { openSound, soundCodecFor, soundSourceFor, writeSound } from './sound'

export type ClipFormat = 'webm' | 'mp4' | 'gif'

export type ExportProgress = (done: number, total: number) => void

/** Frame rate of the exported file. Screen content at 30 is indistinguishable from 60. */
const FPS = 30

/** GIF is a delivery format for README files, not a video codec: half the rate, half the size. */
const GIF_FPS = 12
const GIF_MAX_WIDTH = 640

/** `github-com-2026-09-01.mp4`: the domain if there is one, the title if not. */
function fileNameOf(clip: Clip, format: ClipFormat): string {
  const date = new Date(clip.createdAt).toISOString().slice(0, 10)
  const name = clip.page?.domain ?? clip.title
  return `${slugify(name) || 'clip'}-${date}.${format}`
}

/**
 * A canvas sized for the clip, plus its context.
 *
 * `willReadFrequently` because the GIF path reads every frame back out with
 * `getImageData`, and without the hint Chrome keeps the surface on the GPU and warns
 * about the readbacks on every single frame.
 */
function surfaceFor(
  clip: Clip,
  scale = 1,
  willReadFrequently = false,
): {
  canvas: HTMLCanvasElement
  context: CanvasRenderingContext2D
  size: { w: number; h: number }
} {
  const size = outputSize(clip, scale)
  const canvas = document.createElement('canvas')
  canvas.width = size.w
  canvas.height = size.h

  const context = canvas.getContext('2d', { alpha: true, willReadFrequently })
  if (!context) throw new Error('no 2d context')
  return { canvas, context, size }
}

function seek(video: HTMLVideoElement, sourceMs: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      video.removeEventListener('seeked', done)
      resolve()
    }
    video.addEventListener('seeked', done, { once: true })
    video.currentTime = Math.max(0, sourceMs / 1000)
    // A seek to where the head already is fires nothing at all, and the export would
    // wait for an event that is never coming.
    setTimeout(done, 500)
  })
}

/**
 * The playing element's sound, with a tap on it.
 *
 * Routed through a gain node rather than toggling `muted` on the element: whether a
 * muted element still feeds its captured stream is a browser detail, and a gain of zero
 * is quiet everywhere. The element itself stays unmuted, since a muted element has no
 * sound to capture — so, as before, the export is audible while it runs.
 */
function tapSound(
  video: HTMLVideoElement,
): { track: MediaStreamTrack; gain: GainNode; close: () => void } | null {
  const captured = video.captureStream?.()
  const source = captured?.getAudioTracks()[0]
  if (!captured || !source) return null

  const context = new AudioContext()
  const gain = context.createGain()
  const destination = context.createMediaStreamDestination()
  context.createMediaStreamSource(new MediaStream([source])).connect(gain)
  gain.connect(destination)

  const track = destination.stream.getAudioTracks()[0]
  if (!track) {
    void context.close()
    return null
  }
  return {
    track,
    gain,
    close: () => {
      void context.close().catch(() => undefined)
    },
  }
}

/**
 * WebM, recorded in real time off the canvas.
 *
 * Real time is the cost of keeping the audio: the source element has to actually play
 * for its sound to exist, so a thirty-second clip takes thirty seconds — divided by the
 * playback speed, which is one of the few places where speeding a clip up pays twice.
 */
async function exportWebm(
  clip: Clip,
  video: HTMLVideoElement,
  backdrop: HTMLImageElement | null,
  onProgress: ExportProgress,
): Promise<Blob> {
  const { canvas, context, size } = surfaceFor(clip)
  const total = outputDuration(clip.edit)

  const stream = canvas.captureStream(FPS)
  // Audio comes off the source element rather than being re-encoded: the recording
  // already has it in the right codec, and this simply carries it across.
  const sound = hasSound(clip) ? tapSound(video) : null
  if (sound) stream.addTrack(sound.track)

  const chunks: Blob[] = []
  const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' })
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data)
  }

  const finished = new Promise<void>((resolve) => {
    recorder.addEventListener(
      'stop',
      () => {
        resolve()
      },
      { once: true },
    )
  })

  video.playbackRate = clip.edit.speed
  video.muted = sound === null
  await seek(video, clip.edit.trim.start)
  recorder.start()
  await video.play()

  await new Promise<void>((resolve) => {
    let frame = 0

    const step = () => {
      const source = video.currentTime * 1000

      if (source >= clip.edit.trim.end) {
        cancelAnimationFrame(frame)
        resolve()
        return
      }
      // Skip a removed span by jumping over it, exactly as the player does.
      const cut = clip.edit.cuts.find((span) => source >= span.start && source < span.end)
      if (cut) video.currentTime = cut.end / 1000

      if (sound) {
        const level = isSilent(clip.edit, source) ? 0 : 1
        if (sound.gain.gain.value !== level) sound.gain.gain.value = level
      }

      drawClipFrame(context, video, clip, source, size, backdrop)
      onProgress(
        Math.min(source - clip.edit.trim.start, keptDuration(clip.edit)),
        keptDuration(clip.edit),
      )
      frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
  })

  video.pause()
  recorder.stop()
  await finished
  sound?.close()
  onProgress(total, total)

  return new Blob(chunks, { type: 'video/webm' })
}

/**
 * MP4 through WebCodecs, muxed by mediabunny.
 *
 * H.264 rather than anything newer: an MP4 is what gets dragged into a ticket, a chat
 * or a slide deck, and those all open H.264. A more efficient codec that half the
 * recipients cannot play is not an export, it is a support ticket.
 *
 * `CanvasSource` takes the canvas straight to the encoder, so there is no `VideoFrame`
 * to construct and close by hand and no encoder queue to drain — awaiting `add` is the
 * backpressure. That is the whole reason for the library: the muxing is the small part,
 * and getting the encoder handshake right is the part that goes wrong.
 *
 * The soundtrack goes in first. It takes seconds where the picture takes minutes, and
 * if it cannot be written — a file the demuxer will not read, a platform with no
 * encoder — the export starts over without it rather than failing after all the frames.
 */
async function exportMp4(
  clip: Clip,
  video: HTMLVideoElement,
  file: Blob | null,
  backdrop: HTMLImageElement | null,
  onProgress: ExportProgress,
): Promise<Blob> {
  const { canvas, context, size } = surfaceFor(clip)
  const total = outputDuration(clip.edit)
  const frames = Math.max(1, Math.round((total / 1000) * FPS))

  const format = new Mp4OutputFormat({ fastStart: 'in-memory' })
  const output = new Output({ format, target: new BufferTarget() })

  const source = new CanvasSource(canvas, {
    codec: 'avc',
    quality: QUALITY_HIGH,
    // A key frame every two seconds: a file that seeks is worth the few percent it costs.
    keyFrameInterval: 2,
  })
  output.addVideoTrack(source, { frameRate: FPS })

  const sound =
    file && hasSound(clip)
      ? await openSound(file).catch((error: unknown) => {
          console.warn('[kadr] clip export: the recording gave no sound track', error)
          return null
        })
      : null
  const codec = sound ? await soundCodecFor(format, sound) : null
  const soundSource = codec ? soundSourceFor(codec) : null
  if (soundSource) output.addAudioTrack(soundSource)

  await output.start()

  if (sound && soundSource) {
    try {
      await writeSound(sound, clip, soundSource)
    } catch (error) {
      console.warn('[kadr] clip export: the sound could not be written, exporting silent', error)
      sound.close()
      await output.cancel().catch(() => undefined)
      return await exportMp4(clip, video, null, backdrop, onProgress)
    }
  }
  sound?.close()

  const frameDuration = 1 / FPS

  for (let index = 0; index < frames; index++) {
    const outputMs = (index / FPS) * 1000
    await seek(video, toSource(clip.edit, outputMs))
    drawClipFrame(context, video, clip, video.currentTime * 1000, size, backdrop)

    await source.add(index * frameDuration, frameDuration)
    onProgress(index + 1, frames)
  }

  await output.finalize()

  const buffer = output.target.buffer
  if (!buffer) throw new Error('the mp4 came back empty')
  return new Blob([buffer], { type: 'video/mp4' })
}

/**
 * GIF through `gifenc`.
 *
 * Deliberately small and slow-framed: a GIF exists to sit in a README or an issue, where
 * it autoplays and loops and where a four-megabyte one will not be loaded at all. The
 * palette is computed per frame — a single palette for the whole clip smears any scene
 * change, and screen recordings are nothing but scene changes.
 */
async function exportGif(
  clip: Clip,
  video: HTMLVideoElement,
  backdrop: HTMLImageElement | null,
  onProgress: ExportProgress,
): Promise<Blob> {
  const full = outputSize(clip)
  const scale = Math.min(1, GIF_MAX_WIDTH / full.w)
  const { context, size } = surfaceFor(clip, scale, true)

  const total = outputDuration(clip.edit)
  const frames = Math.max(1, Math.round((total / 1000) * GIF_FPS))
  const delay = Math.round(1000 / GIF_FPS)

  const encoder = GIFEncoder()

  for (let index = 0; index < frames; index++) {
    const outputMs = (index / GIF_FPS) * 1000
    await seek(video, toSource(clip.edit, outputMs))
    drawClipFrame(context, video, clip, video.currentTime * 1000, size, backdrop)

    const { data } = context.getImageData(0, 0, size.w, size.h)
    const palette = quantize(data, 256)
    encoder.writeFrame(applyPalette(data, palette), size.w, size.h, { palette, delay })
    onProgress(index + 1, frames)
  }

  encoder.finish()
  // A fresh copy of the bytes: `Uint8Array` from the encoder is typed against a generic
  // buffer, and `Blob` insists on a plain `ArrayBuffer` behind it.
  return new Blob([encoder.bytes().slice()], { type: 'image/gif' })
}

/**
 * Renders the clip and puts the file in the downloads folder.
 *
 * The source element is created here and thrown away after: leaving a decoded video
 * around after an export holds on to the whole recording.
 */
export async function exportClip(
  format: ClipFormat,
  clip: Clip,
  file: Blob,
  backdrop: HTMLImageElement | null = null,
  onProgress: ExportProgress = () => undefined,
): Promise<void> {
  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.src = url
  video.muted = format !== 'webm'
  video.preload = 'auto'

  await new Promise<void>((resolve, reject) => {
    video.addEventListener(
      'loadeddata',
      () => {
        resolve()
      },
      { once: true },
    )
    video.addEventListener(
      'error',
      () => {
        reject(new Error('the recording could not be read'))
      },
      { once: true },
    )
  })

  try {
    const blob =
      format === 'webm'
        ? await exportWebm(clip, video, backdrop, onProgress)
        : format === 'mp4'
          ? await exportMp4(clip, video, file, backdrop, onProgress)
          : await exportGif(clip, video, backdrop, onProgress)

    await saveBlob(blob, fileNameOf(clip, format))
  } finally {
    video.pause()
    video.src = ''
    URL.revokeObjectURL(url)
  }
}
