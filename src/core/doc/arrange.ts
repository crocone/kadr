/**
 * Laying out several frames on one canvas.
 *
 * Frames means the document capture plus image layers: a three-screenshot chat,
 * a form before and after, a series of app screens. Layout doesn't cut or glue
 * pixels — it places objects: each frame stays separate, can be moved, reordered
 * or removed, and the result still renders from the model.
 *
 * After layout the canvas is fitted to the content: stacking three screens in a
 * column and then hunting for the right height by hand is the editor's job.
 */
import { frameRect } from './canvas-presets'
import { decoratedRectOf } from './frames'
import type { Doc, ImageLayer, Layer, Rect } from './types'

export type ArrangeMode = 'row' | 'column' | 'cascade'

/** Cascade overlap step, as a fraction of the frame's shorter side. */
const CASCADE_SHIFT = 0.12

type Item =
  { kind: 'capture'; box: Rect } | { kind: 'layer'; id: string; box: Rect; layer: ImageLayer }

function isImageLayer(layer: Layer): layer is ImageLayer {
  return layer.kind === 'image'
}

/**
 * What gets laid out: the capture, if present, then all image layers in layer
 * order. The capture goes first — it's the document's base, not one of equals.
 */
export function arrangeableItems(doc: Doc): Item[] {
  const items: Item[] = []

  if (doc.capture.imageId !== '' && doc.capture.visible) {
    items.push({ kind: 'capture', box: decoratedRectOf(doc, frameRect(doc)) })
  }

  for (const layer of doc.layers) {
    if (isImageLayer(layer) && layer.visible) {
      items.push({ kind: 'layer', id: layer.id, box: layer.rect, layer })
    }
  }

  return items
}

/** Frame positions, one after another. Sizes never change — only placements move. */
function placements(items: readonly Item[], mode: ArrangeMode, gap: number): Rect[] {
  if (mode === 'cascade') {
    const step = Math.min(...items.map((item) => Math.min(item.box.w, item.box.h))) * CASCADE_SHIFT

    return items.map((item, index) => ({
      x: index * step,
      y: index * step,
      w: item.box.w,
      h: item.box.h,
    }))
  }

  const across = mode === 'row'
  const extent = Math.max(...items.map((item) => (across ? item.box.h : item.box.w)))

  let cursor = 0
  return items.map((item) => {
    const along = cursor
    cursor += (across ? item.box.w : item.box.h) + gap

    // Across the row, frames are centre-aligned: mixed heights look side by side
    // rather than glued to the top edge.
    const centred = (extent - (across ? item.box.h : item.box.w)) / 2

    return across
      ? { x: along, y: centred, w: item.box.w, h: item.box.h }
      : { x: centred, y: along, w: item.box.w, h: item.box.h }
  })
}

function boundsOf(rects: readonly Rect[]): Rect {
  const left = Math.min(...rects.map((rect) => rect.x))
  const top = Math.min(...rects.map((rect) => rect.y))
  const right = Math.max(...rects.map((rect) => rect.x + rect.w))
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.h))

  return { x: left, y: top, w: right - left, h: bottom - top }
}

/**
 * Places the frames and fits the canvas.
 *
 * With fewer than two frames there's nothing to lay out — the document comes back
 * unchanged so an idle click doesn't land in the undo history.
 */
export function arrangeFrames(doc: Doc, mode: ArrangeMode, gap = 32): Doc {
  const items = arrangeableItems(doc)
  if (items.length < 2) return doc

  const placed = placements(items, mode, gap)
  const bounds = boundsOf(placed)
  const { padding } = doc.canvas

  const canvas = {
    ...doc.canvas,
    w: Math.round(bounds.w + padding * 2),
    h: Math.round(bounds.h + padding * 2),
    preset: 'custom' as const,
  }

  // Layout was computed from zero, and the canvas centres its content: one shared shift.
  const shift = {
    x: padding - bounds.x,
    y: padding - bounds.y,
  }

  let next: Doc = { ...doc, canvas }

  items.forEach((item, index) => {
    const place = placed[index]!

    if (item.kind === 'capture') {
      // The capture stores an offset from the canvas centre, not coordinates — and chrome counts.
      const screen = frameRect(doc)
      const box = decoratedRectOf(doc, screen)
      const inside = { x: screen.x - box.x, y: screen.y - box.y }

      next = {
        ...next,
        capture: {
          ...next.capture,
          offset: {
            x: place.x + shift.x + inside.x + screen.w / 2 - canvas.w / 2,
            y: place.y + shift.y + inside.y + screen.h / 2 - canvas.h / 2,
          },
        },
      }
      return
    }

    next = {
      ...next,
      layers: next.layers.map((layer) =>
        layer.id === item.id
          ? { ...layer, rect: { ...item.box, x: place.x + shift.x, y: place.y + shift.y } }
          : layer,
      ),
    }
  })

  return next
}
