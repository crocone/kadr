/**
 * DOM element picking. The overlay captures the mouse, so the page underneath gets no
 * clicks; the element itself is found via elementFromPoint with the overlay hidden for
 * a moment.
 *
 * ArrowUp widens the pick to the parent, ArrowDown walks back down the chain: hitting
 * the right container on the first try almost never happens.
 *
 * The rect is returned in page coordinates, not viewport ones: the element may be
 * below the fold, and the background decides whether to scroll or stitch.
 *
 * Every table on the page gets a "copy as" badge the moment the overlay opens, pinned
 * over its top-left corner. Waiting for the cursor to land on the right element was a
 * losing game: on a dense grid the pick snaps to a cell, a scroll wrapper or a sticky
 * header, and the badge blinked in and out before it could be clicked. Not a separate
 * capture mode: a table is just another outcome of the same pick — text, not a shot.
 */
import { refOf } from '@/core/dom/selector'
import type { ElementSelectionResponse } from '@/core/messaging'
import { formatTable, type TableFormat, type TableGrid } from '@/core/table/format'

import { t } from '../i18n'
import { closestTable, dataRowCount, findTables, readTable } from '../table/read'

import { createOverlayHost, describeElement, swallowPageEvents } from './host'

const CSS = `
  .layer { cursor: crosshair; background: transparent; }
  .box {
    position: fixed;
    border: 2px solid #6d5cf5;
    background: rgba(109, 92, 245, 0.18);
    pointer-events: none;
    display: none;
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
  .table {
    position: fixed;
    display: none;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    border-radius: 10px;
    border: 1px solid rgba(255, 255, 255, 0.07);
    background: rgba(20, 21, 25, 0.96);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
    pointer-events: auto;
    cursor: default;
    /* Badges sit on top of the page content they describe, so an idle one steps back
       until the pick reaches its table or the cursor reaches the badge itself. */
    opacity: 0.72;
  }
  .table:hover,
  .table[data-active] {
    opacity: 1;
    border-color: rgba(109, 92, 245, 0.9);
  }
  .table b { font-weight: 600; color: #fff; margin-right: 2px; white-space: nowrap; }
`

/** Gap between a badge and the table corner it is pinned to. */
const BAR_INSET = 6

/** A table showing less than this on screen has no room for a badge. */
const BAR_MARGIN = 8

/** Tables come and go with scrolling; re-scanning the whole page is not free. */
const RESCAN_MS = 400

const FORMATS: readonly TableFormat[] = ['csv', 'markdown', 'json']

const FORMAT_LABELS: Record<TableFormat, string> = {
  csv: 'CSV',
  markdown: 'Markdown',
  json: 'JSON',
}

/**
 * Parsed tables are cached for the duration of the pick: the mouse wanders across rows,
 * and re-parsing a large grid on every move is pointless.
 */
type TableCache = WeakMap<Element, TableGrid | null>

function gridFor(table: Element, cache: TableCache): TableGrid | null {
  if (!cache.has(table)) cache.set(table, readTable(table))
  return cache.get(table) ?? null
}

/** A table on the page and the badge floating over it. */
type TableBadge = { element: Element; grid: TableGrid; bar: HTMLElement }

