import { describe, expect, it } from 'vitest'

import { createDoc } from '@/core/doc/create'
import type { Doc } from '@/core/doc/types'

import { EXTENSION, maxExportScale } from './export'
import { MAX_CANVAS_AREA, MAX_CANVAS_SIDE } from './limits'

function docOfSize(w: number, h: number): Doc {
  const base = createDoc({ imageId: 'img_1', imageWidth: 100, imageHeight: 100 })
  return { ...base, canvas: { ...base.canvas, w, h } }
}

describe('maxExportScale', () => {
  it('allows the full range for an ordinary shot', () => {
    expect(maxExportScale(docOfSize(1400, 900))).toBe(4)
  })

  it('stays inside the canvas area limit for a long page', () => {
    const doc = docOfSize(1400, 24_000)
    const scale = maxExportScale(doc)

    expect(scale).toBeLessThan(4)
    expect(doc.canvas.w * scale * (doc.canvas.h * scale)).toBeLessThanOrEqual(MAX_CANVAS_AREA)
  })

  it('stays inside the canvas side limit', () => {
    const doc = docOfSize(1000, 30_000)
    expect(doc.canvas.h * maxExportScale(doc)).toBeLessThanOrEqual(MAX_CANVAS_SIDE)
  })

  it('never returns zero, so export is always attempted at some size', () => {
    expect(maxExportScale(docOfSize(60_000, 60_000))).toBeGreaterThan(0)
  })

  it('copes with an empty document', () => {
    expect(maxExportScale(docOfSize(0, 0))).toBe(1)
  })
})

describe('EXTENSION', () => {
  it('uses the conventional jpg, not jpeg', () => {
    expect(EXTENSION.jpeg).toBe('jpg')
  })
})
