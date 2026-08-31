import type { StoredDoc } from '@/core/storage/db'
import { useT } from '@/core/ui/app-context'
import { cn } from '@/core/ui/cn'
import { useObjectUrl } from '@/core/ui/useObjectUrl'

import { shotLabel } from './label'

/**
 * Grid card: thumbnail, page address, and a numbers line below.
 *
 * The thumbnail opens the document; the corner checkbox adds it to the batch. These
 * are separate click targets on purpose: a card click that sometimes opens and
 * sometimes selects, depending on an invisible mode, misses half the time.
 *
 * Title and tags are not editable here — that's what the list view is for.
 */
export function ShotCard({
  doc,
  timeFormat,
  selected,
  onSelect,
  onOpen,
}: {
  doc: StoredDoc
  timeFormat: Intl.DateTimeFormat
  selected: boolean
  onSelect: (selected: boolean) => void
  onOpen: () => void
}) {
  const t = useT()
  const thumbnailUrl = useObjectUrl(doc.thumbnail)
  const annotations = doc.layers.length

  return (
    <li className="group flex flex-col gap-2">
      <div
        className={cn(
          'relative aspect-[16/10] overflow-hidden rounded-panel border transition-colors',
          selected ? 'border-accent ring-1 ring-accent' : 'border-border',
        )}
      >
        <button
          type="button"
          title={`${t('library.open')} · ${doc.title}`}
          onClick={onOpen}
          className="grid h-full w-full place-items-center bg-surface-muted"
        >
          {thumbnailUrl ? (
            <img
              src={thumbnailUrl}
              alt={doc.title}
              className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]"
            />
          ) : (
            <span className="text-[11px] text-text-muted">{t('library.noPreview')}</span>
          )}
        </button>

        {annotations > 0 ? (
          <span className="pointer-events-none absolute right-2 bottom-2 rounded-md bg-bg/85 px-1.5 py-0.5 font-mono text-[10px] text-text-soft">
            {t('library.badge.annotations', { n: annotations })}
          </span>
        ) : null}

        {/* The checkbox stays visible only while checked: otherwise a feed of fifty
            cards starts looking like a spreadsheet. */}
        <label
          className={cn(
            'absolute top-2 right-2 grid h-6 w-6 cursor-pointer place-items-center rounded-md bg-bg/80 transition-opacity',
            selected ? '' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100',
          )}
        >
          <input
            type="checkbox"
            checked={selected}
            aria-label={`${t('library.select')}: ${doc.title}`}
            onChange={(event) => {
              onSelect(event.target.checked)
            }}
            className="h-4 w-4 accent-accent"
          />
        </label>
      </div>

      <div className="flex flex-col gap-0.5 px-0.5">
        <button
          type="button"
          title={doc.title}
          onClick={onOpen}
          className="truncate text-left text-[13px] text-text hover:text-accent"
        >
          {shotLabel(doc)}
        </button>
        <span className="font-mono text-[10px] text-text-muted tabular-nums">
          {timeFormat.format(doc.updatedAt)} · {doc.capture.width}×{doc.capture.height}
        </span>
      </div>
    </li>
  )
}
