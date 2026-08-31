import { describe, expect, it } from 'vitest'

import { buildImageEdit, imagesUrl, nearestImageSize, parseImageResponse } from './images'
import { AiFailure, type AiConfig } from './types'

const config: AiConfig = {
  transport: 'byok',
  baseUrl: 'https://api.example.com/v1',
  model: 'image-model',
  apiKey: 'sk-test',
}

const edit = { prompt: 'убери фон', image: new Blob(['x'], { type: 'image/png' }) }

describe('imagesUrl', () => {
  it('sits next to the chat endpoint on the same base', () => {
    expect(imagesUrl('https://api.example.com/v1', 'edits')).toBe(
      'https://api.example.com/v1/images/edits',
    )
    expect(imagesUrl('https://api.example.com/v1/', 'generations')).toBe(
      'https://api.example.com/v1/images/generations',
    )
  })
})

describe('buildImageEdit', () => {
  it('sends the model, the words and the frame', () => {
    const form = buildImageEdit(config, edit).init.body as FormData

    expect(form.get('model')).toBe('image-model')
    expect(form.get('prompt')).toBe('убери фон')
    expect(form.get('image')).toBeInstanceOf(Blob)
  })

  // Without a filename some servers refuse to treat the part as a file and return 400.
  it('names the file it uploads', () => {
    const form = buildImageEdit(config, edit).init.body as FormData

    expect((form.get('image') as File).name).toBe('canvas.png')
  })

  it('passes the size only when asked', () => {
    expect((buildImageEdit(config, edit).init.body as FormData).get('size')).toBeNull()
    expect(
      (buildImageEdit(config, { ...edit, size: '1024x1024' }).init.body as FormData).get('size'),
    ).toBe('1024x1024')
  })

  // FormData sets the multipart boundary; a hand-written header clobbers it.
  it('leaves the content type to FormData', () => {
    const headers = buildImageEdit(config, edit).init.headers as Record<string, string>

    expect(headers['content-type']).toBeUndefined()
    expect(headers.authorization).toBe('Bearer sk-test')
  })

  it('sends no authorisation without a key', () => {
    const headers = buildImageEdit({ ...config, apiKey: '' }, edit).init.headers as Record<
      string,
      string
    >

    expect(headers.authorization).toBeUndefined()
  })
})

describe('parseImageResponse', () => {
  it('takes the bytes when they came inline', () => {
    expect(parseImageResponse({ data: [{ b64_json: 'AAA' }] })).toEqual({ base64: 'AAA' })
  })

  // A URL is a legitimate answer too; downloading it is the caller's job.
  it('takes the link when that is what came', () => {
    expect(parseImageResponse({ data: [{ url: 'https://cdn/x.png' }] })).toEqual({
      url: 'https://cdn/x.png',
    })
  })

  it('prefers the bytes over the link', () => {
    expect(parseImageResponse({ data: [{ b64_json: 'AAA', url: 'https://cdn/x.png' }] })).toEqual({
      base64: 'AAA',
    })
  })

  it('treats an empty answer as a failure', () => {
    expect(() => parseImageResponse({ data: [] })).toThrow(AiFailure)
    expect(() => parseImageResponse({})).toThrow(AiFailure)
  })

  it('sees an error hidden in a successful response', () => {
    expect(() => parseImageResponse({ error: { message: 'no such model' } })).toThrow(
      'no such model',
    )
  })
})

describe('nearestImageSize', () => {
  it('takes the square for a square frame', () => {
    expect(nearestImageSize(1000, 1000)).toBe('1024x1024')
  })

  it('takes landscape for a wide frame and portrait for a tall one', () => {
    expect(nearestImageSize(2688, 1433)).toBe('1536x1024')
    expect(nearestImageSize(1080, 1920)).toBe('1024x1536')
  })

  // 2:1 is as far from square as 1:2; with plain ratio differences portrait would always win.
  it('measures both directions the same way', () => {
    expect(nearestImageSize(2000, 1000)).toBe('1536x1024')
    expect(nearestImageSize(1000, 2000)).toBe('1024x1536')
  })

  it('keeps a nearly square frame square', () => {
    expect(nearestImageSize(1050, 1000)).toBe('1024x1024')
  })

  it('has an answer for a frame with no size at all', () => {
    expect(nearestImageSize(0, 0)).toBe('1024x1024')
  })
})
