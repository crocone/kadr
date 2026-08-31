import { useState } from 'react'

import type { MessageKey } from '@/core/i18n'
import { trackerFor, TRACKER_KINDS, type TrackerConfig, type TrackerKind } from '@/core/trackers'
import { useApp } from '@/core/ui/app-context'
import { Field, Select } from '@/core/ui/components'
import { Chip } from '@/core/ui/controls'

/** Where to get a token: each tracker has its own issuance page. */
const TOKEN_PAGE: Record<TrackerKind, string> = {
  github: 'https://github.com/settings/tokens',
  linear: 'https://linear.app/settings/api',
  jira: 'https://id.atlassian.com/manage-profile/security/api-tokens',
}

const input =
  'h-8 rounded-control border border-border bg-surface-muted px-2 font-mono text-xs text-text'

/**
 * Tracker tokens. Stored in `chrome.storage.local` next to the AI key, for the same
 * reason: in `sync` they would end up in Google's cloud.
 *
 * Trackers are shown one at a time: three field sets at once are a wall that hides
 * which one is actually configured.
 */
export function TrackerSettings() {
  const { t, settings, updateSettings } = useApp()
  const [shown, setShown] = useState<TrackerKind>(settings.tracker)

  const config = settings.trackers[shown]
  const ready = trackerFor(shown).missing(config) === null

  const patch = (change: Partial<TrackerConfig>) => {
    void updateSettings({
      trackers: { ...settings.trackers, [shown]: { ...config, ...change } },
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[11px] leading-relaxed text-text-muted">{t('options.trackers.hint')}</p>

      <div className="flex flex-wrap items-center gap-1.5">
        {TRACKER_KINDS.map((kind) => (
          <Chip
            key={kind}
            active={shown === kind}
            onClick={() => {
              setShown(kind)
            }}
          >
            {t(`tracker.${kind}` as MessageKey)}
          </Chip>
        ))}
        <span
          className={`ml-auto font-mono text-[10px] ${ready ? 'text-success' : 'text-text-muted'}`}
        >
          {ready ? t('options.trackers.ready') : t('options.trackers.missing')}
        </span>
      </div>

      {shown === 'jira' ? (
        <>
          <Field label={t('options.trackers.jira.baseUrl')}>
            <input
              value={config.baseUrl}
              spellCheck={false}
              placeholder="https://team.atlassian.net"
              onChange={(event) => {
                patch({ baseUrl: event.target.value })
              }}
              className={input}
            />
          </Field>
          <Field label={t('options.trackers.jira.email')}>
            <input
              value={config.email}
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => {
                patch({ email: event.target.value })
              }}
              className={input}
            />
          </Field>
        </>
      ) : null}

      <Field
        label={t('options.trackers.project')}
        hint={t(`options.trackers.${shown}.hint` as MessageKey)}
      >
        <input
          value={config.project}
          spellCheck={false}
          placeholder={t(`options.trackers.${shown}.project` as MessageKey)}
          onChange={(event) => {
            patch({ project: event.target.value })
          }}
          className={input}
        />
      </Field>

      <Field label={t('options.trackers.token')}>
        <input
          type="password"
          value={config.token}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => {
            patch({ token: event.target.value })
          }}
          className={input}
        />
      </Field>

      <a
        href={TOKEN_PAGE[shown]}
        target="_blank"
        rel="noreferrer"
        className="text-[11px] text-accent hover:underline"
      >
        {t('options.trackers.getToken')}
      </a>

      <Field label={t('options.trackers.default')}>
        <Select
          value={settings.tracker}
          onChange={(event) => void updateSettings({ tracker: event.target.value as TrackerKind })}
        >
          {TRACKER_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {t(`tracker.${kind}` as MessageKey)}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  )
}
