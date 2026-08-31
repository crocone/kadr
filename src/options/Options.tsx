import { LOCALE_LABELS, LOCALES } from '@/core/i18n'
import type { Settings } from '@/core/storage/settings'
import { useApp } from '@/core/ui/app-context'
import { Card, Field, Select, Toggle } from '@/core/ui/components'

import { AiSettings } from './AiSettings'
import { TrackerSettings } from './TrackerSettings'

const CAPTURE_DELAYS: Settings['captureDelaySec'][] = [0, 3, 5, 10]

export function Options() {
  const { t, settings, updateSettings } = useApp()

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 p-8">
      <header className="flex items-center gap-2.5">
        <span className="h-[22px] w-[22px] rounded-md bg-accent" />
        <h1 className="text-base font-semibold">{t('app.name')}</h1>
        <span className="font-mono text-[11px] tracking-[0.08em] text-text-muted uppercase">
          {t('options.title')}
        </span>
      </header>

      <Card className="flex flex-col gap-4 p-5">
        <h2 className="font-mono text-[10px] tracking-[0.1em] text-text-muted uppercase">
          {t('options.appearance')}
        </h2>
        <Field label={t('options.theme')}>
          <Select
            value={settings.theme}
            onChange={(event) =>
              void updateSettings({ theme: event.target.value as Settings['theme'] })
            }
          >
            <option value="system">{t('options.theme.system')}</option>
            <option value="light">{t('options.theme.light')}</option>
            <option value="dark">{t('options.theme.dark')}</option>
          </Select>
        </Field>
        <Field label={t('options.language')}>
          <Select
            value={settings.locale}
            onChange={(event) =>
              void updateSettings({ locale: event.target.value as Settings['locale'] })
            }
          >
            <option value="system">{t('options.language.system')}</option>
            {LOCALES.map((locale) => (
              <option key={locale} value={locale}>
                {LOCALE_LABELS[locale]}
              </option>
            ))}
          </Select>
        </Field>
      </Card>

      <Card className="flex flex-col gap-4 p-5">
        <h2 className="font-mono text-[10px] tracking-[0.1em] text-text-muted uppercase">
          {t('options.capture')}
        </h2>
        <Field label={t('options.captureDelay')}>
          <Select
            value={String(settings.captureDelaySec)}
            onChange={(event) =>
              void updateSettings({
                captureDelaySec: Number(event.target.value) as Settings['captureDelaySec'],
              })
            }
          >
            {CAPTURE_DELAYS.map((delay) => (
              <option key={delay} value={delay}>
                {delay === 0
                  ? t('options.captureDelay.none')
                  : t('options.captureDelay.seconds', { n: delay })}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('options.filenameTemplate')}>
          <input
            value={settings.filenameTemplate}
            onChange={(event) => void updateSettings({ filenameTemplate: event.target.value })}
            className="h-8 rounded-control border border-border bg-surface-muted px-2 font-mono text-xs text-text"
          />
        </Field>
      </Card>

      <Card className="flex flex-col gap-3 p-5">
        <h2 className="font-mono text-[10px] tracking-[0.1em] text-text-muted uppercase">
          {t('options.ai')}
        </h2>
        <Toggle
          checked={settings.aiEnabled}
          onChange={(checked) => void updateSettings({ aiEnabled: checked })}
          label={t('options.aiEnabled')}
        />
        <p className="text-[11px] leading-relaxed text-text-muted">{t('options.ai.hint')}</p>

        {settings.aiEnabled ? <AiSettings /> : null}
      </Card>

      <Card className="flex flex-col gap-3 p-5">
        <h2 className="font-mono text-[10px] tracking-[0.1em] text-text-muted uppercase">
          {t('options.trackers')}
        </h2>
        <TrackerSettings />
      </Card>

      <Card className="flex flex-col gap-2 p-5">
        <h2 className="font-mono text-[10px] tracking-[0.1em] text-text-muted uppercase">
          {t('options.privacy')}
        </h2>
        <p className="text-[11px] leading-relaxed text-text-muted">{t('options.privacy.body')}</p>
      </Card>
    </div>
  )
}
