import { useState } from 'react'

import type { Doc } from '@/core/doc/types'
import { useT } from '@/core/ui/app-context'
import { Button, Divider, ToolButton } from '@/core/ui/components'
import { IconCopy, IconDownload, IconRedo, IconUndo } from '@/core/ui/icons'
import { Popover } from '@/core/ui/Popover'

import type { ExportController } from '../useExport'
import { ExportPanel } from './ExportPanel'

/**
 * Editor top bar: brand, undo/redo, document identity, actions on the right.
 *
 * The title's second line is a monospace summary — true frame size, capture mode,
 * annotation count: the numbers people most often come looking for.
 *
 * "Save" opens an export-settings popover instead of downloading right away: format,
 * density, and share targets are needed exactly at this moment and nowhere else —
 * buried at the bottom of a collapsed "Size" group in the side panel nobody found
 * them. The hotkey still saves immediately with current settings: it's for those
 * who already chose.
 */
export function TopBar({
  doc,
  frameSize,
  canUndo,
  canRedo,
  copied,
  exporter,
  onUndo,
  onRedo,
  onCopy,
}: {
  doc: Doc
  frameSize: { width: number; height: number } | null
  canUndo: boolean
  canRedo: boolean
  copied: boolean
  exporter: ExportController
  onUndo: () => void
  onRedo: () => void
  onCopy: () => void
}) {
  const t = useT()
  const [exportOpen, setExportOpen] = useState(false)
  const annotations = doc.layers.length

  return (
    <header className="flex h-[54px] shrink-0 items-center gap-3.5 border-b border-border bg-raised px-3.5">
      <span className="flex items-center gap-2">
        <span className="h-[22px] w-[22px] rounded-md bg-accent" />
        <span className="text-sm font-semibold tracking-[-0.01em]">{t('app.name')}</span>
      </span>

      <Divider vertical />

      <span className="flex items-center gap-0.5">
        <ToolButton
          className="h-[30px] w-[30px] rounded-lg text-sm"
          disabled={!canUndo}
          title={`${t('editor.undo')} · Ctrl+Z`}
          onClick={onUndo}
        >
          <IconUndo size={16} />
        </ToolButton>
        <ToolButton
          className="h-[30px] w-[30px] rounded-lg text-sm"
          disabled={!canRedo}
          title={`${t('editor.redo')} · Ctrl+Y`}
          onClick={onRedo}
        >
          <IconRedo size={16} />
        </ToolButton>
      </span>

      <Divider vertical />

      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-[13px] font-medium">{doc.title}</span>
        <span className="truncate font-mono text-[10px] text-text-muted">
          {frameSize ? `${frameSize.width} × ${frameSize.height} · ` : ''}
          {t('editor.meta.annotations', { n: annotations })}
        </span>
      </span>

      <span className="flex-1" />

      <Button size="md" onClick={onCopy}>
        <IconCopy size={15} />
        {copied ? t('editor.export.copied') : t('editor.export.copy')}
        <span className="font-mono text-[10px] text-text-muted">Ctrl+C</span>
      </Button>

      <Popover
        open={exportOpen}
        label={t('editor.export')}
        onClose={() => {
          setExportOpen(false)
        }}
        trigger={
          <Button
            size="md"
            variant="primary"
            aria-expanded={exportOpen}
            aria-haspopup="dialog"
            onClick={() => {
              setExportOpen((open) => !open)
            }}
          >
            <IconDownload size={15} />
            {t('editor.export.save')}
          </Button>
        }
      >
        <ExportPanel controller={exporter} />
      </Popover>
    </header>
  )
}
