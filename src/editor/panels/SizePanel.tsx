import {
  applyCanvasPreset,
  RATIO_PRESETS,
  SOCIAL_PRESETS,
  safeZonesFor,
} from '@/core/doc/canvas-presets'
import type { CanvasPreset, Doc } from '@/core/doc/types'
import { useT } from '@/core/ui/app-context'
import { Toggle } from '@/core/ui/components'
import { Chip, NumberField } from '@/core/ui/controls'

import type { DocumentController } from '../useDocument'

const SOCIAL_LABELS: Record<string, string> = {
  x: 'X',
  telegram: 'Telegram',
  vk: 'VK',
  max: 'MAX',
  linkedin: 'LinkedIn',
  instagram: 'Instagram',
  youtube: 'YouTube',
}

export function SizePanel({
  controller,
  showSafeZones,
  onShowSafeZones,
  onSizeChanged,
}: {
  controller: DocumentController
  showSafeZones: boolean
  onShowSafeZones: (show: boolean) => void
  /** Canvas size changed — the scene should refit the document. */
  onSizeChanged: () => void
}) {
  const t = useT()
  const { doc, commit } = controller
  const { canvas } = doc

  const apply = (preset: CanvasPreset) => {
    commit((current) => applyCanvasPreset(current, preset))
    onSizeChanged()
  }

  const setSize = (patch: Partial<Pick<Doc['canvas'], 'w' | 'h'>>) => {
    commit((current) => ({
      ...current,
      canvas: { ...current.canvas, ...patch, preset: 'custom' },
    }))
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap gap-1.5">
        <Chip
          active={canvas.preset === 'auto'}
          onClick={() => {
            apply('auto')
          }}
        >
          {t('editor.size.auto')}
        </Chip>
        {RATIO_PRESETS.map((preset) => (
          <Chip
            key={preset.id}
            active={canvas.preset === preset.id}
            onClick={() => {
              apply(preset.id)
            }}
          >
            {preset.id}
          </Chip>
        ))}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {SOCIAL_PRESETS.map((preset) => (
          <Chip
            key={preset.id}
            active={canvas.preset === preset.id}
            onClick={() => {
              apply(preset.id)
            }}
            {...(preset.kind === 'size' ? { title: `${preset.w} × ${preset.h}` } : {})}
          >
            {SOCIAL_LABELS[preset.id] ?? preset.id}
          </Chip>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <NumberField
          label={t('editor.size.width')}
          value={canvas.w}
          min={16}
          onChange={(w) => {
            setSize({ w })
          }}
          onCommit={onSizeChanged}
        />
        <NumberField
          label={t('editor.size.height')}
          value={canvas.h}
          min={16}
          onChange={(h) => {
            setSize({ h })
          }}
          onCommit={onSizeChanged}
        />
      </div>

      {safeZonesFor(canvas.preset).length > 0 ? (
        <Toggle
          checked={showSafeZones}
          onChange={onShowSafeZones}
          label={t('editor.size.safeZones')}
        />
      ) : null}
    </div>
  )
}
