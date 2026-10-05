import { describe, expect, it } from 'vitest'

import { defaultEdit } from './defaults'
import type { RecordEvent } from './timeline'
import type { ZoomSpan } from './types'
import { autoZooms, cameraAt, clampCamera, envelopeAt, NEUTRAL_CAMERA, separate } from './zoom'

function click(at: number, x: number, y: number, h = 0.05): RecordEvent {
  return {
    kind: 'click',
    at,
    point: { x, y },
    rect: { x: x - 0.05, y: y - h / 2, w: 0.1, h },
  }
}

const edit = defaultEdit(20_000)

describe('autoZooms', () => {
  it('makes one move out of a burst of clicks in one place', () => {
    const zooms = autoZooms([click(2000, 0.4, 0.4), click(2600, 0.42, 0.41)], edit)
    expect(zooms).toHaveLength(1)
    expect(zooms[0]!.hold.end).toBeGreaterThan(2600)
  })

  /**
   * Both ways of picking a single point failed: the average aimed between the buttons,
   * and the tightest element framed one and pushed its neighbour off the screen. The
   * property that matters is simply that everything the group clicked stays visible.
   */
  it('keeps every click of the group inside the frame', () => {
    const first = click(2000, 0.2, 0.2, 0.05)
    const second = click(2500, 0.35, 0.35, 0.02)
    const [zoom] = autoZooms([first, second], edit)
    expect(zoom).toBeDefined()

    const camera = cameraAt([zoom!], 2500)
    const half = 0.5 / camera.scale

    for (const point of [first.point!, second.point!]) {
      expect(point.x).toBeGreaterThanOrEqual(camera.at.x - half)
      expect(point.x).toBeLessThanOrEqual(camera.at.x + half)
      expect(point.y).toBeGreaterThanOrEqual(camera.at.y - half)
      expect(point.y).toBeLessThanOrEqual(camera.at.y + half)
    }
  })

  it('still leans in on a lone click rather than settling for the wide shot', () => {
    const [zoom] = autoZooms([click(2000, 0.5, 0.5, 0.03)], edit)
    expect(zoom!.scale).toBeGreaterThan(1.5)
  })

  it('never zooms so close that the element stops fitting across', () => {
    const halfWide: RecordEvent = {
      kind: 'click',
      at: 2000,
      point: { x: 0.5, y: 0.5 },
      rect: { x: 0.25, y: 0.48, w: 0.5, h: 0.02 },
    }
    // The height alone would ask for 21x; the width caps it at one that still fits.
    const [zoom] = autoZooms([halfWide], edit)
    expect(zoom!.scale).toBeCloseTo(0.85 / 0.5, 5)
  })

  it('skips the move entirely when the element is too wide to lean in on', () => {
    const banner: RecordEvent = {
      kind: 'click',
      at: 2000,
      point: { x: 0.5, y: 0.5 },
      rect: { x: 0.05, y: 0.48, w: 0.9, h: 0.02 },
    }
    expect(autoZooms([banner], edit)).toEqual([])
  })

  it('splits clicks that are far apart in place even when close in time', () => {
    const zooms = autoZooms([click(2000, 0.1, 0.1), click(2400, 0.9, 0.9)], edit)
    expect(zooms).toHaveLength(2)
  })

  it('splits clicks that are far apart in time even in the same place', () => {
    const zooms = autoZooms([click(2000, 0.5, 0.5), click(9000, 0.5, 0.5)], edit)
    expect(zooms).toHaveLength(2)
  })

  it('leans in further on a smaller element', () => {
    const [tight] = autoZooms([click(2000, 0.5, 0.5, 0.02)], edit)
    const [looser] = autoZooms([click(2000, 0.5, 0.5, 0.2)], edit)
    expect(tight!.scale).toBeGreaterThan(looser!.scale)
  })

  it('stays inside the trim', () => {
    const trimmed = { ...edit, trim: { start: 1900, end: 2500 } }
    const [zoom] = autoZooms([click(2000, 0.5, 0.5)], trimmed)
    expect(zoom!.hold.start).toBeGreaterThanOrEqual(1900)
    expect(zoom!.hold.end).toBeLessThanOrEqual(2500)
  })

  it('ignores clicks outside the trim and events that are not clicks', () => {
    const trimmed = { ...edit, trim: { start: 3000, end: 8000 } }
    const moves: RecordEvent = { kind: 'move', at: 4000, point: { x: 0.5, y: 0.5 }, rect: null }
    expect(autoZooms([click(1000, 0.5, 0.5), moves], trimmed)).toEqual([])
  })
})

