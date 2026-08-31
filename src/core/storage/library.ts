/**
 * Screenshot library: search by domain, date, tags, and OCR text.
 *
 * Filtering happens in memory, not via DB indexes: an index answers "equals", the
 * question here is "contains" across five fields at once. One person has thousands of
 * docs, not millions, so an extra array pass is cheaper than five indexes we'd have
 * to intersect by hand anyway.
 */
import type { Doc, DocId, ImageId } from '@/core/doc/types'

import { deleteDoc, deleteImage, getDoc, listDocs, putDoc, type StoredDoc } from './db'

/** How many docs are loaded from the DB at once: the page paginates from there. */
export const LIBRARY_PAGE_SIZE = 200

export type LibraryQuery = {
  /** Free text: title, domain, URL, tags, and OCR text. */
  text?: string
  /**
   * Domains and tags are lists, not single values: the sidebar shows them as
   * checkboxes, and "habr.com or figma.com" is asked more often than one site.
   * OR within a list, AND between lists — how any checkbox filter works.
   */
  domains?: readonly string[] | null
  tags?: readonly string[] | null
  /** Only shots with something drawn on them. */
  annotated?: boolean
  /** Inclusive bounds on the edit date. */
  from?: number | null
  to?: number | null
}

export type Facet = { value: string; count: number }

/**
 * Quick-filter shelves in the sidebar. Not the same as domains and tags: a shelf
 * answers "what kind of shot is this", not "where is it from".
 */
export type Shelf = 'all' | 'today' | 'media' | 'annotated'

export const SHELVES: readonly Shelf[] = ['all', 'today', 'media', 'annotated']

/**
 * The `media` shelf is visible but empty and disabled: the doc model has no video or
 * GIF yet — screen recording ships with 1.1. Removing it from the list would mean
 * reshaping the sidebar when it arrives.
 */
