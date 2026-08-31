/**
 * Style presets: "background + shadow + frame + padding + radius" under a name,
 * one click, shareable as JSON.
 *
 * Only canvas styling goes into a preset. Anything referencing the local
 * database — image backgrounds and custom mockups — is excluded on purpose:
 * `imageId` only means something in one store, and in someone else's file it
 * would point nowhere. The browser-frame URL is dropped for the same reason: it
 * belongs to the shot, not the style.
 */
import { DEFAULT_CANVAS, shadowFromPreset } from './defaults'
import { newPresetId } from './ids'
import type { Background, BrowserFrame, DeviceMockup, Doc, Shadow, ShadowPreset } from './types'

/** Canvas styling without content: what carries over from one shot to another. */
export type CanvasStyle = {
  background: Background
  padding: number
  radius: number
  shadow: Shadow
  frame: Omit<BrowserFrame, 'url'>
  mockup: DeviceMockup
}

export type StylePreset = {
  id: string
  name: string
  createdAt: number
  canvas: CanvasStyle
}

/** Interchange format version. Changes when the field set changes, not when the extension does. */
export const STYLE_PRESET_FORMAT = 'kadr.style-presets/1'

export function captureStyle(doc: Doc): CanvasStyle {
  const { background, padding, radius, shadow, frame, mockup } = doc.canvas
  return {
    // Image backgrounds and custom mockups live in this browser's IndexedDB, so
    // they don't travel: instead of a dead reference the preset gets the default background.
    background: background.kind === 'image' ? DEFAULT_CANVAS.background : background,
    padding,
    radius,
    shadow,
    frame: { style: frame.style, theme: frame.theme, showUrl: frame.showUrl },
    mockup: mockup === 'custom' ? 'none' : mockup,
  }
}

export function makePreset(name: string, doc: Doc, now = Date.now()): StylePreset {
  return {
    id: newPresetId(),
    name: name.trim() || 'Preset',
    createdAt: now,
    canvas: captureStyle(doc),
  }
}

/**
 * Applying changes the styling, not the content: the capture keeps its size.
 *
 * Padding is the one thing that drags the canvas along: margins grow outward,
 * exactly like the padding slider in the panel. Otherwise a foreign preset with
 * big margins would eat into the picture.
 */
export function applyStyle(doc: Doc, style: CanvasStyle): Doc {
  const delta = style.padding - doc.canvas.padding

  return {
    ...doc,
    canvas: {
      ...doc.canvas,
      w: doc.canvas.w + delta * 2,
      h: doc.canvas.h + delta * 2,
      preset: delta === 0 ? doc.canvas.preset : 'custom',
      background: style.background,
      padding: style.padding,
      radius: style.radius,
      shadow: style.shadow,
      // The URL stays the shot's own: a preset frame sets the look, not someone else's address.
      frame: { ...style.frame, url: doc.canvas.frame.url },
      mockup: style.mockup,
      customMockup: style.mockup === 'custom' ? doc.canvas.customMockup : null,
    },
  }
}

export function serializePresets(presets: readonly StylePreset[]): string {
  return `${JSON.stringify({ format: STYLE_PRESET_FORMAT, presets }, null, 2)}\n`
}

/**
 * Parsing a foreign file. Anything unrecognised is replaced with a default: a
 * preset from the internet must not be able to crash the editor with a missing
 * field or a string where a number was expected.
 */
export function parsePresets(text: string, now = Date.now()): StylePreset[] {
  const parsed: unknown = JSON.parse(text)
  const list = readArray(parsed)
  if (!list) throw new Error('not a kadr preset file')

  return list.map((entry, index) => {
    const record = isRecord(entry) ? entry : {}
    return {
      id: typeof record.id === 'string' ? record.id : newPresetId(),
      name:
        typeof record.name === 'string' && record.name.trim()
          ? record.name.trim()
          : `Preset ${index + 1}`,
      createdAt: typeof record.createdAt === 'number' ? record.createdAt : now,
      canvas: sanitizeStyle(record.canvas),
    }
  })
}

/** A full file or a bare preset array: both show up in the wild. */
function readArray(parsed: unknown): unknown[] | null {
  if (Array.isArray(parsed)) return parsed as unknown[]
  if (isRecord(parsed) && Array.isArray(parsed.presets)) return parsed.presets as unknown[]
  return null
}

export function sanitizeStyle(value: unknown): CanvasStyle {
  const record = isRecord(value) ? value : {}
  return {
    background: sanitizeBackground(record.background),
    padding: clampNumber(record.padding, DEFAULT_CANVAS.padding, 0, 512),
    radius: clampNumber(record.radius, DEFAULT_CANVAS.radius, 0, 256),
    shadow: sanitizeShadow(record.shadow),
    frame: sanitizeFrame(record.frame),
    mockup: pick<DeviceMockup>(
      record.mockup,
      ['none', 'iphone-16-pro', 'pixel-9-pro', 'ipad-pro-m4', 'macbook-pro'],
      'none',
    ),
  }
}

function sanitizeBackground(value: unknown): Background {
  const record = isRecord(value) ? value : {}
  const angle = clampNumber(record.angle, 135, 0, 360)
  const from = color(record.from, '#4f46e5')
  const to = color(record.to, '#a855f7')

  switch (record.kind) {
    case 'solid':
      return { kind: 'solid', color: color(record.color, '#101215') }
    case 'transparent':
      return { kind: 'transparent' }
    case 'wallpaper':
      return {
        kind: 'wallpaper',
        pattern: pick(record.pattern, ['mesh', 'dots', 'grid', 'stripes', 'rings'], 'mesh'),
        from,
        to,
        angle,
      }
    default:
      // An image background is meaningless in an interchange file, so it — and
      // anything unrecognised — collapses to a gradient, the one background that renders anywhere.
      return { kind: 'gradient', from, to, angle }
  }
}

function sanitizeShadow(value: unknown): Shadow {
  const record = isRecord(value) ? value : {}
  const preset = pick<ShadowPreset>(
    record.preset,
    ['none', 'soft', 'hard', 'float', 'neon'],
    'soft',
  )
  const fallback = shadowFromPreset(preset)
  return {
    preset,
    offsetX: clampNumber(record.offsetX, fallback.offsetX, -512, 512),
    offsetY: clampNumber(record.offsetY, fallback.offsetY, -512, 512),
    blur: clampNumber(record.blur, fallback.blur, 0, 512),
    opacity: clampNumber(record.opacity, fallback.opacity, 0, 1),
    color: color(record.color, fallback.color),
  }
}

function sanitizeFrame(value: unknown): CanvasStyle['frame'] {
  const record = isRecord(value) ? value : {}
  return {
    style: pick(record.style, ['none', 'macos', 'windows11'], 'none'),
    theme: pick(record.theme, ['light', 'dark'], 'light'),
    showUrl: typeof record.showUrl === 'boolean' ? record.showUrl : true,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function color(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-f]{3,8}$/i.test(value) ? value : fallback
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback
}
