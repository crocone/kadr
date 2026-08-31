/**
 * Finds a recorded element on a freshly opened page.
 *
 * Both re-capture and Scribe use this, and both need an honest answer — a rect in
 * page coordinates or "not found" — never "something similar". A silent substitute is
 * worse than failure: a shot of the neighbouring block looks like a successful
 * re-capture and ends up in documentation.
 */
import { findByRef, type ElementRef } from '@/core/dom/selector'
import type { FindElementResponse } from '@/core/messaging'

/**
 * Lazy layouts render parts of the page only once scrolled to, so an element missing
 * now may appear a moment later. Poll in short intervals: a `MutationObserver` would
 * not simplify anything — the node can appear anywhere in the tree.
 */
const RETRY_MS = 250
const MAX_WAIT_MS = 3000

function rectOf(element: Element): { x: number; y: number; w: number; h: number } {
  const rect = element.getBoundingClientRect()
  return {
    x: rect.left + window.scrollX,
    y: rect.top + window.scrollY,
    w: rect.width,
    h: rect.height,
  }
}

export async function locateElement(ref: ElementRef): Promise<FindElementResponse> {
  const deadline = Date.now() + MAX_WAIT_MS

  for (;;) {
    const match = findByRef(ref, document)
    // Zero size is not a match: the node is in the tree but still collapsed or
    // hidden, so there is nothing to capture. Wait for it to expand.
    if (match) {
      const rect = rectOf(match.element)
      if (rect.w > 0 && rect.h > 0) {
        return { ok: true, rect, similarity: match.similarity }
      }
    }

    if (Date.now() >= deadline) return { ok: false, reason: 'not-found' }
    await new Promise((resolve) => setTimeout(resolve, RETRY_MS))
  }
}
