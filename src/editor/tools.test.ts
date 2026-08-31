import { describe, expect, it } from 'vitest'

import {
  isMeaningfulDrag,
  MIN_DRAG,
  rectFromDrag,
  specFor,
  toolForKey,
  toolPatch,
  TOOLS,
} from './tools'

describe('TOOLS', () => {
  it('gives every tool its own single key', () => {
    const keys = TOOLS.map((spec) => spec.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const key of keys) expect(key).toHaveLength(1)
  })

  // Three tools create no layer: select, crop, and the eraser — which removes layers instead.
  it('creates a layer for everything except the pointer, the crop and the eraser', () => {
    const noLayer = new Set(['select', 'crop', 'eraser'])

    for (const spec of TOOLS) {
      expect(spec.kind === null).toBe(noLayer.has(spec.tool))
    }
  })

  it('gives the eraser its own gesture', () => {
    expect(specFor('eraser').gesture).toBe('erase')
  })

  it('leaves the crop to its own mode rather than a one-shot drag', () => {
    expect(specFor('crop').gesture).toBe('none')
  })
})

describe('toolForKey', () => {
  it('is case-insensitive, so Caps Lock does not break the shortcuts', () => {
    expect(toolForKey('A')).toBe('arrow')
    expect(toolForKey('a')).toBe('arrow')
  })

  it('says nothing for an unbound key', () => {
    expect(toolForKey('q')).toBeUndefined()
  })
})

describe('specFor', () => {
  it('falls back to the pointer for an unknown tool', () => {
    expect(specFor('nonsense' as never).tool).toBe('select')
  })
})

describe('toolPatch', () => {
  it('separates tools that share a layer kind', () => {
    expect(specFor('rect').kind).toBe(specFor('ellipse').kind)
    expect(toolPatch('ellipse')).toEqual({ shape: 'ellipse' })
    expect(toolPatch('rect')).toEqual({})
  })

  it('makes the highlighter a drawing in highlighter mode', () => {
    expect(specFor('highlighter').kind).toBe('draw')
    expect(toolPatch('highlighter')).toEqual({ mode: 'highlighter' })
  })
})

describe('rectFromDrag', () => {
  it('normalises a drag made in any direction', () => {
    const downRight = rectFromDrag({ x: 10, y: 10 }, { x: 110, y: 60 })
    const upLeft = rectFromDrag({ x: 110, y: 60 }, { x: 10, y: 10 })

    expect(downRight).toEqual({ x: 10, y: 10, w: 100, h: 50 })
    expect(upLeft).toEqual(downRight)
  })
})

describe('isMeaningfulDrag', () => {
  it('ignores a stray click, but accepts a real drag', () => {
    expect(isMeaningfulDrag({ x: 0, y: 0 }, { x: 2, y: 2 })).toBe(false)
    expect(isMeaningfulDrag({ x: 0, y: 0 }, { x: MIN_DRAG, y: 0 })).toBe(true)
  })
})
