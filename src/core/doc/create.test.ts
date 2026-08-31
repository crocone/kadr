import { describe, expect, it } from 'vitest'

import { createDoc, domainOf } from './create'
import { DEFAULT_CANVAS } from './defaults'

describe('domainOf', () => {
  it('strips the www prefix', () => {
    expect(domainOf('https://www.github.com/a/b')).toBe('github.com')
  })

  it('returns an empty string for a non-URL', () => {
    expect(domainOf('not a url')).toBe('')
  })
})

describe('createDoc', () => {
  it('sizes the canvas to the frame plus padding on both sides', () => {
    const doc = createDoc({ imageId: 'img_1', imageWidth: 800, imageHeight: 600 })
    expect(doc.canvas.w).toBe(800 + DEFAULT_CANVAS.padding * 2)
    expect(doc.canvas.h).toBe(600 + DEFAULT_CANVAS.padding * 2)
  })

  it('takes the title from the captured page when none is given', () => {
    const doc = createDoc({
      imageId: 'img_1',
      imageWidth: 10,
      imageHeight: 10,
      source: { url: 'https://example.com/x', title: 'Example page', domain: 'example.com' },
    })
    expect(doc.title).toBe('Example page')
    expect(doc.capture.imageId).toBe('img_1')
    expect(doc.layers).toEqual([])
  })

  it('stamps both timestamps from the same clock reading', () => {
    const doc = createDoc({ imageId: 'img_1', imageWidth: 10, imageHeight: 10, now: 1_700_000_000 })
    expect(doc.createdAt).toBe(1_700_000_000)
    expect(doc.updatedAt).toBe(1_700_000_000)
  })
})
