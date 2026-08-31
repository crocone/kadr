/**
 * Library card labels.
 *
 * A document title like "Pull requests · GitHub" says less in a feed of twenty cards
 * than the address does: `github.com/pulls` shows at a glance where the frame is from.
 * So the grid shows a short URL, and the full title stays in the tooltip and the list.
 */
import type { Doc } from '@/core/doc/types'

/** How many characters fit on a card line; the rest becomes an ellipsis. */
export const LABEL_MAX = 28

export function shortUrl(url: string, max = LABEL_MAX): string {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return ellipsis(url, max)
  }

  const host = parsed.host.replace(/^www\./, '')
  const path = decodeURI(parsed.pathname).replace(/\/$/, '')
  return ellipsis(host + path, max)
}

/** Card label: the page address, falling back to the document title. */
export function shotLabel(doc: Doc, max = LABEL_MAX): string {
  return doc.source?.url ? shortUrl(doc.source.url, max) : ellipsis(doc.title, max)
}

/**
 * Ellipsis truncation. The tail is cut, not the middle: for a URL the start matters —
 * domain plus first path segment already identify the page.
 */
function ellipsis(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`
}
