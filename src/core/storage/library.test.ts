import { describe, expect, it } from 'vitest'

import { createDoc } from '@/core/doc/create'
import { DEFAULT_CANVAS } from '@/core/doc/defaults'
import type { ImageLayer } from '@/core/doc/types'

import { getDoc, getImage, putDoc, putImage, type StoredDoc } from './db'
import {
  collectDomains,
  collectTags,
  dayOffset,
  groupByDay,
  imageIdsOf,
  isShelfReady,
  matchesQuery,
  normalizeTag,
  removeDoc,
  renameDoc,
  searchDocs,
  searchLibrary,
  setDocTags,
  setDocText,
  shelfCounts,
  shelfQuery,
  startOfDay,
} from './library'

function storedDoc(overrides: Partial<StoredDoc> = {}): StoredDoc {
  const doc = createDoc({ imageId: 'img_1', imageWidth: 100, imageHeight: 80 })
  return { ...doc, domain: 'example.com', text: null, thumbnail: null, ...overrides }
}

describe('matchesQuery', () => {
  const doc = storedDoc({
    title: 'Pull request',
    domain: 'github.com',
    tags: ['bug', 'ui'],
    text: 'Checks have failed',
    updatedAt: 500,
    source: { url: 'https://github.com/a/b/pull/2', title: 'Pull request', domain: 'github.com' },
  })

  it('takes an empty query as a match', () => {
    expect(matchesQuery(doc, {})).toBe(true)
  })

  it('searches the title, the domain, the url, the tags and the recognised text', () => {
    for (const text of ['pull', 'github', '/pull/2', 'bug', 'failed']) {
      expect(matchesQuery(doc, { text })).toBe(true)
    }
    expect(matchesQuery(doc, { text: 'invoice' })).toBe(false)
  })

  it('joins the words of the query with AND across fields', () => {
    expect(matchesQuery(doc, { text: 'github failed' })).toBe(true)
    expect(matchesQuery(doc, { text: 'github invoice' })).toBe(false)
  })

  it('filters by domain, tag and date range', () => {
    expect(matchesQuery(doc, { domains: ['github.com'] })).toBe(true)
    expect(matchesQuery(doc, { domains: ['example.com'] })).toBe(false)
    expect(matchesQuery(doc, { tags: ['ui'] })).toBe(true)
    expect(matchesQuery(doc, { tags: ['docs'] })).toBe(false)
    expect(matchesQuery(doc, { from: 400, to: 600 })).toBe(true)
    expect(matchesQuery(doc, { from: 600 })).toBe(false)
    expect(matchesQuery(doc, { to: 400 })).toBe(false)
  })

  it('takes an empty list of domains as no filter at all', () => {
    expect(matchesQuery(doc, { domains: [] })).toBe(true)
    expect(matchesQuery(doc, { tags: [] })).toBe(true)
  })

  it('joins several domains by OR, and the domain with the tag by AND', () => {
    expect(matchesQuery(doc, { domains: ['github.com', 'figma.com'] })).toBe(true)
    expect(matchesQuery(doc, { domains: ['stripe.com', 'figma.com'] })).toBe(false)
    expect(matchesQuery(doc, { domains: ['github.com'], tags: ['docs'] })).toBe(false)
  })

  it('keeps only annotated shots when asked', () => {
    expect(matchesQuery(doc, { annotated: true })).toBe(false)
    const drawn = { ...doc, layers: [{ id: 'l1' }] } as typeof doc
    expect(matchesQuery(drawn, { annotated: true })).toBe(true)
  })
})

describe('shelves', () => {
  // Noon: shelves are computed from local midnight, an hour either way must not matter.
  const now = new Date(2026, 7, 31, 12).getTime()
  const docs = [
    storedDoc({ id: 'today_plain', updatedAt: new Date(2026, 7, 31, 9).getTime() }),
    storedDoc({
      id: 'today_drawn',
      updatedAt: new Date(2026, 7, 31, 10).getTime(),
      layers: [{ id: 'l1' }] as never,
    }),
    storedDoc({ id: 'yesterday', updatedAt: new Date(2026, 7, 30, 23).getTime() }),
  ]

  it('counts what each shelf holds', () => {
    expect(shelfCounts(docs, now)).toEqual({ all: 3, today: 2, media: 0, annotated: 1 })
  })

  it('leaves the media shelf empty until there is video to put on it', () => {
    expect(isShelfReady('media')).toBe(false)
    expect(searchDocs(docs, shelfQuery('media', now))).toEqual([])
  })

  it('measures days from midnight, so an hour before midnight is yesterday', () => {
    expect(dayOffset(new Date(2026, 7, 31, 23).getTime(), now)).toBe(0)
    expect(dayOffset(new Date(2026, 7, 30, 23).getTime(), now)).toBe(1)
  })

  it('breaks the feed into days without reordering it', () => {
    const groups = groupByDay(searchDocs(docs, {}))
    expect(groups.map((group) => group.docs.map((doc) => doc.id))).toEqual([
      ['today_drawn', 'today_plain'],
      ['yesterday'],
    ])
    expect(groups[0]?.day).toBe(startOfDay(now))
  })
})

