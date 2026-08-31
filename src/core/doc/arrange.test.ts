import { describe, expect, it } from 'vitest'

import { arrangeableItems, arrangeFrames } from './arrange'
import { frameRect } from './canvas-presets'
import { createDoc } from './create'
import { addLayer, createLayer } from './layers'
import type { Doc, ImageLayer, Rect } from './types'

function base(): Doc {
  const doc = createDoc({ imageId: 'img_1', imageWidth: 800, imageHeight: 600 })
  return { ...doc, canvas: { ...doc.canvas, padding: 40 } }
}

function withImage(doc: Doc, rect: Rect, imageId = 'img_2'): Doc {
  const layer = { ...(createLayer('image', { rect }) as ImageLayer), imageId }
  return addLayer(doc, layer)
}

const imageRects = (doc: Doc): Rect[] =>
  doc.layers.filter((layer): layer is ImageLayer => layer.kind === 'image').map((l) => l.rect)

describe('arrangeableItems', () => {
  it('counts the shot itself as a frame', () => {
    expect(arrangeableItems(base())).toHaveLength(1)
  })

  it('counts image layers too', () => {
    const doc = withImage(base(), { x: 0, y: 0, w: 400, h: 300 })

    expect(arrangeableItems(doc)).toHaveLength(2)
  })

  // A hidden capture doesn't take part: layout arranges what's visible.
  it('skips what is hidden', () => {
    const doc = base()
    const hidden = { ...doc, capture: { ...doc.capture, visible: false } }

    expect(arrangeableItems(hidden)).toHaveLength(0)
  })

  it('has nothing to arrange in a document without a shot', () => {
    const doc = base()

    expect(arrangeableItems({ ...doc, capture: { ...doc.capture, imageId: '' } })).toHaveLength(0)
  })
})

describe('arrangeFrames', () => {
  it('leaves a single frame exactly as it was', () => {
    const doc = base()

    expect(arrangeFrames(doc, 'row')).toBe(doc)
  })

  it('puts frames side by side without overlapping', () => {
    const doc = arrangeFrames(withImage(base(), { x: 0, y: 0, w: 400, h: 300 }), 'row')
    const shot = frameRect(doc)
    const [image] = imageRects(doc)

    expect(image).toBeDefined()
    const gap = image!.x - (shot.x + shot.w)
    expect(gap).toBeGreaterThan(0)
  })

  it('stacks frames one under another in a column', () => {
    const doc = arrangeFrames(withImage(base(), { x: 0, y: 0, w: 400, h: 300 }), 'column')
    const shot = frameRect(doc)
    const [image] = imageRects(doc)

    expect(image!.y).toBeGreaterThan(shot.y + shot.h)
  })

  // A cascade means overlap: the second frame starts before the first ends.
  it('overlaps frames in a cascade', () => {
    const doc = arrangeFrames(withImage(base(), { x: 0, y: 0, w: 400, h: 300 }), 'cascade')
    const shot = frameRect(doc)
    const [image] = imageRects(doc)

    expect(image!.x).toBeGreaterThan(shot.x)
    expect(image!.x).toBeLessThan(shot.x + shot.w)
  })

  it('fits the canvas around the result, padding included', () => {
    const doc = arrangeFrames(withImage(base(), { x: 0, y: 0, w: 400, h: 300 }), 'row')
    const shot = frameRect(doc)
    const [image] = imageRects(doc)

    expect(shot.x).toBeCloseTo(doc.canvas.padding)
    expect(doc.canvas.w - (image!.x + image!.w)).toBeCloseTo(doc.canvas.padding)
    expect(doc.canvas.preset).toBe('custom')
  })

  it('centres frames of different heights across the row', () => {
    const doc = arrangeFrames(withImage(base(), { x: 0, y: 0, w: 400, h: 200 }), 'row')
    const shot = frameRect(doc)
    const [image] = imageRects(doc)

    const shotCentre = shot.y + shot.h / 2
    const imageCentre = image!.y + image!.h / 2
    expect(imageCentre).toBeCloseTo(shotCentre)
  })

  it('keeps every frame its own size', () => {
    const doc = arrangeFrames(withImage(base(), { x: 0, y: 0, w: 400, h: 300 }), 'column')

    expect(imageRects(doc)[0]).toMatchObject({ w: 400, h: 300 })
  })

  it('arranges three frames as well as two', () => {
    const two = withImage(base(), { x: 0, y: 0, w: 400, h: 300 })
    const doc = arrangeFrames(withImage(two, { x: 0, y: 0, w: 200, h: 200 }, 'img_3'), 'row')
    const rects = imageRects(doc)

    expect(rects[0]!.x + rects[0]!.w).toBeLessThanOrEqual(rects[1]!.x)
  })
})
