/**
 * One-click redaction across the whole guide (PLAN.md §6.5).
 *
 * A single screenshot lets the user review findings one by one, but a guide of an
 * internal panel has far more of them (email in the header on every step, a token in
 * the address bar). Walking ten steps manually is the chore that makes people skip
 * redaction, so here it runs once over everything.
 *
 * Everything is local: OCR runs in the browser, and the only network request is a
 * one-time language dictionary download. Guide frames are never sent anywhere
 * (PLAN.md §7).
 */
import { useCallback, useState } from 'react'

import { frameRect } from '@/core/doc/canvas-presets'
import { addLayer, createLayer } from '@/core/doc/layers'
import type { Doc } from '@/core/doc/types'
import { type OcrLanguage, recognize } from '@/core/ocr/engine'
import { docPiiKind, findingsFrom } from '@/core/ocr/redact'
import { ensureStepDoc } from '@/core/scribe/guide'
import type { ScribeStep } from '@/core/scribe/timeline'
import { getDoc, getImage, putDoc } from '@/core/storage/db'

export type RedactState = {
  running: boolean
  /** Step currently being read: OCR takes seconds, so we must show progress. */
  done: number
  total: number
  /** Findings covered in the last run. */
  covered: number | null
}

/**
 * Redactions are added as layers in the step's document, so they show up in the layer
 * list and can be moved or removed — we never burn pixels anywhere, including here.
 *
 * Solid fill, not blur: blurred letters keep their shape, and a phone number is easy
 * to read when zoomed in. A see-through redaction is not a redaction.
 */
async function redactStep(step: ScribeStep, language: OcrLanguage): Promise<number> {
  if (!step.imageId) return 0

  const docId = await ensureStepDoc(step)
  if (!docId) return 0

  const stored = await getDoc(docId)
  const image = await getImage(step.imageId)
  if (!stored || !image) return 0

  // Feed the engine the blob straight from the DB — no point decoding the frame twice.
  const { words } = await recognize(image.blob, language)
  const findings = findingsFrom(words, { w: image.width, h: image.height }, frameRect(stored))
  if (findings.length === 0) return 0

  let doc: Doc = stored
  let covered = 0

  // One finding may need several patches: a long address wraps, one rect per line.
  for (const finding of findings) {
    for (const rect of finding.rects) {
      const layer = createLayer('redact', { rect })
      if (layer.kind !== 'redact') continue
      doc = addLayer(doc, {
        ...layer,
        name: finding.kind,
        mode: 'fill',
        piiKind: docPiiKind(finding.kind),
        source: 'ocr',
      })
      covered += 1
    }
  }

  await putDoc({ ...stored, ...doc, text: words.map((word) => word.text).join(' ') })
  return covered
}

export function useGuideRedact(): RedactState & {
  run: (steps: readonly ScribeStep[], language: OcrLanguage) => Promise<void>
} {
  const [state, setState] = useState<RedactState>({
    running: false,
    done: 0,
    total: 0,
    covered: null,
  })

  const run = useCallback(async (steps: readonly ScribeStep[], language: OcrLanguage) => {
    const withFrames = steps.filter((step) => step.imageId !== null)
    setState({ running: true, done: 0, total: withFrames.length, covered: null })

    let covered = 0
    for (const [at, step] of withFrames.entries()) {
      setState((current) => ({ ...current, done: at }))
      try {
        covered += await redactStep(step, language)
      } catch (error) {
        // One unreadable frame must not abort the run over the rest.
        console.warn('[kadr] the step could not be read', error)
      }
    }

    setState({ running: false, done: withFrames.length, total: withFrames.length, covered })
  }, [])

  return { ...state, run }
}
