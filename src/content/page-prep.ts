/**
 * Prepares the page for a series of frames. Every change is reversible: the original
 * inline style is remembered and restorePage() puts the page back as it was.
 *
 * What gets neutralised and why:
 * — animations and transitions: adjacent frames would drift out of phase;
 * — smooth scrolling: `scrollTo` would report an intermediate position;
 * — `background-attachment: fixed`: parallax smears across the frames;
 * — scrollbars: a strip on the right of every frame looks like a defect.
 *
 * Sticky and fixed are deliberately handled differently:
 *
 * `position: sticky` becomes `static`. A sticky element already occupies its slot in
 * the flow, so layout does not change — it just stops following the scroll and lands
 * in the shot once, in place. Hiding it is not an option: on Habr not only the header
 * but the whole right column is sticky, and it would vanish from the shot entirely.
 *
 * `position: fixed` takes no space in the flow, so switching it to `static` would
 * inject it into layout and shift everything around. Those get hidden instead — but
 * only from the second frame on, so a fixed header appears exactly once, in place.
 */
import type { PageMetrics } from '@/core/capture/types'

const STYLE_ID = 'kadr-capture-freeze'
const SCROLLBAR_STYLE_ID = 'kadr-capture-scrollbars'

/**
 * Animations are not paused — they are fast-forwarded to their end state.
 *
 * Pausing freezes whatever frame the animation was on, and entrance animations usually
 * start from transparency and blur; a paused first frame left exactly that in the shot.
 * A negative delay with a 1ms duration jumps the animation past its end, so the shot
 * captures the state the animation was leading to.
 */
const FREEZE_CSS = `
  *, *::before, *::after {
    animation-duration: 1ms !important;
    animation-delay: -1ms !important;
    animation-iteration-count: 1 !important;
    transition: none !important;
    background-attachment: scroll !important;
  }
  html, body {
    scroll-behavior: auto !important;
  }
`

/**
 * The scrollbar belongs to the browser, not the page: in a shot it is clipped by the
 * viewport and indicates a position that is meaningless in the image.
 *
 * Hidden separately from the freeze: freezing is not needed for every mode (a visible-
 * area shot must keep the header in place), but the scrollbar is always unwanted.
 */
const SCROLLBAR_CSS = `
  html { scrollbar-width: none !important; }
  html::-webkit-scrollbar, body::-webkit-scrollbar {
    width: 0 !important;
    height: 0 !important;
    display: none !important;
  }
`

type Restorable = { element: HTMLElement; position: string; priority: string }

let stickyElements: Restorable[] = []
let fixedElements: Restorable[] = []
let savedScroll: { x: number; y: number } | null = null

export function readPageMetrics(): PageMetrics {
  const doc = document.documentElement
  const body: HTMLElement | null = document.body
  return {
    scrollWidth: Math.max(doc.scrollWidth, body?.scrollWidth ?? 0),
    scrollHeight: Math.max(doc.scrollHeight, body?.scrollHeight ?? 0),
    viewportWidth: doc.clientWidth || window.innerWidth,
    viewportHeight: doc.clientHeight || window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
    scrollX: Math.round(window.scrollX),
    scrollY: Math.round(window.scrollY),
  }
}

/**
 * Two animation frames plus a short pause: enough for the browser to repaint.
 *
 * The frames are an optimisation, not a guarantee: `requestAnimationFrame` never fires
 * while the window is covered, minimised, or otherwise invisible. Waiting on it in such
 * a tab means waiting forever — exactly how re-capture used to deadlock: the window lost
 * focus, `content:metrics` never answered, and `chrome.tabs.sendMessage` has no timeout.
 * So the paint and a timer race, and whichever finishes first wins.
 */
export function settle(ms = 90): Promise<void> {
  return new Promise((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      resolve()
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(() => setTimeout(finish, ms))
    })
    // Fallback margin over the normal path: the same frames at 60Hz plus the pause itself.
    setTimeout(finish, ms + 250)
  })
}

