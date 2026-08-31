import { useEffect, useState } from 'react'

import type { ImageId } from '@/core/doc/types'
import { getImage } from '@/core/storage/db'

/**
 * Document images as ready `HTMLImageElement`s for Konva.
 *
 * Loaded images sit in a page-level cache, and `useStoredImage` returns them on the
 * very first render. That is not just speed: the library shoots documents off-screen
 * and must know the background and capture are in place at shoot time — otherwise an
 * empty scene would end up in the file (see `render-offscreen`).
 *
 * The object URL is revoked right after loading: by then the element already holds
 * the decoded image, and a live blob reference would keep its memory from being freed.
 */
const cache = new Map<ImageId, HTMLImageElement>()

/** How many images to keep. A full-page scroll capture weighs tens of megabytes. */
const CACHE_LIMIT = 64

function remember(id: ImageId, element: HTMLImageElement): HTMLImageElement {
  cache.set(id, element)
  // Map preserves insertion order, so the first key is the oldest.
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next()
    if (oldest.done) break
    cache.delete(oldest.value)
  }
  return element
}

/** The image, if already loaded. Synchronous, no database trip. */
export function cachedStoredImage(id: ImageId | null): HTMLImageElement | null {
  return id ? (cache.get(id) ?? null) : null
}

export async function loadStoredImage(id: ImageId): Promise<HTMLImageElement | null> {
  const ready = cache.get(id)
  if (ready) return ready

  const stored = await getImage(id)
  if (!stored) return null

  const url = URL.createObjectURL(stored.blob)
  try {
    const element = new window.Image()
    await new Promise<void>((resolve, reject) => {
      element.onload = () => {
        resolve()
      }
      element.onerror = () => {
        reject(new Error(`the image ${id} could not be decoded`))
      }
      element.src = url
    })
    return remember(id, element)
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function useStoredImage(imageId: ImageId | null): HTMLImageElement | null {
  // State here is not the source of truth but a reference holder: the cache is the
  // truth, and this copy keeps eviction from yanking the image out from under a
  // component that is already showing it.
  const [loaded, setLoaded] = useState<{ id: ImageId; element: HTMLImageElement } | null>(null)

  useEffect(() => {
    // Already-loaded images are picked up by the render itself — routing the cache
    // through state would cost an extra pass on every frame change.
    if (!imageId || cache.has(imageId)) return

    let cancelled = false
    void loadStoredImage(imageId).then(
      (element) => {
        if (!cancelled && element) setLoaded({ id: imageId, element })
      },
      (error: unknown) => {
        console.error('[kadr] the image could not be loaded', error)
      },
    )

    return () => {
      cancelled = true
    }
  }, [imageId])

  return cachedStoredImage(imageId) ?? (loaded?.id === imageId ? loaded.element : null)
}
