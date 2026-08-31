import { describe, expect, it } from 'vitest'

import { frameRect } from './canvas-presets'
import {
  applyCrop,
  captureFromTransform,
  captureSourceRect,
  clearCaptureImage,
  defaultCropRegion,
  fitCaptureToCanvas,
  hasCaptureImage,
  moveCapture,
  PRIOR_CAPTURE_NAME,
  replaceCapture,
  resetCrop,
  revertCapture,
  setCaptureImage,
} from './capture-ops'
import { createDoc } from './create'
import type { Doc } from './types'

/** A 1200×800 CSS-pixel capture taken at 2× — i.e. a 2400×1600 image. */
const IMAGE = { w: 2400, h: 1600 }

function doc(): Doc {
  return createDoc({ imageId: 'img_1', imageWidth: 1200, imageHeight: 800 })
}

describe('captureSourceRect', () => {
  it('is the whole image until something is cropped', () => {
    expect(captureSourceRect(doc(), IMAGE)).toEqual({ x: 0, y: 0, w: 2400, h: 1600 })
  })
})

describe('applyCrop', () => {
  it('records the crop in source pixels, not document units', () => {
    const start = doc()
    const frame = frameRect(start)
    const half = { x: frame.x, y: frame.y, w: frame.w / 2, h: frame.h / 2 }

    const cropped = applyCrop(start, half, IMAGE)

    expect(cropped.capture.crop).toEqual({ x: 0, y: 0, w: 1200, h: 800 })
  })

  it('keeps the cropped area exactly where it was on screen', () => {
    const start = doc()
    const frame = frameRect(start)
    const region = { x: frame.x + 100, y: frame.y + 50, w: 400, h: 300 }

    const cropped = applyCrop(start, region, IMAGE)
    const after = frameRect(cropped)

    expect(after.x).toBeCloseTo(region.x, 5)
    expect(after.y).toBeCloseTo(region.y, 5)
    expect(after.w).toBeCloseTo(region.w, 5)
    expect(after.h).toBeCloseTo(region.h, 5)
  })

  it('clamps a region dragged past the edge of the frame', () => {
    const start = doc()
    const frame = frameRect(start)
    const overshoot = { x: frame.x - 500, y: frame.y - 500, w: frame.w + 1000, h: frame.h + 1000 }

    const cropped = applyCrop(start, overshoot, IMAGE)

    expect(cropped.capture.crop).toEqual({ x: 0, y: 0, w: 2400, h: 1600 })
  })

  it('crops relative to the previous crop, not to the original', () => {
    const start = doc()
    const frame = frameRect(start)
    const once = applyCrop(start, { x: frame.x + 600, y: frame.y, w: 600, h: 400 }, IMAGE)

    const inner = frameRect(once)
    const twice = applyCrop(once, { x: inner.x + 300, y: inner.y, w: 300, h: 200 }, IMAGE)

    expect(twice.capture.crop?.x).toBeCloseTo(1800, 5)
  })

  it('ignores an empty region', () => {
    const start = doc()
    expect(applyCrop(start, { x: 0, y: 0, w: 0, h: 0 }, IMAGE)).toBe(start)
  })
})

describe('resetCrop', () => {
  it('brings the whole frame back at its natural size', () => {
    const start = doc()
    const frame = frameRect(start)
    const cropped = applyCrop(start, { x: frame.x, y: frame.y, w: 300, h: 200 }, IMAGE)

    const restored = resetCrop(cropped, IMAGE)

    expect(restored.capture.crop).toBeNull()
    expect(restored.capture.width).toBe(1200)
    expect(restored.capture.height).toBe(800)
  })

  it('is a no-op when nothing is cropped', () => {
    const start = doc()
    expect(resetCrop(start, IMAGE)).toBe(start)
  })
})

