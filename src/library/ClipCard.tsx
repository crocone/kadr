import { useEffect, useState } from 'react'

import { formatDuration, formatSize } from '@/core/record/format'
import type { Clip } from '@/core/record/types'
import { getImage } from '@/core/storage/db'
import { useT } from '@/core/ui/app-context'
import { useObjectUrl } from '@/core/ui/useObjectUrl'
import { IconPlay, IconTrash } from '@/core/ui/icons'

/**
 * Library card for a recording.
 *
 * Deliberately not a `ShotCard` with a play badge: a clip has different numbers on it —
 * length before size, source before domain — and it opens a different editor. Sharing
 * the component would mean a card full of conditionals that is worse at both jobs.
 *
 * The poster is a stored image like any other, so it comes out of the same store the
 * shot thumbnails do, and is loaded on demand rather than up front: a shelf of thirty
 * recordings should not decode thirty frames to draw a list.
 */
export function ClipCard({
  clip,
  timeFormat,
  onOpen,
  onDelete,
}: {
  clip: Clip
  timeFormat: Intl.DateTimeFormat
  onOpen: () => void
  onDelete: () => void
}) {
  const t = useT()
  const [poster, setPoster] = useState<Blob | null>(null)
  const posterUrl = useObjectUrl(poster)

  useEffect(() => {
    if (!clip.poster) return
    void getImage(clip.poster).then((image) => {
      setPoster(image?.blob ?? null)
    })
  }, [clip.poster])

  return (
    <li className="group flex flex-col gap-2">
      <div className="relative aspect-[16/10] overflow-hidden rounded-panel border border-border">
        <button
          type="button"
          title={`${t('library.open')} · ${clip.title}`}
          onClick={onOpen}
          className="grid h-full w-full place-items-center bg-surface-muted"
        >
          {posterUrl ? (
            <img
              src={posterUrl}
              alt={clip.title}
              className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]"
            />
          ) : (
            <span className="text-[11px] text-text-muted">{t('library.noPreview')}</span>
          )}
          <span className="pointer-events-none absolute inset-0 grid place-items-center">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-bg/70 text-text opacity-0 transition-opacity group-hover:opacity-100">
              <IconPlay size={16} />
            </span>
          </span>
        </button>

        <span className="pointer-events-none absolute right-2 bottom-2 rounded-md bg-bg/85 px-1.5 py-0.5 font-mono text-[10px] text-text-soft tabular-nums">
          {formatDuration(clip.duration)}
        </span>

        <button
          type="button"
          title={t('clip.delete')}
          aria-label={`${t('clip.delete')}: ${clip.title}`}
          onClick={onDelete}
          className="absolute top-2 right-2 grid h-6 w-6 place-items-center rounded-md bg-bg/80 text-text-muted opacity-0 transition-opacity group-hover:opacity-100 hover:text-danger focus-visible:opacity-100"
        >
          <IconTrash size={13} />
        </button>
      </div>

      <div className="flex flex-col gap-0.5 px-0.5">
        <button
          type="button"
          title={clip.title}
          onClick={onOpen}
          className="truncate text-left text-[13px] text-text hover:text-accent"
        >
          {clip.title}
        </button>
        <span className="font-mono text-[10.5px] text-text-muted tabular-nums">
          {t(`clip.source.${clip.source}`)} · {clip.width}×{clip.height} · {formatSize(clip.size)} ·{' '}
          {timeFormat.format(clip.createdAt)}
        </span>
      </div>
    </li>
  )
}
