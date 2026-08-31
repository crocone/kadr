import { useState } from 'react'

import { defaultLanguage, type OcrLanguage } from '@/core/ocr/engine'
import { rectsOf } from '@/core/ocr/redact'
import { useApp, useT } from '@/core/ui/app-context'
import { Button } from '@/core/ui/components'
import { OcrLanguagePicker } from '@/core/ui/OcrLanguage'

import type { OcrController } from '../useOcr'

/**
 * Private-data detection in the frame — no network, API key, or model.
 *
 * Findings are never redacted automatically: first the list, then a separate click.
 * Redaction looks irreversible (the layer can be removed, but users don't know
 * that), so doing it silently on "scan" would be overreach.
 */
export function PrivacyPanel({ ocr, ready }: { ocr: OcrController; ready: boolean }) {
  const t = useT()
  const { locale } = useApp()
  const [language, setLanguage] = useState<OcrLanguage>(() => defaultLanguage(locale))

  if (!ready) {
    return <p className="text-[11px] text-text-muted">{t('editor.privacy.noFrame')}</p>
  }

  return (
    <>
      <OcrLanguagePicker value={language} onChange={setLanguage} />

      <Button
        size="sm"
        disabled={ocr.status === 'working'}
        onClick={() => {
          void ocr.scan(language)
        }}
      >
        {t('editor.privacy.scan')}
      </Button>

      {/* The first run for a language downloads its dictionary — the only network
          request, and the user should know what the wait is for. */}
      <p className="text-[10px] leading-relaxed text-text-muted">{t('editor.privacy.download')}</p>

      {ocr.status === 'working' ? (
        <p className="text-[11px] text-text-muted">
          {t('editor.privacy.working', { percent: Math.round(ocr.progress * 100) })}
        </p>
      ) : null}

      {ocr.error ? (
        <p className="rounded-md bg-danger/10 px-2 py-1.5 text-[11px] text-danger">{ocr.error}</p>
      ) : null}

      {ocr.status === 'done' && ocr.findings.length === 0 ? (
        <p className="text-[11px] text-text-muted">{t('editor.privacy.clean')}</p>
      ) : null}

      {ocr.findings.length > 0 ? (
        <>
          <ul className="flex flex-col gap-1">
            {ocr.findings.map((finding, index) => (
              <li
                key={`${finding.kind}-${index}`}
                className="flex items-center gap-2 rounded-md border border-border bg-surface-muted px-2 py-1"
              >
                <span className="font-mono text-[10px] tracking-[0.06em] text-accent uppercase">
                  {t(`editor.privacy.kind.${finding.kind}` as never)}
                </span>
                <span className="min-w-0 flex-1 truncate text-[11px] text-text-soft">
                  {finding.text}
                </span>
                <button
                  type="button"
                  title={t('editor.privacy.hideOne')}
                  onClick={() => {
                    ocr.redact([finding])
                  }}
                  className="rounded px-1 text-[11px] text-text-muted hover:text-text"
                >
                  ▒
                </button>
              </li>
            ))}
          </ul>

          <Button
            size="sm"
            onClick={() => {
              ocr.redact(ocr.findings)
            }}
          >
            {t('editor.privacy.hideAll', { n: rectsOf(ocr.findings).length })}
          </Button>
        </>
      ) : null}
    </>
  )
}
