/**
 * The capture as a canvas object: moved, scaled, rotated, and cropped with the
 * same gestures as annotations.
 *
 * In the model it stays a separate `capture` field rather than a layer: size
 * presets, background matching, and export all depend on it, and turning it into
 * an ordinary layer would mean rewriting half of those for the sake of a uniform
 * name. From the outside there's no difference — it selects and drags the same.
 *
 * `capture.crop` lives in source-image pixels: that's how Konva reads it, and
 * that's how it survives any canvas scale.
 */
import { frameRect } from './canvas-presets'
import { decoratedRectOf } from './frames'
import { createLayer } from './layers'
import type { CaptureVersion, Doc, ImageId, Layer, Point, Rect } from './types'

/** Selection id for the capture. No layer can have this id — layers use their own prefix. */
export const CAPTURE_ID = 'capture'

export type ImageSize = { w: number; h: number }

/** The part of the source image currently shown. */
export function captureSourceRect(doc: Doc, image: ImageSize): Rect {
  return doc.capture.crop ?? { x: 0, y: 0, w: image.w, h: image.h }
}

/** Source pixels per CSS pixel of the capture's natural size. */
function pixelRatioOf(doc: Doc, image: ImageSize): number {
  const source = captureSourceRect(doc, image)
  return doc.capture.width > 0 ? source.w / doc.capture.width : 1
}

/** Offset that puts the capture's centre at the given canvas point. */
function offsetForCentre(doc: Doc, centre: Point): Point {
  return { x: centre.x - doc.canvas.w / 2, y: centre.y - doc.canvas.h / 2 }
}

/**
 * Crop by a rectangle in document coordinates.
 *
 * The cropped area stays exactly where it was on screen — otherwise the capture
 * would jump out from under the cursor the moment the crop is applied.
 */
export function applyCrop(doc: Doc, region: Rect, image: ImageSize): Doc {
  const frame = frameRect(doc)
  if (frame.w <= 0 || frame.h <= 0 || region.w <= 0 || region.h <= 0) return doc

  const source = captureSourceRect(doc, image)
  const perDocX = source.w / frame.w
  const perDocY = source.h / frame.h

  // The region cannot extend beyond the part of the image already shown.
  const left = Math.max(frame.x, region.x)
  const top = Math.max(frame.y, region.y)
  const right = Math.min(frame.x + frame.w, region.x + region.w)
  const bottom = Math.min(frame.y + frame.h, region.y + region.h)
  if (right - left <= 0 || bottom - top <= 0) return doc

  const crop: Rect = {
    x: source.x + (left - frame.x) * perDocX,
    y: source.y + (top - frame.y) * perDocY,
    w: (right - left) * perDocX,
    h: (bottom - top) * perDocY,
  }

  const ratio = pixelRatioOf(doc, image)
  const width = crop.w / ratio
  const height = crop.h / ratio

  return {
    ...doc,
    capture: {
      ...doc.capture,
      crop,
      width,
      height,
      offset: offsetForCentre(doc, {
        x: left + (right - left) / 2,
        y: top + (bottom - top) / 2,
      }),
    },
  }
}

/** Remove the crop: the full capture comes back, centred on the canvas. */
export function resetCrop(doc: Doc, image: ImageSize): Doc {
  if (!doc.capture.crop) return doc

  const ratio = pixelRatioOf(doc, image)
  return {
    ...doc,
    capture: {
      ...doc.capture,
      crop: null,
      width: image.w / ratio,
      height: image.h / ratio,
      offset: { x: 0, y: 0 },
    },
  }
}

/**
 * Fit the capture into the canvas with padding, centred.
 *
 * Computed against the decorated box: the browser chrome and device shell take up
 * space, and without them the frame would stick out past the canvas edge. The
 * chrome height depends on the capture width, which depends on the scale, so the
 * scale is refined with a second pass; a third changes nothing.
 *
 * The box is what gets centred, not the shot itself: otherwise a capture with
 * browser chrome would sit low, balancing the drawing above with empty space.
 */
