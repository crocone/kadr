/**
 * Canvas size presets.
 *
 * Ratios and fixed sizes deliberately behave differently. A ratio grows the
 * canvas around the capture: the shot stays as is and margins are added. A
 * platform size is fixed, so the capture is fitted to it instead. Otherwise
 * "1600×900 for X" would either crop the picture or fail to deliver the
 * promised size.
 */
import type { CanvasPreset, Doc, Rect } from './types'

export type PresetSpec =
  | { id: CanvasPreset; kind: 'auto' | 'custom' }
  | { id: CanvasPreset; kind: 'ratio'; ratio: number }
  | { id: CanvasPreset; kind: 'size'; w: number; h: number }

export const RATIO_PRESETS: readonly PresetSpec[] = [
  { id: '16:9', kind: 'ratio', ratio: 16 / 9 },
  { id: '4:3', kind: 'ratio', ratio: 4 / 3 },
  { id: '1:1', kind: 'ratio', ratio: 1 },
  { id: '3:2', kind: 'ratio', ratio: 3 / 2 },
  { id: '4:5', kind: 'ratio', ratio: 4 / 5 },
  { id: '9:16', kind: 'ratio', ratio: 9 / 16 },
  { id: '21:9', kind: 'ratio', ratio: 21 / 9 },
]

/**
 * Platform sizes are working values, not copied from a spec: platforms change
 * their layouts, and promising pixel accuracy would be a lie. The ratio matters
 * more than the absolute numbers.
 */
export const SOCIAL_PRESETS: readonly PresetSpec[] = [
  { id: 'x', kind: 'size', w: 1600, h: 900 },
  { id: 'telegram', kind: 'size', w: 1280, h: 720 },
  { id: 'vk', kind: 'size', w: 1200, h: 675 },
  { id: 'max', kind: 'size', w: 1280, h: 720 },
  { id: 'linkedin', kind: 'size', w: 1200, h: 627 },
  { id: 'instagram', kind: 'size', w: 1080, h: 1350 },
  { id: 'youtube', kind: 'size', w: 1280, h: 720 },
]

export const ALL_PRESETS: readonly PresetSpec[] = [
  { id: 'auto', kind: 'auto' },
  ...RATIO_PRESETS,
  ...SOCIAL_PRESETS,
  { id: 'custom', kind: 'custom' },
]

export function findPreset(id: CanvasPreset): PresetSpec | undefined {
  return ALL_PRESETS.find((preset) => preset.id === id)
}

/**
 * Safe zones as fractions of the canvas. A guideline, not exact platform
 * geometry: platforms change their UI, and pixel accuracy would be a lie.
 */
export type SafeZone = { rect: Rect; kind: 'margin' | 'overlay' }

const MARGIN: SafeZone = { rect: { x: 0.05, y: 0.05, w: 0.9, h: 0.9 }, kind: 'margin' }

export function safeZonesFor(id: CanvasPreset): SafeZone[] {
  switch (id) {
    case 'youtube':
      // The video-duration badge covers the bottom-right corner.
      return [MARGIN, { rect: { x: 0.84, y: 0.85, w: 0.15, h: 0.12 }, kind: 'overlay' }]
    case 'x':
    case 'linkedin':
    case 'instagram':
    case 'vk':
    case 'telegram':
    case 'max':
      return [MARGIN]
    default:
      return []
  }
}

/** Scale at which the capture fully fits the canvas, padding included. */
export function fitCaptureScale(doc: Doc, canvasW: number, canvasH: number): number {
  const { padding } = doc.canvas
  const availableW = Math.max(1, canvasW - padding * 2)
  const availableH = Math.max(1, canvasH - padding * 2)
  return Math.min(availableW / doc.capture.width, availableH / doc.capture.height)
}

export function applyCanvasPreset(doc: Doc, id: CanvasPreset): Doc {
  const preset = findPreset(id)
  if (!preset) return doc

  const { padding } = doc.canvas
  const frameW = doc.capture.width * doc.capture.scale
  const frameH = doc.capture.height * doc.capture.scale

  switch (preset.kind) {
    case 'auto':
      return {
        ...doc,
        canvas: {
          ...doc.canvas,
          preset: id,
          w: Math.round(frameW + padding * 2),
          h: Math.round(frameH + padding * 2),
        },
        capture: { ...doc.capture, offset: { x: 0, y: 0 } },
      }

    case 'ratio': {
      // The canvas must fit the padded capture while keeping the ratio.
      const minW = frameW + padding * 2
      const minH = frameH + padding * 2
      const w = Math.max(minW, minH * preset.ratio)
      return {
        ...doc,
        canvas: { ...doc.canvas, preset: id, w: Math.round(w), h: Math.round(w / preset.ratio) },
        capture: { ...doc.capture, offset: { x: 0, y: 0 } },
      }
    }

    case 'size': {
      const scale = fitCaptureScale(doc, preset.w, preset.h)
      return {
        ...doc,
        canvas: { ...doc.canvas, preset: id, w: preset.w, h: preset.h },
        capture: { ...doc.capture, scale, offset: { x: 0, y: 0 } },
      }
    }

    case 'custom':
      return { ...doc, canvas: { ...doc.canvas, preset: 'custom' } }
  }
}

/** Capture centred on the canvas plus a manual offset — so it doesn't drift when the aspect changes. */
export function frameRect(doc: Doc): Rect {
  const w = doc.capture.width * doc.capture.scale
  const h = doc.capture.height * doc.capture.scale
  return {
    x: (doc.canvas.w - w) / 2 + doc.capture.offset.x,
    y: (doc.canvas.h - h) / 2 + doc.capture.offset.y,
    w,
    h,
  }
}
