import { describe, expect, it } from 'vitest'

import {
  capEvents,
  clampEvents,
  eventsIn,
  eventsOfKind,
  pageRect,
  type RecordEvent,
  sortEvents,
  toFrameSpace,
} from './timeline'

function move(at: number, x = 0.5, y = 0.5): RecordEvent {
  return { kind: 'move', at, point: { x, y }, rect: null }
}

function click(at: number): RecordEvent {
  return { kind: 'click', at, point: { x: 0.5, y: 0.5 }, rect: null }
}

describe('sortEvents', () => {
  it('puts a re-injected burst back in order without mutating the input', () => {
    const events = [click(300), click(100), click(200)]
    expect(sortEvents(events).map((event) => event.at)).toEqual([100, 200, 300])
    expect(events[0]!.at).toBe(300)
  })
})

describe('eventsOfKind and eventsIn', () => {
  it('filters by kind', () => {
    expect(eventsOfKind([move(0), click(10)], 'click')).toHaveLength(1)
  })

  it('takes the span with an exclusive end', () => {
    expect(eventsIn([click(100), click(200), click(300)], 100, 300).map((e) => e.at)).toEqual([
      100, 200,
    ])
  })
})

describe('clampEvents', () => {
  /**
   * Dropping these was losing real clicks: the clock correction shifts the whole timeline
   * by a few hundred milliseconds, which put the first click of a recording just before
   * zero, and it disappeared with no way to tell it ever happened.
   */
  it('pulls an event just outside the recording to the nearest end', () => {
    expect(clampEvents([click(-10), click(500), click(1400)], 1000).map((e) => e.at)).toEqual([
      0, 500, 1000,
    ])
  })

  it('drops what is nowhere near the recording at all', () => {
    expect(clampEvents([click(500), click(90_000)], 1000).map((e) => e.at)).toEqual([500])
  })

  it('scales its tolerance with the length of the clip', () => {
    // Ten per cent of a five-minute recording is thirty seconds, so a stray second is
    // still within reach of the end.
    expect(clampEvents([click(301_000)], 300_000).map((e) => e.at)).toEqual([300_000])
  })
})

describe('capEvents', () => {
  it('leaves a timeline that fits alone', () => {
    const events = [click(100), click(200)]
    expect(capEvents(events, 10)).toHaveLength(2)
  })

  /**
   * Clips recorded before the pointer path was dropped still carry `move` events, and
   * they are the ones worth shedding: a click is a thing that happened, a sample of a
   * cursor on its way somewhere is not.
   */
  it('sheds the oldest cursor samples first, keeping every action', () => {
    const events = [move(0), click(10), move(20), click(30), move(40)]
    const capped = capEvents(events, 3)

    expect(capped.map((event) => event.kind)).toEqual(['click', 'click', 'move'])
    expect(capped.at(-1)!.at).toBe(40)
  })

  it('falls back to dropping the oldest actions when nothing else is left', () => {
    const events = [click(0), click(10), click(20), click(30)]
    expect(capEvents(events, 2).map((event) => event.at)).toEqual([20, 30])
  })
})

describe('pageRect', () => {
  it('is the whole frame when the aspects match', () => {
    expect(pageRect({ w: 1280, h: 720 }, { w: 2560, h: 1440 })).toEqual({ x: 0, y: 0, w: 1, h: 1 })
  })

  /**
   * A capture stream keeps the size it was opened with. When its aspect does not match
   * the page, the page is fitted inside and the rest is padding — the black band along
   * the top of such a recording.
   */
  it('centres a page that is wider than the frame, leaving bands above and below', () => {
    const page = pageRect({ w: 1000, h: 500 }, { w: 1000, h: 1000 })
    expect(page.w).toBeCloseTo(1, 6)
    expect(page.h).toBeCloseTo(0.5, 6)
    expect(page.y).toBeCloseTo(0.25, 6)
  })

  it('refuses to divide by a frame that does not exist', () => {
    expect(pageRect({ w: 0, h: 0 }, { w: 0, h: 0 })).toEqual({ x: 0, y: 0, w: 1, h: 1 })
  })
})

describe('toFrameSpace', () => {
  const clicked: RecordEvent = {
    kind: 'click',
    at: 100,
    point: { x: 0.5, y: 0.1 },
    rect: { x: 0.4, y: 0.05, w: 0.2, h: 0.1 },
  }

  it('leaves the timeline alone when the page fills the frame', () => {
    expect(toFrameSpace([clicked], { w: 1280, h: 720 }, { w: 1280, h: 720 })[0]).toEqual(clicked)
  })

  it('leaves it alone when nothing reported a viewport', () => {
    expect(toFrameSpace([clicked], null, { w: 1000, h: 1000 })[0]).toEqual(clicked)
  })

  /**
   * The error is nothing in the middle of the picture and worst at the edges, which is
   * why a click near the top of the page was the one that looked wrong.
   */
  it('pushes a point near the top down into the band the page really occupies', () => {
    const [moved] = toFrameSpace([clicked], { w: 1000, h: 500 }, { w: 1000, h: 1000 })
    expect(moved!.point!.x).toBeCloseTo(0.5, 6)
    expect(moved!.point!.y).toBeCloseTo(0.3, 6)
    expect(moved!.rect!.h).toBeCloseTo(0.05, 6)
  })

  it('leaves a placeless event without inventing a place for it', () => {
    const key: RecordEvent = { kind: 'key', at: 10, point: null, rect: null }
    expect(toFrameSpace([key], { w: 1000, h: 500 }, { w: 1000, h: 1000 })[0]).toEqual(key)
  })
})