export function fitCaptureToCanvas(doc: Doc): Doc {
  const { padding } = doc.canvas
  const availableW = Math.max(1, doc.canvas.w - padding * 2)
  const availableH = Math.max(1, doc.canvas.h - padding * 2)

  let scale = Math.min(availableW / doc.capture.width, availableH / doc.capture.height)
  for (let pass = 0; pass < 2; pass += 1) {
    const box = decoratedRectOf(doc, {
      x: 0,
      y: 0,
      w: doc.capture.width * scale,
      h: doc.capture.height * scale,
    })
    scale *= Math.min(availableW / box.w, availableH / box.h)
  }

  const screen = { x: 0, y: 0, w: doc.capture.width * scale, h: doc.capture.height * scale }
  const box = decoratedRectOf(doc, screen)
  const offset = {
    x: screen.x + screen.w / 2 - (box.x + box.w / 2),
    y: screen.y + screen.h / 2 - (box.y + box.h / 2),
  }

  return { ...doc, capture: { ...doc.capture, scale, offset, rotation: 0 } }
}

export function moveCapture(doc: Doc, delta: Point): Doc {
  return {
    ...doc,
    capture: {
      ...doc.capture,
      offset: { x: doc.capture.offset.x + delta.x, y: doc.capture.offset.y + delta.y },
    },
  }
}

/**
 * Result of a transformer gesture: Konva reports node position and scale, the
 * document stores capture scale and offset from centre. The conversion lives
 * here so the gesture logic doesn't smear across the UI.
 */
export function captureFromTransform(
  doc: Doc,
  box: { x: number; y: number; w: number; h: number; rotation: number },
): Doc {
  const scale = doc.capture.width > 0 ? box.w / doc.capture.width : doc.capture.scale

  return {
    ...doc,
    capture: {
      ...doc.capture,
      scale,
      rotation: box.rotation,
      offset: offsetForCentre(doc, { x: box.x + box.w / 2, y: box.y + box.h / 2 }),
    },
  }
}

/**
 * Replace the capture image. The crop is reset: it was defined in pixels of the
 * previous image and means nothing for the new one.
 */
export function setCaptureImage(
  doc: Doc,
  image: { imageId: string; width: number; height: number },
): Doc {
  return {
    ...doc,
    capture: {
      ...doc.capture,
      imageId: image.imageId,
      width: image.width,
      height: image.height,
      crop: null,
      scale: 1,
      rotation: 0,
      offset: { x: 0, y: 0 },
      visible: true,
    },
  }
}

/**
 * Re-capture: the new frame takes the old one's place, and the old one goes into
 * document history (PLAN.md §6.5).
 *
 * The capture grows from its top-left corner, not its centre: it stays exactly
 * where it stood, and nearby annotations don't drift apart. Their coordinates are
 * scaled by the size ratio relative to that same corner — an arrow pointing at a
 * button in the shot's bottom-right corner stays on the button in a
 * differently-sized frame.
 *
 * This happens silently only when aspect ratios are close; the divergence is
 * measured by `aspectDrift`, and warning about it is the caller's job. An
 * annotation that drifted onto a neighbouring button is worse than none at all:
 * it confidently points at the wrong thing.
 *
 * The previous shot stays in the document as a separate layer at the bottom of
 * the stack — not just a history entry: a history record can't be seen or
 * compared, whereas a layer sits in the layer list, toggles on with a checkbox,
 * and lands exactly where the old frame stood. That's how before/after is viewed.
 */
export function replaceCapture(
  doc: Doc,
  image: { imageId: ImageId; width: number; height: number; capturedAt: number },
): Doc {
  if (image.width <= 0 || image.height <= 0) return doc

  const before = frameRect(doc)
  const sx = doc.capture.width > 0 ? image.width / doc.capture.width : 1
  const sy = doc.capture.height > 0 ? image.height / doc.capture.height : 1

  const w = image.width * doc.capture.scale
  const h = image.height * doc.capture.scale

  const previous: CaptureVersion | null = doc.capture.imageId
    ? {
        imageId: doc.capture.imageId,
        width: doc.capture.width,
        height: doc.capture.height,
        capturedAt: doc.updatedAt,
      }
    : null

  return {
    ...doc,
    capture: {
      ...doc.capture,
      imageId: image.imageId,
      width: image.width,
      height: image.height,
      visible: true,
      // The crop is in shot pixels. Both frames show the same page, so the same
      // fraction of the frame carries over via the same size ratio.
      crop: doc.capture.crop ? scaleRect(doc.capture.crop, sx, sy) : null,
      offset: {
        x: before.x - (doc.canvas.w - w) / 2,
        y: before.y - (doc.canvas.h - h) / 2,
      },
    },
    layers: [
      // The prior-capture layer is not scaled with the rest: it shows the old
      // shot at its old size, in its old place.
      ...(previous ? [priorLayer(previous, before)] : []),
      ...doc.layers
        .filter((layer) => layer.name !== PRIOR_CAPTURE_NAME)
        .map((layer) => scaleLayer(layer, before, sx, sy)),
    ],
    history: [...(doc.history ?? []), ...(previous ? [previous] : [])],
    updatedAt: image.capturedAt,
  }
}

