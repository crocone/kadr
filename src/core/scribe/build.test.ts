import { describe, expect, it } from 'vitest'

import { frameRect } from '@/core/doc/canvas-presets'

import { buildStepDoc, isGeneratedStepDoc, stepsWithFrames } from './build'
import { DEFAULT_SCRIBE_STYLE } from './style'
import type { ScribeStep } from './timeline'

function step(patch: Partial<ScribeStep> = {}): ScribeStep {
  return {
    id: 's1',
    guideId: 'g1',
    index: 3,
    kind: 'click',
    at: 0,
    point: { x: 120, y: 80 },
    element: { selector: '#save', fingerprint: { tag: 'button', label: 'Save', w: 80, h: 32 } },
    target: 'button',
    rect: { x: 100, y: 60, w: 80, h: 32 },
    url: 'https://example.com/app',
    title: 'App',
    imageId: 'img_1',
    viewport: { w: 1280, h: 800, dpr: 2 },
    caption: 'Click «Save»',
    captionEdited: false,
    docId: null,
    ...patch,
  }
}

const image = { imageId: 'img_1', width: 1280, height: 800 }

describe('buildStepDoc', () => {
  it('builds a plain document — no layer kind the editor does not already have', () => {
    const doc = buildStepDoc(step(), image)!
    expect(doc.layers.map((layer) => layer.kind)).toEqual(['shape', 'badge', 'text'])
  })

  /**
   * The bug where the outline hovered above the button: the canvas grows down by the
   * caption band, but the frame is centered on the canvas and drifts by half of it.
   * The frame position must not be computed a second way — this checks exactly that.
   */
  it('outlines the element itself, not the strip 32 px above it', () => {
    const doc = buildStepDoc(step(), image)!
    const frame = frameRect(doc)
    const outline = doc.layers.find((layer) => layer.kind === 'shape')!

    expect(outline.kind).toBe('shape')
    if (outline.kind !== 'shape') return

    // Outline wraps the element rect in frame coordinates, with a small margin.
    expect(outline.rect.x).toBeCloseTo(frame.x + 100 - 6)
    expect(outline.rect.y).toBeCloseTo(frame.y + 60 - 6)
    expect(outline.rect.w).toBeCloseTo(80 + 12)
    expect(outline.rect.h).toBeCloseTo(32 + 12)
  })

  it('keeps the badge outside the element, so a checkbox stays visible under it', () => {
    const tiny = step({ rect: { x: 400, y: 300, w: 14, h: 14 } })
    const doc = buildStepDoc(tiny, image)!
    const frame = frameRect(doc)
    const badge = doc.layers.find((layer) => layer.kind === 'badge')!
    const outline = doc.layers.find((layer) => layer.kind === 'shape')!

    if (badge.kind !== 'badge' || outline.kind !== 'shape') return
    // Badge center is a full radius left of the outline's left edge — fully outside.
    expect(badge.at.x).toBeLessThanOrEqual(outline.rect.x - badge.size / 2)
    expect(badge.at.x).toBeGreaterThanOrEqual(frame.x)
  })

  it('numbers the badge by the step, not by the order of the layers', () => {
    const badge = buildStepDoc(step(), image)!.layers.find((layer) => layer.kind === 'badge')
    expect(badge).toMatchObject({ number: 3 })
  })

  it('puts the caption below the frame, not over the interface it describes', () => {
    const doc = buildStepDoc(step(), image)!
    const frame = frameRect(doc)
    const caption = doc.layers.find((layer) => layer.kind === 'text')!

    expect(caption.kind).toBe('text')
    if (caption.kind !== 'text') return
    expect(caption.text).toBe('Click «Save»')
    // Below the frame's bottom edge and above the canvas bottom: the caption lives in its band.
    expect(caption.at.y).toBeGreaterThanOrEqual(frame.y + frame.h)
    expect(caption.at.y + 30).toBeLessThanOrEqual(doc.canvas.h)
  })

  it('leaves the frame at the padding, with the whole caption band under it', () => {
    const doc = buildStepDoc(step(), image)!
    const frame = frameRect(doc)
    const caption = doc.layers.find((layer) => layer.kind === 'text')!

    expect(frame.y).toBeCloseTo(doc.canvas.padding)
    if (caption.kind !== 'text') return

    // The band under the frame is taller than the caption, and all of it sits below the frame.
    const band = doc.canvas.h - (frame.y + frame.h) - doc.canvas.padding
    expect(band).toBeGreaterThan(caption.fontSize)
  })

  it('drops the outline when the element scrolled out of the frame', () => {
    const offscreen = step({ rect: { x: 100, y: 4000, w: 80, h: 32 } })
    const kinds = buildStepDoc(offscreen, image)!.layers.map((layer) => layer.kind)
    expect(kinds).toEqual(['text'])
  })

  it('gives no document at all to a step the limiter left without a frame', () => {
    expect(buildStepDoc(step({ imageId: null }), image)).toBeNull()
  })
})

describe('stepsWithFrames', () => {
  it('keeps only the steps a picture can be made of', () => {
    expect(stepsWithFrames([step(), step({ id: 's2', imageId: null })])).toHaveLength(1)
  })
})

describe('style', () => {
  it('paints the outline and the badge in the chosen colour', () => {
    const doc = buildStepDoc(step(), image, { ...DEFAULT_SCRIBE_STYLE, accent: '#ff8800' })!
    const outline = doc.layers.find((layer) => layer.kind === 'shape')!
    const badge = doc.layers.find((layer) => layer.kind === 'badge')!

    if (outline.kind !== 'shape' || badge.kind !== 'badge') return
    expect(outline.stroke).toBe('#ff8800')
    expect(badge.color).toBe('#ff8800')
  })

  it('leaves out what was switched off', () => {
    const doc = buildStepDoc(step(), image, {
      ...DEFAULT_SCRIBE_STYLE,
      outline: false,
      badge: false,
    })!
    expect(doc.layers.map((layer) => layer.kind)).toEqual(['text'])
  })

  it('drops the caption band entirely when there is no caption', () => {
    const withCaption = buildStepDoc(step(), image)!
    const without = buildStepDoc(step(), image, { ...DEFAULT_SCRIBE_STYLE, caption: false })!

    expect(without.canvas.h).toBeLessThan(withCaption.canvas.h)
    expect(without.layers.some((layer) => layer.kind === 'text')).toBe(false)
  })

  it('grows the band with the caption, so a big caption is not cut off', () => {
    const small = buildStepDoc(step(), image, { ...DEFAULT_SCRIBE_STYLE, captionSize: 14 })!
    const large = buildStepDoc(step(), image, { ...DEFAULT_SCRIBE_STYLE, captionSize: 44 })!

    expect(large.canvas.h).toBeGreaterThan(small.canvas.h)
  })
})

describe('isGeneratedStepDoc', () => {
  it('recognises a document nobody has drawn on', () => {
    expect(isGeneratedStepDoc(buildStepDoc(step(), image)!, step())).toBe(true)
  })

  it('refuses to touch a document with a hand-added layer', () => {
    const doc = buildStepDoc(step(), image)!
    const edited = { ...doc, layers: [...doc.layers, { ...doc.layers[0]!, name: 'Arrow' }] }

    expect(isGeneratedStepDoc(edited, step())).toBe(false)
  })
})
