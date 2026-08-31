import { useState } from 'react'

import type { StoredDoc } from '@/core/storage/db'
import { normalizeTag } from '@/core/storage/library'
import { useT } from '@/core/ui/app-context'
import { cn } from '@/core/ui/cn'
import { IconClose, IconRefresh, IconTag, IconTrash } from '@/core/ui/icons'
import { useObjectUrl } from '@/core/ui/useObjectUrl'

/**
 * List row: same as the card, plus everything editable on a shot.
 *
 * Title, tags, reshoot, and delete live here, not in the grid. The grid is for finding
 * by eye, the list for managing: a feed full of input fields hides the shots
 * themselves, and the grid loses nothing since the list is one click away.
 */
export function ShotRow({
  doc,
  dateFormat,
  selected,
  onSelect,
  onOpen,
  onRename,
  onTags,
  onPickTag,
  onDelete,
  onReshoot,
  reshooting,
}: {
  doc: StoredDoc
  dateFormat: Intl.DateTimeFormat
  selected: boolean
  onSelect: (selected: boolean) => void
  onOpen: () => void
  onRename: (title: string) => void
  onTags: (tags: string[]) => void
  onPickTag: (tag: string) => void
  onDelete: () => void
  /** `null` — shot predates v1.1, there is nothing to replay, so no button. */
  onReshoot: (() => void) | null
  reshooting: boolean
}) {
  const t = useT()
  const thumbnailUrl = useObjectUrl(doc.thumbnail)
  const [addingTag, setAddingTag] = useState(false)
  const [draftTag, setDraftTag] = useState('')

  const addTag = () => {
    const tag = normalizeTag(draftTag)
    if (tag && !doc.tags.includes(tag)) onTags([...doc.tags, tag])
    setDraftTag('')
    setAddingTag(false)
  }

  return (
    <li
      className={cn(
        'flex items-center gap-3 rounded-panel border bg-surface p-2 transition-colors',
        selected ? 'border-accent' : 'border-border',
      )}
    >
      <input
        type="checkbox"
        checked={selected}
        aria-label={`${t('library.select')}: ${doc.title}`}
        onChange={(event) => {
          onSelect(event.target.checked)
        }}
        className="ml-1 h-4 w-4 shrink-0 accent-accent"
      />

      <button
        type="button"
        title={t('library.open')}
        onClick={onOpen}
        className="grid h-12 w-20 shrink-0 place-items-center overflow-hidden rounded-control border border-border bg-surface-muted"
      >
        {thumbnailUrl ? (
          <img src={thumbnailUrl} alt={doc.title} className="h-full w-full object-cover" />
        ) : (
          <span className="text-[9px] text-text-muted">{t('library.noPreview')}</span>
        )}
      </button>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <input
          value={doc.title}
          aria-label={t('library.rename')}
          onChange={(event) => {
            onRename(event.target.value)
          }}
          className={cn(
            'w-full truncate rounded-control border border-transparent bg-transparent px-1 py-0.5 text-[13px] font-medium',
            'hover:border-border focus:border-border-strong focus:outline-none',
          )}
        />

        <div className="flex flex-wrap items-center gap-1 px-1">
          <span className="font-mono text-[10px] text-text-muted">
            {doc.domain || t('library.noDomain')}
          </span>

          {doc.tags.map((tag) => (
            <span
              key={tag}
              className="flex items-center gap-1 rounded-md border border-border bg-surface-muted py-0.5 pr-0.5 pl-1.5 text-[10px] text-text-soft"
            >
              <button
                type="button"
                onClick={() => {
                  onPickTag(tag)
                }}
                className="hover:text-text"
              >
                {tag}
              </button>
              <button
                type="button"
                title={t('library.tag.remove')}
                aria-label={t('library.tag.remove')}
                onClick={() => {
                  onTags(doc.tags.filter((other) => other !== tag))
                }}
                className="text-text-muted hover:text-danger"
              >
                <IconClose size={11} />
              </button>
            </span>
          ))}

          {addingTag ? (
            <input
              autoFocus
              value={draftTag}
              aria-label={t('library.tag.add')}
              onChange={(event) => {
                setDraftTag(event.target.value)
              }}
              onBlur={addTag}
              onKeyDown={(event) => {
                if (event.key === 'Enter') addTag()
                if (event.key === 'Escape') {
                  setDraftTag('')
                  setAddingTag(false)
                }
              }}
              className="h-[22px] w-24 rounded-md border border-border-strong bg-surface-muted px-1.5 text-[10px] focus:outline-none"
            />
          ) : (
            <button
              type="button"
              title={t('library.tag.add')}
              aria-label={t('library.tag.add')}
              onClick={() => {
                setAddingTag(true)
              }}
              className="grid h-[22px] w-[22px] place-items-center rounded-md text-text-muted hover:bg-surface-muted hover:text-text"
            >
              <IconTag size={12} />
            </button>
          )}
        </div>
      </div>

      <span className="shrink-0 font-mono text-[10px] text-text-muted tabular-nums">
        {dateFormat.format(doc.updatedAt)} · {doc.capture.width}×{doc.capture.height}
      </span>

      {onReshoot ? (
        <button
          type="button"
          title={t('reshoot.hint')}
          aria-label={t('reshoot.action')}
          disabled={reshooting}
          onClick={onReshoot}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-text-muted hover:bg-surface-muted hover:text-text disabled:opacity-40"
        >
          <IconRefresh size={14} />
        </button>
      ) : null}

      <button
        type="button"
        title={t('library.delete')}
        aria-label={t('library.delete')}
        onClick={onDelete}
        className="mr-1 grid h-7 w-7 shrink-0 place-items-center rounded-md text-text-muted hover:bg-danger/10 hover:text-danger"
      >
        <IconTrash size={14} />
      </button>
    </li>
  )
}
