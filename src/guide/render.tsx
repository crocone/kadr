/**
 * Offscreen document rendering.
 *
 * A guide is exported as a whole — ten steps to markdown, PDF, or one long image — and
 * there is no live editor here to render them in. So the scene is assembled in a
 * temporary container using the same `DocScene` that draws everything else. A second
 * renderer would breed its own "looks right on screen, wrong in the file" bugs — the
 * very thing the document model exists to prevent.
 *
 * The container lives off the edge of the window, not in `display: none`: Chrome does
 * not rasterize a hidden canvas, so there would be nothing to capture.
 */
import type Konva from 'konva'
import { createRoot, type Root } from 'react-dom/client'
import { Stage as KonvaStage } from 'react-konva'

import type { Doc } from '@/core/doc/types'
import { renderDocument } from '@/core/render/export'
import { imageIdsOf } from '@/core/storage/library'

import { DocScene } from '@/editor/DocScene'
import { loadStoredImage } from '@/editor/useStoredImage'

/** How long to wait for react-konva to paint the first frame. */
const PAINT_TIMEOUT_MS = 5000

function offscreenContainer(): HTMLElement {
  const host = document.createElement('div')
  host.style.position = 'fixed'
  host.style.left = '-100000px'
  host.style.top = '0'
  host.style.pointerEvents = 'none'
  document.body.append(host)
  return host
}

/**
 * Preload every image of the document into the cache before the first render.
 *
 * Frame, background, and mockup go into `DocScene` as props, but each image layer loads
 * itself via `useStoredImage`. That load is async, and the snapshot is taken on the very
 * first paint — so a document whose entire content lives in layers (exactly the long
 * guide sheet) used to export as an empty file.
 *
 * The fix is ordering, not waiting: `useStoredImage` returns cached entries
 * synchronously on the first render — everything just has to be in the cache upfront.
 */
async function imagesOf(doc: Doc): Promise<{
  frame: HTMLImageElement | null
  background: HTMLImageElement | null
  mockup: HTMLImageElement | null
}> {
  const [frame, background, mockup] = await Promise.all([
    doc.capture.imageId ? loadStoredImage(doc.capture.imageId) : null,
    doc.canvas.background.kind === 'image' ? loadStoredImage(doc.canvas.background.imageId) : null,
    doc.canvas.customMockup ? loadStoredImage(doc.canvas.customMockup.imageId) : null,
    ...imageIdsOf(doc).map((id) => loadStoredImage(id)),
  ])
  return { frame, background, mockup }
}

/**
 * Render a document to a canvas. Everything needed for the shot is loaded upfront:
 * an empty frame in the exported file is a defect only the reader would notice.
 */
export async function renderDocOffscreen(doc: Doc, scale = 2): Promise<HTMLCanvasElement> {
  const { frame, background, mockup } = await imagesOf(doc)
  const host = offscreenContainer()
  const root: Root = createRoot(host)

  try {
    const stage = await new Promise<Konva.Stage>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('the offscreen stage never painted'))
      }, PAINT_TIMEOUT_MS)

      root.render(
        <KonvaStage
          width={doc.canvas.w}
          height={doc.canvas.h}
          ref={(node: Konva.Stage | null) => {
            if (!node) return
            clearTimeout(timer)
            // Let react-konva finish the current pass: the ref arrives before the
            // children are drawn, and a snapshot at that point would be empty.
            requestAnimationFrame(() => {
              resolve(node)
            })
          }}
        >
          <DocScene
            doc={doc}
            frame={frame}
            background={background}
            mockupImage={mockup}
            showSafeZones={false}
            interactive={false}
          />
        </KonvaStage>,
      )
    })

    return await renderDocument(stage, doc, scale)
  } finally {
    // Defer unmounting: React complains about unmount during render, and the canvas
    // has already been handed to us as a separate object by this point.
    setTimeout(() => {
      root.unmount()
      host.remove()
    }, 0)
  }
}

export async function renderDocBlob(doc: Doc, scale = 2): Promise<Blob> {
  const canvas = await renderDocOffscreen(doc, scale)
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('the canvas produced no blob'))
    }, 'image/png')
  })
}
