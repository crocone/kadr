/**
 * Drag snapping and alignment.
 *
 * Computed over candidate lines worth sticking to: canvas edges and centre,
 * edges and centres of other objects. The threshold is in document pixels but
 * comes from outside: at 10% zoom three screen pixels are thirty document ones,
 * and a fixed threshold would mean nothing snaps when zoomed out.
 */
import type { Rect } from './types'

export type Axis = 'x' | 'y'

/** A snap line, in document coordinates. */
export type Guide = { axis: Axis; at: number }

export type SnapResult = {
  /** Correction to the object's position. */
  dx: number
  dy: number
  /** Guides to show on the canvas. */
  guides: Guide[]
}

const NO_SNAP: SnapResult = { dx: 0, dy: 0, guides: [] }

/** Three anchor points along an axis: start, middle, end. */
function edges(rect: Rect, axis: Axis): number[] {
  return axis === 'x'
    ? [rect.x, rect.x + rect.w / 2, rect.x + rect.w]
    : [rect.y, rect.y + rect.h / 2, rect.y + rect.h]
}

/** Candidate lines: the rectangle's edges and centre. */
export function candidateLines(rect: Rect, axis: Axis): number[] {
  return edges(rect, axis)
}

function snapAxis(moving: Rect, targets: readonly Rect[], axis: Axis, threshold: number) {
  let best: { delta: number; at: number } | null = null

  for (const own of edges(moving, axis)) {
    for (const target of targets) {
      for (const line of candidateLines(target, axis)) {
        const delta = line - own
        if (Math.abs(delta) > threshold) continue
        // Ties go to the first found: candidate order sets priority, and the
        // canvas comes first in the list.
        if (!best || Math.abs(delta) < Math.abs(best.delta)) best = { delta, at: line }
      }
    }
  }

  return best
}

export function computeSnap(moving: Rect, targets: readonly Rect[], threshold: number): SnapResult {
  if (threshold <= 0 || targets.length === 0) return NO_SNAP

  const x = snapAxis(moving, targets, 'x', threshold)
  const y = snapAxis(moving, targets, 'y', threshold)

  const guides: Guide[] = []
  if (x) guides.push({ axis: 'x', at: x.at })
  if (y) guides.push({ axis: 'y', at: y.at })

  return { dx: x?.delta ?? 0, dy: y?.delta ?? 0, guides }
}

export type Alignment = 'left' | 'centreX' | 'right' | 'top' | 'centreY' | 'bottom'

/** Delta that puts the object at an edge or centre of the area. */
export function alignmentDelta(
  rect: Rect,
  area: Rect,
  alignment: Alignment,
): { dx: number; dy: number } {
  switch (alignment) {
    case 'left':
      return { dx: area.x - rect.x, dy: 0 }
    case 'centreX':
      return { dx: area.x + (area.w - rect.w) / 2 - rect.x, dy: 0 }
    case 'right':
      return { dx: area.x + area.w - (rect.x + rect.w), dy: 0 }
    case 'top':
      return { dx: 0, dy: area.y - rect.y }
    case 'centreY':
      return { dx: 0, dy: area.y + (area.h - rect.h) / 2 - rect.y }
    case 'bottom':
      return { dx: 0, dy: area.y + area.h - (rect.y + rect.h) }
  }
}
