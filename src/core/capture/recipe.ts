/**
 * Capture recipe: everything needed to shoot this same frame again (PLAN.md §6.5).
 *
 * Written on every capture, including responsive series, and stored right in the
 * document. No separate store, deliberately: a recipe without its document is
 * meaningless, and a document without a recipe is a plain pre-1.1 shot. That is
 * why the field is optional: old documents simply do not show the reshoot
 * button, and no migration is needed.
 *
 * Viewport width and DPR are in the recipe for a reason: reshoot opens its own
 * window at exactly that width. A frame shot at 1440 and reshot at 1280 is a
 * different frame — the menu moved, the layout changed — and must not replace
 * the original.
 */
import type { ElementRef } from '@/core/dom/selector'
import type { Rect } from '@/core/doc/types'
import type { CaptureMode } from '@/core/messaging'

import type { RollDirection } from './rolling'

export type CaptureRecipe = {
  mode: CaptureMode
  url: string
  /** Element, if that is what was shot: selector plus fingerprint for verification. */
  element: ElementRef | null
  /** Area in page coordinates. The selection rect in area mode, `null` elsewhere. */
  area: Rect | null
  viewportWidth: number
  viewportHeight: number
  devicePixelRatio: number
  /** Pre-capture delay from settings, ms: without it entry animations get into the frame. */
  delayMs: number
  direction: RollDirection | null
  capturedAt: number
}

/**
 * Modes that can be repeated without a human at all.
 *
 * Scroll capture is not here: it consists entirely of on-the-fly decisions —
 * which container to scroll, when to stop, what counts as the feed's end. They
 * cannot be repeated unattended, and pretending otherwise would one day replace
 * a long chat with its first screen.
 */
export const REPEATABLE_MODES: readonly CaptureMode[] = ['fullPage', 'visible', 'area', 'element']

export function isRepeatable(recipe: CaptureRecipe | null | undefined): recipe is CaptureRecipe {
  if (!recipe) return false
  if (!REPEATABLE_MODES.includes(recipe.mode)) return false
  if (recipe.mode === 'element' && !recipe.element) return false
  if (recipe.mode === 'area' && !recipe.area) return false
  return /^https?:/.test(recipe.url)
}

/**
 * How far the old and new frames' proportions diverged.
 *
 * Returns a fraction: 0 — same proportions, 0.2 — the new frame is a fifth
 * "differently shaped". The editor uses it to decide whether to warn. Silently
 * refitting annotations onto a heavily changed frame is not an option: an arrow
 * that slid onto the neighboring button is worse than a missing one — it
 * confidently points at the wrong thing.
 */
export function aspectDrift(
  before: { width: number; height: number },
  after: { width: number; height: number },
): number {
  if (before.width <= 0 || before.height <= 0 || after.width <= 0 || after.height <= 0) return 0
  const a = before.width / before.height
  const b = after.width / after.height
  return Math.abs(a - b) / Math.max(a, b)
}

/** Above this drift, reshoot reports it instead of staying quiet. */
export const MAX_QUIET_DRIFT = 0.08
