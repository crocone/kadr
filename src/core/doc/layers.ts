/**
 * Layer operations.
 *
 * Everything here is a pure function over `Doc`: layers are added, moved and
 * removed by returning a new document, and history (useDocument) decides when to
 * close a step. Array order is bottom-up draw order — the same order as the
 * layers panel, which just displays the list top-down.
 */
import { newLayerId } from './ids'
import type { Doc, Layer, LayerId, LayerKind, Point, Rect } from './types'

export const ACCENT = '#f0526b'

/** Quick annotation palette: the same six colours across all tools. */
export const ANNOTATION_COLORS: readonly string[] = [
  '#6d5cf5',
  '#f0526b',
  '#f5a524',
  '#3ddc97',
  '#101215',
  '#ffffff',
]

const base = (name: string) => ({
  id: newLayerId(),
  name,
  visible: true,
  locked: false,
  opacity: 1,
  rotation: 0,
})

export type LayerSeed = { rect?: Rect; at?: Point; points?: Point[] }

/**
 * A blank layer of the given kind. Dimensions come from the creation gesture;
 * everything else defaults to values that look sensible immediately, so the user
 * refines rather than configures from scratch.
 */
export function createLayer(kind: LayerKind, seed: LayerSeed = {}): Layer {
  const rect = seed.rect ?? { x: 0, y: 0, w: 240, h: 120 }
  const at = seed.at ?? { x: rect.x, y: rect.y }

  switch (kind) {
    case 'text':
      return {
        ...base('Text'),
        kind: 'text',
        at,
        text: 'Text',
        fontFamily: 'Inter, system-ui, sans-serif',
        fontSize: 32,
        fontWeight: 600,
        color: ACCENT,
        align: 'left',
        width: null,
      }

    case 'arrow':
      return {
        ...base('Arrow'),
        kind: 'arrow',
        points: seed.points ?? [
          { x: rect.x, y: rect.y },
          { x: rect.x + rect.w, y: rect.y + rect.h },
        ],
        style: 'straight',
        color: ACCENT,
        width: 6,
      }

    case 'shape':
      return {
        ...base('Shape'),
        kind: 'shape',
        shape: 'rect',
        rect,
        stroke: ACCENT,
        strokeWidth: 4,
        fill: null,
      }

    case 'image':
      return { ...base('Image'), kind: 'image', imageId: '', rect, decoration: null }

    case 'emoji':
      return { ...base('Emoji'), kind: 'emoji', at, emoji: '👉', size: 64 }

    case 'blur':
      return { ...base('Blur'), kind: 'blur', rect, mode: 'blur', strength: 12 }

    case 'badge':
      return {
        ...base('Badge'),
        kind: 'badge',
        at,
        number: null,
        style: 'number',
        color: ACCENT,
        size: 44,
      }

    case 'spotlight':
      return { ...base('Spotlight'), kind: 'spotlight', rect, shape: 'rect', dimOpacity: 0.6 }

    case 'draw':
      return {
        ...base('Drawing'),
        kind: 'draw',
        points: (seed.points ?? []).flatMap((point) => [point.x, point.y]),
        color: ACCENT,
        width: 6,
        mode: 'pen',
      }

    case 'redact':
      return {
        ...base('Redaction'),
        kind: 'redact',
        rect,
        mode: 'blur',
        piiKind: 'other',
        confidence: 1,
        source: 'manual',
      }
  }
}

export function findLayer(doc: Doc, id: LayerId): Layer | undefined {
  return doc.layers.find((layer) => layer.id === id)
}

export function addLayer(doc: Doc, layer: Layer): Doc {
  return { ...doc, layers: [...doc.layers, layer] }
}

export function updateLayer(doc: Doc, id: LayerId, patch: Partial<Layer>): Doc {
  return {
    ...doc,
    layers: doc.layers.map((layer) =>
      // A patch can't change the layer kind: that would be a different layer, not an edit.
      layer.id === id ? ({ ...layer, ...patch, kind: layer.kind } as Layer) : layer,
    ),
  }
}

