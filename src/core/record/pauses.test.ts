import { describe, expect, it } from 'vitest'

import { defaultEdit } from './defaults'
import { DEFAULT_PAUSE_OPTIONS, findPauses, pauseSavings } from './pauses'
import type { RecordEvent } from './timeline'

function action(at: number, kind: RecordEvent['kind'] = 'click'): RecordEvent {
  return { kind, at, point: { x: 0.5, y: 0.5 }, rect: null }
}

const edit = defaultEdit(20_000)

describe('findPauses', () => {
  it('cuts the dead air between two clicks, keeping a lead and a tail', () => {
    const spans = findPauses([action(1000), action(11_000)], edit)
    expect(spans).toContainEqual({ start: 1400, end: 10_700 })
  })

  it('leaves short gaps alone', () => {
    const spans = findPauses([action(1000), action(2000), action(3000)], {
      ...edit,
      trim: { start: 900, end: 3100 },
    })
    expect(spans).toEqual([])
  })

  it('cuts the head and the tail right up to the boundary', () => {
    const spans = findPauses([action(9000)], { ...edit, trim: { start: 0, end: 20_000 } })
    expect(spans[0]).toEqual({ start: 0, end: 8700 })
    expect(spans.at(-1)).toEqual({ start: 9400, end: 20_000 })
  })

  it('treats cursor movement as dead air, not as activity', () => {
    const spans = findPauses([action(1000), action(5000, 'move'), action(11_000)], edit)
    expect(spans).toContainEqual({ start: 1400, end: 10_700 })
  })

  it('counts scroll and typing as activity', () => {
    const spans = findPauses(
      [action(1000), action(5000, 'scroll'), action(9000, 'key'), action(11_000)],
      edit,
    )
    expect(spans.some((span) => span.start < 5000 && span.end > 5000)).toBe(false)
  })

  it('stays inside the trim', () => {
    const trimmed = { ...edit, trim: { start: 5000, end: 15_000 } }
    for (const span of findPauses([action(10_000)], trimmed)) {
      expect(span.start).toBeGreaterThanOrEqual(5000)
      expect(span.end).toBeLessThanOrEqual(15_000)
    }
  })

  it('honours a shorter minimum pause', () => {
    const spans = findPauses([action(1000), action(3000)], edit, {
      ...DEFAULT_PAUSE_OPTIONS,
      minPause: 500,
    })
    expect(spans).toContainEqual({ start: 1400, end: 2700 })
  })
})

describe('pauseSavings', () => {
  it('adds the spans up', () => {
    expect(
      pauseSavings([
        { start: 0, end: 1000 },
        { start: 3000, end: 3500 },
      ]),
    ).toBe(1500)
  })
})
