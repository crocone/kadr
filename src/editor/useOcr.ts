import { useCallback, useState } from 'react'

import { frameRect } from '@/core/doc/canvas-presets'
import { addLayer, createLayer } from '@/core/doc/layers'
import type { BlurLayer, Doc } from '@/core/doc/types'
import { type OcrLanguage, recognize } from '@/core/ocr/engine'
import { type Finding, findingsFrom } from '@/core/ocr/redact'

import type { DocumentController } from './useDocument'

export type OcrStatus = 'idle' | 'working' | 'done' | 'failed'

export type OcrController = {
  status: OcrStatus
  /** What is happening right now: dictionary download or the recognition itself. */
  stage: string
  progress: number
  findings: Finding[]
  error: string | null
  /** Recognize the capture and find private data in it. */
  scan: (language: OcrLanguage) => Promise<void>
  /** Redact the findings: each patch becomes a regular blur layer. */
  redact: (findings: readonly Finding[]) => void
  clear: () => void
}

/**
 * Local private-data detection.
 *
 * The capture never leaves: recognition runs in the browser, and the only outbound
 * request is a one-time fetch of the language dictionary. Findings are not redacted
 * automatically: layers are created by a separate click, and until then the person
 * sees the list of findings.
 */
export function useOcr(
  doc: Doc,
  frame: HTMLImageElement | null,
  controller: DocumentController,
): OcrController {
  const [status, setStatus] = useState<OcrStatus>('idle')
  const [stage, setStage] = useState('')
  const [progress, setProgress] = useState(0)
  const [findings, setFindings] = useState<Finding[]>([])
  const [error, setError] = useState<string | null>(null)

  const scan = useCallback(
    async (language: OcrLanguage) => {
      if (!frame) return

      setStatus('working')
      setError(null)
      setFindings([])

      try {
        const { words } = await recognize(frame, language, (nextStage, ratio) => {
          setStage(nextStage)
          setProgress(ratio)
        })

        // Word coordinates are in image pixels; layers live in document coordinates.
        const image = { w: frame.naturalWidth, h: frame.naturalHeight }
        setFindings(findingsFrom(words, image, frameRect(doc)))

        // Recognized text stays with the document: the library searches by it.
        // For free: the text is already assembled, and re-running OCR just for search takes minutes.
        controller.setText(words.map((word) => word.text).join(' '))
        setStatus('done')
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : String(failure))
        setStatus('failed')
      }
    },
    [controller, doc, frame],
  )

  const redact = useCallback(
    (chosen: readonly Finding[]) => {
      controller.commit((current) => {
        let next = current

        for (const finding of chosen) {
          for (const rect of finding.rects) {
            const layer = createLayer('blur', { rect }) as BlurLayer
            next = addLayer(next, { ...layer, name: finding.kind, strength: 14 })
          }
        }

        return next
      })

      // Redacted findings leave the list: otherwise it is unclear what is already done.
      setFindings((current) => current.filter((finding) => !chosen.includes(finding)))
    },
    [controller],
  )

  const clear = useCallback(() => {
    setFindings([])
    setStatus('idle')
    setError(null)
  }, [])

  return { status, stage, progress, findings, error, scan, redact, clear }
}
