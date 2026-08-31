/**
 * Scrolling capture: picking the container, frame extras, direction, and a progress HUD.
 *
 * Selection is two steps. First the overlay highlights whatever can scroll at all —
 * the page itself or a message feed. Then non-scrolling extras can be added to the
 * frame: a channel header, a panel, a sidebar. The capture area becomes the union
 * rect of everything selected; the header inside it stays put in every frame, so
 * stitching naturally keeps it exactly once.
 *
 * The same overlay then becomes a HUD: a frame counter and "Stop". The HUD never
 * blinks or hides — it stays put the whole run, or "Stop" would be impossible to hit.
 * It stays out of the shot because the capture area is pre-shrunk by its height, and
 * the strip under it is captured by the background as one final frame after the
 * overlay is gone. That is why the HUD sits at the edge the scroll is heading to:
 * the missing strip lands exactly where it will be glued on.
 */
import type { RollDirection } from '@/core/capture/rolling'
import type { Rect } from '@/core/doc/types'
import type { RollStepResult, ScrollTargetResponse } from '@/core/messaging'

import { t } from '../i18n'
import { settle } from '../page-prep'

import { createOverlayHost, describeElement, type OverlayHost, swallowPageEvents } from './host'

const CSS = `
  .layer { cursor: crosshair; background: transparent; }
  /**
   * Dimming around the selection: a huge box-shadow covers everything but the frame.
   * Four separate rects would do the same but need recomputing on every mouse move.
   */
  .box {
    position: fixed;
    border: 2px solid #6d5cf5;
    box-shadow: 0 0 0 100vmax rgba(10, 11, 14, 0.42);
    pointer-events: none;
    display: none;
  }
  /** Hovered element on step two: not selected yet, so just an outline. */
  .hover {
    position: fixed;
    border: 2px dashed rgba(255, 255, 255, 0.7);
    pointer-events: none;
    display: none;
  }
  .extra {
    position: fixed;
    border: 2px solid #3ddc97;
    background: rgba(61, 220, 151, 0.12);
    pointer-events: none;
  }
  .tag {
    position: fixed;
    padding: 3px 7px;
    border-radius: 6px;
    background: #6d5cf5;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11px;
    white-space: nowrap;
    pointer-events: none;
    display: none;
  }
  /** Same dimming during the run: shows what exactly goes into the frames. */
  .mask {
    position: fixed;
    box-shadow: 0 0 0 100vmax rgba(10, 11, 14, 0.32);
    pointer-events: none;
    display: none;
  }
  .hud {
    position: fixed;
    /* Above the shield: it covers everything, and without this the shield would catch "Stop" clicks. */
    z-index: 2;
    left: 50%;
    transform: translateX(-50%);
    display: none;
    align-items: center;
    gap: 12px;
    padding: 10px 12px 10px 16px;
    border-radius: 12px;
    background: rgba(20, 21, 25, 0.95);
    box-shadow: 0 14px 40px rgba(0, 0, 0, 0.5);
    pointer-events: auto;
  }
  .hud[data-edge='bottom'] { bottom: 24px; }
  .hud[data-edge='top'] { top: 24px; }
  .hud .count { font-variant-numeric: tabular-nums; color: #e7e9ee; }
  .hud .count i { display: block; font-style: normal; font-size: 11px; color: #8b919c; }
  .stop {
    all: unset;
    padding: 6px 12px;
    border-radius: 8px;
    background: #6d5cf5;
    color: #fff;
    font-weight: 600;
    cursor: pointer;
  }
  .stop:hover { background: #8f7dff; }
  .stop:disabled { opacity: 0.5; cursor: default; }
  /** The shield catches the mouse during the run: hover states would otherwise change the frame. */
  .shield { position: fixed; inset: 0; display: none; cursor: progress; }
`

/**
 * A container counts as scrollable if it has somewhere to go and does not forbid it.
 * The 8px slack cuts off rounding artefacts like "scrollHeight one pixel over clientHeight".
 */
