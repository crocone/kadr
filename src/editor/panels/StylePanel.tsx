import { useEffect, useRef, useState } from 'react'

import {
  applyStyle,
  makePreset,
  parsePresets,
  serializePresets,
  type StylePreset,
} from '@/core/doc/style-presets'
import { saveBlob } from '@/core/render/export'
import { deletePreset, listPresets, putPreset } from '@/core/storage/db'
import { useT } from '@/core/ui/app-context'
import { Button } from '@/core/ui/components'
import { IconClose } from '@/core/ui/icons'

import type { DocumentController } from '../useDocument'

const PRESET_FILE = 'kadr-style-presets.json'

/**
 * Style presets: save a look under a name and apply it in one click, plus JSON
 * import/export for sharing with a team (PLAN.md §4).
 *
 * Presets live in IndexedDB next to documents, not in settings: there can be dozens,
 * and chrome.storage.local is the wrong place for that volume.
 */
export function StylePanel({
  controller,
  onApplied,
}: {
  controller: DocumentController
  /** A preset's padding changes the canvas size, so the view is recomputed. */
  onApplied: () => void
}) {
  const t = useT()
  const [presets, setPresets] = useState<StylePreset[]>([])
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  /**
   * The stored list is merged into what's on screen rather than replacing it: a save
   * or import can happen before IndexedDB responds, and a plain assignment would wipe
   * the just-added preset.
   */
  useEffect(() => {
    void listPresets().then((stored) => {
      setPresets((current) => {
        const shown = new Set(current.map((preset) => preset.id))
        return [...stored.filter((preset) => !shown.has(preset.id)), ...current]
      })
    })
  }, [])

  const save = () => {
    const preset = makePreset(name || t('editor.style.untitled'), controller.doc)
    setPresets((current) => [...current, preset])
    setName('')
    setNaming(false)
    void putPreset(preset)
  }

  const apply = (preset: StylePreset) => {
    controller.commit((doc) => applyStyle(doc, preset.canvas))
    onApplied()
  }

  const drop = (preset: StylePreset) => {
    setPresets((current) => current.filter((other) => other.id !== preset.id))
    void deletePreset(preset.id)
  }

  const exportAll = () => {
    const file = new Blob([serializePresets(presets)], { type: 'application/json' })
    void saveBlob(file, PRESET_FILE)
  }

  /** Import adds instead of replacing: someone else's file must not erase your presets. */
  const importFile = async (file: File) => {
    try {
      const incoming = parsePresets(await file.text())
      const known = new Set(presets.map((preset) => preset.id))
      const added = incoming.filter((preset) => !known.has(preset.id))
      setPresets((current) => [...current, ...added])
      for (const preset of added) await putPreset(preset)
      setError(null)
    } catch {
      setError(t('editor.style.import.failed'))
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {presets.length === 0 ? (
        <p className="text-[11px] leading-relaxed text-text-muted">{t('editor.style.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {presets.map((preset) => (
            <li key={preset.id} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  apply(preset)
                }}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-control border border-border px-2 py-1.5 text-left text-[11.5px] text-text-soft transition-colors hover:border-border-strong hover:text-text"
              >
                <span
                  aria-hidden
                  style={{ background: swatch(preset) }}
                  className="h-4 w-4 shrink-0 rounded border border-border"
                />
                <span className="truncate">{preset.name}</span>
              </button>
              <button
                type="button"
                title={t('editor.style.delete')}
                aria-label={`${t('editor.style.delete')}: ${preset.name}`}
                onClick={() => {
                  drop(preset)
                }}
                className="grid h-[26px] w-[26px] place-items-center rounded-control text-text-muted hover:bg-danger/10 hover:text-danger"
              >
                <IconClose size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {naming ? (
        <div className="flex items-center gap-1">
          <input
            autoFocus
            value={name}
            aria-label={t('editor.style.name')}
            placeholder={t('editor.style.name')}
            onChange={(event) => {
              setName(event.target.value)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') save()
              if (event.key === 'Escape') setNaming(false)
            }}
            className="h-8 min-w-0 flex-1 rounded-control border border-border-strong bg-surface-muted px-2 text-xs focus:outline-none"
          />
          <Button size="sm" variant="primary" onClick={save}>
            {t('common.save')}
          </Button>
        </div>
      ) : (
        <Button
          size="sm"
          onClick={() => {
            setNaming(true)
          }}
        >
          {t('editor.style.save')}
        </Button>
      )}

      <div className="flex items-center gap-1">
        <Button
          size="sm"
          variant="ghost"
          disabled={presets.length === 0}
          onClick={exportAll}
          className="flex-1"
        >
          {t('editor.style.export')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            fileRef.current?.click()
          }}
          className="flex-1"
        >
          {t('editor.style.import')}
        </Button>
      </div>

      <input
        ref={fileRef}
        type="file"
        aria-label={t('editor.style.import')}
        accept="application/json,.json"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void importFile(file)
          event.target.value = ''
        }}
      />

      {error ? <p className="text-[11px] text-danger">{error}</p> : null}
    </div>
  )
}

/** Preset swatch: shows the background, which is what presets are usually saved for. */
function swatch(preset: StylePreset): string {
  const background = preset.canvas.background
  switch (background.kind) {
    case 'solid':
      return background.color
    case 'gradient':
    case 'wallpaper':
      return `linear-gradient(135deg, ${background.from}, ${background.to})`
    default:
      // Transparent shows a checkerboard; image backgrounds never occur in presets by construction.
      return 'repeating-conic-gradient(#8884 0 25%, transparent 0 50%) 0 0 / 8px 8px'
  }
}
