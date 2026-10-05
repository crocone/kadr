/**
 * Time-stretching that keeps the pitch, for the sound of a sped-up clip.
 *
 * Playing a recording at 1.5× through a `<video>` element sounds fine because the
 * browser stretches the audio for you. The MP4 exporter never plays anything — it
 * decodes the sound and re-times it by hand — so the stretching is by hand as well.
 * Plain resampling would do the timing and raise every voice by a fifth.
 *
 * The method is WSOLA: short windowed grains of the input are overlapped and added at
 * a hop that differs from the one they were taken at, and each grain is picked from a
 * small neighbourhood of its nominal position, wherever it lines up best with the tail
 * of the previous one. That alignment step is the whole difference between speech and
 * a fluttering echo of speech.
 *
 * Streaming: audio comes in pieces of any size and leaves in pieces of some other size,
 * and nothing holds the whole recording. Pure module: numbers in, numbers out.
 */

/** Grain length, seconds. About a pitch period of a low voice; longer starts to echo. */
const GRAIN_S = 0.024
/** How far a grain may be moved from its nominal spot to line up, seconds. */
const TOLERANCE_S = 0.008
/** The alignment search runs on every fourth sample; then it looks around the winner. */
const COARSE = 4

function hann(length: number): Float32Array {
  const window = new Float32Array(length)
  for (let at = 0; at < length; at++) {
    window[at] = 0.5 - 0.5 * Math.cos((2 * Math.PI * at) / length)
  }
  return window
}

function concat(parts: readonly Float32Array[]): Float32Array {
  const length = parts.reduce((total, part) => total + part.length, 0)
  const joined = new Float32Array(length)
  let at = 0
  for (const part of parts) {
    joined.set(part, at)
    at += part.length
  }
  return joined
}

export class Stretcher {
  private readonly rate: number
  private readonly channels: number
  /** Grain length in frames, even, so the synthesis hop is a whole number. */
  private readonly grain: number
  private readonly hop: number
  private readonly tolerance: number
  private readonly window: Float32Array

  /** Buffered input, one plane per channel, plus its mono mix for the alignment search. */
  private input: Float32Array[]
  private mono: Float32Array
  /** Absolute frame index of `input[c][0]`. */
  private inputStart = 0
  /** Frames pushed in so far. */
  private received = 0
  /** Nominal analysis position of the next grain, absolute, fractional. */
  private nextIn = 0
  /** Where the previous grain was actually taken from; -1 before the first. */
  private previous = -1

  /** The overlap region the next grain is added into: `grain` frames per channel. */
  private pending: Float32Array[]
  private emitted = 0
  private finished = false

  constructor(rate: number, sampleRate: number, channels: number) {
    if (!(rate > 0) || !(sampleRate > 0) || channels < 1) {
      throw new Error('stretcher: rate, sample rate and channels must be positive')
    }
    this.rate = rate
    this.channels = channels
    this.grain = Math.max(4, Math.round((sampleRate * GRAIN_S) / 2) * 2)
    this.hop = this.grain / 2
    this.tolerance = Math.max(1, Math.round(sampleRate * TOLERANCE_S))
    this.window = hann(this.grain)
    this.input = Array.from({ length: channels }, () => new Float32Array(0))
    this.mono = new Float32Array(0)
    this.pending = Array.from({ length: channels }, () => new Float32Array(this.grain))
  }

  /** Feeds planar audio in; returns whatever output became final. Empty planes are fine. */
  push(planes: readonly Float32Array[]): Float32Array[] {
    if (this.finished) throw new Error('stretcher: pushed after flush')
    const frames = planes[0]?.length ?? 0
    if (frames === 0) return this.empty()
    if (this.rate === 1) return planes.map((plane) => plane.slice())

    this.append(planes)
    this.received += frames
    return this.process(this.inputStart + this.mono.length)
  }

  /**
   * Ends the stream. The output is brought to exactly `received / rate` frames: a
   * soundtrack a few grains short of its picture drifts out of step at the very end,
   * which is where people look.
   */
  flush(): Float32Array[] {
    if (this.finished) return this.empty()
    this.finished = true
    if (this.rate === 1) return this.empty()

    const expected = Math.round(this.received / this.rate)
    const padding = this.grain + this.tolerance
    this.append(Array.from({ length: this.channels }, () => new Float32Array(padding)))

    // Grains whose nominal spot still lies inside the real audio; the padding only
    // covers the search window and the overlap.
    const out = this.process(this.inputStart + this.mono.length, this.received)
    const tail = this.pending.map((plane) => plane.slice())

    // Beyond what the grains produced, the overlap region still holds a fading tail;
    // whatever is missing after that is silence, and anything over is dropped.
    const need = expected - this.emitted
    const result: Float32Array[] = []
    for (let channel = 0; channel < this.channels; channel++) {
      const done = out[channel]!
      const length = Math.max(0, done.length + need)
      const plane = new Float32Array(length)
      plane.set(done.subarray(0, Math.min(done.length, length)))
      if (need > 0) plane.set(tail[channel]!.subarray(0, need), done.length)
      result.push(plane)
    }
    this.emitted = expected
    return result
  }