export function isShelfReady(shelf: Shelf): boolean {
  return shelf !== 'media'
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Midnight of the day containing the moment. Local time, not UTC. */
export function startOfDay(at: number): number {
  const date = new Date(at)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/**
 * Days back from today: 0 — today, 1 — yesterday. Computed between midnights and
 * rounded — otherwise a DST switch adds an hour to the day and shifts yesterday's
 * shots into the day before.
 */
export function dayOffset(day: number, now: number): number {
  return Math.round((startOfDay(now) - startOfDay(day)) / DAY_MS)
}

/** What a shelf translates to as a query. The `today` shelf gets its date from outside. */
export function shelfQuery(shelf: Shelf, now: number): LibraryQuery {
  switch (shelf) {
    case 'today':
      return { from: startOfDay(now) }
    case 'annotated':
      return { annotated: true }
    case 'media':
      // Nothing to select: the shelf is disabled and its query must not match anything.
      return { from: Number.MAX_SAFE_INTEGER }
    case 'all':
      return {}
  }
}

/** Tags are normalized on input: otherwise "Bug", "bug " and "bug" are three different tags. */
export function normalizeTag(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 32)
}

function haystack(doc: StoredDoc): string {
  return [doc.title, doc.domain, doc.source?.url ?? '', doc.tags.join(' '), doc.text ?? '']
    .join('\n')
    .toLowerCase()
}

/**
 * Query terms are ANDed: "github badge" finds a doc containing both, even across
 * different fields — that's how mail and file search work, and what people expect.
 */
export function matchesQuery(doc: StoredDoc, query: LibraryQuery): boolean {
  if (query.domains?.length && !query.domains.includes(doc.domain)) return false
  if (query.tags?.length && !query.tags.some((tag) => doc.tags.includes(tag))) return false
  if (query.annotated && doc.layers.length === 0) return false
  if (typeof query.from === 'number' && doc.updatedAt < query.from) return false
  if (typeof query.to === 'number' && doc.updatedAt > query.to) return false

  const terms = (query.text ?? '').toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return true

  const text = haystack(doc)
  return terms.every((term) => text.includes(term))
}

/** Pure filter: newest first, independent of the order the DB returned docs in. */
export function searchDocs(docs: readonly StoredDoc[], query: LibraryQuery): StoredDoc[] {
  return docs.filter((doc) => matchesQuery(doc, query)).sort((a, b) => b.updatedAt - a.updatedAt)
}

export type ShelfCounts = Record<Shelf, number>

/** Shot count per shelf. Computed over the whole library, not the filtered subset. */
export function shelfCounts(docs: readonly StoredDoc[], now: number): ShelfCounts {
  const counts = {} as ShelfCounts
  for (const shelf of SHELVES) {
    counts[shelf] = docs.filter((doc) => matchesQuery(doc, shelfQuery(shelf, now))).length
  }
  return counts
}

export type DayGroup = { day: number; docs: StoredDoc[] }

/**
 * Feed split by day. Input order is kept: `searchDocs` sorted it, and sorting again
 * here would mean two competing orders.
 */
export function groupByDay(docs: readonly StoredDoc[]): DayGroup[] {
  const groups: DayGroup[] = []
  for (const doc of docs) {
    const day = startOfDay(doc.updatedAt)
    const last = groups.at(-1)
    if (last?.day === day) last.docs.push(doc)
    else groups.push({ day, docs: [doc] })
  }
  return groups
}

export async function searchLibrary(
  query: LibraryQuery = {},
  limit = LIBRARY_PAGE_SIZE,
): Promise<StoredDoc[]> {
  return searchDocs(await listDocs(limit), query)
}

function facets(values: readonly string[]): Facet[] {
  const counts = new Map<string, number>()
  for (const value of values) if (value) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
}

/** Domains and tags for sidebar filters: most frequent first, ties alphabetical. */
export function collectDomains(docs: readonly StoredDoc[]): Facet[] {
  return facets(docs.map((doc) => doc.domain))
}

export function collectTags(docs: readonly StoredDoc[]): Facet[] {
  return facets(docs.flatMap((doc) => doc.tags))
}

/**
 * Every image a doc references: frame, layers, background, custom mockup, and past
 * frames from the reshoot history.
 *
 * History must be included. No renderer looks at it, so it's easy to forget here —
 * and the price is that deleting a doc leaves its old frames in the DB forever,
 * unreferenced and unfindable.
 */
export function imageIdsOf(doc: Doc): ImageId[] {
  const ids = new Set<ImageId>()
  if (doc.capture.imageId) ids.add(doc.capture.imageId)
  for (const version of doc.history ?? []) ids.add(version.imageId)
  if (doc.canvas.background.kind === 'image') ids.add(doc.canvas.background.imageId)
  if (doc.canvas.customMockup) ids.add(doc.canvas.customMockup.imageId)
  for (const layer of doc.layers) {
    if (layer.kind !== 'image') continue
    ids.add(layer.imageId)
    if (layer.decoration?.customMockup) ids.add(layer.decoration.customMockup.imageId)
  }
  return [...ids]
}

async function updateDoc(id: DocId, patch: (doc: StoredDoc) => StoredDoc): Promise<void> {
  const doc = await getDoc(id)
  if (!doc) return
  await putDoc(patch(doc))
}

/**
 * Tags and title are edited right in the library, no editor needed: they're search
 * metadata, not styling. `updatedAt` stays untouched — otherwise renaming would bump
 * the doc to the top of the feed.
 */
export async function setDocTags(id: DocId, tags: readonly string[]): Promise<void> {
  const unique = [...new Set(tags.map(normalizeTag).filter(Boolean))]
  await updateDoc(id, (doc) => ({ ...doc, tags: unique }))
}

export async function renameDoc(id: DocId, title: string): Promise<void> {
  const trimmed = title.trim()
  if (!trimmed) return
  await updateDoc(id, (doc) => ({ ...doc, title: trimmed }))
}

/** OCR text is stored on the doc: the library searches it. */
export async function setDocText(id: DocId, text: string): Promise<void> {
  await updateDoc(id, (doc) => ({ ...doc, text }))
}

/**
 * Delete a doc together with its frames. An image isn't held only by its own doc: a
 * responsive-series frame sits as a layer in several docs at once, and deleting it
 * while still referenced would punch a hole in someone else's document.
 */
export async function removeDoc(id: DocId): Promise<void> {
  const doc = await getDoc(id)
  if (!doc) return

  const others = (await listDocs(Number.MAX_SAFE_INTEGER)).filter((other) => other.id !== id)
  const stillUsed = new Set(others.flatMap(imageIdsOf))

  await deleteDoc(id)
  for (const imageId of imageIdsOf(doc)) {
    if (!stillUsed.has(imageId)) await deleteImage(imageId)
  }
}
