import { useState } from 'react'

import type { MessageKey } from '@/core/i18n'
import type { Settings } from '@/core/storage/settings'
import { trackerFor, TRACKER_KINDS, type TrackerKind } from '@/core/trackers'
import { useT } from '@/core/ui/app-context'
import { Button } from '@/core/ui/components'
import { Chip } from '@/core/ui/controls'

import type { TrackerController } from '../useTracker'

/**
 * Screenshot straight to a ticket: title, description, and a button (PLAN.md §6).
 *
 * Page context (URL, browser, resolution) is appended automatically, so the panel
 * has no fields for it: nobody fills those in by hand, yet a bug report needs them.
 */
export function TrackerPanel({
  tracker,
  settings,
  defaultTitle,
}: {
  tracker: TrackerController
  settings: Settings
  /** Document title — usually doubles as the issue title. */
  defaultTitle: string
}) {
  const t = useT()
  const [kind, setKind] = useState<TrackerKind>(settings.tracker)
  const [title, setTitle] = useState(defaultTitle)
  const [description, setDescription] = useState('')

  const missing = trackerFor(kind).missing(settings.trackers[kind])
  const working = tracker.status === 'working'

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        {TRACKER_KINDS.map((option) => (
          <Chip
            key={option}
            active={kind === option}
            onClick={() => {
              setKind(option)
              tracker.reset()
            }}
          >
            {t(`tracker.${option}` as MessageKey)}
          </Chip>
        ))}
      </div>

      {missing ? (
        <p className="text-[11px] leading-relaxed text-text-muted">
          {t('tracker.notConfigured')}{' '}
          <button
            type="button"
            onClick={() => {
              void chrome.runtime.openOptionsPage()
            }}
            className="text-accent hover:underline"
          >
            {t('popup.openOptions')}
          </button>
        </p>
      ) : (
        <>
          <input
            value={title}
            aria-label={t('tracker.issueTitle')}
            placeholder={t('tracker.issueTitle')}
            onChange={(event) => {
              setTitle(event.target.value)
            }}
            className="h-8 rounded-control border border-border bg-surface-muted px-2 text-xs focus:border-border-strong focus:outline-none"
          />
          <textarea
            value={description}
            rows={3}
            aria-label={t('tracker.description')}
            placeholder={t('tracker.description')}
            onChange={(event) => {
              setDescription(event.target.value)
            }}
            className="resize-y rounded-control border border-border bg-surface-muted px-2 py-1.5 text-xs focus:border-border-strong focus:outline-none"
          />

          <Button
            variant="primary"
            size="sm"
            disabled={working}
            onClick={() => {
              void tracker.send(kind, title, description)
            }}
          >
            {working ? t('tracker.sending') : t('tracker.send')}
          </Button>

          <p className="text-[10px] leading-relaxed text-text-muted">{t('tracker.context')}</p>
        </>
      )}

      {tracker.issue ? (
        <p className="text-[11px] text-success">
          <a
            href={tracker.issue.url}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2"
          >
            {tracker.issue.key || t('tracker.created')}
          </a>
          {tracker.issue.warning ? ` · ${t('tracker.error.upload-failed')}` : ''}
        </p>
      ) : null}

      {tracker.error ? (
        <p role="alert" className="text-[11px] text-danger">
          {t(`tracker.error.${tracker.error.code}` as MessageKey)}
        </p>
      ) : null}
    </div>
  )
}
