import type { Background, DocCanvas, DocCapture, ImageFilters, Shadow } from './types'

export const NEUTRAL_FILTERS: ImageFilters = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  hue: 0,
}

/** Shadow presets from §2. Values in px, opacity 0..1. */
export const SHADOW_PRESETS: Record<Shadow['preset'], Omit<Shadow, 'preset'>> = {
  none: { offsetX: 0, offsetY: 0, blur: 0, opacity: 0, color: '#000000' },
  soft: { offsetX: 0, offsetY: 18, blur: 48, opacity: 0.24, color: '#0b1020' },
  hard: { offsetX: 0, offsetY: 8, blur: 0, opacity: 0.5, color: '#0b1020' },
  float: { offsetX: 0, offsetY: 42, blur: 72, opacity: 0.32, color: '#0b1020' },
  neon: { offsetX: 0, offsetY: 0, blur: 56, opacity: 0.55, color: '#6366f1' },
}

export function shadowFromPreset(preset: Shadow['preset']): Shadow {
  return { preset, ...SHADOW_PRESETS[preset] }
}

/** Gradients are generated in code — no third-party wallpapers in the repo. */
export const DEFAULT_BACKGROUND: Background = {
  kind: 'gradient',
  from: '#4f46e5',
  to: '#a855f7',
  angle: 135,
}

export const DEFAULT_CANVAS: DocCanvas = {
  w: 0,
  h: 0,
  preset: 'auto',
  background: DEFAULT_BACKGROUND,
  padding: 64,
  radius: 12,
  shadow: shadowFromPreset('soft'),
  frame: { style: 'none', theme: 'light', url: '', showUrl: true },
  mockup: 'none',
  customMockup: null,
}

export const DEFAULT_CAPTURE: Omit<DocCapture, 'imageId' | 'width' | 'height'> = {
  visible: true,
  scale: 1,
  rotation: 0,
  tilt: { x: 0, y: 0 },
  offset: { x: 0, y: 0 },
  filters: NEUTRAL_FILTERS,
  crop: null,
}
