/**
 * Editor tools and how each one creates its layer.
 *
 * The select tool creates nothing, "drag" tools draw a rect from press to release,
 * "click" tools place with a single click, and the brush accumulates points as it
 * moves. This split drives all gesture logic on the stage.
 */
import type { LayerKind } from '@/core/doc/types'

export type Tool =
  | 'select'
  | 'text'
  | 'arrow'
  | 'rect'
  | 'ellipse'
  | 'callout'
  | 'badge'
  | 'spotlight'
  | 'blur'
  | 'pen'
  | 'highlighter'
  | 'eraser'
  | 'crop'

export type ToolGesture = 'none' | 'drag' | 'click' | 'freehand' | 'erase'

export type ToolSpec = {
  tool: Tool
  gesture: ToolGesture
  kind: LayerKind | null
  /** One key per tool (PLAN.md §4). */
  key: string
}

export const TOOLS: readonly ToolSpec[] = [
  { tool: 'select', gesture: 'none', kind: null, key: 'v' },
  { tool: 'text', gesture: 'click', kind: 'text', key: 't' },
  { tool: 'arrow', gesture: 'drag', kind: 'arrow', key: 'a' },
  { tool: 'rect', gesture: 'drag', kind: 'shape', key: 'r' },
  { tool: 'ellipse', gesture: 'drag', kind: 'shape', key: 'e' },
  { tool: 'callout', gesture: 'drag', kind: 'shape', key: 'c' },
  { tool: 'badge', gesture: 'click', kind: 'badge', key: 'b' },
  { tool: 'spotlight', gesture: 'drag', kind: 'spotlight', key: 's' },
  { tool: 'blur', gesture: 'drag', kind: 'blur', key: 'u' },
  { tool: 'pen', gesture: 'freehand', kind: 'draw', key: 'p' },
  { tool: 'highlighter', gesture: 'freehand', kind: 'draw', key: 'h' },
  // The eraser creates nothing but sweeps the canvas like a brush: its own gesture kind.
  { tool: 'eraser', gesture: 'erase', kind: null, key: 'x' },
  // Crop draws no gesture: it enters a mode with a region to move and confirm.
  { tool: 'crop', gesture: 'none', kind: null, key: 'k' },
]

const BY_TOOL = new Map(TOOLS.map((spec) => [spec.tool, spec]))
const BY_KEY = new Map(TOOLS.map((spec) => [spec.key, spec.tool]))

export function specFor(tool: Tool): ToolSpec {
  return BY_TOOL.get(tool) ?? TOOLS[0]!
}

export function toolForKey(key: string): Tool | undefined {
  return BY_KEY.get(key.toLowerCase())
}

/** Extra fields that distinguish a tool from its sibling of the same layer kind. */
export function toolPatch(tool: Tool): Record<string, unknown> {
  switch (tool) {
    case 'ellipse':
      return { shape: 'ellipse' }
    case 'callout':
      return { shape: 'callout' }
    case 'highlighter':
      return { mode: 'highlighter' }
    default:
      return {}
  }
}

/**
 * Rect from the gesture's two points. Normalized because a drag can go in any
 * direction, and negative width breaks both rendering and hit testing.
 */
export function rectFromDrag(
  from: { x: number; y: number },
  to: { x: number; y: number },
): { x: number; y: number; w: number; h: number } {
  return {
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    w: Math.abs(to.x - from.x),
    h: Math.abs(to.y - from.y),
  }
}

/** A too-short gesture is a stray click, not a one-pixel layer. */
export const MIN_DRAG = 6

export function isMeaningfulDrag(
  from: { x: number; y: number },
  to: { x: number; y: number },
): boolean {
  return Math.hypot(to.x - from.x, to.y - from.y) >= MIN_DRAG
}
