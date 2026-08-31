/**
 * Sending the capture to a tracker: GitHub, Linear, or Jira with the user's token (PLAN.md §6).
 *
 * The same image as export goes out — the composed canvas, not the raw capture:
 * redacted content must stay redacted in the issue too.
 *
 * Settings are read on every send, not at mount: the token is set up in another tab
 * and the user comes back here without reloading the editor.
 */
import type Konva from 'konva'
import { type RefObject, useCallback, useState } from 'react'

import type { Doc } from '@/core/doc/types'
import { exportDocument } from '@/core/render/export'
import { buildFilename } from '@/core/render/filename'
import { readSettings } from '@/core/storage/settings'
import {
  contextFrom,
  type CreatedIssue,
  createIssue,
  hasAccess,
  issueBody,
  requestAccess,
  TrackerFailure,
  type TrackerKind,
} from '@/core/trackers'

export type TrackerStatus = 'idle' | 'working' | 'done' | 'failed'

export type TrackerController = {
  status: TrackerStatus
  issue: CreatedIssue | null
  error: TrackerFailure | null
  send: (kind: TrackerKind, title: string, description: string) => Promise<void>
  reset: () => void
}

export function useTracker(doc: Doc, stageRef: RefObject<Konva.Stage | null>): TrackerController {
  const [status, setStatus] = useState<TrackerStatus>('idle')
  const [issue, setIssue] = useState<CreatedIssue | null>(null)
  const [error, setError] = useState<TrackerFailure | null>(null)

  const send = useCallback(
    async (kind: TrackerKind, title: string, description: string) => {
      const stage = stageRef.current
      if (!stage) return

      setStatus('working')
      setError(null)
      setIssue(null)

      try {
        const settings = await readSettings()
        const config = settings.trackers[kind]

        // Host permission is requested before any network call and within the same
        // button press: without a user gesture Chrome will not show the prompt.
        if (!(await hasAccess(kind, config)) && !(await requestAccess(kind, config))) {
          throw new TrackerFailure('no-permission')
        }

        const image = await exportDocument(stage, doc, { format: 'png', quality: 1, scale: 1 })
        const filename = buildFilename(
          settings.filenameTemplate,
          { domain: doc.source?.domain ?? '', title: doc.title, date: new Date() },
          'png',
        )

        const context = contextFrom(doc.source, {
          w: doc.capture.width,
          h: doc.capture.height,
        })

        setIssue(
          await createIssue(kind, config, {
            title: title.trim() || doc.title,
            body: issueBody(description, context),
            image,
            filename,
          }),
        )
        setStatus('done')
      } catch (failure) {
        console.error('[kadr] the issue could not be created', failure)
        setError(
          failure instanceof TrackerFailure
            ? failure
            : new TrackerFailure('network', String(failure)),
        )
        setStatus('failed')
      }
    },
    [doc, stageRef],
  )

  const reset = useCallback(() => {
    setStatus('idle')
    setIssue(null)
    setError(null)
  }, [])

  return { status, issue, error, send, reset }
}
