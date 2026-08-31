import { useEffect, useState } from 'react'

import { buildStepDoc } from '@/core/scribe/build'
import { resolveStyle, type ScribeStyle } from '@/core/scribe/style'
import type { ScribeStep, StepId } from '@/core/scribe/timeline'
import { getImage } from '@/core/storage/db'

import { renderDocBlob } from './render'

/** Preview width in CSS pixels. Small on purpose: ten of these are drawn at a time. */
const PREVIEW_WIDTH = 480

/** How long the inputs must sit still before the list is redrawn. */
const SETTLE_MS = 400

async function renderPreview(step: ScribeStep, style: ScribeStyle): Promise<Blob | null> {
  if (!step.imageId) return null

  const image = await getImage(step.imageId)
  if (!image) return null

  const doc = buildStepDoc(
    step,
    {
      imageId: step.imageId,
      width: Math.round(image.width / image.dpr),
      height: Math.round(image.height / image.dpr),
    },
    style,
  )
  if (!doc) return null

  return await renderDocBlob(doc, Math.min(1, PREVIEW_WIDTH / doc.canvas.w))
}

/** What a preview depends on. Redrawing on an unrelated change would be wasted work. */
function signatureOf(steps: readonly ScribeStep[], style: ScribeStyle): string {
  const rows = steps.map((step) => `${step.id}:${step.index}:${step.imageId ?? ''}:${step.caption}`)
  return JSON.stringify([rows, style])
}

/**
 * Step previews, drawn by the same renderer as the export.
 *
 * The list used to show the raw captured frame, so changing the annotation style changed
 * nothing on screen — the outline, the badge and the caption only appeared in the
 * exported file. Reusing the export renderer is what keeps the two from drifting apart.
 *
 * Rendering is sequential: each preview mounts its own offscreen stage, and ten at once
 * would fight for the same main thread with nothing gained.
 */
export function useStepPreviews(
  steps: readonly ScribeStep[],
  style: ScribeStyle,
): Map<StepId, Blob> {
  const [previews, setPreviews] = useState<Map<StepId, Blob>>(new Map())
  const signature = signatureOf(steps, resolveStyle(style))

  useEffect(() => {
    let cancelled = false

    // Captions are edited letter by letter, and each keystroke changes the signature.
    // Without the wait every keystroke would redraw the whole list.
    const timer = setTimeout(() => {
      void (async () => {
        const drawn = new Map<StepId, Blob>()
        for (const step of steps) {
          if (cancelled) return
          try {
            const blob = await renderPreview(step, resolveStyle(style))
            if (blob) drawn.set(step.id, blob)
          } catch (error) {
            console.warn('[kadr] the step preview could not be drawn', error)
          }
          // Published as they come: a long guide should not sit blank until the last.
          if (!cancelled) setPreviews(new Map(drawn))
        }
      })()
    }, SETTLE_MS)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- signature covers both
  }, [signature])

  return previews
}
