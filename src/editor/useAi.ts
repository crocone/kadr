import type Konva from 'konva'
import { type RefObject, useCallback, useState } from 'react'

import { cacheKeyFor, createCache } from '@/core/ai/cache'
import { runAi, runImageEdit } from '@/core/ai/client'
import { nearestImageSize } from '@/core/ai/images'
import { recordSpend } from '@/core/ai/spend'
import { AiFailure, type AiConfig, type AiImage, type AiRequest } from '@/core/ai/types'
import type { Doc } from '@/core/doc/types'
import { exportDocument } from '@/core/render/export'
import { readSettings } from '@/core/storage/settings'

export type AiStatus = 'idle' | 'working' | 'done' | 'failed'

export type AiController = {
  status: AiStatus
  /** Last answer and where it came from: network or cache. */
  answer: string
  cached: boolean
  error: AiFailure | null
  run: (prompt: string, output: AiRequest['output']) => Promise<void>
  /** Edit the capture with words: the result comes back as an image and lands as a layer. */
  edit: (prompt: string) => Promise<Blob | null>
  clear: () => void
}

/** No point sending a larger image: models downscale it anyway. */
const MAX_SIDE = 1600

/**
 * What goes to the model is what is visible on canvas, not the original capture.
 *
 * Otherwise the answer would disagree with the picture: redacted parts would stay
 * visible to the model, while drawn arrows and labels would never reach it. It is
 * also exactly the image to show in the "what gets sent" preview.
 */
async function canvasBlob(stage: Konva.Stage, doc: Doc): Promise<Blob> {
  const scale = Math.min(1, MAX_SIDE / Math.max(doc.canvas.w, doc.canvas.h))
  return exportDocument(stage, doc, { format: 'png', quality: 1, scale })
}

async function canvasImage(stage: Konva.Stage, doc: Doc): Promise<AiImage> {
  const blob = await canvasBlob(stage, doc)

  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      // FileReader yields a data URL; the provider only wants the payload.
      const url = typeof reader.result === 'string' ? reader.result : ''
      resolve(url.split(',')[1] ?? '')
    }
    reader.onerror = () => {
      reject(new Error('cannot read the canvas'))
    }
    reader.readAsDataURL(blob)
  })

  return { base64, mediaType: 'image/png' }
}

/**
 * Runs a prompt against the current canvas.
 *
 * Settings are read on every run, not at mount: the key and model are edited in
 * another tab, and picking them up only after an editor reload would be an
 * annoying little bug.
 */
export function useAi(doc: Doc, stageRef: RefObject<Konva.Stage | null>): AiController {
  const [status, setStatus] = useState<AiStatus>('idle')
  const [answer, setAnswer] = useState('')
  const [cached, setCached] = useState(false)
  const [error, setError] = useState<AiFailure | null>(null)

  const run = useCallback(
    async (prompt: string, output: AiRequest['output']) => {
      const stage = stageRef.current
      if (!stage) return

      setStatus('working')
      setError(null)

      try {
        const settings = await readSettings()
        const config: AiConfig = {
          transport: settings.aiTransport,
          baseUrl: settings.aiBaseUrl,
          model: settings.aiModel,
          apiKey: settings.aiKey,
        }

        const request: AiRequest = { prompt, image: await canvasImage(stage, doc), output }

        const result = await runAi(config, request, {
          fetch: globalThis.fetch.bind(globalThis),
          cache: createCache(),
          cacheKey: await cacheKeyFor(config, request),
          onSpend: (usage) => recordSpend(usage).then(() => undefined),
        })

        setAnswer(result.text)
        setCached(result.cached)
        setStatus('done')
      } catch (failure) {
        setError(failure instanceof AiFailure ? failure : new AiFailure('network', String(failure)))
        setStatus('failed')
      }
    },
    [doc, stageRef],
  )

  /**
   * Model-driven image edit. Settings are read the same way as for the text request —
   * they share the key and model — but there is no cache: the same request meaningfully
   * yields a different picture, and a retry is an attempt to get a better one.
   */
  const edit = useCallback(
    async (prompt: string) => {
      const stage = stageRef.current
      if (!stage) return null

      setStatus('working')
      setError(null)

      try {
        const settings = await readSettings()
        const config: AiConfig = {
          transport: settings.aiTransport,
          baseUrl: settings.aiBaseUrl,
          // A dedicated model: a chat model on /images/edits answers with a 400,
          // and a human would have to decipher the provider's error text.
          model: settings.aiImageModel,
          apiKey: settings.aiKey,
        }

        if (config.model.trim() === '') throw new AiFailure('no-image-model')

        const picture = await runImageEdit(
          config,
          {
            prompt,
            image: await canvasBlob(stage, doc),
            // Without a size the model answers with a square, and a wide capture
            // comes back cropped — with no way to tell model invention from wrong size.
            size: nearestImageSize(doc.canvas.w, doc.canvas.h),
          },
          { fetch: globalThis.fetch.bind(globalThis) },
        )

        setStatus('done')
        setAnswer('')
        return picture
      } catch (failure) {
        setError(failure instanceof AiFailure ? failure : new AiFailure('network', String(failure)))
        setStatus('failed')
        return null
      }
    },
    [doc, stageRef],
  )

  const clear = useCallback(() => {
    setAnswer('')
    setError(null)
    setStatus('idle')
  }, [])

  return { status, answer, cached, error, run, edit, clear }
}
