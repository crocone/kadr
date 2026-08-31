/**
 * Shared types of the AI layer.
 *
 * One protocol for everyone — OpenAI-compatible `/chat/completions`. OpenAI
 * speaks it natively, Anthropic and Google via their compatibility layers, plus
 * OpenRouter and local Ollama/LM Studio. A client per provider would mean
 * writing and maintaining four response parsers for the same result.
 *
 * A provider is defined by base URL and model, not a code branch: a new endpoint
 * is a setting, not a client change.
 *
 * The call is the same; who executes it is the transport's choice: a user's own
 * key goes straight to the provider, server mode will go to the Kadr backend
 * with a task name but without the prompt text.
 */

/** Where the request goes. `server` arrives with premium, phase 5.5. */
export type Transport = 'byok' | 'server'

/** Expected response shape: free text or parseable JSON. */
export type OutputKind = 'text' | 'json'

export type AiConfig = {
  transport: Transport
  /** URL up to `/chat/completions`, without that suffix itself. */
  baseUrl: string
  model: string
  apiKey: string
}

export type AiImage = {
  /** Data only, no `data:` prefix — that is assembled at send time. */
  base64: string
  mediaType: string
}

export type AiRequest = {
  /** Prompt text. In server mode a task name travels instead. */
  prompt: string
  image: AiImage | null
  output: OutputKind
  maxTokens?: number
}

export type AiUsage = { input: number; output: number }

export type AiResult = {
  text: string
  usage: AiUsage
  /** Served from cache: rerunning the same frame costs no tokens. */
  cached: boolean
}

/**
 * AI-layer error with a parsed cause: it drives the retry decision and what to
 * show the user. Raw provider text won't do — every provider's differs.
 */
export type AiErrorCode =
  | 'no-key'
  | 'no-image-model'
  | 'auth'
  | 'rate-limit'
  | 'overloaded'
  | 'bad-request'
  | 'network'
  | 'empty'
  | 'not-available'

export class AiFailure extends Error {
  constructor(
    readonly code: AiErrorCode,
    message?: string,
  ) {
    super(message ?? code)
    this.name = 'AiFailure'
  }
}

/** Only what time can fix is worth retrying. */
export function isRetryable(code: AiErrorCode): boolean {
  return code === 'rate-limit' || code === 'overloaded' || code === 'network'
}
