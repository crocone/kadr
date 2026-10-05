import { describe, expect, it } from 'vitest'

import { defaultEdit, upgradeClip } from './defaults'
import {
  addSilence,
  hasSound,
  isSilent,
  removeSilence,
  replaceSilence,
  setMuted,
  setSoundTrim,
  silencedDuration,
  silentSpans,
  tidySilences,
  waveformBuilder,
} from './sound'
import type { Clip, ClipEdit } from './types'

function edit(overrides: Partial<ClipEdit['sound']> = {}): ClipEdit {
  const base = defaultEdit(10_000)
  return { ...base, sound: { ...base.sound, ...overrides } }
}

describe('isSilent', () => {
  it('is loud everywhere on a fresh edit', () => {
    expect(isSilent(edit(), 0)).toBe(false)
    expect(isSilent(edit(), 9999)).toBe(false)
  })

  it('goes quiet inside a silence, outside the sound trim, and when muted', () => {
    expect(isSilent(edit({ silences: [{ start: 2000, end: 3000 }] }), 2500)).toBe(true)
    expect(isSilent(edit({ silences: [{ start: 2000, end: 3000 }] }), 3000)).toBe(false)
    expect(isSilent(edit({ trim: { start: 1000, end: 9000 } }), 500)).toBe(true)
    expect(isSilent(edit({ trim: { start: 1000, end: 9000 } }), 9000)).toBe(true)
    expect(isSilent(edit({ muted: true }), 5000)).toBe(true)
  })
})

describe('silentSpans', () => {
  it('merges the trimmed ends with the silences', () => {
    const spans = silentSpans(
      { muted: false, trim: { start: 1000, end: 9000 }, silences: [{ start: 800, end: 2000 }] },
      { start: 0, end: 10_000 },
    )
    expect(spans).toEqual([
      { start: 0, end: 2000 },
      { start: 9000, end: 10_000 },
    ])
    expect(silencedDuration(edit().sound, { start: 0, end: 10_000 })).toBe(0)
  })

  it('is the whole range when muted', () => {
    expect(silentSpans(edit({ muted: true }).sound, { start: 500, end: 700 })).toEqual([
      { start: 500, end: 700 },
    ])
  })
})

describe('silences', () => {
  it('adds, merges and removes', () => {
    let next = addSilence(edit(), { start: 1000, end: 2000 })
    next = addSilence(next, { start: 1500, end: 2500 })
    expect(next.sound.silences).toEqual([{ start: 1000, end: 2500 }])

    next = removeSilence(next, 1200)
    expect(next.sound.silences).toEqual([])
  })

  it('replaces in place and tidies on release', () => {
    const two = addSilence(addSilence(edit(), { start: 1000, end: 2000 }), {
      start: 5000,
      end: 6000,
    })
    const dragged = replaceSilence(two, 0, { start: 4000, end: 5500 })
    expect(dragged.sound.silences).toEqual([
      { start: 4000, end: 5500 },
      { start: 5000, end: 6000 },
    ])
    expect(tidySilences(dragged).sound.silences).toEqual([{ start: 4000, end: 6000 }])
  })

  it('clamps a replaced silence to the sound trim', () => {
    const trimmed = setSoundTrim(addSilence(edit(), { start: 1000, end: 2000 }), {
      start: 1500,
      end: 8000,
    })
    expect(trimmed.sound.silences).toEqual([{ start: 1500, end: 2000 }])
    expect(replaceSilence(trimmed, 0, { start: 0, end: 9000 }).sound.silences).toEqual([
      { start: 1500, end: 8000 },
    ])
  })
})

describe('hasSound', () => {
  const clip = (overrides: Partial<ClipEdit['sound']> = {}, audio = true) =>
    ({ audio, edit: edit(overrides) }) as Pick<Clip, 'audio' | 'edit'>

  it('needs a recording with sound that is not entirely quiet', () => {
    expect(hasSound(clip())).toBe(true)
    expect(hasSound(clip({}, false))).toBe(false)
    expect(hasSound(clip({ muted: true }))).toBe(false)
    expect(hasSound(clip({ silences: [{ start: 0, end: 10_000 }] }))).toBe(false)
    expect(hasSound(clip({ trim: { start: 0, end: 0 } }))).toBe(false)
    expect(setMuted(edit(), true).sound.muted).toBe(true)
  })
})

describe('upgradeClip', () => {
  it('fills the sound edit into a record written without one', () => {
    const { sound: _dropped, ...legacy } = defaultEdit(4000)
    const clip = { duration: 4000, edit: legacy } as unknown as Clip
    expect(upgradeClip(clip).edit.sound).toEqual({
      muted: false,
      trim: { start: 0, end: 4000 },
      silences: [],
    })
    const current = { duration: 4000, edit: defaultEdit(4000) } as Clip
    expect(upgradeClip(current)).toBe(current)
  })
})

describe('waveformBuilder', () => {
  it('keeps the loudest sample of each bin and normalizes to the peak', () => {
    const builder = waveformBuilder(1000, 4)
    // 1 kHz: one frame per millisecond, four bins of 250 frames.
    const left = new Float32Array(1000)
    left[100] = 0.2
    left[300] = -0.5
    left[900] = 0.1
    builder.add([left], 0, 1000)

    const { peaks, duration } = builder.done()
    expect(duration).toBe(1000)
    expect(Array.from(peaks).map((value) => Math.round(value * 100) / 100)).toEqual([
      0.4, 1, 0, 0.2,
    ])
  })

  it('places a chunk by its start time', () => {
    const builder = waveformBuilder(1000, 2)
    const chunk = new Float32Array(10).fill(0.5)
    builder.add([chunk], 600, 1000)
    expect(Array.from(builder.done().peaks)).toEqual([0, 1])
  })
})
