import { describe, expect, it } from 'vitest'

import { createDoc } from '@/core/doc/create'
import type { Doc } from '@/core/doc/types'

import { shortUrl, shotLabel } from './label'

function docWith(source: Doc['source'], title = 'Untitled'): Doc {
  return { ...createDoc({ imageId: 'img_1', imageWidth: 10, imageHeight: 10 }), source, title }
}

describe('shortUrl', () => {
  it('keeps the host and the path, and drops the rest', () => {
    expect(shortUrl('https://habr.com/ru/feed?page=2#top')).toBe('habr.com/ru/feed')
  })

  it('drops www and the trailing slash', () => {
    expect(shortUrl('https://www.figma.com/file/')).toBe('figma.com/file')
  })

  it('reads a percent-encoded path back into letters', () => {
    expect(shortUrl('https://notion.so/plan')).toBe('notion.so/plan')
  })

  it('cuts the tail rather than the host', () => {
    expect(shortUrl('https://github.com/anthropic/very-long-repository/pulls', 20)).toBe(
      'github.com/anthropi…',
    )
  })

  it('shows what it got when the address is not an address', () => {
    expect(shortUrl('not a url')).toBe('not a url')
  })
})

describe('shotLabel', () => {
  it('prefers the address of the page', () => {
    const doc = docWith({ url: 'https://github.com/pulls', title: 'Pulls', domain: 'github.com' })
    expect(shotLabel(doc)).toBe('github.com/pulls')
  })

  it('falls back to the title for a shot with no page behind it', () => {
    expect(shotLabel(docWith(null, 'Pasted image'))).toBe('Pasted image')
  })
})