const SCROLL_SLACK = 8

/** How many page scroller candidates to keep in reserve. */
const PAGE_SCROLLER_CANDIDATES = 5

/** Gap between the HUD and the capture area edge: the HUD shadow must stay out of the frame. */
const HUD_CLEARANCE = 14

/**
 * All scrollable ancestors under the cursor, nearest first.
 *
 * The nearest is almost never the right one. A code block with horizontal scrolling
 * gets vertical `auto` too (CSS mandates it: one non-`visible` overflow makes the
 * other `auto`), so over a long listing it comes first instead of the message feed.
 * Hence we pick the largest, not the first — and the arrows can reach any other.
 */
function scrollableChain(element: Element | null): HTMLElement[] {
  const found: HTMLElement[] = []
  for (let node = element; node instanceof HTMLElement; node = node.parentElement) {
    if (node.scrollHeight - node.clientHeight <= SCROLL_SLACK) continue
    const style = getComputedStyle(node)
    if (style.overflowY === 'auto' || style.overflowY === 'scroll') found.push(node)
  }
  return found
}

/** The largest of the found: in a chat that is the feed, not a code block inside a message. */
function widestScroller(chain: readonly HTMLElement[]): number {
  let best = 0
  let bestArea = 0
  chain.forEach((node, index) => {
    const rect = visibleRect(node)
    const area = rect.w * rect.h
    if (area > bestArea) {
      best = index
      bestArea = area
    }
  })
  return best
}

/**
 * What actually scrolls the page.
 *
 * In app shells — chats, mail, ChatGPT — the document does not move at all: `html`
 * and `body` are fixed, and an inner container scrolls. "Whole page" on such a site
 * would mean exactly one screen, so when the document has nowhere to go, the largest
 * container that does is taken instead.
 *
 * The full tree walk runs once, and only when the document really does not scroll.
 */
function pageScrollers(): HTMLElement[] {
  const doc = document.documentElement
  if (doc.scrollHeight - (doc.clientHeight || window.innerHeight) > SCROLL_SLACK) return []

  const found: { node: HTMLElement; area: number }[] = []
  for (const node of document.body?.querySelectorAll<HTMLElement>('*') ?? []) {
    if (node.scrollHeight - node.clientHeight <= SCROLL_SLACK) continue
    const style = getComputedStyle(node)
    if (style.overflowY !== 'auto' && style.overflowY !== 'scroll') continue

    const rect = visibleRect(node)
    found.push({ node, area: rect.w * rect.h })
  }

  // Largest first: the first becomes the target, the rest are fallbacks in case the
  // chosen one accepts the scroll while nothing on screen moves.
  return found
    .sort((first, second) => second.area - first.area)
    .slice(0, PAGE_SCROLLER_CANDIDATES)
    .map((entry) => entry.node)
}

/** The chosen target outlives a single message: selection and scroll steps arrive separately. */
let target: HTMLElement | null = null

/**
 * Fallback targets: the other scrollable containers from under the cursor plus the
 * page scroller. If the chosen one accepts `scrollTop` but the picture never changes,
 * the wrong thing is scrolling — the session asks for the next candidate instead of
 * silently returning one screen.
 */
let candidates: HTMLElement[] = []
let hud: OverlayHost | null = null
let stopped = false

function scrollTopOf(): number {
  return Math.round(target ? target.scrollTop : window.scrollY)
}

function viewportRect(): Rect {
  return {
    x: 0,
    y: 0,
    w: document.documentElement.clientWidth || window.innerWidth,
    h: document.documentElement.clientHeight || window.innerHeight,
  }
}

/** Visible part of an element in viewport coordinates. */
function visibleRect(element: HTMLElement): Rect {
  const rect = element.getBoundingClientRect()
  const x = Math.max(0, rect.left)
  const y = Math.max(0, rect.top)
  return {
    x,
    y,
    w: Math.max(1, Math.min(rect.right, window.innerWidth) - x),
    h: Math.max(1, Math.min(rect.bottom, window.innerHeight) - y),
  }
}