function remember(element: HTMLElement): Restorable {
  return {
    element,
    position: element.style.position,
    priority: element.style.getPropertyPriority('position'),
  }
}

function restorePosition({ element, position, priority }: Restorable): void {
  if (position) element.style.setProperty('position', position, priority)
  else element.style.removeProperty('position')
}

/** Single pass over the tree: getComputedStyle is expensive and pages hold thousands of elements. */
function collectPositioned(): void {
  stickyElements = []
  fixedElements = []

  for (const element of document.body?.querySelectorAll<HTMLElement>('*') ?? []) {
    const position = getComputedStyle(element).position
    if (position === 'sticky') stickyElements.push(remember(element))
    else if (position === 'fixed') fixedElements.push(remember(element))
  }
}

/**
 * Hides the scrollbar and waits for reflow: the page gets wider by its width,
 * and capturing before the repaint would catch the old layout.
 */
export async function hideScrollbars(): Promise<void> {
  if (document.getElementById(SCROLLBAR_STYLE_ID)) return

  const style = document.createElement('style')
  style.id = SCROLLBAR_STYLE_ID
  style.textContent = SCROLLBAR_CSS
  document.documentElement.append(style)

  await settle()
}

export function restoreScrollbars(): void {
  document.getElementById(SCROLLBAR_STYLE_ID)?.remove()
}

export async function preparePage(): Promise<PageMetrics> {
  savedScroll = { x: window.scrollX, y: window.scrollY }
  await hideScrollbars()

  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = FREEZE_CSS
    document.documentElement.append(style)
  }

  collectPositioned()
  for (const { element } of stickyElements) {
    element.style.setProperty('position', 'static', 'important')
  }

  await settle()
  return readPageMetrics()
}

/**
 * Fixed elements are hidden from the second frame on. Waiting for the repaint is
 * mandatory: without it the next captureVisibleTab could shoot before the repaint,
 * and the header appeared in the stitched image twice.
 */
export async function setFixedHidden(hidden: boolean): Promise<void> {
  for (const entry of fixedElements) {
    if (hidden) entry.element.style.setProperty('visibility', 'hidden', 'important')
    else entry.element.style.removeProperty('visibility')
  }
  await settle(0)
}

export async function scrollToY(y: number): Promise<number> {
  window.scrollTo({ top: y, left: 0, behavior: 'auto' })
  await settle()
  return Math.round(window.scrollY)
}

/**
 * Warms up lazy images: strip `loading="lazy"`, then sweep the page to the bottom —
 * most lazy loaders hang off IntersectionObserver and never fire without scrolling.
 * Decoding is awaited with a timeout: one stuck image must not stall the capture.
 */
export async function warmLazyImages(): Promise<PageMetrics> {
  for (const image of document.images) {
    if (image.loading === 'lazy') image.loading = 'eager'
    image.decoding = 'sync'
  }

  const viewportHeight = window.innerHeight
  const startY = window.scrollY
  const height = () => document.documentElement.scrollHeight

  for (let y = 0; y < height(); y += viewportHeight) {
    window.scrollTo({ top: y, left: 0, behavior: 'auto' })
    await settle(60)
  }

  await Promise.race([
    Promise.allSettled([...document.images].filter((i) => !i.complete).map((i) => i.decode())),
    new Promise((resolve) => setTimeout(resolve, 2500)),
  ])

  window.scrollTo({ top: startY, left: 0, behavior: 'auto' })
  await settle()
  return readPageMetrics()
}

export async function restorePage(): Promise<void> {
  for (const entry of fixedElements) {
    entry.element.style.removeProperty('visibility')
    restorePosition(entry)
  }
  for (const entry of stickyElements) restorePosition(entry)
  stickyElements = []
  fixedElements = []

  document.getElementById(STYLE_ID)?.remove()
  restoreScrollbars()

  if (savedScroll) {
    window.scrollTo({ top: savedScroll.y, left: savedScroll.x, behavior: 'auto' })
    savedScroll = null
  }
  await settle(0)
}
