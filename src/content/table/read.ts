/**
 * Reads a page table into a rectangular grid.
 *
 * Two jobs, both non-obvious.
 *
 * First, merged cells. `colspan` and `rowspan` turn a table into a sieve: the second
 * row may have three fewer cells than the first, and pasted into Excel such a table
 * falls apart. Here an honest rectangular grid is built, with a merged cell repeated
 * in every slot it occupied.
 *
 * Second, cell text. `textContent` grabs everything: hidden sort captions
 * ("Sort by name ascending"), screen-reader icons, `display: none` markup. So text is
 * collected by walking the tree with visibility checks; inputs contribute their value,
 * images their `alt`.
 */
import type { TableAlign, TableGrid } from '@/core/table/format'

/** Roles used to mark up a table without `<table>`. */
const GRID_ROLES = ['table', 'grid', 'treegrid']

/** Read no more than this: a giant virtualised grid is incomplete anyway. */
const MAX_ROWS = 2000
const MAX_COLUMNS = 200

export function isTableLike(element: Element): boolean {
  if (element.tagName === 'TABLE') return true
  const role = element.getAttribute('role')
  return role !== null && GRID_ROLES.includes(role)
}

/**
 * The table a node under the cursor belongs to.
 *
 * Up first — the cursor is almost always on a cell, not the table itself. If nothing
 * is found upward, look down: wide tables are almost always wrapped in a scroll
 * container, and that container occupies exactly the edge strip the cursor crosses on
 * its way to the buttons. Without looking inside, the chips went dark on approach.
 *
 * Inside only when there is exactly one table there: in a block with three tables a
 * "copy" button that cannot say which one is useless.
 */
export function closestTable(element: Element | null): Element | null {
  for (let node = element; node; node = node.parentElement) {
    if (isTableLike(node)) return node
  }

  if (!element) return null
  const inside = element.querySelectorAll('table, [role="table"], [role="grid"], [role="treegrid"]')
  return inside.length === 1 ? inside[0]! : null
}

function isHidden(element: Element): boolean {
  if (element.getAttribute('aria-hidden') === 'true') return true
  if (element.hasAttribute('hidden')) return true

  const style = element.ownerDocument.defaultView?.getComputedStyle(element)
  if (!style) return false
  return style.display === 'none' || style.visibility === 'hidden'
}

/**
 * Cell text: tree walk instead of `textContent`.
 *
 * Hidden content is skipped entirely, descendants included: the "Sorted ascending"
 * caption sits in a `<span class="sr-only">` inside the same cell and does not belong
 * in the data. Inputs contribute their value, images their `alt`: in a cell with a
 * checkbox or status icon, that is where the meaning is.
 */
export function cellText(root: Element): string {
  const parts: string[] = []

  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(node.nodeValue ?? '')
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return

    const element = node as Element
    if (isHidden(element)) return

    if (element instanceof HTMLInputElement) {
      if (element.type === 'checkbox' || element.type === 'radio') {
        parts.push(element.checked ? 'true' : 'false')
      } else if (element.type !== 'password') {
        parts.push(element.value)
      }
      return
    }
    if (element instanceof HTMLSelectElement) {
      parts.push(element.selectedOptions[0]?.textContent ?? '')
      return
    }
    if (element instanceof HTMLTextAreaElement) {
      parts.push(element.value)
      return
    }
    if (element instanceof HTMLImageElement) {
      parts.push(element.alt)
      return
    }
    if (element.tagName === 'BR') {
      parts.push('\n')
      return
    }

    for (const child of element.childNodes) walk(child)
  }

  walk(root)

  // Line breaks inside a cell are kept, markup indentation is not: in the source a
  // cell often spans five lines, and all of that is whitespace, not data.
  return parts
    .join('')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim()
}

function alignOf(cell: Element): TableAlign | null {
  const style = cell.ownerDocument.defaultView?.getComputedStyle(cell)
  const value = style?.textAlign
  if (value === 'right' || value === 'end') return 'right'
  if (value === 'center') return 'center'
  if (value === 'left' || value === 'start') return 'left'
  return null
}

type RawCell = {
  text: string
  colSpan: number
  rowSpan: number
  header: boolean
  align: TableAlign | null
}

function spanOf(cell: Element, attribute: 'colspan' | 'rowspan'): number {
  const own =
    cell instanceof HTMLTableCellElement
      ? attribute === 'colspan'
        ? cell.colSpan
        : cell.rowSpan
      : Number(cell.getAttribute(`aria-${attribute}`) ?? cell.getAttribute(attribute) ?? 1)

  return Number.isFinite(own) && own >= 1 ? Math.min(Math.floor(own), MAX_COLUMNS) : 1
}

function isHeaderCell(cell: Element): boolean {
  return cell.tagName === 'TH' || cell.getAttribute('role') === 'columnheader'
}

