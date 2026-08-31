/**
 * Pixel operations live in the service worker: it has OffscreenCanvas and
 * createImageBitmap, so stitching needs neither a tab nor an offscreen document.
 */
import type { Rect } from '@/core/doc/types'

import { thumbnailSize } from './plan'

export async function dataUrlToBitmap(dataUrl: string): Promise<ImageBitmap> {
  const response = await fetch(dataUrl)
  return createImageBitmap(await response.blob())
}

export async function blobToBitmap(blob: Blob): Promise<ImageBitmap> {
  return createImageBitmap(blob)
}

function draw(
  width: number,
  height: number,
  paint: (ctx: OffscreenCanvasRenderingContext2D) => void,
) {
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('OffscreenCanvas 2d context unavailable')
  paint(ctx)
  return canvas
}

export async function cropBitmap(bitmap: ImageBitmap, rect: Rect): Promise<Blob> {
  const canvas = draw(rect.w, rect.h, (ctx) => {
    ctx.drawImage(bitmap, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h)
  })
  return canvas.convertToBlob({ type: 'image/png' })
}

export async function bitmapToBlob(bitmap: ImageBitmap): Promise<Blob> {
  const canvas = draw(bitmap.width, bitmap.height, (ctx) => {
    ctx.drawImage(bitmap, 0, 0)
  })
  return canvas.convertToBlob({ type: 'image/png' })
}

/**
 * Narrow frame thumbnail for content matching.
 *
 * Width shrinks to 64, height stays one-to-one: the shift is found per row, and
 * compressing rows would lose exactly the precision this exists for. Horizontal
 * averaging actually helps — anti-aliasing and subpixel rendering blur away with
 * the rest.
 */
export function downscaleRegion(bitmap: ImageBitmap, rect: Rect, width: number): ImageData {
  const canvas = draw(width, rect.h, (ctx) => {
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'low'
    ctx.drawImage(bitmap, rect.x, rect.y, rect.w, rect.h, 0, 0, width, rect.h)
  })

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('OffscreenCanvas 2d context unavailable')
  return ctx.getImageData(0, 0, width, rect.h)
}

/**
 * Thumbnail for the recents strip. JPEG instead of PNG: a thousand library
 * documents must not weigh hundreds of megabytes.
 */
export async function makeThumbnail(bitmap: ImageBitmap, max = 320): Promise<Blob> {
  const { width, height } = thumbnailSize(bitmap.width, bitmap.height, max)
  const canvas = draw(width, height, (ctx) => {
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, width, height)
  })
  return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 })
}
