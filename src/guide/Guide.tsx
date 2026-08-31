/**
 * Guide page.
 *
 * A step list, not a canvas: a guide is a sequence, and what needs editing is usually
 * order and captions, not pixels. An individual step opens in the regular editor,
 * which already has everything needed to finish it.
 */
import { useCallback, useEffect, useState } from 'react'

import { sendMessage } from '@/core/messaging'
import {
  applyStyle,
  dropGuide,
  dropStep,
  editCaption,
  ensureStepDoc,
  loadGuide,
  renameGuide,
  reorderSteps,
} from '@/core/scribe/guide'
import { resolveStyle, type ScribeStyle } from '@/core/scribe/style'
import type { GuideId, ScribeSession, ScribeStep } from '@/core/scribe/timeline'
import { pageBreaks } from '@/core/scribe/timeline'
import { defaultLanguage, type OcrLanguage } from '@/core/ocr/engine'
import { useApp } from '@/core/ui/app-context'
import { OcrLanguagePicker } from '@/core/ui/OcrLanguage'
import { Button } from '@/core/ui/components'
import { IconTrash } from '@/core/ui/icons'

import { exportGuide, type GuideFormat } from './export'
import { StepRow } from './StepRow'
import { StylePanel } from './StylePanel'
import { useGuideRedact } from './useGuideRedact'

const FORMATS: readonly GuideFormat[] = ['markdown', 'pdf', 'image']

const FORMAT_LABELS: Record<GuideFormat, string> = {
  markdown: 'Markdown',
  pdf: 'PDF',
  image: 'PNG',
}

function guideIdFromUrl(): GuideId | null {
  return new URLSearchParams(location.search).get('guide')
}

export function Guide() {
  const { t, locale } = useApp()
  const [session, setSession] = useState<ScribeSession | null>(null)
  const [steps, setSteps] = useState<ScribeStep[]>([])
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null)
  const [style, setStyle] = useState<ScribeStyle>(() => resolveStyle(null))
  const [styling, setStyling] = useState(false)
  const [language, setLanguage] = useState<OcrLanguage>(() => defaultLanguage(locale))
  const redact = useGuideRedact()

  useEffect(() => {
    const id = guideIdFromUrl()
    // Go through a promise even without an id: otherwise `setLoaded` would fire
    // synchronously inside the effect and trigger a pointless cascading render.
    void Promise.resolve(id ? loadGuide(id) : null).then((guide) => {
      if (guide) {
        setSession(guide.session)
        setSteps(guide.steps)
        setStyle(resolveStyle(guide.session.style))
      }
      setLoaded(true)
    })
  }, [])

  const runExport = useCallback(
    (format: GuideFormat) => {
      if (!session) return
      setBusy({ done: 0, total: steps.length })
      void exportGuide(format, session, steps, (done, total) => {
        setBusy({ done, total })
      })
        .catch((error: unknown) => {
          console.error('[kadr] guide export failed', error)
        })
        .finally(() => {
          setBusy(null)
        })
    },
    [session, steps],
  )

  if (!loaded) return <Centered>{t('common.loading')}</Centered>
  if (!session) return <Centered>{t('guide.missing')}</Centered>

  const breaks = pageBreaks(steps)

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-6">
      <header className="flex flex-wrap items-center gap-3">
        <input
          value={session.title}
          aria-label={t('guide.rename')}
          onChange={(event) => {
            const title = event.target.value
            setSession({ ...session, title })
          }}
          onBlur={() => {
            void renameGuide(session, session.title).then(setSession)
          }}
          className="min-w-56 flex-1 rounded-control border border-transparent bg-transparent px-2 py-1 text-lg font-semibold hover:border-border focus:border-border-strong focus:outline-none"
        />

        <span className="font-mono text-[11px] text-text-muted">
          {t('guide.steps', { n: steps.length })}
        </span>

        {FORMATS.map((format) => (
          <Button
            key={format}
            size="sm"
            variant={format === 'markdown' ? 'primary' : 'secondary'}
            disabled={busy !== null || steps.length === 0}
            onClick={() => {
              runExport(format)
            }}
          >
            {FORMAT_LABELS[format]}
          </Button>
        ))}

        <OcrLanguagePicker value={language} onChange={setLanguage} />

        <Button
          size="sm"
          disabled={redact.running || steps.length === 0}
          title={t('guide.redact')}
          onClick={() => {
            void redact.run(steps, language)
          }}
        >
          {redact.running
            ? t('guide.redacting', { done: redact.done + 1, total: redact.total })
            : t('guide.redact')}
        </Button>

        <button
          type="button"
          title={t('guide.delete')}
          aria-label={t('guide.delete')}
          onClick={() => {
            void dropGuide(session.id).then(() => {
              window.close()
            })
          }}
          className="grid h-8 w-8 place-items-center rounded-control text-text-muted hover:bg-danger/10 hover:text-danger"
        >
          <IconTrash size={15} />
        </button>
      </header>

      {busy ? (
        <p className="text-xs text-text-muted">
          {t('guide.exporting', { done: busy.done, total: busy.total })}
        </p>
      ) : null}

      <StylePanel
        style={style}
        onChange={setStyle}
        onCommit={() => {
          if (!session) return
          setStyling(true)
          void applyStyle(session, steps, style)
            .then(async (next) => {
              setSession(next)
              // Step docs were rebuilt; list thumbnails come from the frames, so the
              // reload is for their `docId`, not the images.
              const fresh = await loadGuide(next.id)
              if (fresh) setSteps(fresh.steps)
            })
            .finally(() => {
              setStyling(false)
            })
        }}
        busy={styling}
      />

      {redact.covered !== null ? (
        <p className="text-xs text-text-muted">
          {redact.covered > 0 ? t('guide.redacted', { n: redact.covered }) : t('guide.redact.none')}
        </p>
      ) : null}

      {session.droppedFrames > 0 ? (
        <p className="rounded-panel border border-border bg-surface px-3 py-2 text-xs text-text-muted">
          {t('guide.dropped', { n: session.droppedFrames })}
        </p>
      ) : null}

      {steps.length === 0 ? (
        <Centered>{t('guide.empty')}</Centered>
      ) : (
        <ol className="flex flex-col gap-2">
          {steps.map((step, at) => (
            <StepRow
              key={step.id}
              step={step}
              startsPage={breaks.has(step.id)}
              onCaption={(caption) => {
                setSteps((current) =>
                  current.map((other) =>
                    other.id === step.id ? { ...other, caption, captionEdited: true } : other,
                  ),
                )
              }}
              onCaptionDone={(caption) => {
                void editCaption(step, caption)
              }}
              onMove={(delta) => {
                void reorderSteps(steps, at, at + delta).then(setSteps)
              }}
              onDelete={() => {
                void dropStep(steps, step.id).then(setSteps)
              }}
              onOpen={() => {
                void ensureStepDoc(step, style).then((docId) => {
                  if (docId) void sendMessage('editor:open', { docId })
                })
              }}
            />
          ))}
        </ol>
      )}
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid flex-1 place-items-center p-12 text-sm text-text-soft">{children}</div>
  )
}
