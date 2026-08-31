import { useEffect, useState } from 'react'

import { clearCache } from '@/core/ai/cache'
import { isLocalEndpoint, PRESETS, presetForUrl, type PresetId } from '@/core/ai/presets'
import { readSpend, resetSpend, type Spend } from '@/core/ai/spend'
import type { Transport } from '@/core/ai/types'
import { useApp } from '@/core/ui/app-context'
import { Button, Field, Select } from '@/core/ui/components'

/**
 * AI connection: transport, base URL, model, key, and a spend counter.
 *
 * A provider here is a URL plus a model name, not a list entry: presets merely fill
 * the fields. So users can connect providers the extension knows nothing about, and
 * fix a renamed model by hand without waiting for an update.
 */
export function AiSettings() {
  const { t, settings, updateSettings } = useApp()
  const [spend, setSpend] = useState<Spend | null>(null)
  const [cleared, setCleared] = useState(false)

  useEffect(() => {
    void readSpend().then(setSpend)
  }, [])

  const preset = presetForUrl(settings.aiBaseUrl)
  const local = isLocalEndpoint(settings.aiBaseUrl)

  const applyPreset = (id: PresetId) => {
    const chosen = PRESETS.find((item) => item.id === id)
    if (!chosen) return

    // The key is left alone: it belongs to the provider, not the preset, and wiping
    // it on an accidental list click would be an unexpected loss.
    void updateSettings({
      aiBaseUrl: chosen.baseUrl,
      aiModel: chosen.model,
      aiImageModel: chosen.imageModel,
    })
  }

  return (
    <div className="flex flex-col gap-4 border-t border-border pt-4">
      <Field label={t('options.ai.transport')} hint={t('options.ai.transport.hint')}>
        <Select
          value={settings.aiTransport}
          onChange={(event) =>
            void updateSettings({ aiTransport: event.target.value as Transport })
          }
        >
          <option value="byok">{t('options.ai.transport.byok')}</option>
          {/* Server transport is the phase 5.5 premium: shown, but not selectable. */}
          <option value="server" disabled>
            {t('options.ai.transport.server')}
          </option>
        </Select>
      </Field>

      <Field label={t('options.ai.preset')}>
        <Select
          value={preset?.id ?? 'custom'}
          onChange={(event) => {
            applyPreset(event.target.value as PresetId)
          }}
        >
          {PRESETS.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </Select>
      </Field>

      <Field label={t('options.ai.baseUrl')} hint={t('options.ai.baseUrl.hint')}>
        <input
          value={settings.aiBaseUrl}
          spellCheck={false}
          placeholder="https://api.example.com/v1"
          onChange={(event) => void updateSettings({ aiBaseUrl: event.target.value })}
          className="h-8 rounded-control border border-border bg-surface-muted px-2 font-mono text-xs text-text"
        />
      </Field>

      <Field label={t('options.ai.model')}>
        <input
          value={settings.aiModel}
          spellCheck={false}
          onChange={(event) => void updateSettings({ aiModel: event.target.value })}
          className="h-8 rounded-control border border-border bg-surface-muted px-2 font-mono text-xs text-text"
        />
      </Field>

      <Field label={t('options.ai.imageModel')} hint={t('options.ai.imageModel.hint')}>
        <input
          value={settings.aiImageModel}
          spellCheck={false}
          placeholder={t('options.ai.imageModel.none')}
          onChange={(event) => void updateSettings({ aiImageModel: event.target.value })}
          className="h-8 rounded-control border border-border bg-surface-muted px-2 font-mono text-xs text-text"
        />
      </Field>

      <Field
        label={t('options.ai.key')}
        hint={local ? t('options.ai.key.local') : t('options.ai.key.hint')}
      >
        <input
          type="password"
          value={settings.aiKey}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => void updateSettings({ aiKey: event.target.value })}
          className="h-8 rounded-control border border-border bg-surface-muted px-2 font-mono text-xs text-text"
        />
      </Field>

      {preset?.keysUrl ? (
        <a
          href={preset.keysUrl}
          target="_blank"
          rel="noreferrer"
          className="text-[11px] text-accent hover:underline"
        >
          {t('options.ai.getKey', { provider: preset.label })}
        </a>
      ) : null}

      <div className="flex flex-col gap-2 border-t border-border pt-3">
        <p className="text-[11px] text-text-muted">
          {/* Counts tokens and requests, not money: providers price differently and prices change. */}
          {t('options.ai.spend', {
            requests: spend?.requests ?? 0,
            input: spend?.input ?? 0,
            output: spend?.output ?? 0,
          })}
        </p>
        <span className="flex gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              void resetSpend().then(() => readSpend().then(setSpend))
            }}
          >
            {t('options.ai.resetSpend')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              void clearCache().then(() => {
                setCleared(true)
              })
            }}
          >
            {cleared ? t('options.ai.cacheCleared') : t('options.ai.clearCache')}
          </Button>
        </span>
      </div>
    </div>
  )
}
