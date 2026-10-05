/**
 * The sound edit: what is quiet, and where.
 *
 * Deliberately separate from `edit.ts`. That module answers where the picture is; this
 * one answers whether there is sound under it, and the two never mix — a silence does
 * not move the clock, and a cut does not need to know about sound at all, because the
 * sound under a removed span is removed along with it.
 *
 * Pure module: numbers in, numbers out.
 */
import { normalizeSpans, spanLength } from './edit'
import type { ClipEdit, SoundEdit, TimeSpan } from './types'

/** Is the sound off at this source moment? Cuts are not consulted: a cut moment is never played. */
export function isSilent(edit: ClipEdit, source: number): boolean {
  const { sound } = edit
  if (sound.muted) return true
  if (source < sound.trim.start || source >= sound.trim.end) return true
  return sound.silences.some((span) => source >= span.start && source < span.end)
}

/**
 * Every quiet span inside the bounds, as one sorted list: the trimmed head and tail
 * plus the silences, merged. This is what the exporter walks and what the lane paints.
 */
export function silentSpans(sound: SoundEdit, bounds: TimeSpan): TimeSpan[] {
  if (sound.muted) return spanLength(bounds) > 0 ? [{ ...bounds }] : []

  const outside: TimeSpan[] = [
    { start: bounds.start, end: sound.trim.start },
    { start: sound.trim.end, end: bounds.end },
  ]
  return normalizeSpans([...outside, ...sound.silences], bounds)
}

/** Length of sound that survives, in source ms — for the panel's "3 stretches, 12 s" line. */
export function silencedDuration(sound: SoundEdit, bounds: TimeSpan): number {
  return silentSpans(sound, bounds).reduce((total, span) => total + spanLength(span), 0)
}

export function addSilence(edit: ClipEdit, span: TimeSpan): ClipEdit {
  const { sound } = edit
  return {
    ...edit,
    sound: { ...sound, silences: normalizeSpans([...sound.silences, span], sound.trim) },
  }
}

export function removeSilence(edit: ClipEdit, at: number): ClipEdit {
  const { sound } = edit
  return {
    ...edit,
    sound: {
      ...sound,
      silences: sound.silences.filter((span) => at < span.start || at >= span.end),
    },
  }
}

/**
 * Replaces one silence without normalizing, for the same reason `replaceCut` does not:
 * merging mid-drag renumbers the list under the hand holding it.
 */
export function replaceSilence(edit: ClipEdit, index: number, span: TimeSpan): ClipEdit {
  const { sound } = edit
  if (index < 0 || index >= sound.silences.length) return edit

  const start = Math.max(sound.trim.start, Math.min(span.start, span.end))
  const end = Math.min(sound.trim.end, Math.max(span.start, span.end))
  const silences = sound.silences.map((held, at) => (at === index ? { start, end } : held))

  return { ...edit, sound: { ...sound, silences } }
}

/** Sorts, merges and clamps the silences. Once per gesture, on release. */
export function tidySilences(edit: ClipEdit): ClipEdit {
  const { sound } = edit
  return { ...edit, sound: { ...sound, silences: normalizeSpans(sound.silences, sound.trim) } }
}

/**
 * Moves the sound's own trim handles. Silences are re-clamped to the new range: one
 * left outside would silence nothing now and come back the moment the handle moved.
 */
export function setSoundTrim(edit: ClipEdit, trim: TimeSpan): ClipEdit {
  const bounded = {
    start: Math.max(0, Math.min(trim.start, trim.end)),
    end: Math.max(trim.start, trim.end),
  }
  return {
    ...edit,
    sound: {
      ...edit.sound,
      trim: bounded,
      silences: normalizeSpans(edit.sound.silences, bounded),
    },
  }
}

export function setMuted(edit: ClipEdit, muted: boolean): ClipEdit {
  return { ...edit, sound: { ...edit.sound, muted } }
}

/**
 * Whether the finished file should carry a track at all. `false` when the recording
 * never had sound or when every moment of it is quiet: an all-silent track is a bigger
 * file that plays exactly like no track.
 */
export function hasSound(clip: { audio: boolean; edit: ClipEdit }): boolean {
  if (!clip.audio || clip.edit.sound.muted) return false
  const { sound, trim } = clip.edit
  return silencedDuration(sound, trim) < spanLength(trim)
}

/**
 * Loudness envelope of a recording, for the lane to draw.
 *
 * One number per bin, 0..1, the peak of the absolute sample within that slice of time.
 * Peaks rather than RMS because the lane is a map, not a meter: what a person looks for
 * is "where did I say something", and a peak envelope shows a single word where an RMS
 * envelope shows a faint bump.
 */
export type Waveform = {
  /** Length of the recording the bins cover, ms. */
  duration: number
  peaks: Float32Array
}

/**
 * Accumulates peaks from decoded audio arriving in pieces, so a ten-minute recording is
 * never held decoded in memory: each chunk updates a handful of bins and is dropped.
 */
export function waveformBuilder(
  duration: number,
  bins: number,
): {
  add: (channels: readonly Float32Array[], startMs: number, sampleRate: number) => void
  done: () => Waveform
} {
  const peaks = new Float32Array(Math.max(1, bins))
  const perBin = Math.max(1e-6, duration / peaks.length)

  return {
    add: (channels, startMs, sampleRate) => {
      const frames = channels[0]?.length ?? 0
      if (frames === 0 || sampleRate <= 0) return
      const msPerFrame = 1000 / sampleRate

      for (let frame = 0; frame < frames; frame++) {
        const bin = Math.floor((startMs + frame * msPerFrame) / perBin)
        if (bin < 0 || bin >= peaks.length) continue
        for (const channel of channels) {
          const value = Math.abs(channel[frame] ?? 0)
          if (value > peaks[bin]!) peaks[bin] = value
        }
      }
    },
    done: () => {
      // Normalized to the loudest moment: a quiet microphone still draws a readable lane.
      let loudest = 0
      for (const value of peaks) if (value > loudest) loudest = value
      if (loudest > 0) for (let at = 0; at < peaks.length; at++) peaks[at] = peaks[at]! / loudest
      return { duration, peaks }
    },
  }
}