/**
 * Capture area of the scrolling target.
 *
 * An inner container keeps its own scrollbar — the page only hides its own. In the
 * frames it shows up as thumb fragments along the right edge, different in each strip,
 * so its width is cut off. The width is measured, not a constant: overlay scrollbars
 * have zero width, and there is nothing to cut.
 */
function rectOf(element: HTMLElement | null): Rect {
  if (!element) return viewportRect()

  const rect = visibleRect(element)
  const style = getComputedStyle(element)

  // The width difference is scrollbar plus borders, so borders are subtracted:
  // otherwise a bordered container would lose a couple of pixels of content.
  const borders =
    (parseFloat(style.borderLeftWidth) || 0) + (parseFloat(style.borderRightWidth) || 0)
  const scrollbar = Math.max(0, element.offsetWidth - element.clientWidth - borders)
  if (scrollbar === 0) return rect

  return style.direction === 'rtl'
    ? { ...rect, x: rect.x + scrollbar, w: Math.max(1, rect.w - scrollbar) }
    : { ...rect, w: Math.max(1, rect.w - scrollbar) }
}

/** Union rect of everything selected: the scrolling target plus its extras. */
function unionRect(rects: readonly Rect[]): Rect {
  const first = rects[0] ?? viewportRect()
  let left = first.x
  let top = first.y
  let right = first.x + first.w
  let bottom = first.y + first.h

  for (const rect of rects.slice(1)) {
    left = Math.min(left, rect.x)
    top = Math.min(top, rect.y)
    right = Math.max(right, rect.x + rect.w)
    bottom = Math.max(bottom, rect.y + rect.h)
  }

  return { x: left, y: top, w: Math.max(1, right - left), h: Math.max(1, bottom - top) }
}

/**
 * Picks the target, extras, and direction.
 *
 * Direction is asked up front: in chats the main scenario is going up through the
 * history, and asking later would be too late.
 */
