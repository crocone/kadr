/**
 * Element selector plus fingerprint: how re-capture and Scribe find the same node
 * on a freshly opened page (PLAN.md §6.5).
 *
 * The preference order is about lifespan, not elegance. A human-written `id`
 * survives markup and theme changes — but a framework-generated one changes on
 * every reload and is dead within a minute. `data-testid` and friends come next:
 * they exist precisely to be hooked onto. Last is an `:nth-of-type` path, the most
 * fragile option — any inserted sibling breaks it.
 *
 * The fingerprint always travels with the selector. The selector answers "where to
 * look", the fingerprint answers "did we find the right one": tag, label, and size
 * match on the intended node and diverge on an accidental hit. Without it,
 * re-capture would silently swap the frame for a shot of a neighbouring button.
 *
 * The module is pure — it only touches the given node and root, so everything is
 * testable in jsdom.
 */

export type ElementFingerprint = {
  tag: string
  /** Element label: `aria-label`, `title`, `alt`, or visible text. */
  label: string
  /** Size in CSS pixels at record time, rounded. */
  w: number
  h: number
}

/** Element address: where to look, plus a check that we didn't find a neighbour. */
export type ElementRef = {
  selector: string
  fingerprint: ElementFingerprint
}

/** Attributes set specifically for automation, ordered by prevalence; first hit wins. */
const TEST_ATTRIBUTES = [
  'data-testid',
  'data-test-id',
  'data-test',
  'data-qa',
  'data-cy',
  'data-automation-id',
] as const

/**
 * Attributes the label is built from; visible text comes after them.
 *
 * `name` is deliberately absent: it names the field for the server, not for a
 * human. It once labelled a consent checkbox "consent" — a machine word that
 * appears nowhere on screen.
 */
const LABEL_ATTRIBUTES = ['aria-label', 'title', 'alt', 'placeholder'] as const

/** Beyond this depth a path guarantees nothing anyway, so stop building it. */
const MAX_PATH_DEPTH = 8

/** Labels are for matching, not for displaying a whole article — truncate. */
const MAX_LABEL = 80

/**
 * Does the identifier look machine-generated?
 *
 * The checks are deliberately coarse and one-sided: accepting a generated `id`
 * costs more than rejecting a hand-written one. The former silently breaks the
 * selector after a page reload; the latter just means a slightly longer path.
 */
export function looksGenerated(value: string): boolean {
  if (!value || value.length > 64) return true
  // React `useId`, Radix and other id factories: `:r3:`, `radix-:r1:`.
  if (value.includes(':')) return true
  if (/^(ember|react|radix|mui|headlessui|downshift|tippy|popper)[-_]?\d/i.test(value)) return true
  // Hex tail from a bundler or CSS-modules hash.
  if (/[0-9a-f]{8,}/i.test(value)) return true
  // Long numeric tail: `item-184623` is a database record, not a place in the markup.
  if (/\d{4,}/.test(value)) return true
  // An `id` starting with a digit needs escaping in CSS and is never hand-written.
  if (/^\d/.test(value)) return true
  return false
}

