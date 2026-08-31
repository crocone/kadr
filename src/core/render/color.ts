/** Colour conversions. Separate from the renderer: needed by both background picking and the panels. */

export type Rgb = { r: number; g: number; b: number }
export type Hsl = { h: number; s: number; l: number }

const clamp255 = (value: number) => Math.min(255, Math.max(0, Math.round(value)))

export function hexToRgb(hex: string): Rgb | null {
  const match = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(hex.trim())
  if (!match) return null
  const digits = match[1]!
  const full =
    digits.length === 3
      ? digits
          .split('')
          .map((d) => d + d)
          .join('')
      : digits
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  }
}

export function rgbToHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b].map((c) => clamp255(c).toString(16).padStart(2, '0')).join('')}`
}

export function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const delta = max - min
  const l = (max + min) / 2

  if (delta === 0) return { h: 0, s: 0, l }

  const s = delta / (1 - Math.abs(2 * l - 1))
  let h: number
  if (max === rn) h = ((gn - bn) / delta) % 6
  else if (max === gn) h = (bn - rn) / delta + 2
  else h = (rn - gn) / delta + 4

  return { h: (h * 60 + 360) % 360, s, l }
}

export function hslToRgb({ h, s, l }: Hsl): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const hue = ((h % 360) + 360) % 360
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1))
  const m = l - c / 2

  const [r, g, b] =
    hue < 60
      ? [c, x, 0]
      : hue < 120
        ? [x, c, 0]
        : hue < 180
          ? [0, c, x]
          : hue < 240
            ? [0, x, c]
            : hue < 300
              ? [x, 0, c]
              : [c, 0, x]

  return { r: clamp255((r + m) * 255), g: clamp255((g + m) * 255), b: clamp255((b + m) * 255) }
}

/** Clamps saturation and lightness into a range where the colour reads as a backdrop. */
export function asBackdrop(rgb: Rgb, lightness: number): Rgb {
  const hsl = rgbToHsl(rgb)
  return hslToRgb({
    h: hsl.h,
    s: Math.min(0.72, Math.max(0.35, hsl.s)),
    l: lightness,
  })
}

export function shiftHue(rgb: Rgb, degrees: number): Rgb {
  const hsl = rgbToHsl(rgb)
  return hslToRgb({ ...hsl, h: hsl.h + degrees })
}

/**
 * Colour with the given alpha. Via rgba(), not by appending two hex digits: the
 * colour field also accepts 3-digit notation, and concatenation would produce garbage.
 */
export function withAlpha(color: string, alpha: number): string {
  const rgb = hexToRgb(color)
  if (!rgb) return 'transparent'
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`
}