export function removeLayer(doc: Doc, id: LayerId): Doc {
  return { ...doc, layers: doc.layers.filter((layer) => layer.id !== id) }
}

/** The copy goes right above the original, slightly offset — otherwise it's invisible. */
export function duplicateLayer(doc: Doc, id: LayerId, offset = 24): { doc: Doc; id: LayerId } {
  const index = doc.layers.findIndex((layer) => layer.id === id)
  const original = doc.layers[index]
  if (!original) return { doc, id }

  const copy = { ...shift(original, offset), id: newLayerId(), name: `${original.name} copy` }
  const layers = [...doc.layers]
  layers.splice(index + 1, 0, copy)
  return { doc: { ...doc, layers }, id: copy.id }
}

function shift(layer: Layer, offset: number): Layer {
  switch (layer.kind) {
    case 'text':
    case 'emoji':
    case 'badge':
      return { ...layer, at: { x: layer.at.x + offset, y: layer.at.y + offset } }
    case 'arrow':
      return {
        ...layer,
        points: layer.points.map((point) => ({ x: point.x + offset, y: point.y + offset })),
      }
    case 'draw':
      return { ...layer, points: layer.points.map((value) => value + offset) }
    default:
      return {
        ...layer,
        rect: { ...layer.rect, x: layer.rect.x + offset, y: layer.rect.y + offset },
      }
  }
}

export type MoveTo = 'up' | 'down' | 'top' | 'bottom'

export function moveLayer(doc: Doc, id: LayerId, to: MoveTo): Doc {
  const from = doc.layers.findIndex((layer) => layer.id === id)
  if (from < 0) return doc

  const target =
    to === 'up' ? from + 1 : to === 'down' ? from - 1 : to === 'top' ? doc.layers.length - 1 : 0

  return reorderLayers(doc, from, target)
}

export function reorderLayers(doc: Doc, from: number, to: number): Doc {
  if (from === to) return doc
  const layers = [...doc.layers]
  const moved = layers[from]
  if (!moved || to < 0 || to >= layers.length) return doc

  layers.splice(from, 1)
  layers.splice(to, 0, moved)
  return { ...doc, layers }
}

/**
 * Badge numbers. Derived from layer order, not stored: delete step two and step
 * three becomes two on its own, with no document walk and no desync. An
 * explicitly set number is respected and drops out of the sequence.
 */
export function badgeNumbers(layers: readonly Layer[]): Map<LayerId, number> {
  const numbers = new Map<LayerId, number>()
  let next = 1

  for (const layer of layers) {
    if (layer.kind !== 'badge') continue
    if (layer.number !== null) {
      numbers.set(layer.id, layer.number)
      continue
    }
    while ([...numbers.values()].includes(next)) next += 1
    numbers.set(layer.id, next)
    next += 1
  }
  return numbers
}

/** Layer bounds in document coordinates — for alignment and snapping. */
export function layerBounds(layer: Layer): Rect | null {
  switch (layer.kind) {
    case 'text': {
      // With no explicit width, estimate from the longest line: only Konva knows
      // the exact width after layout, but selection and snapping need bounds first.
      const lines = layer.text.split('\n')
      const longest = lines.reduce((most, line) => Math.max(most, line.length), 1)

      return {
        x: layer.at.x,
        y: layer.at.y,
        w: layer.width ?? longest * layer.fontSize * 0.55,
        h: lines.length * layer.fontSize * 1.2,
      }
    }
    case 'emoji':
      return { x: layer.at.x, y: layer.at.y, w: layer.size, h: layer.size }
    case 'badge':
      return { x: layer.at.x, y: layer.at.y, w: layer.size, h: layer.size }
    case 'arrow': {
      const xs = layer.points.map((point) => point.x)
      const ys = layer.points.map((point) => point.y)
      return {
        x: Math.min(...xs),
        y: Math.min(...ys),
        w: Math.max(...xs) - Math.min(...xs),
        h: Math.max(...ys) - Math.min(...ys),
      }
    }
    case 'draw': {
      if (layer.points.length < 2) return null
      const xs = layer.points.filter((_, i) => i % 2 === 0)
      const ys = layer.points.filter((_, i) => i % 2 === 1)
      return {
        x: Math.min(...xs),
        y: Math.min(...ys),
        w: Math.max(...xs) - Math.min(...xs),
        h: Math.max(...ys) - Math.min(...ys),
      }
    }
    default:
      return layer.rect
  }
}