export async function selectScrollTarget(): Promise<ScrollTargetResponse> {
  const host = createOverlayHost(CSS)
  const release = swallowPageEvents(host.element)

  const layer = document.createElement('div')
  layer.className = 'layer'
  layer.innerHTML = `
    <div class="box"></div>
    <div class="hover"></div>
    <div class="extras"></div>
    <div class="tag"></div>
    <div class="mask"></div>
    <div class="card">
      <b class="title">${t('overlay.scroll.hint')}</b> <span class="hint">${t('overlay.scroll.page')}</span>
      <div class="chips">
        <button class="chip" data-direction="down" aria-pressed="true">${t('overlay.scroll.down')}</button>
        <button class="chip" data-direction="up" aria-pressed="false">${t('overlay.scroll.up')}</button>
      </div>
    </div>
    <div class="keys">
      <span class="enter"><kbd>Enter</kbd> ${t('overlay.scroll.wholePage')}</span><i></i>
      <span><kbd>Esc</kbd> ${t('overlay.keys.cancel')}</span>
    </div>
    <div class="hud">
      <span class="count"></span>
      <button class="stop">${t('overlay.scroll.stop')}</button>
    </div>
    <div class="shield"></div>
  `
  host.root.append(layer)

  const box = layer.querySelector<HTMLElement>('.box')!
  const hover = layer.querySelector<HTMLElement>('.hover')!
  const extrasLayer = layer.querySelector<HTMLElement>('.extras')!
  const tag = layer.querySelector<HTMLElement>('.tag')!
  const chips = [...layer.querySelectorAll<HTMLButtonElement>('.chip')]

  return await new Promise<ScrollTargetResponse>((resolve) => {
    /** Step one picks what scrolls; step two picks what else goes into the frame. */
    let phase: 'target' | 'extras' = 'target'
    /**
     * Scrollable containers from under the cursor at pick time. Kept apart from
     * `chain`: on step two that becomes a chain of arbitrary ancestors, and taking
     * fallback targets from it would offer the session `body` and `div.contents` —
     * elements with no scrolling to speak of.
     */
    let scrollChain: HTMLElement[] = []
    let hovered: HTMLElement | null = null
    /** Ancestor chain from the hovered element up: the arrows walk it on step two. */
    let chain: HTMLElement[] = []
    let depth = 0
    let chosen: HTMLElement | null = null
    const extras: HTMLElement[] = []
    let direction: RollDirection = 'down'

    const place = (element: HTMLElement, rect: Rect) => {
      element.style.display = 'block'
      element.style.left = `${rect.x}px`
      element.style.top = `${rect.y}px`
      element.style.width = `${rect.w}px`
      element.style.height = `${rect.h}px`
    }

    const shotRect = () => unionRect([rectOf(chosen), ...extras.map(visibleRect)])

    const paint = () => {
      if (phase === 'target') {
        place(box, rectOf(hovered))
        tag.style.display = 'block'
        tag.textContent = hovered
          ? `${describeElement(hovered)} · ${Math.round(hovered.scrollHeight)} px`
          : t('overlay.scroll.wholePage')
        const rect = rectOf(hovered)
        tag.style.left = `${Math.max(4, rect.x)}px`
        tag.style.top = `${rect.y > 26 ? rect.y - 24 : Math.min(window.innerHeight - 24, rect.y + rect.h + 4)}px`
        return
      }

      // On step two the dimming shows the whole capture area: the scrolling
      // target's frame together with everything already added.
      place(box, shotRect())

      extrasLayer.replaceChildren(
        ...extras.map((element) => {
          const marker = document.createElement('div')
          marker.className = 'extra'
          place(marker, visibleRect(element))
          return marker
        }),
      )

      const current = chain[depth]
      if (current) {
        place(hover, visibleRect(current))
        tag.style.display = 'block'
        tag.textContent = describeElement(current)
        const rect = visibleRect(current)
        tag.style.left = `${Math.max(4, rect.x)}px`
        tag.style.top = `${rect.y > 26 ? rect.y - 24 : Math.min(window.innerHeight - 24, rect.y + rect.h + 4)}px`
      } else {
        hover.style.display = 'none'
        tag.style.display = 'none'
      }
    }

    const toExtrasPhase = (element: HTMLElement | null) => {
      phase = 'extras'
      scrollChain = chain
      // "Whole page" on an app-style site means its inner container: the document
      // itself does not scroll there, and shooting it would yield one screen.
      chosen = element ?? pageScrollers()[0] ?? null
      chain = []
      depth = 0

      layer.querySelector<HTMLElement>('.title')!.textContent = t('overlay.scroll.extras')
      layer.querySelector<HTMLElement>('.hint')!.textContent = t('overlay.scroll.extras.hint')
      layer.querySelector<HTMLElement>('.enter')!.innerHTML =
        `<kbd>Enter</kbd> ${t('overlay.scroll.start')}`
      paint()
    }

    /**
     * Silences the selection overlay: both mouse and keys. Otherwise a click on
     * "Stop" would hit the extras handler — it listens in the capture phase and
     * swallows the event — and mouse moves would keep drawing the frame into the shot.
     */
    const silence = () => {
      release()
      window.removeEventListener('keydown', onKeyDown, true)
      layer.removeEventListener('mousemove', onMouseMove)
      layer.removeEventListener('click', onClick, true)
    }

    const cancel = () => {
      silence()
      hud = null
      host.destroy()
      resolve({ ok: false, cancelled: true })
    }

    const start = async () => {
      silence()

      // The overlay stays: it becomes the HUD for the run. But everything related to
      // selection is removed from the DOM for good — not hidden. Hidden things can
      // come back: one stray line resetting `display` and the highlight is in the
      // shot. Removed things cannot.
      for (const element of [
        box,
        hover,
        tag,
        extrasLayer,
        layer.querySelector<HTMLElement>('.card'),
        layer.querySelector<HTMLElement>('.keys'),
      ]) {
        element?.remove()
      }

      target = chosen
      candidates = [...scrollChain, ...pageScrollers()].filter(
        (node, index, all) => node !== chosen && all.indexOf(node) === index,
      )
      hud = host
      stopped = false

      const rect = shotRect()
      const band = showHud(direction, rect, 1, 0)
      const shot: Rect =
        direction === 'down'
          ? { ...rect, h: Math.max(1, rect.h - band) }
          : { ...rect, y: rect.y + band, h: Math.max(1, rect.h - band) }

      paintMask(shot)

      // Waiting for the repaint is mandatory: the selection frame and element tag
      // just disappeared, and the background shoots the first frame right after the
      // response. Without the pause it caught them — and the highlight stayed in the
      // final stitched image.
      await settle(60)

      beginRolling()
      resolve({
        ok: true,
        rect: shot,
        direction,
        scrollTop: scrollTopOf(),
        viewportHeight: chosen ? chosen.clientHeight : window.innerHeight,
        hudBand: band,
      })
    }

    const elementUnder = (x: number, y: number): Element | null => {
      host.element.style.display = 'none'
      const under = document.elementFromPoint(x, y)
      host.element.style.display = ''
      return under
    }

    const onMouseMove = (event: MouseEvent) => {
      const under = elementUnder(event.clientX, event.clientY)

      if (phase === 'target') {
        const found = scrollableChain(under)
        if (found[0] === chain[0] && found.length === chain.length) return
        chain = found
        depth = widestScroller(found)
        hovered = chain[depth] ?? null
        paint()
        return
      }

      if (!(under instanceof HTMLElement) || under === chain[depth]) return
      chain = []
      for (let node: HTMLElement | null = under; node; node = node.parentElement) chain.push(node)
      depth = 0
      paint()
    }

    const onClick = (event: MouseEvent) => {
      event.preventDefault()
      event.stopPropagation()

      if (phase === 'target') {
        toExtrasPhase(hovered)
        return
      }

      // Clicking an extra again removes it: misclicking is easier than starting over.
      const current = chain[depth]
      if (!current) return
      const at = extras.indexOf(current)
      if (at === -1) extras.push(current)
      else extras.splice(at, 1)
      paint()
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        cancel()
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        event.stopPropagation()
        if (phase === 'target') toExtrasPhase(null)
        else void start()
        return
      }
      // The arrows walk the chain: scrollable containers on step one, ancestors of
      // the hovered element on step two. Hitting the right one on the first try
      // almost never happens in either.
      if (event.key === 'ArrowUp' && depth < chain.length - 1) {
        event.preventDefault()
        depth += 1
        if (phase === 'target') hovered = chain[depth] ?? null
        paint()
      } else if (event.key === 'ArrowDown' && depth > 0) {
        event.preventDefault()
        depth -= 1
        if (phase === 'target') hovered = chain[depth] ?? null
        paint()
      }
    }

    for (const chip of chips) {
      chip.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        direction = chip.dataset.direction === 'up' ? 'up' : 'down'
        for (const other of chips) {
          other.setAttribute('aria-pressed', String(other === chip))
        }
      })
    }

    layer.addEventListener('mousemove', onMouseMove)
    layer.addEventListener('click', onClick, true)
    window.addEventListener('keydown', onKeyDown, true)
    paint()
  })
}

