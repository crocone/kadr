/**
 * OpenAI-compatible protocol: request building and response parsing.
 *
 * Pure functions, no network — so both the request shape and every parsing
 * branch are testable, including ones unreachable by hand: empty response,
 * truncated by the limit, error text where JSON should be.
 */
import { AiFailure, type AiConfig, type AiErrorCode, type AiRequest, type AiUsage } from './types'

/** Without an explicit limit the response risks being cut mid-JSON. */
export const DEFAULT_MAX_TOKENS = 2048

export type HttpRequest = {
  url: string
  init: RequestInit
}

/** URL to `/chat/completions`, however many trailing slashes the setting has. */
export function chatUrl(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '')
  return `${base}/chat/completions`
}

/**
 * The image travels as a data URL in `image_url` — accepted by OpenAI and by
 * everyone else's compatibility layers. The protocol has no separate bytes field.
 */
function contentParts(request: AiRequest): unknown[] {
  const parts: unknown[] = []

  if (request.image) {
    parts.push({
      type: 'image_url',
      image_url: { url: `data:${request.image.mediaType};base64,${request.image.base64}` },
    })
  }

  parts.push({ type: 'text', text: request.prompt })
  return parts
}

export function buildChatRequest(config: AiConfig, request: AiRequest): HttpRequest {
  const body: Record<string, unknown> = {
    model: config.model,
    max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
    messages: [{ role: 'user', content: contentParts(request) }],
  }

  // Request JSON via response_format, not just words in the prompt: a server
  // that supports it stops wrapping answers in ```json, one that doesn't simply
  // ignores the extra field.
  if (request.output === 'json') body.response_format = { type: 'json_object' }

  return {
    url: chatUrl(config.baseUrl),
    init: {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // Local servers ask for no key, so an empty one is not sent at all.
        ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
    },
  }
}

/** Error code from HTTP status; downstream it drives the retry decision. */
export function errorCodeForStatus(status: number): AiErrorCode {
  if (status === 401 || status === 403) return 'auth'
  if (status === 429) return 'rate-limit'
  if (status === 529 || status === 503) return 'overloaded'
  if (status >= 500) return 'overloaded'
  return 'bad-request'
}

type ChatResponse = {
  choices?: { message?: { content?: unknown }; finish_reason?: string }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number }
  error?: { message?: string }
}

/** Response text: some servers return content as a list of parts, not a string. */
function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''

  return content
    .map((part) =>
      typeof part === 'object' && part !== null && 'text' in part
        ? String((part as { text: unknown }).text)
        : '',
    )
    .join('')
}

export function parseChatResponse(payload: unknown): { text: string; usage: AiUsage } {
  const data = payload as ChatResponse

  // Some servers return 200 with an error in the body — same error to us.
  if (data.error?.message) throw new AiFailure('bad-request', data.error.message)

  const text = textOf(data.choices?.[0]?.message?.content).trim()
  if (text === '') throw new AiFailure('empty')

  return {
    text,
    usage: {
      input: data.usage?.prompt_tokens ?? 0,
      output: data.usage?.completion_tokens ?? 0,
    },
  }
}

/**
 * JSON out of a model answer.
 *
 * Even with `response_format` a model occasionally wraps the object in ```json —
 * no reason to lose a good answer, so the fence is stripped before parsing.
 */
export function parseJsonAnswer(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
  const body = (fenced?.[1] ?? text).trim()

  try {
    return JSON.parse(body)
  } catch {
    throw new AiFailure('bad-request', 'answer is not JSON')
  }
}
