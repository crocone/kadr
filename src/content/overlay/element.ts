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
 * When the cursor is over a table, "copy as" chips appear next to the frame
 *. Not a separate capture mode: the user is already hovering elements,
 * and a table is just another outcome of the same pick — as text instead of a shot.
 */
import { refOf } from '@/core/dom/selector'
import type { ElementSelectionResponse } from '@/core/messaging'
import { formatTable, type TableFormat, type TableGrid } from '@/core/table/format'

import { t } from '../i18n'
import { closestTable, dataRowCount, readTable } from '../table/read'

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
    padding: 7px 9px;
    border-radius: 10px;
    border: 1px solid rgba(255, 255, 255, 0.07);
    background: rgba(20, 21, 25, 0.96);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
    pointer-events: auto;
    cursor: default;
  }
  .table b { font-weight: 600; color: #fff; margin-right: 2px; }
`

/** Chip bar height: decides whether it goes below the table or above it. */
const BAR_HEIGHT = 40

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

export async function selectElement(): Promise<ElementSelectionResponse> {
  const host = createOverlayHost(CSS)
  const release = swallowPageEvents(host.element)

  const layer = document.createElement('div')
  layer.className = 'layer'
  layer.innerHTML = `
    <div class="box"></div>
    <div class="tag"></div>
    <div class="table">
      <b></b>
      ${FORMATS.map(
        (format) =>
          `<button class="chip" data-format="${format}">${FORMAT_LABELS[format]}</button>`,
      ).join('')}
    </div>
    <div class="card"><b>${t('overlay.element.hint')}</b> ${t('overlay.element.keys')}</div>
    <div class="keys"><span><kbd>Esc</kbd> ${t('overlay.keys.cancel')}</span></div>
  `
  host.root.append(layer)

  const box = layer.querySelector<HTMLElement>('.box')!
  const tag = layer.querySelector<HTMLElement>('.tag')!
  const tableBar = layer.querySelector<HTMLElement>('.table')!
  const tableCount = layer.querySelector<HTMLElement>('.table b')!
  const hostElement = host.element

  return await new Promise<ElementSelectionResponse>((resolve) => {
    /** Ancestor chain from the hovered element up: the arrow keys walk it. */
    let chain: Element[] = []
    let depth = 0
    /** Table under the cursor and its parsed grid — what the chips will copy. */
    let table: { element: Element; grid: TableGrid } | null = null
    const cache: TableCache = new WeakMap()

    const finish = (response: ElementSelectionResponse) => {
      release()
      host.destroy()
      window.removeEventListener('keydown', onKeyDown, true)
      resolve(response)
    }

    const current = () => chain[depth]

    /**
     * Chips appear only when the cursor is really over a table — itself, or exactly
     * one inside the hovered container. In a block with three tables a "copy" button
     * that cannot say which one is useless, so no chips there.
     */
    const paintTable = () => {
      const element = current()
      const found = element ? closestTable(element) : null
      const grid = found ? gridFor(found, cache) : null

      if (!found || !grid) {
        table = null
        tableBar.style.display = 'none'
        return
      }

      table = { element: found, grid }
      tableCount.textContent = t('overlay.table.rows', { n: dataRowCount(grid) })
      tableBar.style.display = 'flex'

      const rect = found.getBoundingClientRect()
      const below = rect.bottom + BAR_HEIGHT < window.innerHeight

      // The bar hugs the table edge with no gap — even overlapping by a couple of
      // pixels. A gap would be a strip of some other element on the cursor's way to
      // the buttons: while crossing it, the pick jumps to a neighbouring paragraph
      // and the bar disappears.
      tableBar.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 320))}px`
      tableBar.style.top = `${below ? rect.bottom - 2 : Math.max(8, rect.top - BAR_HEIGHT + 2)}px`
    }

    const paint = () => {
      const element = current()
      if (!element) {
        box.style.display = 'none'
        tag.style.display = 'none'
        tableBar.style.display = 'none'
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

      paintTable()
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
    }

    /**
     * The copy happens here, in the click handler, not in the background: the
     * Clipboard API needs a user gesture and a focused document, and the service
     * worker has neither. The area overlay writes image copies for the same reason.
     */
    const copyTable = async (format: TableFormat) => {
      if (!table) return
      const rows = dataRowCount(table.grid)
      let copied = true

      try {
        await navigator.clipboard.writeText(formatTable(table.grid, format))
      } catch (error) {
        console.warn('[kadr] clipboard write failed', error)
        copied = false
      }

      finish({ ok: true, table: { format, rows, copied } })
    }

    const onClick = (event: MouseEvent) => {
      event.preventDefault()
      event.stopPropagation()

      const chip = (event.target as Element | null)?.closest?.<HTMLElement>('.chip')
      if (chip?.dataset.format) {
        void copyTable(chip.dataset.format as TableFormat)
        return
      }
      // A click on the bar itself, missing the buttons, must not capture what is under it.
      if ((event.target as Element | null)?.closest?.('.table')) return

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
  })
}
