/**
 * Rough file size prediction.
 *
 * The export panel shows the size before the frame is rendered: the real size is only
 * known after `toBlob`, which takes seconds on a long scrolled capture — we can't run
 * a background render on every toggle just for a header caption.
 *
 * Coefficients were measured on UI screenshots — large flat fills, sharp edges,
 * little noise. For photos the estimate runs low, which is why the UI shows "≈"
 * before the number: promising precision we don't have is worse than not promising.
 */
import type { ExportFormat } from './export'

/** PNG bytes per pixel: it has no quality knob, content decides everything. */
const PNG_BYTES_PER_PIXEL = 0.52

/**
 * JPEG size grows roughly with the square of quality: ~0.25 B/pixel at 0.92, ~0.11
 * at 0.6. WebP at the same quality is consistently about a third lighter.
 */
const JPEG_BYTES_PER_PIXEL = 0.3
const WEBP_RATIO = 0.7

/** PDF structural objects: catalog, page tree, xref. Only noticeable on a tiny frame. */
const PDF_OVERHEAD_BYTES = 2048

export function estimateBytes(
  width: number,
  height: number,
  options: { format: ExportFormat; quality: number },
): number {
  const pixels = Math.max(0, Math.round(width)) * Math.max(0, Math.round(height))
  if (pixels === 0) return 0

  const quality = Math.min(1, Math.max(0, options.quality))
  const jpeg = pixels * JPEG_BYTES_PER_PIXEL * quality * quality

  switch (options.format) {
    case 'png':
      return Math.round(pixels * PNG_BYTES_PER_PIXEL)
    case 'jpeg':
      return Math.round(jpeg)
    case 'webp':
      return Math.round(jpeg * WEBP_RATIO)
    case 'pdf':
      // A PDF holds the same JPEGs — plus a white backdrop under a transparent background.
      return Math.round(jpeg + PDF_OVERHEAD_BYTES)
  }
}

export type SizeParts = { value: number; unit: 'kb' | 'mb' }

/**
 * Bytes to a number with a unit. The unit is a key, not a string: the "KB" and "MB"
 * labels live in the i18n dictionary, not in core.
 */
export function sizeParts(bytes: number): SizeParts {
  const kb = bytes / 1024
  if (kb < 999) return { value: Math.max(1, Math.round(kb)), unit: 'kb' }
  return { value: Math.round((kb / 1024) * 10) / 10, unit: 'mb' }
}
