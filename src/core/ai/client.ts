/**
 * AI client: one call backed by transport, cache, retries, and spend tracking.
 *
 * Network, cache, and clock come in as parameters — otherwise all of this could
 * only be tested by hand against a live key. The retry-or-give-up decision lives
 * here too: waiting makes sense when the provider is busy, not when the key is wrong.
 */
import { buildImageEdit, type ImageEdit, parseImageResponse } from './images'
import { buildChatRequest, errorCodeForStatus, parseChatResponse } from './protocol'
import { isLocalEndpoint } from './presets'
import {
  AiFailure,
  type AiConfig,
  type AiRequest,
  type AiResult,
  type AiUsage,
  isRetryable,
} from './types'

/** Retry count and delay between attempts. */
export const RETRIES = 2
export const BACKOFF_MS = 800

export type AiCache = {
  get: (key: string) => Promise<AiResult | null>
  put: (key: string, result: AiResult) => Promise<void>
}

export type ClientDeps = {
  fetch: typeof globalThis.fetch
  cache?: AiCache
  /** Cache key is computed outside: it depends on the image, and hashing is async. */
  cacheKey?: string
  wait?: (ms: number) => Promise<void>
  onSpend?: (usage: AiUsage) => void | Promise<void>
}

function checkConfig(config: AiConfig): void {
  if (config.transport === 'server') {
    // The extension point exists, the server does not yet: callers surface this
    // as "mode unavailable" (phase 5.5).
    throw new AiFailure('not-available')
  }

  if (config.baseUrl.trim() === '' || config.model.trim() === '') {
    throw new AiFailure('bad-request', 'endpoint or model is not set')
  }

  // A local server needs no key; everything else has no chance without one.
  if (config.apiKey.trim() === '' && !isLocalEndpoint(config.baseUrl)) {
    throw new AiFailure('no-key')
  }
}

async function once(config: AiConfig, request: AiRequest, deps: ClientDeps) {
  const { url, init } = buildChatRequest(config, request)

  let response: Response
  try {
    response = await deps.fetch(url, init)
  } catch (error) {
    // Covers both a dropped connection and a CORS-blocked response: from the
    // outside both are "could not reach".
    throw new AiFailure('network', error instanceof Error ? error.message : undefined)
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new AiFailure(errorCodeForStatus(response.status), detail.slice(0, 300))
  }

  return parseChatResponse(await response.json())
}

/**
 * Runs a request: cache, retries, spend tracking.
 *
 * Cache is checked before the network and filled after: the same prompt over the
 * same frame must not cost twice — and reruns are common while tuning the wording.
 */
export async function runAi(
  config: AiConfig,
  request: AiRequest,
  deps: ClientDeps,
): Promise<AiResult> {
  checkConfig(config)

  const key = deps.cacheKey
  if (key && deps.cache) {
    const hit = await deps.cache.get(key)
    if (hit) return { ...hit, cached: true }
  }

  const wait = deps.wait ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)))
  let last: AiFailure | null = null

  for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
    try {
      const { text, usage } = await once(config, request, deps)
      const result: AiResult = { text, usage, cached: false }

      await deps.onSpend?.(usage)
      if (key && deps.cache) await deps.cache.put(key, result)

      return result
    } catch (error) {
      const failure = error instanceof AiFailure ? error : new AiFailure('network', String(error))

      if (!isRetryable(failure.code) || attempt === RETRIES) throw failure

      last = failure
      // Growing backoff: a busy provider is still busy one second later.
      await wait(BACKOFF_MS * (attempt + 1))
    }
  }

  throw last ?? new AiFailure('network')
}

/**
 * Image editing with words.
 *
 * No cache, unlike text: for images the same request legitimately yields
 * different results, and a rerun usually means "give me a better variant", not
 * "save money". Returning the old image would defeat the point.
 */
export async function runImageEdit(
  config: AiConfig,
  edit: ImageEdit,
  deps: ClientDeps,
): Promise<Blob> {
  checkConfig(config)

  const wait = deps.wait ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)))

  for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
    try {
      const { url, init } = buildImageEdit(config, edit)

      let response: Response
      try {
        response = await deps.fetch(url, init)
      } catch (error) {
        throw new AiFailure('network', error instanceof Error ? error.message : undefined)
      }

      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        throw new AiFailure(errorCodeForStatus(response.status), detail.slice(0, 300))
      }

      const answer = parseImageResponse(await response.json())

      if ('base64' in answer) {
        const bytes = Uint8Array.from(atob(answer.base64), (char) => char.charCodeAt(0))
        return new Blob([bytes], { type: 'image/png' })
      }

      // The URL is short-lived and hosted by the provider: download now, while it exists.
      const picture = await deps.fetch(answer.url)
      if (!picture.ok) throw new AiFailure('network')

      return await picture.blob()
    } catch (error) {
      const failure = error instanceof AiFailure ? error : new AiFailure('network', String(error))

      if (!isRetryable(failure.code) || attempt === RETRIES) throw failure
      await wait(BACKOFF_MS * (attempt + 1))
    }
  }

  throw new AiFailure('network')
}
