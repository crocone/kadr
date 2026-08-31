import { useEffect, useRef, useState } from 'react'

import {
  DEFAULT_FONT,
  FONT_CATEGORIES,
  type FontCategory,
  fontByStack,
  searchFonts,
} from '@/core/doc/fonts'
import { useT } from '@/core/ui/app-context'
import { cn } from '@/core/ui/cn'

/**
 * Font picker with search by name and category.
 * Each list row renders in its own font — a name like "Georgia" doesn't tell you
 * whether it suits the screenshot; the actual glyphs do.
 */
export function FontPicker({ value, onPick }: { value: string; onPick: (stack: string) => void }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<FontCategory | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  // Click outside closes the dropdown — it deliberately has no cancel button.
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('mousedown', onDown)
    }
  }, [open])

  const current = fontByStack(value) ?? DEFAULT_FONT
  const found = searchFonts(query, category)

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((shown) => !shown)
        }}
        className={cn(
          'h-7 min-w-32 rounded-md border px-2 text-left text-[12px] transition-colors',
          open ? 'border-accent bg-accent/10' : 'border-border hover:border-border-strong',
        )}
        style={{ fontFamily: current.stack }}
      >
        {current.label}
      </button>

      {open ? (
        <div className="absolute bottom-9 left-0 z-20 w-64 overflow-hidden rounded-panel border border-border bg-raised shadow-float">
          <input
            autoFocus
            value={query}
            placeholder={t('editor.font.search')}
            onChange={(event) => {
              setQuery(event.target.value)
            }}
            className="w-full border-b border-border bg-transparent px-3 py-2 text-[12px] outline-none"
          />

          <div className="flex flex-wrap gap-1 border-b border-border px-2 py-2">
            {FONT_CATEGORIES.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => {
                  setCategory((current) => (current === name ? null : name))
                }}
                className={cn(
                  'rounded-full px-2 py-0.5 text-[10px] tracking-[0.04em] uppercase transition-colors',
                  category === name
                    ? 'bg-accent/20 text-accent'
                    : 'text-text-muted hover:bg-surface-muted',
                )}
              >
                {t(`editor.font.category.${name}`)}
              </button>
            ))}
          </div>

          {found.length === 0 ? (
            <p className="px-3 py-4 text-center text-[11px] text-text-muted">
              {t('editor.font.empty')}
            </p>
          ) : (
            <ul className="max-h-64 overflow-y-auto py-1">
              {found.map((font) => (
                <li key={font.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onPick(font.stack)
                      setOpen(false)
                    }}
                    className={cn(
                      'w-full px-3 py-1.5 text-left text-[13px] transition-colors',
                      font.stack === value ? 'bg-accent/15 text-text' : 'hover:bg-surface-muted',
                    )}
                    style={{ fontFamily: font.stack }}
                  >
                    {font.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  )
}