export async function selectElement(): Promise<ElementSelectionResponse> {
  const host = createOverlayHost(CSS)
  const release = swallowPageEvents(host.element)

  const layer = document.createElement('div')
  layer.className = 'layer'
  layer.innerHTML = `
    <div class="box"></div>
    <div class="tag"></div>
    <div class="card"><b>${t('overlay.element.hint')}</b> ${t('overlay.element.keys')}</div>
    <div class="keys"><span><kbd>Esc</kbd> ${t('overlay.keys.cancel')}</span></div>
  `
  host.root.append(layer)

  const box = layer.querySelector<HTMLElement>('.box')!
  const tag = layer.querySelector<HTMLElement>('.tag')!
  const hostElement = host.element

  return await new Promise<ElementSelectionResponse>((resolve) => {
    /** Ancestor chain from the hovered element up: the arrow keys walk it. */
    let chain: Element[] = []
    let depth = 0
    /** One badge per table on the page, in document order. */
    const badges: TableBadge[] = []
    const cache: TableCache = new WeakMap()
    let scannedAt = 0

    const finish = (response: ElementSelectionResponse) => {
      release()
      host.destroy()
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('scroll', onViewportChange, true)
      window.removeEventListener('resize', onViewportChange)
      resolve(response)
    }

    const current = () => chain[depth]

    /** A badge for one table: built once, then only moved. */
    const addBadge = (element: Element): TableBadge | null => {
      const grid = gridFor(element, cache)
      if (!grid || dataRowCount(grid) === 0) return null

      const bar = document.createElement('div')
      bar.className = 'table'
      bar.innerHTML = `
        <b>${t('overlay.table.rows', { n: dataRowCount(grid) })}</b>
        ${FORMATS.map(
          (format) =>
            `<button class="chip" data-format="${format}">${FORMAT_LABELS[format]}</button>`,
        ).join('')}
      `
      layer.append(bar)

      const badge = { element, grid, bar }
      badges.push(badge)
      return badge
    }

    /**
     * Picks up tables that were not there when the overlay opened: virtualised grids
     * mount on scroll, and a page-long scan on every frame is far too expensive.
     */
    const scanTables = () => {
      const now = Date.now()
      if (now - scannedAt < RESCAN_MS) return
      scannedAt = now

      let added = false
      for (const element of findTables()) {
        if (badges.some((badge) => badge.element === element)) continue
        if (addBadge(element)) added = true
      }
      if (added) placeBadges()
    }

    /**
     * Badges are pinned over the top-left corner of their table and clamped to the
     * part of it that is on screen: on a grid taller than the viewport the badge stays
     * reachable instead of scrolling away with the table's own top edge.
     */
    const placeBadges = () => {
      for (let at = badges.length - 1; at >= 0; at -= 1) {
        const badge = badges[at]!
        if (!badge.element.isConnected) {
          badge.bar.remove()
          badges.splice(at, 1)
          continue
        }

        const rect = badge.element.getBoundingClientRect()
        const left = Math.max(rect.left, 0)
        const top = Math.max(rect.top, 0)
        const right = Math.min(rect.right, window.innerWidth)
        const bottom = Math.min(rect.bottom, window.innerHeight)

        // Measured with the badge visible: a `display: none` element has no size.
        badge.bar.style.display = 'flex'
        const size = badge.bar.getBoundingClientRect()
        const fits =
          right - left >= size.width + BAR_MARGIN && bottom - top >= size.height + BAR_MARGIN
        if (!fits) {
          badge.bar.style.display = 'none'
          continue
        }

        badge.bar.style.left = `${left + BAR_INSET}px`
        badge.bar.style.top = `${top + BAR_INSET}px`
      }
    }

    /**
     * The badge of the table the pick is inside lights up, so it is clear which grid
     * those buttons would copy when several sit next to each other.
     */
    const markActive = () => {
      const element = current()
      const active = element ? closestTable(element) : null
      for (const badge of badges) {
        if (active && badge.element.contains(active)) badge.bar.dataset.active = ''
        else delete badge.bar.dataset.active
      }
    }

    const paint = () => {
      const element = current()
      if (!element) {
        box.style.display = 'none'
        tag.style.display = 'none'
        return
      }

      const rect = element.getBoundingClientRect()
      box.style.display = 'block'
      box.style.left = `${rect.left}px`
      box.style.top = `${rect.top}px`
      box.style.width = `${rect.width}px`
      box.style.height = `${rect.height}px`

      tag.style.display = 'block'
      tag.textContent = `${describeElement(element)} · ${Math.round(rect.width)} × ${Math.round(rect.height)}`
      const above = rect.top > 26
      tag.style.left = `${Math.max(4, rect.left)}px`
      tag.style.top = `${above ? rect.top - 24 : Math.min(window.innerHeight - 24, rect.bottom + 4)}px`

      markActive()
    }

    /** Scroll and resize move every table under the badges; a rescan may add more. */
    let frame = 0
    function onViewportChange() {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        scanTables()
        placeBadges()
      })
    }

    const elementUnder = (x: number, y: number): Element | null => {
      hostElement.style.display = 'none'
      const found = document.elementFromPoint(x, y)
      hostElement.style.display = ''
      return found
    }

    const onMouseMove = (event: MouseEvent) => {
      // Cursor over our own bar — leave the pick alone. Otherwise `elementFromPoint`
      // with the host hidden returned whatever lay under the bar, the pick jumped to
      // it, the table "got lost" and the bar vanished — exactly when the user was
      // reaching for it. The buttons were effectively unclickable.
      if ((event.target as Element | null)?.closest?.('.table')) return

      const found = elementUnder(event.clientX, event.clientY)
      if (!found || found === current()) return

      chain = []
      for (let node: Element | null = found; node; node = node.parentElement) chain.push(node)
      depth = 0
      paint()
      // A table can be rendered long after the overlay opened, without a single scroll
      // in between — the throttle keeps this from costing anything on a still page.
      scanTables()
    }

    /**
     * The copy happens here, in the click handler, not in the background: the
     * Clipboard API needs a user gesture and a focused document, and the service
     * worker has neither. The area overlay writes image copies for the same reason.
     */
    const copyTable = async (badge: TableBadge, format: TableFormat) => {
      const rows = dataRowCount(badge.grid)
      let copied = true

      try {
        await navigator.clipboard.writeText(formatTable(badge.grid, format))
      } catch (error) {
        console.warn('[kadr] clipboard write failed', error)
        copied = false
      }

      finish({ ok: true, table: { format, rows, copied } })
    }

    const onClick = (event: MouseEvent) => {
      event.preventDefault()
      event.stopPropagation()

      const bar = (event.target as Element | null)?.closest?.('.table')
      const chip = (event.target as Element | null)?.closest?.<HTMLElement>('.chip')
      const badge = bar ? badges.find((candidate) => candidate.bar === bar) : undefined
      if (badge && chip?.dataset.format) {
        void copyTable(badge, chip.dataset.format as TableFormat)
        return
      }
      // A click on the bar itself, missing the buttons, must not capture what is under it.
      if (bar) return

      const element = current()
      if (!element) return

      const rect = element.getBoundingClientRect()
      finish({
        ok: true,
        rect: {
          x: rect.left + window.scrollX,
          y: rect.top + window.scrollY,
          w: rect.width,
          h: rect.height,
        },
        label: describeElement(element),
        // The element ref travels with the rect: re-capture uses it to find the
        // element again on a page opened a week later in another window.
        element: refOf(element),
      })
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        finish({ ok: false, cancelled: true })
        return
      }
      if (event.key === 'ArrowUp' && depth < chain.length - 1) {
        event.preventDefault()
        depth += 1
        paint()
        return
      }
      if (event.key === 'ArrowDown' && depth > 0) {
        event.preventDefault()
        depth -= 1
        paint()
      }
    }

    layer.addEventListener('mousemove', onMouseMove)
    layer.addEventListener('click', onClick, true)
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('scroll', onViewportChange, true)
    window.addEventListener('resize', onViewportChange)

    for (const element of findTables()) addBadge(element)
    scannedAt = Date.now()
    placeBadges()
  })
}
