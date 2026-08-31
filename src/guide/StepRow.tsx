/**
 * A single step row in the guide.
 *
 * Reordering uses up/down buttons instead of drag-and-drop: buttons work from the
 * keyboard, lists are tens of rows at most, and DnD would mean pulling in a library
 * and losing accessibility.
 */
import { useEffect, useState } from 'react'

import type { ScribeStep } from '@/core/scribe/timeline'
import { getImage } from '@/core/storage/db'
import { useT } from '@/core/ui/app-context'
import { IconTrash } from '@/core/ui/icons'
import { useObjectUrl } from '@/core/ui/useObjectUrl'

export function StepRow({
  step,
  startsPage,
  preview,
  onCaption,
  onCaptionDone,
  onMove,
  onDelete,
  onOpen,
}: {
  step: ScribeStep
  /** First step on a new page: a divider with the URL is drawn above it. */
  startsPage: boolean
  /** Step drawn with its annotations. Null until it is ready. */
  preview: Blob | null
  onCaption: (caption: string) => void
  onCaptionDone: (caption: string) => void
  onMove: (delta: number) => void
  onDelete: () => void
  onOpen: () => void
}) {
  const t = useT()
  const [frame, setFrame] = useState<Blob | null>(null)
  // The bare frame stands in until the annotated preview arrives, so the list never
  // blinks empty while a style change is being redrawn.
  const thumbnail = useObjectUrl(preview ?? frame)

  useEffect(() => {
    if (!step.imageId) return
    let cancelled = false
    void getImage(step.imageId).then((image) => {
      if (!cancelled) setFrame(image?.blob ?? null)
    })
    return () => {
      cancelled = true
    }
  }, [step.imageId])

  return (
    <>
      {startsPage ? (
        <li className="mt-3 flex items-center gap-2 px-1 font-mono text-[10px] text-text-muted">
          <span className="h-px flex-1 bg-border" />
          <span className="truncate">{step.title || step.url}</span>
          <span className="h-px flex-1 bg-border" />
        </li>
      ) : null}

      <li className="flex items-start gap-3 rounded-panel border border-border bg-surface p-2.5">
        <span className="mt-1 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent text-[11px] font-semibold text-white">
          {step.index}
        </span>

        <button
          type="button"
          title={t('guide.open')}
          disabled={!thumbnail}
          onClick={onOpen}
          className="grid h-[72px] w-32 shrink-0 place-items-center overflow-hidden rounded-control border border-border bg-surface-muted disabled:cursor-default"
        >
          {thumbnail ? (
            // Whole step, not a corner of it: the annotation is what the row is about.
            <img src={thumbnail} alt="" className="max-h-full max-w-full object-contain" />
          ) : (
            <span className="text-[10px] text-text-muted">{t('guide.noFrame')}</span>
          )}
        </button>

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <input
            value={step.caption}
            aria-label={t('guide.caption')}
            onChange={(event) => {
              onCaption(event.target.value)
            }}
            onBlur={(event) => {
              onCaptionDone(event.target.value)
            }}
            className="w-full rounded-control border border-transparent bg-transparent px-1 py-0.5 text-[13px] hover:border-border focus:border-border-strong focus:outline-none"
          />
          <span className="truncate px-1 font-mono text-[10px] text-text-muted">{step.url}</span>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <MoveButton label={t('guide.up')} onClick={() => onMove(-1)}>
            ↑
          </MoveButton>
          <MoveButton label={t('guide.down')} onClick={() => onMove(1)}>
            ↓
          </MoveButton>
          <button
            type="button"
            title={t('guide.dropStep')}
            aria-label={t('guide.dropStep')}
            onClick={onDelete}
            className="grid h-[26px] w-[26px] place-items-center rounded-md text-text-muted hover:bg-danger/10 hover:text-danger"
          >
            <IconTrash size={13} />
          </button>
        </div>
      </li>
    </>
  )
}

function MoveButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="grid h-[26px] w-[26px] place-items-center rounded-md text-text-muted hover:bg-surface-muted hover:text-text"
    >
      {children}
    </button>
  )
}
