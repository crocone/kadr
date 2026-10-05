/**
 * The recording's sound, read back out of the file.
 *
 * Two customers. The timeline wants a loudness envelope to draw under the picture, and
 * the MP4 exporter wants the samples themselves, re-timed across the cuts and the speed
 * change. Both go through mediabunny's demuxer rather than `decodeAudioData`: the latter
 * needs the whole file in an ArrayBuffer and gives back the whole recording as PCM,
 * which for a ten-minute take is half a gigabyte to get at a few thousand peaks. The
 * demuxer hands over one packet at a time and nothing is kept.
 */
import {
  ALL_FORMATS,
  AudioSample,
  AudioSampleSink,
  AudioSampleSource,
  BlobSource,
  getFirstEncodableAudioCodec,
  Input,
  QUALITY_HIGH,
  type AudioCodec,
  type InputAudioTrack,
  type OutputFormat,
} from 'mediabunny'

import { clampSpeed, keptSpans } from '@/core/record/edit'
import { silentSpans, type Waveform, waveformBuilder } from '@/core/record/sound'
import { Stretcher } from '@/core/record/stretch'
import type { Clip, TimeSpan } from '@/core/record/types'

export type SoundSource = {
  track: InputAudioTrack
  sampleRate: number
  channels: number
  close: () => void
}

/** The file's audio track, or `null` when there is none the browser can decode. */
export async function openSound(file: Blob): Promise<SoundSource | null> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
  try {
    const track = await input.getPrimaryAudioTrack()
    if (!track || !(await track.canDecode())) {
      input.dispose()
      return null
    }
    return {
      track,
      sampleRate: await track.getSampleRate(),
      channels: await track.getNumberOfChannels(),
      close: () => {
        input.dispose()
      },
    }
  } catch (error) {
    input.dispose()
    throw error
  }
}

/** Planar float copy of frames `[from, to)` of a decoded sample. */
function planesOf(sample: AudioSample, from: number, to: number): Float32Array[] {
  const frames = Math.max(0, to - from)
  return Array.from({ length: sample.numberOfChannels }, (_, plane) => {
    const data = new Float32Array(frames)
    if (frames > 0) {
      sample.copyTo(data, {
        planeIndex: plane,
        format: 'f32-planar',
        frameOffset: from,
        frameCount: frames,
      })
    }
    return data
  })
}

/** Number of bins the lane is drawn with. Two per pixel of a wide timeline is plenty. */
export const WAVEFORM_BINS = 2400

/**
 * Loudness envelope of the whole recording. Decoding a long take runs for seconds, so
 * it is done once, after the clip opens, and the lane draws a flat line until then.
 */
export async function loadWaveform(
  file: Blob,
  duration: number,
  signal?: AbortSignal,
): Promise<Waveform | null> {
  const sound = await openSound(file)
  if (!sound) return null

  const builder = waveformBuilder(duration, WAVEFORM_BINS)
  try {
    const sink = new AudioSampleSink(sound.track)
    for await (const sample of sink.samples()) {
      if (signal?.aborted) {
        sample.close()
        return null
      }
      builder.add(
        planesOf(sample, 0, sample.numberOfFrames),
        sample.timestamp * 1000,
        sample.sampleRate,
      )
      sample.close()
    }
  } finally {
    sound.close()
  }
  return builder.done()
}

/**
 * Which codec the finished file gets. AAC first — it is what every player expects in
 * an MP4 — and Opus where the platform has no AAC encoder, which is Linux; Chrome
 * still plays that file, and so does VLC.
 */
export async function soundCodecFor(
  format: OutputFormat,
  sound: SoundSource,
): Promise<AudioCodec | null> {
  const supported = format.getSupportedAudioCodecs()
  const preferred = (['aac', 'opus'] as const).filter((codec) => supported.includes(codec))
  return await getFirstEncodableAudioCodec([...preferred], {
    numberOfChannels: sound.channels,
    sampleRate: sound.sampleRate,
  })
}

export function soundSourceFor(codec: AudioCodec): AudioSampleSource {
  return new AudioSampleSource({ codec, quality: QUALITY_HIGH })
}

/** Zeroes the frames of a chunk that fall inside a quiet span. */
function muteSpans(
  planes: Float32Array[],
  startMs: number,
  sampleRate: number,
  quiet: readonly TimeSpan[],
): void {
  const frames = planes[0]?.length ?? 0
  const endMs = startMs + (frames / sampleRate) * 1000

  for (const span of quiet) {
    if (span.end <= startMs || span.start >= endMs) continue
    const from = Math.max(0, Math.round(((span.start - startMs) / 1000) * sampleRate))
    const to = Math.min(frames, Math.round(((span.end - startMs) / 1000) * sampleRate))
    for (const plane of planes) plane.fill(0, from, to)
  }
}

/**
 * Writes the edited soundtrack into an output track.
 *
 * The kept spans are walked in order and their samples appended back to back, so the
 * sound lands exactly where `toSource` puts the picture. Quiet spans are zeroed rather
 * than skipped: a silence keeps its length, only a cut loses it. Holes in the decoded
 * stream — a pause taken mid-take, a dropped packet — are filled with silence for the
 * same reason, or everything after them would slide ahead of the picture.
 */
export async function writeSound(
  sound: SoundSource,
  clip: Clip,
  into: AudioSampleSource,
): Promise<void> {
  const { edit } = clip
  const { sampleRate, channels } = sound
  const speed = clampSpeed(edit.speed)
  const stretcher = speed === 1 ? null : new Stretcher(speed, sampleRate, channels)
  const quiet = silentSpans(edit.sound, edit.trim)
  const sink = new AudioSampleSink(sound.track)

  let written = 0
  const emit = async (planes: Float32Array[]) => {
    const frames = planes[0]?.length ?? 0
    if (frames === 0) return
    const data = new Float32Array(frames * channels)
    planes.forEach((plane, at) => {
      data.set(plane, at * frames)
    })
    await into.add(
      new AudioSample({
        data,
        format: 'f32-planar',
        numberOfChannels: channels,
        sampleRate,
        timestamp: written / sampleRate,
      }),
    )
    written += frames
  }
  const feed = (planes: Float32Array[]) => emit(stretcher ? stretcher.push(planes) : planes)
  const silence = (frames: number) =>
    Array.from({ length: channels }, () => new Float32Array(Math.max(0, frames)))
  const framesIn = (ms: number) => Math.round((ms / 1000) * sampleRate)

  for (const span of keptSpans(edit)) {
    let cursor = span.start

    for await (const sample of sink.samples(span.start / 1000, span.end / 1000)) {
      const sampleStart = sample.timestamp * 1000
      const from = Math.max(0, framesIn(span.start - sampleStart))
      const to = Math.min(sample.numberOfFrames, framesIn(span.end - sampleStart))
      if (to <= from) {
        sample.close()
        continue
      }

      const chunkStart = sampleStart + (from / sampleRate) * 1000
      const gap = framesIn(chunkStart - cursor)
      if (gap > 0) await feed(silence(gap))

      const planes = planesOf(sample, from, to)
      sample.close()
      muteSpans(planes, chunkStart, sampleRate, quiet)
      await feed(planes)
      cursor = chunkStart + ((to - from) / sampleRate) * 1000
    }

    const rest = framesIn(span.end - cursor)
    if (rest > 0) await feed(silence(rest))
  }

  if (stretcher) await emit(stretcher.flush())
}