  private empty(): Float32Array[] {
    return Array.from({ length: this.channels }, () => new Float32Array(0))
  }

  private append(planes: readonly Float32Array[]): void {
    const frames = planes[0]?.length ?? 0
    const mix = new Float32Array(frames)
    for (let channel = 0; channel < this.channels; channel++) {
      const plane = planes[channel] ?? planes[0]!
      this.input[channel] = concat([this.input[channel]!, plane])
      for (let at = 0; at < frames; at++) mix[at] = (mix[at] ?? 0) + plane[at]! / this.channels
    }
    this.mono = concat([this.mono, mix])
  }

  /**
   * Takes every grain that can be taken with the input buffered so far, and returns
   * the output that is no longer going to change.
   */
  private process(available: number, nominalLimit = Number.POSITIVE_INFINITY): Float32Array[] {
    const out: Float32Array[][] = Array.from({ length: this.channels }, () => [])
    const analysisHop = this.hop * this.rate

    for (;;) {
      const nominal = Math.round(this.nextIn)
      if (nominal >= nominalLimit) break
      const reference = this.previous < 0 ? -1 : this.previous + this.hop
      const farthest = Math.max(nominal + this.tolerance, reference) + this.grain
      if (farthest > available) break

      const pick = this.align(nominal, reference)
      this.overlapAdd(pick, out)
      this.previous = pick
      this.nextIn += analysisHop

      // Input behind both the next search window and the next reference is done with.
      const keep = Math.max(
        this.inputStart,
        Math.min(Math.round(this.nextIn) - this.tolerance, pick + this.hop),
      )
      if (keep > this.inputStart) this.drop(keep - this.inputStart)
    }

    return out.map((parts) => concat(parts))
  }

  /**
   * The grain start near `nominal` whose first samples best continue the previous
   * grain — measured as normalized correlation with what would naturally have followed
   * it. Coarse pass on every fourth sample, then a fine pass around the winner.
   */
  private align(nominal: number, reference: number): number {
    if (reference < 0) return Math.max(this.inputStart, nominal)

    const low = Math.max(this.inputStart, nominal - this.tolerance)
    const high = nominal + this.tolerance
    let best = nominal
    let bestScore = Number.NEGATIVE_INFINITY

    const score = (candidate: number, stride: number): number => {
      let dot = 0
      let energy = 0
      const from = candidate - this.inputStart
      const ref = reference - this.inputStart
      for (let at = 0; at < this.grain; at += stride) {
        const value = this.mono[from + at]!
        dot += value * this.mono[ref + at]!
        energy += value * value
      }
      return dot / Math.sqrt(energy + 1e-9)
    }

    for (let candidate = low; candidate <= high; candidate += COARSE) {
      const value = score(candidate, COARSE)
      if (value > bestScore) {
        bestScore = value
        best = candidate
      }
    }
    const coarse = best
    for (let candidate = coarse - COARSE + 1; candidate < coarse + COARSE; candidate++) {
      if (candidate < low || candidate > high || candidate === coarse) continue
      const value = score(candidate, 1)
      if (value > bestScore) {
        bestScore = value
        best = candidate
      }
    }
    return best
  }

  /** Adds the windowed grain into the overlap region and emits the half that is now final. */
  private overlapAdd(pick: number, out: Float32Array[][]): void {
    const from = pick - this.inputStart
    // The very first grain has nothing to overlap with, so its rising half goes in
    // unwindowed — otherwise every stretched clip would open with a fade-in.
    const first = this.previous < 0

    for (let channel = 0; channel < this.channels; channel++) {
      const plane = this.input[channel]!
      const region = this.pending[channel]!
      for (let at = 0; at < this.grain; at++) {
        const weight = first && at < this.hop ? 1 : this.window[at]!
        region[at] = (region[at] ?? 0) + plane[from + at]! * weight
      }
      out[channel]!.push(region.slice(0, this.hop))
      const next = new Float32Array(this.grain)
      next.set(region.subarray(this.hop))
      this.pending[channel] = next
    }
    this.emitted += this.hop
  }

  private drop(frames: number): void {
    for (let channel = 0; channel < this.channels; channel++) {
      this.input[channel] = this.input[channel]!.slice(frames)
    }
    this.mono = this.mono.slice(frames)
    this.inputStart += frames
  }
}

/** Runs a whole signal through in one go: the convenience the tests and short clips want. */
export function stretch(
  planes: readonly Float32Array[],
  rate: number,
  sampleRate: number,
): Float32Array[] {
  const stretcher = new Stretcher(rate, sampleRate, planes.length)
  const head = stretcher.push(planes)
  const tail = stretcher.flush()
  return head.map((plane, channel) => concat([plane, tail[channel]!]))
}
