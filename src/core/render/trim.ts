/**
 * Trimming empty margins: how much uniform edge can be cut without losing anything.
 *
 * Computed locally from pixels — no network, key, or model (PLAN.md §7). Works on a
 * downscaled copy and returns bounds as fractions: at full resolution the same pass
 * would cost tens of millions of comparisons, and margins don't depend on scale.
 */
export type Sample = { data: Uint8ClampedArray | number[]; width: number; height: number }

export type Bounds = { x: number; y: number; w: number; h: number }

/** Whole frame in fractions: the starting point, and the fallback when there is nothing to cut. */
export const WHOLE: Bounds = { x: 0, y: 0, w: 1, h: 1 }

type Rgb = { r: number; g: number; b: number }

function pixelAt(sample: Sample, x: number, y: number): Rgb {
  const index = (y * sample.width + x) * 4
  return {
    r: sample.data[index] ?? 0,
    g: sample.data[index + 1] ?? 0,
    b: sample.data[index + 2] ?? 0,
  }
}

/** Whether two colours are close enough for the difference to be compression noise. */
function alike(a: Rgb, b: Rgb, tolerance: number): boolean {
  return (
    Math.abs(a.r - b.r) <= tolerance &&
    Math.abs(a.g - b.g) <= tolerance &&
    Math.abs(a.b - b.b) <= tolerance
  )
}

function rowIsFlat(sample: Sample, y: number, colour: Rgb, tolerance: number): boolean {
  for (let x = 0; x < sample.width; x += 1) {
    if (!alike(pixelAt(sample, x, y), colour, tolerance)) return false
  }
  return true
}

function columnIsFlat(sample: Sample, x: number, colour: Rgb, tolerance: number): boolean {
  for (let y = 0; y < sample.height; y += 1) {
    if (!alike(pixelAt(sample, x, y), colour, tolerance)) return false
  }
  return true
}

/**
 * Content bounds as fractions of the frame.
 *
 * The margin colour is taken from the top-left corner — if a margin exists at all,
 * it's there. The tolerance covers compression: a JPEG "uniform" margin varies by a
 * point or two.
 *
 * A fully uniform frame is returned whole: trimming it into nothing is not what the
 * button is expected to do.
 */
export function contentBounds(sample: Sample, tolerance = 6): Bounds {
  if (sample.width === 0 || sample.height === 0) return WHOLE

  const colour = pixelAt(sample, 0, 0)

  let top = 0
  while (top < sample.height && rowIsFlat(sample, top, colour, tolerance)) top += 1
  if (top === sample.height) return WHOLE

  let bottom = sample.height - 1
  while (bottom > top && rowIsFlat(sample, bottom, colour, tolerance)) bottom -= 1

  let left = 0
  while (left < sample.width && columnIsFlat(sample, left, colour, tolerance)) left += 1

  let right = sample.width - 1
  while (right > left && columnIsFlat(sample, right, colour, tolerance)) right -= 1

  return {
    x: left / sample.width,
    y: top / sample.height,
    w: (right - left + 1) / sample.width,
    h: (bottom - top + 1) / sample.height,
  }
}

/** Whether trimming is worth it: bounds close to the whole frame mean "no margins". */
export function worthTrimming(bounds: Bounds, minimum = 0.01): boolean {
  return (
    bounds.x > minimum || bounds.y > minimum || bounds.w < 1 - minimum || bounds.h < 1 - minimum
  )
}

/**
 * Downscaled copy of the whole frame, proportions preserved.
 *
 * The square sample from palette.ts won't do here: it stretches the frame, and the
 * edge margins stop being margins.
 */
export function sampleImage(image: CanvasImageSource, side = 240): Sample | null {
  const width = Number((image as { naturalWidth?: number }).naturalWidth ?? 0)
  const height = Number((image as { naturalHeight?: number }).naturalHeight ?? 0)
  if (width === 0 || height === 0) return null

  const scale = Math.min(1, side / Math.max(width, height))
  const w = Math.max(1, Math.round(width * scale))
  const h = Math.max(1, Math.round(height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h

  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return null

  context.drawImage(image, 0, 0, w, h)
  return { data: context.getImageData(0, 0, w, h).data, width: w, height: h }
}