/** Selector escaping. `CSS.escape` isn't available everywhere, hence the fallback. */
function escapeValue(value: string): string {
  const escape = (globalThis as { CSS?: { escape?: (value: string) => string } }).CSS?.escape
  return escape ? escape(value) : value.replace(/["\\]/g, '\\$&')
}

function isUnique(root: ParentNode, selector: string, element: Element): boolean {
  try {
    const found = root.querySelectorAll(selector)
    return found.length === 1 && found[0] === element
  } catch {
    // The selector may be syntactically invalid due to an exotic attribute value.
    return false
  }
}

/** Position among same-tag siblings; CSS counts from one. */
function nthOfType(element: Element): number {
  let index = 1
  for (let node = element.previousElementSibling; node; node = node.previousElementSibling) {
    if (node.tagName === element.tagName) index += 1
  }
  return index
}

/** Short anchor for a node: `#id`, `[data-testid="…"]`, or `null` if there is none. */
function anchorOf(element: Element): string | null {
  if (element.id && !looksGenerated(element.id)) return `#${escapeValue(element.id)}`

  for (const attribute of TEST_ATTRIBUTES) {
    const value = element.getAttribute(attribute)
    if (value && !looksGenerated(value)) return `[${attribute}="${escapeValue(value)}"]`
  }
  return null
}

/**
 * Selector for an element inside `root`.
 *
 * The path is built bottom-up and stops at the first ancestor with an anchor:
 * `#main > …` survives a header redesign, `html > body > div:nth-of-type(3) > …`
 * does not. If no anchor turns up, the path runs to `html` and lives only until
 * the first inserted sibling — an honest worst case, not a bug.
 *
 * A short path that happens to be unique on the page is deliberately not
 * returned: `span:nth-of-type(2)` with no ancestors matches any second span
 * anywhere in the document, and the first added block sends it astray. Selector
 * length costs nothing here; precision costs a frame.
 */
export function buildSelector(element: Element, root: ParentNode = element.ownerDocument): string {
  const own = anchorOf(element)
  if (own && isUnique(root, own, element)) return own

  const parts: string[] = [own ? `${element.tagName.toLowerCase()}${own}` : segmentOf(element)]
  let node = element.parentElement

  for (let depth = 1; node && depth < MAX_PATH_DEPTH; depth += 1) {
    const anchor = anchorOf(node)
    if (anchor) {
      // An ancestor anchor ends the path: above it the markup may change freely.
      parts.unshift(anchor)
      return parts.join(' > ')
    }

    parts.unshift(segmentOf(node))
    if (node.tagName === 'HTML') break
    node = node.parentElement
  }

  return parts.join(' > ')
}

function segmentOf(element: Element): string {
  return `${element.tagName.toLowerCase()}:nth-of-type(${nthOfType(element)})`
}

function visibleText(element: Element): string {
  const text = (element as HTMLElement).innerText ?? element.textContent ?? ''
  return text.replace(/\s+/g, ' ').trim()
}

/** Text of the elements referenced by `aria-labelledby`. */
function labelledBy(element: Element): string {
  const ids = element.getAttribute('aria-labelledby')?.split(/\s+/).filter(Boolean) ?? []
  return ids
    .map((id) => element.ownerDocument.getElementById(id))
    .filter((node): node is HTMLElement => node !== null)
    .map((node) => visibleText(node))
    .join(' ')
    .trim()
}

/**
 * Text of the associated `<label>`.
 *
 * A checkbox or switch has no text of its own — it all lives in the label next to
 * it, and without it an instruction step ends up nameless. The browser already
 * resolves this link via `for` and via nesting; `element.labels` reuses that.
 */
function labelElementText(element: Element): string {
  const labels = (element as HTMLInputElement).labels
  if (labels && labels.length > 0) {
    return [...labels]
      .map((label) => visibleText(label))
      .join(' ')
      .trim()
  }
  const wrapping = element.closest('label')
  return wrapping ? visibleText(wrapping) : ''
}

/** Truncate at a word boundary: a cut phrase reads fine, half a word doesn't. */
function trimLabel(value: string): string {
  if (value.length <= MAX_LABEL) return value
  const cut = value.slice(0, MAX_LABEL)
  const space = cut.lastIndexOf(' ')
  return `${(space > MAX_LABEL / 2 ? cut.slice(0, space) : cut).trimEnd()}…`
}

/**
 * Element label: the name a screen reader would announce, then visible text.
 *
 * The order mirrors accessible-name computation: `aria-label`, `aria-labelledby`,
 * associated `<label>`, `title`, `alt`, `placeholder`. An author-written
 * accessible name is the best label there is — whereas a container's visible text
 * is its entire content, which would end up truncated beyond recognition.
 */
export function labelOf(element: Element): string {
  const aria = element.getAttribute('aria-label')?.replace(/\s+/g, ' ').trim()
  if (aria) return trimLabel(aria)

  const referenced = labelledBy(element)
  if (referenced) return trimLabel(referenced)

  const own = visibleText(element)
  // Fields and checkboxes have no text of their own; where text exists, it beats the label.
  if (!own) {
    const label = labelElementText(element)
    if (label) return trimLabel(label)
  }

  for (const attribute of LABEL_ATTRIBUTES) {
    const value = element.getAttribute(attribute)?.replace(/\s+/g, ' ').trim()
    if (value) return trimLabel(value)
  }
  return trimLabel(own)
}

export function fingerprintOf(
  element: Element,
  size?: { w: number; h: number },
): ElementFingerprint {
  const rect = size ?? element.getBoundingClientRect()
  const w = 'w' in rect ? rect.w : rect.width
  const h = 'h' in rect ? rect.h : rect.height

  return {
    tag: element.tagName.toLowerCase(),
    label: labelOf(element),
    w: Math.round(w),
    h: Math.round(h),
  }
}

export function refOf(element: Element, root?: ParentNode): ElementRef {
  return { selector: buildSelector(element, root), fingerprint: fingerprintOf(element) }
}

/** Size drift: 0 — identical, 1 — off by a factor of two or more. */
function sizeDrift(a: number, b: number): number {
  const max = Math.max(a, b)
  if (max <= 0) return 0
  return Math.min(1, Math.abs(a - b) / max)
}

/**
 * Similarity of a found node to the recorded one, 0 to 1.
 *
 * Tag weighs the most: `button` instead of `div` is definitely a different
 * element, however well the sizes match. Label is second: button text changes
 * less often than button width. Size comes last and softly — responsive layouts
 * change it on every other viewport, and demanding pixel equality would throw
 * away correct matches.
 */
export function similarity(found: ElementFingerprint, recorded: ElementFingerprint): number {
  const tag = found.tag === recorded.tag ? 1 : 0

  const both = found.label && recorded.label
  const label =
    found.label === recorded.label
      ? 1
      : both && (found.label.includes(recorded.label) || recorded.label.includes(found.label))
        ? 0.6
        : 0

  const size = 1 - (sizeDrift(found.w, recorded.w) + sizeDrift(found.h, recorded.h)) / 2
  const score = tag * 0.5 + label * 0.3 + size * 0.2

  // Both labels present with no overlap at all means different elements, no matter
  // what else matches. Otherwise, after a row is inserted above, `li:nth-of-type(2)`
  // points at a sibling with the same tag and size, and a miss passes as a hit.
  return both && label === 0 ? score / 2 : score
}

/** Below this similarity a find counts as foreign: an honest miss beats the wrong frame. */
export const MIN_SIMILARITY = 0.55

export type ElementMatch = {
  element: Element
  /** Fingerprint similarity; shown to the user when below one. */
  similarity: number
}

/**
 * Look up by address. First via the selector; if it no longer hits anything,
 * scan same-tag nodes and pick the most similar.
 *
 * The fallback pass exists precisely because of `:nth-of-type`: a relayout shifts
 * indices and the selector misses even though the element is still on the page.
 * The scan is limited to one tag, so it's cheap even on a large page.
 */
export function findByRef(ref: ElementRef, root: ParentNode): ElementMatch | null {
  let direct: Element | null = null
  try {
    direct = root.querySelector(ref.selector)
  } catch {
    direct = null
  }

  if (direct) {
    const score = similarity(fingerprintOf(direct), ref.fingerprint)
    if (score >= MIN_SIMILARITY) return { element: direct, similarity: score }
  }

  let best: ElementMatch | null = null
  for (const candidate of root.querySelectorAll(ref.fingerprint.tag)) {
    const score = similarity(fingerprintOf(candidate), ref.fingerprint)
    if (!best || score > best.similarity) best = { element: candidate, similarity: score }
  }

  return best && best.similarity >= MIN_SIMILARITY ? best : null
}
