import { describe, expect, it } from 'vitest'

import { clickPulses } from './clicks'
import type { RecordEvent } from './timeline'

const clicks: RecordEvent[] = [
  { kind: 'click', at: 1000, point: { x: 0.2, y: 0.3 }, rect: null },
  { kind: 'click', at: 1200, point: { x: 0.2, y: 0.3 }, rect: null },
]

describe('clickPulses', () => {
  it('ages a ripple from 0 to 1', () => {
    expect(clickPulses(clicks, 1000, 500)[0]!.progress).toBe(0)
    expect(clickPulses(clicks, 1250, 500)[0]!.progress).toBe(0.5)
  })

  it('shows a double click as two overlapping rings', () => {
    expect(clickPulses(clicks, 1300, 500)).toHaveLength(2)
  })

  it('drops a ripple once it has faded', () => {
    expect(clickPulses(clicks, 2000, 500)).toEqual([])
  })

  it('ignores everything that is not a click', () => {
    const move: RecordEvent = { kind: 'move', at: 1000, point: { x: 0.5, y: 0.5 }, rect: null }
    expect(clickPulses([move], 1000, 500)).toEqual([])
  })
})