/**
 * Shift a layer by a vector. A point, a rect, and a point list each move
 * differently, so dragging, arrow keys, and alignment all call this one place
 * instead of each repeating the per-kind dispatch.
 */
export function shiftLayerBy(layer: Layer, delta: Point): Partial<Layer> {
  switch (layer.kind) {
    case 'text':
    case 'emoji':
    case 'badge':
      return { at: { x: layer.at.x + delta.x, y: layer.at.y + delta.y } }
    case 'arrow':
      return {
        points: layer.points.map((point) => ({ x: point.x + delta.x, y: point.y + delta.y })),
      }
    case 'draw':
      return {
        points: layer.points.map((value, index) => value + (index % 2 === 0 ? delta.x : delta.y)),
      }
    default:
      return {
        rect: { ...layer.rect, x: layer.rect.x + delta.x, y: layer.rect.y + delta.y },
      }
  }
}

/** Transformer gesture result in document coordinates, pre-rotation. */
export type LayerBox = { x: number; y: number; w: number; h: number; rotation: number }

/**
 * New layer size after a transformer gesture.
 *
 * Each layer kind expresses size in its own field, and the gesture must hit that
 * field: text-box width for a caption, diameter for a badge, the points
 * themselves for arrows and strokes. Previously everything got a `rect` — which
 * half of them don't have — so the gesture looked like it worked while the
 * document didn't change at all.
 */
export function resizeLayer(layer: Layer, box: LayerBox): Partial<Layer> {
  const at = { x: box.x, y: box.y }

  switch (layer.kind) {
    case 'text':
      // Don't touch the font size: the box is being dragged, not the glyphs.
      return { at, width: Math.max(box.w, layer.fontSize), rotation: box.rotation }

    case 'emoji':
    case 'badge':
      // The badge is round, so take the smaller side — otherwise it escapes the box.
      return { at, size: Math.max(8, Math.min(box.w, box.h)), rotation: box.rotation }

    case 'arrow':
      return { points: scalePoints(layer.points, layerBounds(layer), box), rotation: box.rotation }

    case 'draw':
      return {
        points: scaleFlatPoints(layer.points, layerBounds(layer), box),
        rotation: box.rotation,
      }

    default:
      return { rect: { x: box.x, y: box.y, w: box.w, h: box.h }, rotation: box.rotation }
  }
}

/** Scale factors from old bounds to new. A zero-length side doesn't scale. */
function factors(from: Rect | null, to: LayerBox) {
  if (!from) return null
  return {
    from,
    kx: from.w === 0 ? 1 : to.w / from.w,
    ky: from.h === 0 ? 1 : to.h / from.h,
  }
}

function scalePoints(points: readonly Point[], from: Rect | null, to: LayerBox): Point[] {
  const scale = factors(from, to)
  if (!scale) return [...points]

  return points.map((point) => ({
    x: to.x + (point.x - scale.from.x) * scale.kx,
    y: to.y + (point.y - scale.from.y) * scale.ky,
  }))
}

/** Stroke coordinates are a flat list: x and y alternate. */
function scaleFlatPoints(points: readonly number[], from: Rect | null, to: LayerBox): number[] {
  const scale = factors(from, to)
  if (!scale) return [...points]

  return points.map((value, index) =>
    index % 2 === 0
      ? to.x + (value - scale.from.x) * scale.kx
      : to.y + (value - scale.from.y) * scale.ky,
  )
}
