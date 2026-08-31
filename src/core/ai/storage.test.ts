import { describe, expect, it } from 'vitest'

import { cacheKeyFor, CACHE_LIMIT, createCache, trim } from './cache'
import { displayName, isRunnable, newPrompt, remove, upsert } from './prompts'
import { addUsage, emptySpend, readSpend, recordSpend, resetSpend } from './spend'
import type { AiConfig, AiRequest, AiResult } from './types'

const config: AiConfig = {
  transport: 'byok',
  baseUrl: 'https://api.example.com/v1',
  model: 'some-model',
  apiKey: 'sk-test',
}

const request: AiRequest = { prompt: 'Что тут?', image: null, output: 'text' }
const result: AiResult = { text: 'Готово', usage: { input: 1, output: 1 }, cached: false }

describe('cacheKeyFor', () => {
  it('gives the same request the same key', async () => {
    expect(await cacheKeyFor(config, request)).toBe(await cacheKeyFor(config, request))
  })

  // Anything that affects the answer must affect the key — or the cache serves the wrong thing.
  it('changes with the model, the prompt, the output kind and the picture', async () => {
    const base = await cacheKeyFor(config, request)

    expect(await cacheKeyFor({ ...config, model: 'other' }, request)).not.toBe(base)
    expect(await cacheKeyFor(config, { ...request, prompt: 'иначе' })).not.toBe(base)
    expect(await cacheKeyFor(config, { ...request, output: 'json' })).not.toBe(base)
    expect(
      await cacheKeyFor(config, { ...request, image: { base64: 'AAA', mediaType: 'image/png' } }),
    ).not.toBe(base)
  })

  // The cache key must not depend on the API key: change the key, keep the cache.
  it('ignores the api key', async () => {
    expect(await cacheKeyFor({ ...config, apiKey: 'other' }, request)).toBe(
      await cacheKeyFor(config, request),
    )
  })
})

describe('trim', () => {
  it('keeps the newest entries', () => {
    const entries = {
      old: { result, at: 1 },
      fresh: { result, at: 3 },
      middle: { result, at: 2 },
    }

    expect(Object.keys(trim(entries, 2))).toEqual(['fresh', 'middle'])
  })

  it('leaves a short cache alone', () => {
    const entries = { a: { result, at: 1 } }

    expect(trim(entries)).toEqual(entries)
  })
})

describe('createCache', () => {
  it('gives back what it stored', async () => {
    const cache = createCache()
    await cache.put('k', result)

    expect(await cache.get('k')).toEqual(result)
  })

  it('has nothing for a key it never saw', async () => {
    expect(await createCache().get('missing')).toBeNull()
  })

  it('never grows past the limit', async () => {
    let clock = 0
    const cache = createCache(() => (clock += 1))

    for (let index = 0; index < CACHE_LIMIT + 5; index += 1) {
      await cache.put(`k${index}`, result)
    }

    const stored = await chrome.storage.local.get('aiCache')
    expect(Object.keys(stored.aiCache as object)).toHaveLength(CACHE_LIMIT)
  })
})

describe('prompts', () => {
  it('is runnable only with text in it', () => {
    expect(isRunnable(newPrompt({ text: 'опиши' }))).toBe(true)
    expect(isRunnable(newPrompt({ text: '   ' }))).toBe(false)
  })

  // A name is optional: without one the list shows the first line of the prompt.
  it('falls back to the first line for a name', () => {
    expect(displayName(newPrompt({ name: 'Alt', text: 'опиши' }))).toBe('Alt')
    expect(displayName(newPrompt({ text: 'опиши\nвторая строка' }))).toBe('опиши')
  })

  it('shortens a very long first line', () => {
    expect(displayName(newPrompt({ text: 'я'.repeat(80) }))).toHaveLength(41)
  })

  it('adds a prompt it has not seen', () => {
    const prompt = newPrompt({ text: 'a' })

    expect(upsert([], prompt)).toHaveLength(1)
  })

  it('replaces a prompt in place, keeping the order', () => {
    const first = newPrompt({ text: 'a' })
    const second = newPrompt({ text: 'b' })
    const list = upsert(upsert([], first), second)

    const updated = upsert(list, { ...first, text: 'a2' })

    expect(updated).toHaveLength(2)
    expect(updated[0]?.text).toBe('a2')
  })

  it('stamps the time of the change', () => {
    const prompt = newPrompt({ text: 'a' }, 1)

    expect(upsert([], prompt, 500)[0]?.updatedAt).toBe(500)
  })

  it('removes by identifier', () => {
    const prompt = newPrompt({ text: 'a' })

    expect(remove([prompt], prompt.id)).toEqual([])
    expect(remove([prompt], 'other')).toHaveLength(1)
  })
})

describe('spend', () => {
  it('starts at zero', () => {
    expect(emptySpend(5)).toEqual({ requests: 0, input: 0, output: 0, since: 5 })
  })

  it('adds up tokens and requests', () => {
    const spend = addUsage(addUsage(emptySpend(0), { input: 3, output: 1 }), {
      input: 2,
      output: 4,
    })

    expect(spend).toMatchObject({ requests: 2, input: 5, output: 5 })
  })

  // The period start never shifts: otherwise "since such-and-such date" loses meaning.
  it('keeps the start of the period', () => {
    expect(addUsage(emptySpend(7), { input: 1, output: 1 }).since).toBe(7)
  })

  it('survives a round trip through storage', async () => {
    await recordSpend({ input: 10, output: 2 })
    await recordSpend({ input: 1, output: 1 })

    expect(await readSpend()).toMatchObject({ requests: 2, input: 11, output: 3 })
  })

  it('starts a new period on reset', async () => {
    await recordSpend({ input: 10, output: 2 })
    await resetSpend(99)

    expect(await readSpend()).toEqual({ requests: 0, input: 0, output: 0, since: 99 })
  })
})
