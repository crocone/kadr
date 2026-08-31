/**
 * Overlays live in shadow DOM: page styles do not leak in, ours do not leak out.
 * The host must always be removed in a finally, or a failed capture leaves the page blocked.
 */
export type OverlayHost = {
  /** Host element; needed to hide the overlay momentarily for elementFromPoint. */
  element: HTMLElement
  root: ShadowRoot
  destroy: () => void
}

/**
 * Shared chrome for both overlays: hint card top-left, ratio chips and key hints
 * bottom-right. Colours are hard-coded rather than theme variables: `all: initial`
 * on the host cuts inheritance, so `var(--color-accent)` never reaches the shadow tree.
 */
const BASE_CSS = `
  :host { all: initial; }
  .layer {
    position: fixed;
    inset: 0;
    z-index: 2147483647;
    font: 500 12px/1.4 ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    color: #fff;
    user-select: none;
    -webkit-user-select: none;
  }
  .card {
    position: fixed;
    left: 24px;
    top: 24px;
    max-width: 292px;
    padding: 12px 14px;
    border-radius: 12px;
    border: 1px solid rgba(255, 255, 255, 0.07);
    background: rgba(20, 21, 25, 0.94);
    box-shadow: 0 12px 36px rgba(0, 0, 0, 0.5);
    line-height: 1.5;
    color: #8b919c;
    pointer-events: none;
  }
  .card b { font-weight: 600; color: #fff; }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 10px;
    pointer-events: auto;
  }
  .chip {
    all: unset;
    padding: 4px 9px;
    border-radius: 7px;
    background: rgba(255, 255, 255, 0.06);
    color: #b7bcc5;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11px;
    cursor: pointer;
  }
  .chip:hover { background: rgba(255, 255, 255, 0.12); color: #fff; }
  .chip[aria-pressed='true'] { background: #6d5cf5; color: #fff; }
  .keys {
    position: fixed;
    right: 24px;
    bottom: 24px;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 12px;
    border-radius: 9px;
    background: rgba(20, 21, 25, 0.92);
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.4);
    color: #8b919c;
    pointer-events: none;
  }
  .keys span { display: inline-flex; align-items: center; gap: 6px; }
  .keys i { width: 1px; height: 12px; background: rgba(255, 255, 255, 0.14); }
  kbd {
    padding: 1px 5px;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.16);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11px;
    color: #e7e9ee;
  }
`

/**
 * The shadow root is closed on purpose: the selection overlay keeps a screenshot of
 * the page in its DOM, and an open root would let page scripts read it. Tests need
 * access, so active roots go into this registry — unreachable from the page itself.
 */
const activeRoots = new Map<HTMLElement, ShadowRoot>()

export function overlayRootsForTests(): ShadowRoot[] {
  return [...activeRoots.values()]
}

export function createOverlayHost(extraCss = ''): OverlayHost {
  const element = document.createElement('div')
  element.dataset.kadrOverlay = ''
  element.style.setProperty('all', 'initial')
  element.style.setProperty('position', 'fixed')
  element.style.setProperty('z-index', '2147483647')

  const root = element.attachShadow({ mode: 'closed' })
  const style = document.createElement('style')
  style.textContent = BASE_CSS + extraCss
  root.append(style)
  document.documentElement.append(element)
  activeRoots.set(element, root)

  return {
    element,
    root,
    destroy: () => {
      activeRoots.delete(element)
      element.remove()
    },
  }
}

/**
 * Short element label for overlays: `div#main.wrap`. Two classes are enough to
 * recognise the element without letting the tag sprawl across half the screen.
 */
export function describeElement(element: Element): string {
  const id = element.id ? `#${element.id}` : ''
  const cls =
    typeof element.className === 'string' && element.className.trim()
      ? `.${element.className.trim().split(/\s+/).slice(0, 2).join('.')}`
      : ''
  return `${element.tagName.toLowerCase()}${id}${cls}`
}

/**
 * While selection is in progress, the page must not react to clicks or hotkeys.
 *
 * The comparison is against the host specifically: an event that starts inside the
 * shadow DOM is retargeted to the host element outside it, so checking "is target
 * inside the root" would swallow our own clicks.
 */
export function swallowPageEvents(host: HTMLElement): () => void {
  const stop = (event: Event) => {
    if (event.target === host) return
    event.stopPropagation()
  }
  const events = ['click', 'mousedown', 'mouseup', 'keydown', 'keyup', 'keypress'] as const
  for (const type of events) window.addEventListener(type, stop, true)
  return () => {
    for (const type of events) window.removeEventListener(type, stop, true)
  }
}