/** Table rows in display order. `<tfoot>` goes last, wherever it sits in the markup. */
function rowsOf(table: Element): Element[] {
  if (table instanceof HTMLTableElement) {
    const sections = [
      ...(table.tHead ? [table.tHead] : []),
      ...table.tBodies,
      ...(table.tFoot ? [table.tFoot] : []),
    ]
    const rows = sections.flatMap((section) => [...section.rows])
    return rows.length > 0 ? rows : [...table.rows]
  }

  return [...table.querySelectorAll('[role="row"]')].filter(
    (row) => closestTable(row.parentElement) === table,
  )
}

function cellsOf(row: Element): Element[] {
  if (row instanceof HTMLTableRowElement) return [...row.cells]
  return [
    ...row.querySelectorAll(
      '[role="cell"], [role="gridcell"], [role="columnheader"], [role="rowheader"]',
    ),
  ]
}

/**
 * Expands `colspan` and `rowspan` into a rectangular grid.
 *
 * Occupied slots are marked ahead of time: a `rowspan=3` cell reserves its place in
 * the next two rows, so when their turn comes, their own cells shift right — exactly
 * as the browser lays them out.
 */
function expand(rows: readonly (readonly RawCell[])[]): { text: string[][]; header: boolean[][] } {
  const text: string[][] = []
  const header: boolean[][] = []
  /** Slots already taken by cells from above; keyed "row:column". */
  const taken = new Map<string, RawCell>()

  rows.forEach((cells, rowIndex) => {
    const line: string[] = []
    const flags: boolean[] = []
    let column = 0

    const place = (cell: RawCell) => {
      for (let dy = 0; dy < cell.rowSpan; dy += 1) {
        for (let dx = 0; dx < cell.colSpan; dx += 1) {
          if (dy === 0 && dx === 0) continue
          taken.set(`${rowIndex + dy}:${column + dx}`, cell)
        }
      }
    }

    for (const cell of cells) {
      // The slot may be taken by `rowspan` cells from rows above — move right until free.
      while (taken.has(`${rowIndex}:${column}`)) {
        const held = taken.get(`${rowIndex}:${column}`)!
        line[column] = held.text
        flags[column] = held.header
        column += 1
      }

      place(cell)
      for (let dx = 0; dx < cell.colSpan && column < MAX_COLUMNS; dx += 1) {
        line[column] = cell.text
        flags[column] = cell.header
        column += 1
      }
    }

    // The row's tail may be occupied from above too.
    while (taken.has(`${rowIndex}:${column}`)) {
      const held = taken.get(`${rowIndex}:${column}`)!
      line[column] = held.text
      flags[column] = held.header
      column += 1
    }

    text.push(line)
    header.push(flags)
  })

  const columns = Math.min(MAX_COLUMNS, Math.max(0, ...text.map((row) => row.length)))
  return {
    text: text.map((row) => Array.from({ length: columns }, (_, at) => row[at] ?? '')),
    header: header.map((row) => Array.from({ length: columns }, (_, at) => row[at] ?? false)),
  }
}

/**
 * How many leading rows form the header.
 *
 * Only solid header rows at the top count: a row mixing header cells with data is
 * already data with a row header, and must not be declared column names.
 */
function headerRowsOf(header: readonly (readonly boolean[])[]): number {
  let count = 0
  for (const row of header) {
    if (row.length === 0 || !row.every(Boolean)) break
    count += 1
  }
  // The whole table cannot be a header: then it is just a table of headings.
  return count === header.length ? 0 : count
}

export function readTable(table: Element): TableGrid | null {
  const rows = rowsOf(table)
    .slice(0, MAX_ROWS)
    .filter((row) => !isHidden(row))
  if (rows.length === 0) return null

  const raw = rows.map((row) =>
    cellsOf(row)
      .filter((cell) => !isHidden(cell))
      .map((cell): RawCell => ({
        text: cellText(cell),
        colSpan: spanOf(cell, 'colspan'),
        rowSpan: spanOf(cell, 'rowspan'),
        header: isHeaderCell(cell),
        align: alignOf(cell),
      })),
  )

  const { text, header } = expand(raw)
  if (text.length === 0 || text[0]!.length === 0) return null

  const headerRows = headerRowsOf(header)

  // Alignment comes from the first data row, not the header: headers are often
  // centred regardless of how the numbers below are aligned.
  const sample = raw[headerRows] ?? raw[0] ?? []
  const align: TableAlign[] = Array.from(
    { length: text[0]!.length },
    (_, column) => sample[column]?.align ?? 'left',
  )

  return { rows: text, headerRows, align }
}

/** Data row count for the table under the cursor: the number shown on the chip. */
export function dataRowCount(grid: TableGrid): number {
  return Math.max(0, grid.rows.length - grid.headerRows)
}
