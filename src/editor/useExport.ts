/**
 * Document export: format/density state plus the actions themselves.
 *
 * A separate hook because there are two entry points — the "Download" popover and
 * the hotkeys with the command palette. Writing the logic twice would let filenames
 * and quality drift apart.
 */
import type Konva from 'konva'
import { type RefObject, useCallback, useMemo, useState } from 'react'

import type { Doc } from '@/core/doc/types'
import { estimateBytes } from '@/core/render/estimate'
import {
  ClipboardTooLarge,
  copyImage,
  type ExportFormat,
  EXTENSION,
  exportDocument,
  maxExportScale,
  saveBlob,
} from '@/core/render/export'
import { ANONYMOUS_TEMPLATE, buildFilename } from '@/core/render/filename'
import { editorLink, isShareTargetReady, type ShareTarget } from '@/core/share/targets'
import { getImage } from '@/core/storage/db'
import { readSettings } from '@/core/storage/settings'

export type ExportStatus = 'idle' | 'working' | 'copied' | 'failed' | 'too-big'

/**
 * Density instead of a free multiplier: x1, x2, x3 are the only values anyone picks
 * deliberately, while a 0.25-step slider invited choices like 1.75.
 */
export type Density = 1 | 2 | 3

export const DENSITIES: readonly Density[] = [1, 2, 3]

export type ExportController = {
  format: ExportFormat
  setFormat: (format: ExportFormat) => void
  quality: number
  setQuality: (quality: number) => void
  density: Density
  setDensity: (density: Density) => void
  /** Chrome's canvas cannot go beyond this density: higher options are disabled. */
  maxDensity: Density
  /** Export without the page URL and title — starting with the filename. */
  stripMeta: boolean
  setStripMeta: (strip: boolean) => void
  targets: readonly ShareTarget[]
  toggleTarget: (target: ShareTarget) => void
  /** Expected output: pixel size and approximate file weight. */
  output: { width: number; height: number; bytes: number }
  status: ExportStatus
  /** Link to the capture that went to the clipboard with the last download. */
  sharedLink: string | null
  save: () => void
  copy: () => void
  saveOriginal: () => void
}

export function useExport(doc: Doc, stageRef: RefObject<Konva.Stage | null>): ExportController {
  const [format, setFormat] = useState<ExportFormat>('png')
  const [quality, setQuality] = useState(0.92)
  const [density, setDensity] = useState<Density>(1)
  const [stripMeta, setStripMeta] = useState(false)
  const [targets, setTargets] = useState<readonly ShareTarget[]>([])
  const [status, setStatus] = useState<ExportStatus>('idle')
  const [sharedLink, setSharedLink] = useState<string | null>(null)

  const maxDensity = useMemo<Density>(() => {
    const limit = Math.floor(maxExportScale(doc))
    return DENSITIES.filter((value) => value <= limit).at(-1) ?? 1
  }, [doc])

  // Density above the canvas limit is silently clamped instead of failing at export.
  const scale = Math.min(density, maxDensity)

  const output = useMemo(() => {
    const width = Math.round(doc.canvas.w * scale)
    const height = Math.round(doc.canvas.h * scale)
    return { width, height, bytes: estimateBytes(width, height, { format, quality }) }
  }, [doc.canvas.w, doc.canvas.h, format, quality, scale])

  /**
   * Filename. With the metadata toggle on, the domain and page title are omitted
   * entirely: the file leaves for other hands, and the name is its most visible part.
   */
  const filenameFor = useCallback(
    async (extension: string, anonymous: boolean) => {
      const settings = await readSettings()
      return buildFilename(
        anonymous ? ANONYMOUS_TEMPLATE : settings.filenameTemplate,
        anonymous
          ? { domain: '', title: '', date: new Date() }
          : { domain: doc.source?.domain ?? '', title: doc.title, date: new Date() },
        extension,
      )
    },
    [doc.source?.domain, doc.title],
  )

  const toggleTarget = useCallback((target: ShareTarget) => {
    if (!isShareTargetReady(target)) return
    setTargets((current) =>
      current.includes(target) ? current.filter((value) => value !== target) : [...current, target],
    )
  }, [])

  const run = useCallback(
    (action: 'save' | 'copy') => {
      const stage = stageRef.current
      if (!stage) return

      setStatus('working')
      setSharedLink(null)
      void (async () => {
        try {
          if (action === 'copy') {
            // Browsers reliably accept only PNG on the clipboard.
            const blob = await exportDocument(stage, doc, { format: 'png', quality: 1, scale })
            await copyImage(blob)
            setStatus('copied')
            setTimeout(() => {
              setStatus('idle')
            }, 1500)
            return
          }

          const blob = await exportDocument(stage, doc, { format, quality, scale })
          await saveBlob(blob, await filenameFor(EXTENSION[format], stripMeta))

          // The link goes to the clipboard after the download: had the export failed,
          // there would be nothing to share, yet the clipboard would already be clobbered.
          if (targets.includes('link')) {
            const link = editorLink(doc.id)
            await navigator.clipboard.writeText(link)
            setSharedLink(link)
          }
          setStatus('idle')
        } catch (error) {
          console.error('[kadr] export failed', error)
          setStatus(error instanceof ClipboardTooLarge ? 'too-big' : 'failed')
        }
      })()
    },
    [doc, filenameFor, format, quality, scale, stageRef, stripMeta, targets],
  )

  /** The original leaves as is: no background, no shadow, no recompression. */
  const saveOriginal = useCallback(() => {
    void (async () => {
      const stored = await getImage(doc.capture.imageId)
      if (!stored) return
      await saveBlob(stored.blob, await filenameFor('png', stripMeta))
    })()
  }, [doc.capture.imageId, filenameFor, stripMeta])

  return {
    format,
    setFormat,
    quality,
    setQuality,
    density,
    setDensity,
    maxDensity,
    stripMeta,
    setStripMeta,
    targets,
    toggleTarget,
    output,
    status,
    sharedLink,
    save: () => {
      run('save')
    },
    copy: () => {
      run('copy')
    },
    saveOriginal,
  }
}