/**
 * One capture step: scroll the target and wait for the repaint.
 *
 * The HUD is untouched — it is outside the frame anyway. `top === null` means the
 * first step: shoot from where we stand.
 */
export async function rollStep(
  top: number | null,
  frames: number,
  rows: number,
): Promise<RollStepResult> {
  updateCount(frames, rows)

  if (top !== null) {
    // A container lies about its `scrollHeight`: virtualised feeds report only the
    // rendered part. Clamping by it would hit a made-up bottom, so the position is
    // passed as is — the browser applies the real limit itself.
    const next = Math.max(0, top)
    if (target) target.scrollTo({ top: next, behavior: 'auto' })
    else window.scrollTo({ top: next, left: window.scrollX, behavior: 'auto' })

    // Lazy loading adds content after the scroll: without the pause the frame would
    // catch empty space where messages are about to appear.
    await settle(120)
  }

  return { scrollTop: scrollTopOf(), stopped }
}

/**
 * Shows the HUD at the right edge and returns how many pixels of the capture area it
 * covers. Zero means the HUD hangs outside the captured area — nothing to subtract.
 */
function showHud(direction: RollDirection, rect: Rect, frames: number, rows: number): number {
  const root = hud?.root
  if (!root) return 0

  const panel = root.querySelector<HTMLElement>('.hud')!
  panel.dataset.edge = direction === 'down' ? 'bottom' : 'top'
  panel.style.display = 'flex'
  root.querySelector<HTMLElement>('.shield')!.style.display = 'block'
  updateCount(frames, rows)

  const stop = root.querySelector<HTMLButtonElement>('.stop')!
  stop.onclick = (event) => {
    event.preventDefault()
    event.stopPropagation()
    stopped = true
    stop.disabled = true
  }

  const panelRect = panel.getBoundingClientRect()
  const band =
    direction === 'down'
      ? rect.y + rect.h - (panelRect.top - HUD_CLEARANCE)
      : panelRect.bottom + HUD_CLEARANCE - rect.y

  // The HUD may not cover more than half the area: past that it is a panel, not a capture.
  return Math.max(0, Math.min(Math.round(band), Math.floor(rect.h / 2)))
}

