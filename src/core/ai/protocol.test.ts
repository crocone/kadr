import { describe, expect, it } from 'vitest'

import {
  buildChatRequest,
  chatUrl,
  DEFAULT_MAX_TOKENS,
  errorCodeForStatus,
  parseChatResponse,
  parseJsonAnswer,
} from './protocol'
import { AiFailure, type AiConfig, type AiRequest } from './types'

const config: AiConfig = {
  transport: 'byok',
  baseUrl: 'https://api.example.com/v1',
  model: 'some-model',
  apiKey: 'sk-test',
}

const request: AiRequest = { prompt: 'Что на скриншоте?', image: null, output: 'text' }

/** Parsed request body: the tests inspect this, not the raw string. */
type ChatBody = {
  model: string
  max_tokens: number
  response_format?: { type: string }
  messages: { role: string; content: ContentPart[] }[]
}

type ContentPart = { type: string; text?: string; image_url?: { url: string } }

function bodyOf(built: { init: RequestInit }): ChatBody {
  return JSON.parse(built.init.body as string) as ChatBody
}

describe('chatUrl', () => {
  it('adds the endpoint to the base', () => {
    expect(chatUrl('https://api.example.com/v1')).toBe(
      'https://api.example.com/v1/chat/completions',
    )
  })

  // Everyone adds a trailing slash; that is no reason to end up with a double one.
  it('survives a trailing slash', () => {
    expect(chatUrl('https://api.example.com/v1/')).toBe(
      'https://api.example.com/v1/chat/completions',
    )
  })
})

describe('buildChatRequest', () => {
  it('sends the prompt as a user message', () => {
    const body = bodyOf(buildChatRequest(config, request))

    expect(body.model).toBe('some-model')
    expect(body.messages[0]?.role).toBe('user')
    expect(body.messages[0]?.content).toContainEqual({ type: 'text', text: 'Что на скриншоте?' })
  })

  it('caps the answer so it cannot run away', () => {
    expect(bodyOf(buildChatRequest(config, request)).max_tokens).toBe(DEFAULT_MAX_TOKENS)
    expect(bodyOf(buildChatRequest(config, { ...request, maxTokens: 64 })).max_tokens).toBe(64)
  })

  it('sends the image as a data URL before the text', () => {
    const withImage = buildChatRequest(config, {
      ...request,
      image: { base64: 'AAA', mediaType: 'image/png' },
    })
    const [first, second] = bodyOf(withImage).messages[0]!.content

    expect(first?.type).toBe('image_url')
    expect(first?.image_url?.url).toBe('data:image/png;base64,AAA')
    expect(second?.type).toBe('text')
  })

  it('asks for JSON only when JSON is expected', () => {
    expect(bodyOf(buildChatRequest(config, request)).response_format).toBeUndefined()
    expect(
      bodyOf(buildChatRequest(config, { ...request, output: 'json' })).response_format,
    ).toEqual({ type: 'json_object' })
  })

  it('carries the key as a bearer token', () => {
    const headers = buildChatRequest(config, request).init.headers as Record<string, string>

    expect(headers.authorization).toBe('Bearer sk-test')
  })

  // A local server asks for no key; some builds reject an empty header.
  it('sends no authorisation at all without a key', () => {
    const headers = buildChatRequest({ ...config, apiKey: '' }, request).init.headers as Record<
      string,
      string
    >

    expect(headers.authorization).toBeUndefined()
  })
})

describe('errorCodeForStatus', () => {
  it('tells apart what is worth retrying', () => {
    expect(errorCodeForStatus(401)).toBe('auth')
    expect(errorCodeForStatus(403)).toBe('auth')
    expect(errorCodeForStatus(429)).toBe('rate-limit')
    expect(errorCodeForStatus(503)).toBe('overloaded')
    expect(errorCodeForStatus(500)).toBe('overloaded')
    expect(errorCodeForStatus(400)).toBe('bad-request')
  })
})

describe('parseChatResponse', () => {
  const answer = (content: unknown, usage?: unknown) => ({
    choices: [{ message: { content } }],
    ...(usage ? { usage } : {}),
  })

  it('takes the text of the first choice', () => {
    expect(parseChatResponse(answer('Готово')).text).toBe('Готово')
  })

  // Some servers return content as a list of parts, not a string.
  it('glues a content split into parts', () => {
    expect(parseChatResponse(answer([{ text: 'Го' }, { text: 'тово' }])).text).toBe('Готово')
  })

  it('reports what the answer cost', () => {
    const result = parseChatResponse(answer('x', { prompt_tokens: 10, completion_tokens: 3 }))

    expect(result.usage).toEqual({ input: 10, output: 3 })
  })

  it('counts nothing when the server reports nothing', () => {
    expect(parseChatResponse(answer('x')).usage).toEqual({ input: 0, output: 0 })
  })

  it('treats an empty answer as a failure, not as an answer', () => {
    expect(() => parseChatResponse(answer('   '))).toThrow(AiFailure)
    expect(() => parseChatResponse({ choices: [] })).toThrow(AiFailure)
  })

  // A 200 with an error in the body is an error, not an answer.
  it('sees an error hidden in a successful response', () => {
    expect(() => parseChatResponse({ error: { message: 'model not found' } })).toThrow(
      'model not found',
    )
  })
})

describe('parseJsonAnswer', () => {
  it('reads plain JSON', () => {
    expect(parseJsonAnswer('{"a":1}')).toEqual({ a: 1 })
  })

  // Models occasionally wrap the object in ```json — no reason to lose the answer.
  it('unwraps a fenced block', () => {
    expect(parseJsonAnswer('```json\n{"a":1}\n```')).toEqual({ a: 1 })
    expect(parseJsonAnswer('```\n{"a":1}\n```')).toEqual({ a: 1 })
  })

  it('fails loudly on something that is not JSON at all', () => {
    expect(() => parseJsonAnswer('извините, не могу')).toThrow(AiFailure)
  })
})
