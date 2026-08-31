import { describe, expect, it, vi } from 'vitest'

import { type AiCache, type ClientDeps, RETRIES, runAi, runImageEdit } from './client'
import { AiFailure, type AiConfig, type AiRequest, type AiResult } from './types'

const config: AiConfig = {
  transport: 'byok',
  baseUrl: 'https://api.example.com/v1',
  model: 'some-model',
  apiKey: 'sk-test',
}

const request: AiRequest = { prompt: 'Что тут?', image: null, output: 'text' }

const answer = (text: string) =>
  new Response(
    JSON.stringify({
      choices: [{ message: { content: text } }],
      usage: { prompt_tokens: 7, completion_tokens: 2 },
    }),
    { status: 200 },
  )

function deps(patch: Partial<ClientDeps> = {}): ClientDeps {
  return {
    fetch: vi.fn(() => Promise.resolve(answer('Готово'))),
    wait: () => Promise.resolve(),
    ...patch,
  }
}

function memoryCache(): AiCache & { stored: Map<string, AiResult> } {
  const stored = new Map<string, AiResult>()
  return {
    stored,
    get: (key) => Promise.resolve(stored.get(key) ?? null),
    put: (key, result) => {
      stored.set(key, result)
      return Promise.resolve()
    },
  }
}

describe('runAi', () => {
  it('returns the answer and what it cost', async () => {
    const result = await runAi(config, request, deps())

    expect(result.text).toBe('Готово')
    expect(result.usage).toEqual({ input: 7, output: 2 })
    expect(result.cached).toBe(false)
  })

  // Server transport is premium, phase 5.5: the extension point exists, the server doesn't.
  it('says plainly that the server transport is not there yet', async () => {
    await expect(runAi({ ...config, transport: 'server' }, request, deps())).rejects.toMatchObject({
      code: 'not-available',
    })
  })

  it('refuses to call a remote endpoint without a key', async () => {
    await expect(runAi({ ...config, apiKey: '' }, request, deps())).rejects.toMatchObject({
      code: 'no-key',
    })
  })

  // A local model needs no key — demanding one would be an invented obstacle.
  it('calls a local endpoint with no key at all', async () => {
    const local = { ...config, apiKey: '', baseUrl: 'http://localhost:11434/v1' }

    await expect(runAi(local, request, deps())).resolves.toMatchObject({ text: 'Готово' })
  })

  it('needs an endpoint and a model', async () => {
    await expect(runAi({ ...config, model: '' }, request, deps())).rejects.toThrow(AiFailure)
    await expect(runAi({ ...config, baseUrl: ' ' }, request, deps())).rejects.toThrow(AiFailure)
  })

  it('retries while the provider is busy', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('busy', { status: 429 }))
      .mockResolvedValueOnce(answer('Готово'))

    const result = await runAi(config, request, deps({ fetch: fetch }))

    expect(result.text).toBe('Готово')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  // A wrong key is not fixed by retrying: waiting only wastes the user's time.
  it('does not retry a wrong key', async () => {
    const fetch = vi.fn(() => Promise.resolve(new Response('nope', { status: 401 })))

    await expect(runAi(config, request, deps({ fetch: fetch }))).rejects.toMatchObject({
      code: 'auth',
    })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('gives up after the last attempt', async () => {
    const fetch = vi.fn(() => Promise.resolve(new Response('busy', { status: 429 })))

    await expect(runAi(config, request, deps({ fetch: fetch }))).rejects.toMatchObject({
      code: 'rate-limit',
    })
    expect(fetch).toHaveBeenCalledTimes(RETRIES + 1)
  })

  it('waits longer before every next attempt', async () => {
    const waits: number[] = []
    const fetch = vi.fn(() => Promise.resolve(new Response('busy', { status: 429 })))

    await runAi(
      config,
      request,
      deps({
        fetch: fetch,
        wait: (ms) => {
          waits.push(ms)
          return Promise.resolve()
        },
      }),
    ).catch(() => undefined)

    expect(waits).toHaveLength(RETRIES)
    expect(waits[1]).toBeGreaterThan(waits[0]!)
  })

  it('turns a dead network into a plain failure', async () => {
    const fetch = vi.fn(() => Promise.reject(new Error('offline')))

    await expect(runAi(config, request, deps({ fetch: fetch }))).rejects.toMatchObject({
      code: 'network',
    })
  })

  it('reports what it spent', async () => {
    const onSpend = vi.fn()

    await runAi(config, request, deps({ onSpend }))

    expect(onSpend).toHaveBeenCalledWith({ input: 7, output: 2 })
  })

  // Prompts get tuned by rerunning over the same frame — no reason to pay twice.
  it('answers from cache without touching the network', async () => {
    const cache = memoryCache()
    const fetch = vi.fn(() => Promise.resolve(answer('Готово')))
    const shared = { fetch: fetch, cache, cacheKey: 'k1', wait: () => Promise.resolve() }

    await runAi(config, request, shared)
    const second = await runAi(config, request, shared)

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(second.cached).toBe(true)
    expect(second.text).toBe('Готово')
  })

  it('does not spend twice on a cached answer', async () => {
    const cache = memoryCache()
    const onSpend = vi.fn()
    const shared = deps({ cache, cacheKey: 'k1', onSpend })

    await runAi(config, request, shared)
    await runAi(config, request, shared)

    expect(onSpend).toHaveBeenCalledTimes(1)
  })

  it('keeps different requests apart in the cache', async () => {
    const cache = memoryCache()
    const fetch = vi.fn(() => Promise.resolve(answer('Готово')))

    await runAi(config, request, { fetch: fetch, cache, cacheKey: 'k1' })
    await runAi(config, request, { fetch: fetch, cache, cacheKey: 'k2' })

    expect(fetch).toHaveBeenCalledTimes(2)
  })
})

describe('runImageEdit', () => {
  const edit = { prompt: 'убери фон', image: new Blob(['x'], { type: 'image/png' }) }

  const inlineAnswer = () =>
    new Response(JSON.stringify({ data: [{ b64_json: btoa('picture') }] }), { status: 200 })

  it('returns the picture that came inline', async () => {
    const fetch = vi.fn(() => Promise.resolve(inlineAnswer()))

    const blob = await runImageEdit(config, edit, deps({ fetch }))

    expect(await blob.text()).toBe('picture')
  })

  // The URL is short-lived and provider-hosted: download right away, while it exists.
  it('downloads the picture when a link came instead', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ url: 'https://cdn/x.png' }] }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response('bytes', { status: 200 }))

    const blob = await runImageEdit(config, edit, deps({ fetch }))

    expect(await blob.text()).toBe('bytes')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('retries a busy provider and gives up on a bad key', async () => {
    const busy = vi
      .fn()
      .mockResolvedValueOnce(new Response('busy', { status: 429 }))
      .mockResolvedValueOnce(inlineAnswer())
    await expect(runImageEdit(config, edit, deps({ fetch: busy }))).resolves.toBeInstanceOf(Blob)

    const denied = vi.fn(() => Promise.resolve(new Response('no', { status: 401 })))
    await expect(runImageEdit(config, edit, deps({ fetch: denied }))).rejects.toMatchObject({
      code: 'auth',
    })
    expect(denied).toHaveBeenCalledTimes(1)
  })

  it('refuses the same way as the chat call when nothing is set up', async () => {
    await expect(
      runImageEdit({ ...config, transport: 'server' }, edit, deps()),
    ).rejects.toMatchObject({ code: 'not-available' })
    await expect(runImageEdit({ ...config, apiKey: '' }, edit, deps())).rejects.toMatchObject({
      code: 'no-key',
    })
  })
})
