/**
 * Grid to CSV, Markdown, and JSON.
 *
 * Input is a rectangular grid of strings — `colspan`/`rowspan` already expanded,
 * service labels already stripped. Only formatting happens here, no DOM access: all
 * the quoting, pipes, and newline fiddling is verified by tests, not by eyeballing
 * a file pasted into Excel.
 */

export type TableAlign = 'left' | 'center' | 'right'

export type TableGrid = {
  /** Rows, including the header row if any. */
  rows: string[][]
  /** How many leading rows are the header. 0 — no header. */
  headerRows: number
  /** Per-column alignment: taken from `text-align`, not guessed from the data. */
  align: TableAlign[]
}

export type TableFormat = 'csv' | 'markdown' | 'json'

/**
 * RFC 4180: a field is quoted when it contains a comma, quote, or newline; inner
 * quotes are doubled. Quoted newlines survive, and Excel reads such a cell as
 * multi-line — exactly how it looked on the page.
 */
function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/**
 * CSV with CRLF: the RFC requires it, and it's the only line ending that Excel on
 * Windows, Numbers, and Google Sheets all read the same way.
 */
export function toCsv(grid: TableGrid): string {
  return grid.rows.map((row) => row.map(csvField).join(',')).join('\r\n')
}

/** In a Markdown cell a pipe breaks the markup, a newline breaks the whole table. */
function markdownCell(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>')
}

const DASHES: Record<TableAlign, (width: number) => string> = {
  left: (width) => ':'.padEnd(width, '-'),
  center: (width) => `:${'-'.repeat(Math.max(1, width - 2))}:`,
  right: (width) => '-'.repeat(Math.max(1, width - 1)) + ':',
}

/**
 * Markdown table with width-aligned columns.
 *
 * Even columns are for the human, not the parser: the pasted table usually goes into
 * a file that's later read and edited by hand, and ragged markup is unreadable there.
 * The separator row carries the alignment the page had.
 *
 * A headerless table gets its first row promoted: Markdown tables can't exist without
 * a header, and pretending otherwise produces markup nothing will render.
 */
export function toMarkdown(grid: TableGrid): string {
  if (grid.rows.length === 0) return ''

  const cells = grid.rows.map((row) => row.map(markdownCell))
  const columns = Math.max(...cells.map((row) => row.length))
  const padded = cells.map((row) => [...row, ...Array<string>(columns - row.length).fill('')])

  const widths = Array.from({ length: columns }, (_, column) =>
    Math.max(3, ...padded.map((row) => [...row[column]!].length)),
  )
  const align = (value: string, column: number): string => {
    const pad = widths[column]! - [...value].length
    if (grid.align[column] === 'right') return ' '.repeat(pad) + value
    if (grid.align[column] === 'center') {
      const left = Math.floor(pad / 2)
      return ' '.repeat(left) + value + ' '.repeat(pad - left)
    }
    return value + ' '.repeat(pad)
  }

  const line = (row: string[]): string =>
    `| ${row.map((value, column) => align(value, column)).join(' | ')} |`

  const header = Math.max(1, grid.headerRows)
  const rule = `| ${widths
    .map((width, column) => DASHES[grid.align[column] ?? 'left'](width))
    .join(' | ')} |`

  return [...padded.slice(0, header).map(line), rule, ...padded.slice(header).map(line)].join('\n')
}

/** An empty header or two identical ones would make some columns unreachable. */
function jsonKeys(header: readonly string[]): string[] {
  const used = new Map<string, number>()
  return header.map((raw, column) => {
    const base = raw.trim() || `column${column + 1}`
    const seen = used.get(base) ?? 0
    used.set(base, seen + 1)
    return seen === 0 ? base : `${base} (${seen + 1})`
  })
}

/**
 * JSON: array of objects keyed by the header, or array of arrays without one.
 *
 * Unlike Markdown, the first data row must NOT be promoted to a header here: in a
 * headerless table it's a record like any other, and turning it into field names
 * would lose its contents.
 */
export function toJson(grid: TableGrid): string {
  if (grid.headerRows === 0) return JSON.stringify(grid.rows, null, 2)

  // A multi-level header is joined into one name: "Q1 · Revenue" reads fine, a
  // two-level nested object does not.
  const header = grid.rows[0]!.map((_, column) =>
    grid.rows
      .slice(0, grid.headerRows)
      .map((row) => row[column] ?? '')
      .filter((part, at, parts) => part && parts.indexOf(part) === at)
      .join(' · '),
  )

  const keys = jsonKeys(header)
  const records = grid.rows
    .slice(grid.headerRows)
    .map((row) => Object.fromEntries(keys.map((key, column) => [key, row[column] ?? ''])))

  return JSON.stringify(records, null, 2)
}

export function formatTable(grid: TableGrid, format: TableFormat): string {
  if (format === 'csv') return toCsv(grid)
  if (format === 'markdown') return toMarkdown(grid)
  return toJson(grid)
}

export const MIME_TYPES: Record<TableFormat, string> = {
  csv: 'text/csv',
  markdown: 'text/markdown',
  json: 'application/json',
}
