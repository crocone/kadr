import { describe, expect, it } from 'vitest'

import { Stretcher, stretch } from './stretch'

const RATE = 48_000

function sine(hz: number, seconds: number, amplitude = 0.5): Float32Array {
  const frames = Math.round(RATE * seconds)
  const plane = new Float32Array(frames)
  for (let at = 0; at < frames; at++) {
    plane[at] = amplitude * Math.sin((2 * Math.PI * hz * at) / RATE)
  }
  return plane
}

/** Zero crossings per second — a pitch estimate that needs no FFT. */
function pitchOf(plane: Float32Array): number {
  let crossings = 0
  for (let at = 1; at < plane.length; at++) {
    if (plane[at - 1]! < 0 !== plane[at]! < 0) crossings += 1
  }
  return crossings / 2 / (plane.length / RATE)
}

function rms(plane: Float32Array): number {
  let total = 0
  for (const value of plane) total += value * value
  return Math.sqrt(total / plane.length)
}

describe('stretch', () => {
  it('is a copy at rate 1', () => {
    const input = sine(440, 0.5)
    const [output] = stretch([input], 1, RATE)
    expect(output).toEqual(input)
    expect(output).not.toBe(input)
  })

  it('halves the length at 2× and keeps the pitch and the level', () => {
    const input = sine(440, 2)
    const [output] = stretch([input], 2, RATE)

    expect(output!.length).toBe(input.length / 2)
    expect(pitchOf(output!)).toBeCloseTo(440, -1)
    expect(rms(output!)).toBeGreaterThan(rms(input) * 0.85)
    expect(rms(output!)).toBeLessThan(rms(input) * 1.15)
  })

  it('doubles the length at 0.5× and keeps the pitch', () => {
    const input = sine(220, 1)
    const [output] = stretch([input], 0.5, RATE)

    expect(output!.length).toBe(input.length * 2)
    expect(pitchOf(output!)).toBeCloseTo(220, -1)
  })

  it('keeps the channels apart and equal in length', () => {
    const left = sine(300, 1)
    const right = sine(600, 1, 0.2)
    const [outLeft, outRight] = stretch([left, right], 1.5, RATE)

    expect(outLeft!.length).toBe(outRight!.length)
    expect(pitchOf(outLeft!)).toBeCloseTo(300, -1)
    expect(pitchOf(outRight!)).toBeCloseTo(600, -1)
  })

  it('comes out the same whether fed at once or in pieces', () => {
    const input = sine(440, 1)
    const [whole] = stretch([input], 1.5, RATE)

    const stretcher = new Stretcher(1.5, RATE, 1)
    const parts: Float32Array[] = []
    for (let at = 0; at < input.length; at += 777) {
      parts.push(stretcher.push([input.subarray(at, Math.min(input.length, at + 777))])[0]!)
    }
    parts.push(stretcher.flush()[0]!)
    const pieced = new Float32Array(parts.reduce((total, part) => total + part.length, 0))
    let at = 0
    for (const part of parts) {
      pieced.set(part, at)
      at += part.length
    }

    expect(pieced.length).toBe(whole!.length)
    expect(pieced).toEqual(whole)
  })

  it('opens without a fade-in', () => {
    const input = new Float32Array(RATE).fill(0.5)
    const [output] = stretch([input], 2, RATE)
    expect(output![0]).toBeCloseTo(0.5, 3)
    expect(output![100]).toBeCloseTo(0.5, 3)
  })
})