describe('fitCaptureToCanvas', () => {
  it('scales the frame to the canvas minus padding and recentres it', () => {
    const start = { ...doc(), canvas: { ...doc().canvas, w: 1600, h: 900 } }
    const fitted = fitCaptureToCanvas(moveCapture(start, { x: 300, y: 40 }))

    expect(fitted.capture.height * fitted.capture.scale).toBeLessThanOrEqual(900 - 128)
    expect(fitted.capture.offset).toEqual({ x: 0, y: 0 })
  })
})

describe('moveCapture', () => {
  it('adds to the offset rather than replacing it', () => {
    const moved = moveCapture(moveCapture(doc(), { x: 10, y: 5 }), { x: -3, y: 20 })
    expect(moved.capture.offset).toEqual({ x: 7, y: 25 })
  })
})

describe('captureFromTransform', () => {
  it('turns a resize into a scale, keeping the natural size untouched', () => {
    const start = doc()
    const next = captureFromTransform(start, { x: 0, y: 0, w: 600, h: 400, rotation: 0 })

    expect(next.capture.scale).toBe(0.5)
    expect(next.capture.width).toBe(1200)
  })

  it('places the frame where the gesture left it', () => {
    const start = doc()
    const next = captureFromTransform(start, { x: 100, y: 50, w: 1200, h: 800, rotation: 0 })
    const rect = frameRect(next)

    expect(rect.x).toBeCloseTo(100, 5)
    expect(rect.y).toBeCloseTo(50, 5)
  })

  it('keeps the rotation from the gesture', () => {
    const next = captureFromTransform(doc(), { x: 0, y: 0, w: 1200, h: 800, rotation: 12 })
    expect(next.capture.rotation).toBe(12)
  })
})

describe('setCaptureImage', () => {
  it('drops a crop measured in the old image, since it means nothing in the new one', () => {
    const start = doc()
    const frame = frameRect(start)
    const cropped = applyCrop(start, { x: frame.x, y: frame.y, w: 300, h: 200 }, IMAGE)

    const replaced = setCaptureImage(cropped, { imageId: 'img_2', width: 640, height: 480 })

    expect(replaced.capture.crop).toBeNull()
    expect(replaced.capture.width).toBe(640)
    expect(replaced.capture.imageId).toBe('img_2')
  })

  it('recentres and unrotates, so the new picture arrives plainly', () => {
    const moved = { ...doc(), capture: { ...doc().capture, rotation: 20, scale: 3 } }
    const replaced = setCaptureImage(moved, { imageId: 'img_2', width: 100, height: 100 })

    expect(replaced.capture.rotation).toBe(0)
    expect(replaced.capture.scale).toBe(1)
    expect(replaced.capture.offset).toEqual({ x: 0, y: 0 })
  })
})

describe('clearCaptureImage', () => {
  it('leaves the document standing, only without a picture', () => {
    const start = doc()
    const cleared = clearCaptureImage(start)

    expect(hasCaptureImage(cleared)).toBe(false)
    expect(cleared.canvas).toEqual(start.canvas)
    expect(cleared.layers).toEqual(start.layers)
  })
})

describe('defaultCropRegion', () => {
  it('starts on part of the frame, not all of it', () => {
    const start = doc()
    const frame = frameRect(start)
    const region = defaultCropRegion(start)

    expect(region.w).toBeLessThan(frame.w)
    expect(region.h).toBeLessThan(frame.h)
  })

  it('sits centred inside the frame', () => {
    const start = doc()
    const frame = frameRect(start)
    const region = defaultCropRegion(start)

    expect(region.x + region.w / 2).toBeCloseTo(frame.x + frame.w / 2, 5)
    expect(region.y + region.h / 2).toBeCloseTo(frame.y + frame.h / 2, 5)
  })

  it('stays inside the frame, so nothing is clamped away on apply', () => {
    const start = doc()
    const frame = frameRect(start)
    const region = defaultCropRegion(start)

    expect(region.x).toBeGreaterThanOrEqual(frame.x)
    expect(region.x + region.w).toBeLessThanOrEqual(frame.x + frame.w)
  })
})