function updateCount(frames: number, rows: number): void {
  const count = hud?.root.querySelector<HTMLElement>('.count')
  if (!count) return
  count.innerHTML = `${t('overlay.scroll.frames', { n: frames })}<i>${t('overlay.scroll.rows', { n: rows })}</i>`
}

/** Dimming around the capture area: outside it the overlay never enters the frame. */
function paintMask(rect: Rect): void {
  const mask = hud?.root.querySelector<HTMLElement>('.mask')
  if (!mask) return
  mask.style.display = 'block'
  mask.style.left = `${rect.x}px`
  mask.style.top = `${rect.y}px`
  mask.style.width = `${rect.w}px`
  mask.style.height = `${rect.h}px`
}

/**
 * Switches to the next scrollable container.
 *
 * Called when the picture stops changing: the chosen one may have been wrong — a code
 * block inside a message, an invisible wrapper, a panel with its own scrolling.
 */
export function nextRollTarget(): { ok: boolean; scrollTop: number } {
  const next = candidates.shift()
  if (!next) return { ok: false, scrollTop: 0 }

  target = next
  return { ok: true, scrollTop: scrollTopOf() }
}

/** Esc during the run acts as "Stop": the session stops, what was captured stays. */
function onRollingKeyDown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  event.preventDefault()
  event.stopPropagation()
  stopped = true
}

function beginRolling(): void {
  window.addEventListener('keydown', onRollingKeyDown, true)
}

/**
 * The run is over: the overlay comes down, and waiting for the repaint is mandatory.
 *
 * Right after this the background shoots the final frame — the one supplying the strip
 * from under the HUD. Without the pause that frame caught the not-yet-removed overlay,
 * and the bottom of the stitched image ended up with the dimming and the HUD itself,
 * "Stop" button included.
 */
export async function endRolling(): Promise<void> {
  window.removeEventListener('keydown', onRollingKeyDown, true)
  hud?.destroy()
  hud = null
  target = null
  candidates = []
  stopped = false
  await settle(60)
}
