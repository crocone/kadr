/**
 * IndexedDB holds frame blobs, documents, and presets. The MV3 service worker gets
 * suspended, so state never lives in its memory.
 */
import { type DBSchema, type IDBPDatabase, openDB } from 'idb'

import type { StylePreset } from '@/core/doc/style-presets'
import type { Doc, DocId, ImageId } from '@/core/doc/types'
import type { GuideId, ScribeSession, ScribeStep, StepId } from '@/core/scribe/timeline'

export const DB_NAME = 'kadr'
/** 2 — Scribe: recorded steps and built guides. */
export const DB_VERSION = 2

export type StoredImage = {
  id: ImageId
  blob: Blob
  width: number
  height: number
  /** devicePixelRatio the frame was captured at: 1x, 2x, or 3x. */
  dpr: number
  createdAt: number
  source: { url: string; title: string; domain: string } | null
}

/**
 * Named "background + shadow + border + padding + radius" bundle.
 * What a style contains is decided (and parsed) by `core/doc/style-presets`.
 */
export type StoredPreset = StylePreset

export type StoredDoc = Doc & {
  /** Domain lifted out of `source`: the library index is built on it. */
  domain: string
  /** OCR-recognized text — used for library search (phase 5). */
  text: string | null
  thumbnail: Blob | null
}

export interface KadrDB extends DBSchema {
  images: {
    key: ImageId
    value: StoredImage
    indexes: { 'by-createdAt': number }
  }
  docs: {
    key: DocId
    value: StoredDoc
    indexes: { 'by-updatedAt': number; 'by-domain': string; 'by-tag': string }
  }
  presets: {
    key: string
    value: StoredPreset
    indexes: { 'by-createdAt': number }
  }
  /**
   * Scribe guides and their steps — two stores, not one array field.
   *
   * A step is written the moment it happens: the session must survive both link
   * navigation and service-worker suspension. Embedding steps in the session would
   * mean reading and rewriting the whole record on every click.
   */
  guides: {
    key: GuideId
    value: ScribeSession
    indexes: { 'by-updatedAt': number }
  }
  steps: {
    key: StepId
    value: ScribeStep
    indexes: { 'by-guide': GuideId }
  }
}

let dbPromise: Promise<IDBPDatabase<KadrDB>> | null = null

export function getDb(): Promise<IDBPDatabase<KadrDB>> {
  dbPromise ??= openDB<KadrDB>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        const images = db.createObjectStore('images', { keyPath: 'id' })
        images.createIndex('by-createdAt', 'createdAt')

        const docs = db.createObjectStore('docs', { keyPath: 'id' })
        docs.createIndex('by-updatedAt', 'updatedAt')
        docs.createIndex('by-domain', 'domain')
        docs.createIndex('by-tag', 'tags', { multiEntry: true })

        const presets = db.createObjectStore('presets', { keyPath: 'id' })
        presets.createIndex('by-createdAt', 'createdAt')
      }

      // Version 1 docs stay as they are: `recipe` and `history` were added as optional
      // fields, and IndexedDB returns records exactly as stored.
      if (oldVersion < 2) {
        const guides = db.createObjectStore('guides', { keyPath: 'id' })
        guides.createIndex('by-updatedAt', 'updatedAt')

        const steps = db.createObjectStore('steps', { keyPath: 'id' })
        steps.createIndex('by-guide', 'guideId')
      }
    },
  })
  return dbPromise
}

/**
 * Test-only: closes the connection and resets memoization.
 * Without close(), deleting the DB between tests is blocked by the open connection.
 */
export async function resetDbForTests(): Promise<void> {
  const db = await dbPromise?.catch(() => null)
  db?.close()
  dbPromise = null
}

export async function putImage(image: StoredImage): Promise<ImageId> {
  return (await getDb()).put('images', image)
}

export async function getImage(id: ImageId): Promise<StoredImage | undefined> {
  return (await getDb()).get('images', id)
}

export async function deleteImage(id: ImageId): Promise<void> {
  return (await getDb()).delete('images', id)
}

export async function putDoc(doc: StoredDoc): Promise<DocId> {
  return (await getDb()).put('docs', doc)
}

export async function getDoc(id: DocId): Promise<StoredDoc | undefined> {
  return (await getDb()).get('docs', id)
}

export async function deleteDoc(id: DocId): Promise<void> {
  return (await getDb()).delete('docs', id)
}

/** Library and recents feed: newest first. */
export async function listDocs(limit = 50): Promise<StoredDoc[]> {
  const db = await getDb()
  const found: StoredDoc[] = []
  let cursor = await db.transaction('docs').store.index('by-updatedAt').openCursor(null, 'prev')
  while (cursor && found.length < limit) {
    found.push(cursor.value)
    cursor = await cursor.continue()
  }
  return found
}

export async function listDocsByDomain(domain: string): Promise<StoredDoc[]> {
  return (await getDb()).getAllFromIndex('docs', 'by-domain', domain)
}

export async function putPreset(preset: StoredPreset): Promise<string> {
  return (await getDb()).put('presets', preset)
}

export async function listPresets(): Promise<StoredPreset[]> {
  return (await getDb()).getAllFromIndex('presets', 'by-createdAt')
}

export async function deletePreset(id: string): Promise<void> {
  return (await getDb()).delete('presets', id)
}

export async function putGuide(session: ScribeSession): Promise<GuideId> {
  return (await getDb()).put('guides', session)
}

export async function getGuide(id: GuideId): Promise<ScribeSession | undefined> {
  return (await getDb()).get('guides', id)
}

export async function listGuides(): Promise<ScribeSession[]> {
  const guides = await (await getDb()).getAllFromIndex('guides', 'by-updatedAt')
  return guides.reverse()
}

export async function putStep(step: ScribeStep): Promise<StepId> {
  return (await getDb()).put('steps', step)
}

export async function putSteps(steps: readonly ScribeStep[]): Promise<void> {
  const tx = (await getDb()).transaction('steps', 'readwrite')
  await Promise.all([...steps.map((step) => tx.store.put(step)), tx.done])
}

export async function listSteps(guideId: GuideId): Promise<ScribeStep[]> {
  const steps = await (await getDb()).getAllFromIndex('steps', 'by-guide', guideId)
  return steps.sort((a, b) => a.index - b.index || a.at - b.at)
}

export async function deleteStep(id: StepId): Promise<void> {
  return (await getDb()).delete('steps', id)
}

/**
 * Delete a whole guide. Step documents are left alone: a built step is a regular shot
 * living its own life in the library. Frames that never got built, though, are held by
 * nothing else — keeping them would clutter the DB forever.
 */
export async function deleteGuide(id: GuideId): Promise<ImageId[]> {
  const steps = await listSteps(id)
  const orphaned = steps.filter((step) => step.imageId && !step.docId).map((step) => step.imageId!)

  const db = await getDb()
  const tx = db.transaction(['guides', 'steps'], 'readwrite')
  await Promise.all([
    tx.objectStore('guides').delete(id),
    ...steps.map((step) => tx.objectStore('steps').delete(step.id)),
    tx.done,
  ])

  return orphaned
}
