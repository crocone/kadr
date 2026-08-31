import { describe, expect, it } from 'vitest'

import { createDoc } from '@/core/doc/create'
import type { Doc } from '@/core/doc/types'

import { getDoc, listDocs, listDocsByDomain, putDoc, type StoredDoc } from './db'

function storedDoc(overrides: Partial<StoredDoc> = {}): StoredDoc {
  const doc: Doc = createDoc({ imageId: 'img_1', imageWidth: 100, imageHeight: 80 })
  return { ...doc, domain: 'example.com', text: null, thumbnail: null, ...overrides }
}

describe('docs store', () => {
  it('round-trips a document', async () => {
    const doc = storedDoc({ title: 'Dashboard' })
    await putDoc(doc)
    expect((await getDoc(doc.id))?.title).toBe('Dashboard')
  })

  it('lists documents newest first', async () => {
    await putDoc(storedDoc({ id: 'doc_old', updatedAt: 1 }))
    await putDoc(storedDoc({ id: 'doc_new', updatedAt: 3 }))
    await putDoc(storedDoc({ id: 'doc_mid', updatedAt: 2 }))

    expect((await listDocs()).map((doc) => doc.id)).toEqual(['doc_new', 'doc_mid', 'doc_old'])
  })

  it('honours the limit', async () => {
    for (let i = 0; i < 5; i++) await putDoc(storedDoc({ id: `doc_${i}`, updatedAt: i }))
    expect(await listDocs(2)).toHaveLength(2)
  })

  it('finds documents by domain', async () => {
    await putDoc(storedDoc({ id: 'doc_a', domain: 'github.com' }))
    await putDoc(storedDoc({ id: 'doc_b', domain: 'example.com' }))

    expect((await listDocsByDomain('github.com')).map((doc) => doc.id)).toEqual(['doc_a'])
  })
})
