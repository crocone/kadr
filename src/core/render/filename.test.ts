import { describe, expect, it } from 'vitest'

import { buildFilename, FILENAME_MAX_LENGTH, slugify } from './filename'

const DATE = new Date(2026, 7, 30, 14, 5, 9)

describe('slugify', () => {
  it('keeps latin and digits', () => {
    expect(slugify('GitHub Pull Request 42')).toBe('github-pull-request-42')
  })

  it('transliterates cyrillic, so the name stays typable', () => {
    expect(slugify('Моя лента')).toBe('moya-lenta')
    expect(slugify('Хабр')).toBe('habr')
  })

  it('collapses punctuation and trims the edges', () => {
    expect(slugify('  ...Hello, world!  ')).toBe('hello-world')
  })
})

describe('buildFilename', () => {
  it('fills the default template', () => {
    const name = buildFilename(
      '{domain}-{title}-{date}',
      {
        domain: 'github.com',
        title: 'Pull Request',
        date: DATE,
      },
      'png',
    )

    expect(name).toBe('github-com-pull-request-2026-08-30.png')
  })

  it('leaves no gap when a field is empty', () => {
    const name = buildFilename(
      '{domain}-{title}-{date}',
      {
        domain: '',
        title: '',
        date: DATE,
      },
      'png',
    )

    expect(name).toBe('2026-08-30.png')
  })

  it('supports a time field for several shots a day', () => {
    const name = buildFilename(
      '{title}-{time}',
      {
        domain: 'x.com',
        title: 'Feed',
        date: DATE,
      },
      'jpg',
    )

    expect(name).toBe('feed-140509.jpg')
  })

  it('leaves an unknown placeholder visible rather than silently dropping it', () => {
    const name = buildFilename('{nope}-{date}', { domain: 'a', title: 'b', date: DATE }, 'png')
    expect(name).toContain('nope')
  })

  it('never produces an empty name', () => {
    expect(buildFilename('{domain}', { domain: '', title: '', date: DATE }, 'png')).toBe('kadr.png')
  })

  it('caps the length, because file systems do too', () => {
    const name = buildFilename('{title}', { domain: '', title: 'x'.repeat(400), date: DATE }, 'png')
    expect(name.length).toBeLessThanOrEqual(FILENAME_MAX_LENGTH + 4)
  })

  it('strips characters that are illegal in a path', () => {
    const name = buildFilename(
      '{title}',
      {
        domain: '',
        title: 'a/b|c:d*e?f"g<h>i-j',
        date: DATE,
      },
      'png',
    )

    expect(name).not.toMatch(/[/:*?"<>|]/)
  })
})
