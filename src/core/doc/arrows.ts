/**
 * Arrow geometry. The seven styles from checklist §2 differ in line shape and
 * heads; both are computed here so the renderer stays thin and the shape testable.
 */
import type { ArrowLayer, Point } from './types'

export type ArrowStyle = ArrowLayer['style']

export const ARROW_STYLES: readonly ArrowStyle[] = [
  'straight',
  'curved',
  'elbow',
  'double',
  'thin',
  'thick',
  'sketch',
]

export type ArrowShape = {
  /** Flat coordinate list for Konva: x, y, x, y… */
  points: number[]
  /** Smoothing through the control points. */
  tension: number
  width: number
  pointerAtBeginning: boolean
  dash: number[] | null
}

/**
 * The curve uses one control point offset perpendicular to the chord. The offset
 * is proportional to length: a short arrow shouldn't bow into an arc.
 */
export function defaultControlPoint(from: Point, to: Point, bend = 0.22): Point {
  const midX = (from.x + to.x) / 2
  const midY = (from.y + to.y) / 2
  const dx = to.x - from.x
  const dy = to.y - from.y

  return { x: midX - dy * bend, y: midY + dx * bend }
}

/** The elbow runs horizontally first, then vertically — like in diagrams. */
export function elbowPoints(from: Point, to: Point): Point[] {
  return [from, { x: to.x, y: from.y }, to]
}

/**
 * The curve's control point: the user's own if it was moved, otherwise computed.
 *
 * The middle point in the list is the handle — a dedicated model field would
 * only mean something for two of the seven styles.
 */
export function controlPointOf(layer: ArrowLayer): Point {
  const from = layer.points[0] ?? { x: 0, y: 0 }
  const to = layer.points.at(-1) ?? from
  const bend = layer.style === 'sketch' ? 0.08 : 0.22

  return layer.points.length > 2 ? layer.points[1]! : defaultControlPoint(from, to, bend)
}

/** Does the style have a bend handle? Straight lines and elbows have nothing to bend. */
export function isCurved(layer: ArrowLayer): boolean {
  return layer.style === 'curved' || layer.style === 'sketch'
}

/** Arrow with a manually set bend: same ends, new middle. */
export function withControlPoint(layer: ArrowLayer, control: Point): Point[] {
  const from = layer.points[0] ?? control
  const to = layer.points.at(-1) ?? control

  return [from, control, to]
}

export function arrowShape(layer: ArrowLayer): ArrowShape {
  const from = layer.points[0] ?? { x: 0, y: 0 }
  const to = layer.points.at(-1) ?? from

  const flat = (points: Point[]) => points.flatMap((point) => [point.x, point.y])
  const straight = flat([from, to])

  switch (layer.style) {
    case 'curved':
      return {
        points: flat([from, controlPointOf(layer), to]),
        tension: 0.5,
        width: layer.width,
        pointerAtBeginning: false,
        dash: null,
      }

    case 'elbow':
      return {
        points: flat(elbowPoints(from, to)),
        tension: 0,
        width: layer.width,
        pointerAtBeginning: false,
        dash: null,
      }

    case 'double':
      return {
        points: straight,
        tension: 0,
        width: layer.width,
        pointerAtBeginning: true,
        dash: null,
      }

    case 'thin':
      return {
        points: straight,
        tension: 0,
        width: Math.max(1, layer.width * 0.45),
        pointerAtBeginning: false,
        dash: null,
      }

    case 'thick':
      return {
        points: straight,
        tension: 0,
        width: layer.width * 1.8,
        pointerAtBeginning: false,
        dash: null,
      }

    case 'sketch':
      // Hand-drawn dashes: dash and gap derive from the width so they don't merge.
      return {
        points: flat([from, controlPointOf(layer), to]),
        tension: 0.6,
        width: layer.width,
        pointerAtBeginning: false,
        dash: [layer.width * 2.2, layer.width * 1.6],
      }

    default:
      return {
        points: straight,
        tension: 0,
        width: layer.width,
        pointerAtBeginning: false,
        dash: null,
      }
  }
}