describe('separate', () => {
  function zoom(start: number, end: number): ZoomSpan {
    return {
      id: `z${start}`,
      hold: { start, end },
      rampIn: 400,
      rampOut: 400,
      at: { x: 0.5, y: 0.5 },
      scale: 2,
      auto: true,
    }
  }

  it('shortens ramps that would overlap a neighbour', () => {
    const [first, second] = separate([zoom(0, 1000), zoom(1200, 2000)])
    expect(first!.rampOut).toBe(100)
    expect(second!.rampIn).toBe(100)
  })

  it('leaves ramps alone when there is room', () => {
    const [first, second] = separate([zoom(0, 1000), zoom(3000, 4000)])
    expect(first!.rampOut).toBe(400)
    expect(second!.rampIn).toBe(400)
  })
})

describe('envelopeAt', () => {
  const zoom: ZoomSpan = {
    id: 'z',
    hold: { start: 1000, end: 2000 },
    rampIn: 500,
    rampOut: 500,
    at: { x: 0.5, y: 0.5 },
    scale: 2,
    auto: true,
  }

  it('is flat on the plateau and gone outside the ramps', () => {
    expect(envelopeAt(zoom, 1500)).toBe(1)
    expect(envelopeAt(zoom, 400)).toBe(0)
    expect(envelopeAt(zoom, 2600)).toBe(0)
  })

  it('rises and falls monotonically along the ramps', () => {
    expect(envelopeAt(zoom, 600)).toBeLessThan(envelopeAt(zoom, 800))
    expect(envelopeAt(zoom, 2200)).toBeGreaterThan(envelopeAt(zoom, 2400))
    expect(envelopeAt(zoom, 750)).toBeCloseTo(0.5, 5)
  })
})

describe('cameraAt', () => {
  const zoom: ZoomSpan = {
    id: 'z',
    hold: { start: 1000, end: 2000 },
    rampIn: 500,
    rampOut: 500,
    at: { x: 0.5, y: 0.5 },
    scale: 2,
    auto: true,
  }

  it('is neutral with no zooms at all', () => {
    expect(cameraAt([], 1000)).toEqual(NEUTRAL_CAMERA)
    expect(cameraAt([zoom], 0)).toEqual(NEUTRAL_CAMERA)
  })

  it('reaches the full scale on the plateau', () => {
    expect(cameraAt([zoom], 1500).scale).toBeCloseTo(2, 5)
  })

  it('sits between wide and close halfway up the ramp', () => {
    const camera = cameraAt([zoom], 750)
    expect(camera.scale).toBeGreaterThan(1)
    expect(camera.scale).toBeLessThan(2)
  })

  it('blends overlapping zooms instead of jumping between them', () => {
    const other: ZoomSpan = { ...zoom, id: 'z2', at: { x: 0.5, y: 0.9 }, scale: 2 }
    const camera = cameraAt([zoom, other], 1500)
    expect(camera.at.y).toBeCloseTo(0.7, 5)
  })
})

describe('clampCamera', () => {
  it('keeps the window inside the frame', () => {
    expect(clampCamera({ scale: 2, at: { x: 0, y: 1 } })).toEqual({
      scale: 2,
      at: { x: 0.25, y: 0.75 },
    })
  })

  it('never zooms out past the whole frame', () => {
    expect(clampCamera({ scale: 0.5, at: { x: 0.5, y: 0.5 } }).scale).toBe(1)
  })
})