describe('replaceCapture', () => {
  const shot = (width: number, height: number) => ({
    imageId: 'img_2',
    width,
    height,
    capturedAt: 2_000,
  })

  it('keeps the frame anchored at its top-left corner', () => {
    const start = doc()
    const before = frameRect(start)
    const after = frameRect(replaceCapture(start, shot(1200, 900)))

    expect(after.x).toBeCloseTo(before.x)
    expect(after.y).toBeCloseTo(before.y)
    expect(after.h).toBeGreaterThan(before.h)
  })

  it('pushes the previous frame into the history, so nothing is lost', () => {
    const replaced = replaceCapture(doc(), shot(1200, 800))

    expect(replaced.history).toEqual([
      { imageId: 'img_1', width: 1200, height: 800, capturedAt: replaced.history![0]!.capturedAt },
    ])
    expect(replaced.capture.imageId).toBe('img_2')
  })

  it('keeps the old shot as a layer at the bottom of the stack, switched off', () => {
    const start = doc()
    const was = frameRect(start)
    const replaced = replaceCapture(start, shot(1200, 900))
    const prior = replaced.layers[0]!

    expect(prior.name).toBe(PRIOR_CAPTURE_NAME)
    expect(prior.kind).toBe('image')
    if (prior.kind !== 'image') return

    expect(prior.imageId).toBe('img_1')
    // The layer sits where the old capture stood, at its former size.
    expect(prior.rect).toEqual({ x: was.x, y: was.y, w: was.w, h: was.h })
    // Hidden: layers draw above the capture, and enabled it would cover the new shot.
    expect(prior.visible).toBe(false)
  })

  it('keeps exactly one old shot, not a pile of them', () => {
    const once = replaceCapture(doc(), shot(1200, 800))
    const twice = replaceCapture(once, { ...shot(1200, 800), imageId: 'img_3' })

    expect(twice.layers.filter((layer) => layer.name === PRIOR_CAPTURE_NAME)).toHaveLength(1)
    // The full capture history is still intact.
    expect(twice.history?.map((version) => version.imageId)).toEqual(['img_1', 'img_2'])
  })

  it('scales an annotation from the corner of the frame, not from the canvas', () => {
    const start = doc()
    const frame = frameRect(start)
    const badge = {
      id: 'l1',
      kind: 'badge' as const,
      name: 'badge',
      visible: true,
      locked: false,
      opacity: 1,
      rotation: 0,
      at: { x: frame.x + 100, y: frame.y + 200 },
      number: null,
      style: 'number' as const,
      color: '#f00',
      size: 32,
    }

    const replaced = replaceCapture({ ...start, layers: [badge] }, shot(2400, 1600))
    const moved = replaced.layers.find((layer) => layer.name === 'badge')!

    expect(moved.kind).toBe('badge')
    if (moved.kind !== 'badge') return
    expect(moved.at).toEqual({ x: frame.x + 200, y: frame.y + 400 })
  })

  it('carries the crop over by the same ratio, keeping the same part in view', () => {
    const start = applyCrop(doc(), defaultCropRegion(doc()), IMAGE)
    const cropped = replaceCapture(start, shot(600, 400)).capture.crop!
    const was = start.capture.crop!

    expect(cropped.w / was.w).toBeCloseTo(600 / start.capture.width)
  })

  it('refuses an empty frame instead of collapsing the document', () => {
    const start = doc()
    expect(replaceCapture(start, shot(0, 0))).toBe(start)
  })
})

describe('revertCapture', () => {
  it('swaps the frames back and forth rather than eating them one by one', () => {
    const replaced = replaceCapture(doc(), {
      imageId: 'img_2',
      width: 1200,
      height: 800,
      capturedAt: 2_000,
    })
    const reverted = revertCapture(replaced, 3_000)

    expect(reverted.capture.imageId).toBe('img_1')
    expect(reverted.history?.map((version) => version.imageId)).toEqual(['img_2'])
  })

  it('does nothing when the document was never re-shot', () => {
    const start = doc()
    expect(revertCapture(start, 3_000)).toBe(start)
  })
})
