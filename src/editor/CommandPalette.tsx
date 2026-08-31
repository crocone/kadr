import { useEffect, useMemo, useRef, useState } from 'react'

import { useT } from '@/core/ui/app-context'
import { cn } from '@/core/ui/cn'

export type Command = {
  id: string
  title: string
  /** Group for list readability: tools, view, document. */
  group: string
  hint?: string
  run: () => void
}

/**
 * Command palette on Ctrl+K.
 *
 * Search matches title and group, because "arrow" is looked up both as a tool and
 * via the word "annotations". Substring matching, no fuzzy search: the list is
 * short, and typo guessing would mostly get in the way here.
 */
export function CommandPalette({
  commands,
  onClose,
}: {
  commands: readonly Command[]
  onClose: () => void
}) {
  const t = useT()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const found = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return commands
    return commands.filter((command) =>
      `${command.title} ${command.group}`.toLowerCase().includes(needle),
    )
  }, [commands, query])

  const index = Math.min(active, Math.max(0, found.length - 1))

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((current) => Math.min(current + 1, found.length - 1))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((current) => Math.max(current - 1, 0))
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const command = found[index]
      if (command) {
        command.run()
        onClose()
      }
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[12vh]"
      onMouseDown={onClose}
    >
      <div
        className="w-[520px] overflow-hidden rounded-panel border border-border bg-raised shadow-float"
        onMouseDown={(event) => {
          event.stopPropagation()
        }}
      >
        <input
          ref={inputRef}
          value={query}
          placeholder={t('editor.palette.placeholder')}
          onChange={(event) => {
            setQuery(event.target.value)
            setActive(0)
          }}
          onKeyDown={onKeyDown}
          className="w-full border-b border-border bg-transparent px-4 py-3 text-sm text-text outline-none"
        />

        {found.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-text-muted">
            {t('editor.palette.empty')}
          </p>
        ) : (
          <ul className="max-h-[50vh] overflow-y-auto py-1">
            {found.map((command, position) => (
              <li key={command.id}>
                <button
                  type="button"
                  onMouseEnter={() => {
                    setActive(position)
                  }}
                  onClick={() => {
                    command.run()
                    onClose()
                  }}
                  className={cn(
                    'flex w-full items-center gap-3 px-4 py-2 text-left',
                    position === index ? 'bg-accent/15' : 'hover:bg-surface-muted',
                  )}
                >
                  <span className="w-20 shrink-0 font-mono text-[10px] tracking-[0.08em] text-text-muted uppercase">
                    {command.group}
                  </span>
                  <span className="flex-1 truncate text-[13px]">{command.title}</span>
                  {command.hint ? (
                    <span className="font-mono text-[10px] text-text-muted">{command.hint}</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
