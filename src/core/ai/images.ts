/**
 * Model-driven image editing: same protocol, different endpoint.
 *
 * `/images/edits` takes multipart, not JSON: the frame file, the instruction
 * text, and the model. The answer is base64 or a URL; both are supported
 * because providers differ, and the caller ultimately needs bytes.
 *
 * No wording of our own: the user writes the instruction, the extension
 * delivers the frame (PLAN.md §7).
 */
import { AiFailure, type AiConfig } from './types'

export type ImageEdit = {
  prompt: string
  image: Blob
  /** Result size in provider terms: '1024x1024', 'auto'. */
  size?: string
}

/**
 * Sizes the edit endpoint accepts: square, landscape, portrait.
 *
 * The list is short not by our choice — providers reject arbitrary sizes. So we
 * pick the closest aspect ratio for the frame instead of computing an exact one.
 */
export const IMAGE_SIZES = ['1024x1024', '1536x1024', '1024x1536'] as const

export type ImageSize = (typeof IMAGE_SIZES)[number]

function ratioOf(size: ImageSize): number {
  const [w, h] = size.split('x').map(Number)
  return (w ?? 1) / (h ?? 1)
}

/**
 * Closest size to the frame's aspect ratio.
 *
 * Without it the model answers with a square: a wide screenshot comes back
 * cropped or stretched, and you can no longer tell model hallucination from a
 * wrong size.
 *
 * Log ratios are compared: 2:1 is as far from 1:1 as 1:2 is — with plain ratio
 * differences portrait would always win.
 */
export function nearestImageSize(width: number, height: number): ImageSize {
  if (width <= 0 || height <= 0) return IMAGE_SIZES[0]

  const wanted = Math.log(width / height)
  let best: ImageSize = IMAGE_SIZES[0]
  let distance = Infinity

  for (const size of IMAGE_SIZES) {
    const gap = Math.abs(Math.log(ratioOf(size)) - wanted)
    if (gap < distance) {
      distance = gap
      best = size
    }
  }

  return best
}

/** Image endpoint next to the chat one: both share the same base URL. */
export function imagesUrl(baseUrl: string, endpoint: 'edits' | 'generations'): string {
  const base = baseUrl.trim().replace(/\/+$/, '')
  return `${base}/images/${endpoint}`
}

export function buildImageEdit(
  config: AiConfig,
  edit: ImageEdit,
): { url: string; init: RequestInit } {
  const form = new FormData()
  form.set('model', config.model)
  form.set('prompt', edit.prompt)
  // The filename is required: without it some servers do not treat the part as a file.
  form.set('image', edit.image, 'canvas.png')
  if (edit.size) form.set('size', edit.size)

  return {
    url: imagesUrl(config.baseUrl, 'edits'),
    init: {
      method: 'POST',
      // No manual Content-Type: FormData sets the multipart boundary itself.
      headers: config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {},
      body: form,
    },
  }
}

type ImageResponse = {
  data?: { b64_json?: string; url?: string }[]
  error?: { message?: string }
}

export type ImageAnswer = { base64: string } | { url: string }

/**
 * Response parsing. The provider returns either bytes or a URL to them — both
 * are legitimate, so the caller decides: downloading the URL is its job.
 */
export function parseImageResponse(payload: unknown): ImageAnswer {
  const data = payload as ImageResponse

  if (data.error?.message) throw new AiFailure('bad-request', data.error.message)

  const first = data.data?.[0]
  if (first?.b64_json) return { base64: first.b64_json }
  if (first?.url) return { url: first.url }

  throw new AiFailure('empty')
}
