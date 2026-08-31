/**
 * Eraser.
 *
 * Erases a place, not objects: a circle is subtracted from a stroke, leaving the
 * pieces the eraser didn't touch. Eating out the middle of a line splits it into
 * two lines, both remaining ordinary editable, movable layers.
 *
 * Cutting at stroke nodes would be simpler but wrong: points along a stroke are
 * unevenly spaced, so on a long segment the eraser would erase either nothing or
 * too much. Instead the segment is properly intersected with the circle and the
 * entry/exit points are added at the cut — the edge lands where the cursor went.
 *
 * The eraser never touches the shot's own pixels: Kadr edits are non-destructive
 *.
 */
import { newLayerId } from './ids'
import type { Doc, DrawLayer, Layer, Point } from './types'

/** What the eraser removes: the stroke part under it, or the whole object. */
export type EraserMode = 'part' | 'object'

export const ERASER_SIZES = { min: 4, max: 80 } as const

/** Point-to-segment distance: any part of a stroke is erasable, not just its nodes. */
function distanceToSegment(point: Point, from: Point, to: Point): number {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const lengthSquared = dx * dx + dy * dy

  // A degenerate segment is a point.
  if (lengthSquared === 0) return Math.hypot(point.x - from.x, point.y - from.y)

  const t = Math.max(
    0,
    Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared),
  )
  return Math.hypot(point.x - (from.x + t * dx), point.y - (from.y + t * dy))
}

/** Did the eraser hit the stroke? Line width counts: a thick trail is wider than its axis. */
export function strokeHit(layer: DrawLayer, point: Point, radius: number): boolean {
  const reach = radius + layer.width / 2
  const { points } = layer

  if (points.length < 2) return false
  if (points.length === 2) {
    return Math.hypot(point.x - points[0]!, point.y - points[1]!) <= reach
  }

  for (let index = 0; index + 3 < points.length; index += 2) {
    const from = { x: points[index]!, y: points[index + 1]! }
    const to = { x: points[index + 2]!, y: points[index + 3]! }
    if (distanceToSegment(point, from, to) <= reach) return true
  }

  return false
}

/**
 * The part of a segment inside the circle, as fractions of segment length.
 * `null` — no intersection.
 *
 * Solves the quadratic |A + t·(B−A) − C|² = r²; roots are clamped to [0, 1]
 * since they're meaningless outside the segment.
 */
function insideRange(
  from: Point,
  to: Point,
  centre: Point,
  radius: number,
): [number, number] | null {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const fx = from.x - centre.x
  const fy = from.y - centre.y

  const a = dx * dx + dy * dy
  if (a === 0) return fx * fx + fy * fy <= radius * radius ? [0, 1] : null

  const b = 2 * (fx * dx + fy * dy)
  const c = fx * fx + fy * fy - radius * radius
  const discriminant = b * b - 4 * a * c
  if (discriminant < 0) return null

  const root = Math.sqrt(discriminant)
  const first = (-b - root) / (2 * a)
  const second = (-b + root) / (2 * a)
  if (second < 0 || first > 1) return null

  return [Math.max(first, 0), Math.min(second, 1)]
}

function pointAt(from: Point, to: Point, t: number): Point {
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }
}

/**
 * Polyline minus circle: the list of surviving pieces.
 *
 * Coordinates come as a flat list, the way a stroke stores them: x, y, x, y…
 * A single-point piece is dropped: there's nothing to draw it with.
 */
export function subtractCircle(
  points: readonly number[],
  centre: Point,
  radius: number,
): number[][] {
  const nodes = Math.floor(points.length / 2)
  if (nodes === 0) return []

  if (nodes === 1) {
    const only = { x: points[0]!, y: points[1]! }
    return Math.hypot(only.x - centre.x, only.y - centre.y) <= radius ? [] : [[only.x, only.y]]
  }

  const runs: number[][] = []
  let current: number[] = []

  const close = () => {
    if (current.length >= 4) runs.push(current)
    current = []
  }

  for (let index = 0; index + 1 < nodes; index += 1) {
    const from = { x: points[index * 2]!, y: points[index * 2 + 1]! }
    const to = { x: points[index * 2 + 2]!, y: points[index * 2 + 3]! }
    const range = insideRange(from, to, centre, radius)

    if (!range) {
      if (current.length === 0) current.push(from.x, from.y)
      current.push(to.x, to.y)
      continue
    }

    const [enter, exit] = range

    // The piece before entering the circle.
    if (enter > 0) {
      if (current.length === 0) current.push(from.x, from.y)
      const edge = pointAt(from, to, enter)
      current.push(edge.x, edge.y)
    }
    close()

    // The piece after the exit — also the start of the next run.
    if (exit < 1) {
      const edge = pointAt(from, to, exit)
      current = [edge.x, edge.y, to.x, to.y]
    }
  }

  close()
  return runs
}

function sameNumbers(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

/**
 * Partial erase: each stroke under the eraser is replaced with what's left of it.
 *
 * The first piece keeps the layer id, the rest get new ones: references to the
 * layer (selection, history) survive the erase, and pieces stay separate layers.
 */
export function erasePartAt(doc: Doc, point: Point, radius: number): Doc {
  const layers: Layer[] = []
  let changed = false

  for (const layer of doc.layers) {
    if (layer.kind !== 'draw' || layer.locked) {
      layers.push(layer)
      continue
    }

    // The eraser works on the visible trail, half a line-width wider than the axis.
    const runs = subtractCircle(layer.points, point, radius + layer.width / 2)
    if (runs.length === 1 && sameNumbers(runs[0]!, layer.points)) {
      layers.push(layer)
      continue
    }

    changed = true
    runs.forEach((points, index) => {
      layers.push(index === 0 ? { ...layer, points } : { ...layer, id: newLayerId(), points })
    })
  }

  return changed ? { ...doc, layers } : doc
}

/** Removes whole strokes under the point. Locked layers resist the eraser. */
export function eraseObjectAt(doc: Doc, point: Point, radius: number): Doc {
  const kept = doc.layers.filter(
    (layer) => !(layer.kind === 'draw' && !layer.locked && strokeHit(layer, point, radius)),
  )

  return kept.length === doc.layers.length ? doc : { ...doc, layers: kept }
}

export function eraseAt(doc: Doc, point: Point, radius: number, mode: EraserMode = 'part'): Doc {
  return mode === 'object' ? eraseObjectAt(doc, point, radius) : erasePartAt(doc, point, radius)
}

/**
 * Erase along the whole path between two cursor positions.
 *
 * The mouse is sampled less often than the hand moves: a fast swipe leaves a
 * dozen pixels between events, and single circles would leave a dashed line of
 * half-erased bits. Stepping at half the radius gives a solid band.
 */
export function eraseAlong(
  doc: Doc,
  from: Point,
  to: Point,
  radius: number,
  mode: EraserMode = 'part',
): Doc {
  const distance = Math.hypot(to.x - from.x, to.y - from.y)
  const steps = Math.max(1, Math.ceil(distance / Math.max(1, radius / 2)))

  // Count from zero: the path starts at the origin, not one step past it.
  let next = doc
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps
    next = eraseAt(next, pointAt(from, to, t), radius, mode)
  }

  return next
}