describe('searchDocs', () => {
  it('puts the freshest first regardless of the incoming order', () => {
    const docs = [
      storedDoc({ id: 'doc_old', updatedAt: 1 }),
      storedDoc({ id: 'doc_new', updatedAt: 3 }),
      storedDoc({ id: 'doc_mid', updatedAt: 2 }),
    ]
    expect(searchDocs(docs, {}).map((doc) => doc.id)).toEqual(['doc_new', 'doc_mid', 'doc_old'])
  })
})

describe('facets', () => {
  const docs = [
    storedDoc({ id: 'a', domain: 'github.com', tags: ['bug'] }),
    storedDoc({ id: 'b', domain: 'github.com', tags: ['bug', 'ui'] }),
    storedDoc({ id: 'c', domain: 'linear.app', tags: [] }),
  ]

  it('counts domains and tags, frequent first', () => {
    expect(collectDomains(docs)).toEqual([
      { value: 'github.com', count: 2 },
      { value: 'linear.app', count: 1 },
    ])
    expect(collectTags(docs)).toEqual([
      { value: 'bug', count: 2 },
      { value: 'ui', count: 1 },
    ])
  })
})

describe('normalizeTag', () => {
  it('brings a tag to one shape', () => {
    expect(normalizeTag('  Bug  Report ')).toBe('bug report')
    expect(normalizeTag('UI')).toBe('ui')
  })
})

describe('imageIdsOf', () => {
  it('collects the frame, the layers, the background and the custom mockup', () => {
    const layer: ImageLayer = {
      id: 'layer_1',
      kind: 'image',
      name: 'Shot',
      visible: true,
      locked: false,
      opacity: 1,
      rotation: 0,
      imageId: 'img_layer',
      rect: { x: 0, y: 0, w: 10, h: 10 },
      decoration: null,
    }
    const doc = storedDoc({
      layers: [layer],
      canvas: {
        ...DEFAULT_CANVAS,
        background: { kind: 'image', imageId: 'img_bg', fit: 'cover' },
        customMockup: { imageId: 'img_mockup', screen: { x: 0, y: 0, w: 1, h: 1 } },
      },
    })

    expect(imageIdsOf(doc).sort()).toEqual(['img_1', 'img_bg', 'img_layer', 'img_mockup'])
  })
})

describe('library storage', () => {
  it('searches what the database holds', async () => {
    await putDoc(storedDoc({ id: 'doc_a', title: 'Dashboard', domain: 'github.com' }))
    await putDoc(storedDoc({ id: 'doc_b', title: 'Invoice', domain: 'stripe.com' }))

    expect((await searchLibrary({ text: 'invoice' })).map((doc) => doc.id)).toEqual(['doc_b'])
  })

  it('normalises tags and keeps them unique', async () => {
    const doc = storedDoc({ id: 'doc_a' })
    await putDoc(doc)
    await setDocTags('doc_a', ['Bug', ' bug ', 'UI', ''])

    expect((await getDoc('doc_a'))?.tags).toEqual(['bug', 'ui'])
  })

  it('renames without moving the document up the feed', async () => {
    await putDoc(storedDoc({ id: 'doc_a', title: 'Untitled', updatedAt: 7 }))
    await renameDoc('doc_a', '  Release notes  ')

    const stored = await getDoc('doc_a')
    expect(stored?.title).toBe('Release notes')
    expect(stored?.updatedAt).toBe(7)
  })

  it('keeps the recognised text next to the document', async () => {
    await putDoc(storedDoc({ id: 'doc_a' }))
    await setDocText('doc_a', 'Checks have failed')

    expect((await searchLibrary({ text: 'checks' })).map((doc) => doc.id)).toEqual(['doc_a'])
  })

  it('deletes the frames the document held alone', async () => {
    const image = { blob: new Blob(), width: 1, height: 1, dpr: 1, createdAt: 0, source: null }
    await putImage({ ...image, id: 'img_own' })
    await putImage({ ...image, id: 'img_shared' })
    await putDoc(
      storedDoc({ id: 'doc_a', capture: { ...storedDoc().capture, imageId: 'img_own' } }),
    )
    await putDoc(
      storedDoc({ id: 'doc_b', capture: { ...storedDoc().capture, imageId: 'img_shared' } }),
    )

    // The second doc references the shared frame via a layer — so it must not be deleted.
    const shared = await getDoc('doc_a')
    if (shared) {
      await putDoc({
        ...shared,
        layers: [
          {
            id: 'layer_1',
            kind: 'image',
            name: 'Shot',
            visible: true,
            locked: false,
            opacity: 1,
            rotation: 0,
            imageId: 'img_shared',
            rect: { x: 0, y: 0, w: 1, h: 1 },
            decoration: null,
          },
        ],
      })
    }

    await removeDoc('doc_a')

    expect(await getDoc('doc_a')).toBeUndefined()
    expect(await getImage('img_own')).toBeUndefined()
    expect(await getImage('img_shared')).toBeDefined()
  })
})
