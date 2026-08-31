import { describe, expect, it } from 'vitest'

import { createDoc } from './create'
import { DEFAULT_CANVAS, shadowFromPreset } from './defaults'
import {
  applyStyle,
  captureStyle,
  makePreset,
  parsePresets,
  serializePresets,
  STYLE_PRESET_FORMAT,
} from './style-presets'
import type { Doc } from './types'

function doc(canvas: Partial<Doc['canvas']> = {}): Doc {
  const base = createDoc({ imageId: 'img_1', imageWidth: 400, imageHeight: 300 })
  return { ...base, canvas: { ...base.canvas, ...canvas } }
}

describe('captureStyle', () => {
  it('takes the decoration and leaves the size alone', () => {
    const style = captureStyle(
      doc({ padding: 96, radius: 24, shadow: shadowFromPreset('neon'), w: 1000, h: 800 }),
    )

    expect(style.padding).toBe(96)
    expect(style.radius).toBe(24)
    expect(style.shadow.preset).toBe('neon')
    expect(style).not.toHaveProperty('w')
  })

  it('drops the url of the browser frame: it belongs to the shot', () => {
    const style = captureStyle(
      doc({ frame: { style: 'macos', theme: 'dark', url: 'https://example.com', showUrl: true } }),
    )

    expect(style.frame).toEqual({ style: 'macos', theme: 'dark', showUrl: true })
  })

  it('replaces what only makes sense in this database', () => {
    const style = captureStyle(
      doc({
        background: { kind: 'image', imageId: 'img_bg', fit: 'cover' },
        mockup: 'custom',
        customMockup: { imageId: 'img_mockup', screen: { x: 0, y: 0, w: 1, h: 1 } },
      }),
    )

    expect(style.background).toEqual(DEFAULT_CANVAS.background)
    expect(style.mockup).toBe('none')
  })
})

describe('applyStyle', () => {
  it('changes the decoration and keeps the frame url', () => {
    const target = doc({
      w: 1200,
      h: 900,
      padding: 64,
      frame: { style: 'none', theme: 'light', url: 'https://mine.dev', showUrl: true },
    })
    const style = captureStyle(
      doc({
        padding: 64,
        radius: 32,
        frame: { style: 'windows11', theme: 'dark', url: 'https://theirs.dev', showUrl: false },
      }),
    )

    const next = applyStyle(target, style)

    expect(next.canvas.w).toBe(1200)
    expect(next.canvas.h).toBe(900)
    expect(next.canvas.padding).toBe(64)
    expect(next.canvas.radius).toBe(32)
    expect(next.canvas.frame).toEqual({
      style: 'windows11',
      theme: 'dark',
      url: 'https://mine.dev',
      showUrl: false,
    })
  })

  it('grows the canvas outwards when the style has wider margins', () => {
    const target = doc({ w: 528, h: 428, padding: 64 })

    const next = applyStyle(target, captureStyle(doc({ padding: 96 })))

    expect(next.canvas.padding).toBe(96)
    expect(next.canvas.w).toBe(528 + 64)
    expect(next.canvas.h).toBe(428 + 64)
    expect(next.canvas.preset).toBe('custom')
  })

  it('forgets a custom mockup when the style asks for another body', () => {
    const target = doc({
      mockup: 'custom',
      customMockup: { imageId: 'img_mockup', screen: { x: 0, y: 0, w: 1, h: 1 } },
    })

    expect(
      applyStyle(target, captureStyle(doc({ mockup: 'macbook-pro' }))).canvas.customMockup,
    ).toBeNull()
  })
})

describe('preset files', () => {
  it('round-trips through JSON', () => {
    const preset = makePreset('Dark deck', doc({ padding: 120 }), 42)
    const [parsed] = parsePresets(serializePresets([preset]))

    expect(parsed).toEqual(preset)
  })

  it('names the format so a foreign file is recognisable', () => {
    const file = JSON.parse(serializePresets([])) as { format: string }
    expect(file.format).toBe(STYLE_PRESET_FORMAT)
  })

  it('reads a bare array as well as a whole file', () => {
    const preset = makePreset('Bare', doc(), 42)
    expect(parsePresets(JSON.stringify([preset]))).toHaveLength(1)
  })

  it('refuses what is not a preset file', () => {
    expect(() => parsePresets('{"hello":"world"}')).toThrow()
  })

  it('replaces broken fields instead of letting them through', () => {
    const [parsed] = parsePresets(
      JSON.stringify({
        format: STYLE_PRESET_FORMAT,
        presets: [
          {
            name: '   ',
            canvas: {
              padding: 'lots',
              radius: -40,
              background: { kind: 'javascript:alert(1)', from: 'red' },
              shadow: { preset: 'nope', opacity: 12 },
              frame: { style: 'safari-2001', theme: 'neon' },
              mockup: 'custom',
            },
          },
        ],
      }),
      42,
    )

    expect(parsed?.name).toBe('Preset 1')
    expect(parsed?.createdAt).toBe(42)
    expect(parsed?.canvas.padding).toBe(DEFAULT_CANVAS.padding)
    expect(parsed?.canvas.radius).toBe(0)
    expect(parsed?.canvas.background.kind).toBe('gradient')
    expect(parsed?.canvas.shadow.preset).toBe('soft')
    expect(parsed?.canvas.shadow.opacity).toBe(1)
    expect(parsed?.canvas.frame).toEqual({ style: 'none', theme: 'light', showUrl: true })
    // A custom mockup lives as an image in someone's local database — it can't exist in an interchange file.
    expect(parsed?.canvas.mockup).toBe('none')
  })

  it('gives every preset an id, even when the file has none', () => {
    const [parsed] = parsePresets(JSON.stringify([{ name: 'No id', canvas: {} }]))
    expect(parsed?.id).toMatch(/^preset_/)
  })
})
