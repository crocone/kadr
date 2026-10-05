/**
 * The uploaded background picture, decoded once.
 *
 * An image background is stored like any other image in the library — an id in the
 * document, the bytes in IndexedDB — so it has to be read and decoded before it can be
 * drawn. Doing that inside the draw loop would mean a decode per frame; doing it here
 * means one, and the same element goes to the player and the exporter.
 *
 * What is kept in state is the picture *together with the id it was loaded for*, and the
 * match is checked on the way out. Swapping the background then shows nothing rather than
 * the previous picture for a frame — and the hook never has to clear itself, which is
 * what turns a load into a render cascade.
 */
import { useEffect, useState } from 'react'

import type { Background, ImageId } from '@/core/doc/types'
import { getImage } from '@/core/storage/db'

type Loaded = { id: ImageId; element: HTMLImageElement }

export function useBackdrop(background: Background): HTMLImageElement | null {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const imageId = background.kind === 'image' ? background.imageId : null

  useEffect(() => {
    if (!imageId) return

    let url: string | null = null
    let live = true

    void (async () => {
      const stored = await getImage(imageId)
      if (!stored || !live) return

      url = URL.createObjectURL(stored.blob)
      const element = new Image()
      element.src = url
      // `decode` rather than `onload`: a picture that is loaded but not yet decoded still
      // costs a stall on the first frame that draws it.
      await element.decode().catch(() => undefined)
      if (live) setLoaded({ id: imageId, element })
    })()

    return () => {
      live = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [imageId])

  return loaded?.id === imageId ? loaded.element : null
}