/** Name of the prior-capture layer; also how it's found on the next re-capture. */
export const PRIOR_CAPTURE_NAME = 'Prior shot'

/**
 * The layer holding the previous capture.
 *
 * Hidden by default and first in the list — i.e. at the bottom of the stack.
 * First because layers draw above the capture: enabled, it would cover the new
 * shot the re-capture was done for. It's turned on to compare.
 *
 * There's exactly one such layer: the previous one is replaced by the new one.
 * The full capture history lives in `history` — keeping it as a stack of layers
 * too would clutter the document.
 */
function priorLayer(previous: CaptureVersion, at: Rect): Layer {
  const layer = createLayer('image', { rect: { x: at.x, y: at.y, w: at.w, h: at.h } })
  return {
    ...layer,
    kind: 'image',
    name: PRIOR_CAPTURE_NAME,
    imageId: previous.imageId,
    rect: { x: at.x, y: at.y, w: at.w, h: at.h },
    decoration: null,
    visible: false,
  }
}

function scaleRect(rect: Rect, sx: number, sy: number): Rect {
  return { x: rect.x * sx, y: rect.y * sy, w: rect.w * sx, h: rect.h * sy }
}

/** Points scale from the frame corner, not the canvas origin: surrounding background and captions stay put. */
function scalePoint(point: Point, origin: Point, sx: number, sy: number): Point {
  return {
    x: origin.x + (point.x - origin.x) * sx,
    y: origin.y + (point.y - origin.y) * sy,
  }
}

function scaleLayer(layer: Layer, frame: Rect, sx: number, sy: number): Layer {
  const origin = { x: frame.x, y: frame.y }
  const box = (rect: Rect): Rect => {
    const at = scalePoint({ x: rect.x, y: rect.y }, origin, sx, sy)
    return { ...at, w: rect.w * sx, h: rect.h * sy }
  }

  switch (layer.kind) {
    case 'text':
    case 'emoji':
    case 'badge':
      return { ...layer, at: scalePoint(layer.at, origin, sx, sy) }
    case 'arrow':
      return { ...layer, points: layer.points.map((at) => scalePoint(at, origin, sx, sy)) }
    case 'draw': {
      // Brush strokes are a flat coordinate list: x, y, x, y — two per point.
      const points = layer.points.map((value, at) =>
        at % 2 === 0 ? origin.x + (value - origin.x) * sx : origin.y + (value - origin.y) * sy,
      )
      return { ...layer, points }
    }
    case 'shape':
    case 'image':
    case 'blur':
    case 'spotlight':
    case 'redact':
      return { ...layer, rect: box(layer.rect) }
  }
}

/**
 * Undo a re-capture: the latest frame in history returns as the current one.
 *
 * This is what the history exists for: a re-capture that visited the login page
 * and brought back an auth form should be reversible in one click, not with
 * another capture.
 */
export function revertCapture(doc: Doc, now: number): Doc {
  const history = doc.history ?? []
  const previous = history.at(-1)
  if (!previous) return doc

  const restored = replaceCapture(doc, { ...previous, capturedAt: now })
  const replaced = restored.history?.at(-1)

  return {
    ...restored,
    // The restored frame leaves history and the one it displaced takes its slot:
    // revert should toggle frames back and forth, not eat them one by one.
    history: [...history.slice(0, -1), ...(replaced ? [replaced] : [])],
  }
}

/**
 * Remove the capture. The document stays — background, annotations, size — with
 * an empty slot where the shot was, ready for any image.
 */
export function clearCaptureImage(doc: Doc): Doc {
  return { ...doc, capture: { ...doc.capture, imageId: '', crop: null } }
}

export function hasCaptureImage(doc: Doc): boolean {
  return doc.capture.imageId !== ''
}

/**
 * Initial crop region: a centred portion of the frame, not the whole frame.
 *
 * A full-frame marquee looks like nothing is selected and immediately has to be
 * shrunk. A smaller region reads as adjustable right away.
 */
export function defaultCropRegion(doc: Doc, fraction = 0.7): Rect {
  const frame = frameRect(doc)
  const w = frame.w * fraction
  const h = frame.h * fraction

  return {
    x: frame.x + (frame.w - w) / 2,
    y: frame.y + (frame.h - h) / 2,
    w,
    h,
  }
}
