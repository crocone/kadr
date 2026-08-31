import { CAPTURE_ID } from '@/core/doc/capture-ops'
import { frameRect } from '@/core/doc/canvas-presets'
import { findLayer, layerBounds, resizeLayer, shiftLayerBy, updateLayer } from '@/core/doc/layers'
import type { Layer, LayerId, Rect } from '@/core/doc/types'
import { useT } from '@/core/ui/app-context'

import type { DocumentController } from '../useDocument'

/**
 * Selected-object block: what is selected and where it sits.
 *
 * Coordinates are edited by shifting, not assignment: layers have different geometry
 * (point, rect, point list) and a shift applies uniformly to all. Size goes through
 * resizeLayer, which decides how to translate it per layer kind.
 */
export function SelectedObject({
  controller,
  selected,
  onSelect,
}: {
  controller: DocumentController
  selected: string | null
  onSelect: (id: LayerId | null) => void
}) {
  const t = useT()
  const { doc, commit } = controller

  if (!selected) return null

  const isCapture = selected === CAPTURE_ID
  const layer = isCapture ? undefined : findLayer(doc, selected)
  if (!isCapture && !layer) return null

  const bounds: Rect | null = isCapture ? frameRect(doc) : layer ? layerBounds(layer) : null
  if (!bounds) return null

  // Every layer has a size, just expressed differently (text: wrap width, badge:
  // diameter, arrow: its points); resizeLayer handles the translation.
  const resizable = layer !== undefined

  const move = (dx: number, dy: number) => {
    commit((current) => {
      if (isCapture) {
        return {
          ...current,
          capture: {
            ...current.capture,
            offset: {
              x: current.capture.offset.x + dx,
              y: current.capture.offset.y + dy,
            },
          },
        }
      }
      const target = findLayer(current, selected)
      return target
        ? updateLayer(current, selected, shiftLayerBy(target, { x: dx, y: dy }))
        : current
    })
  }

  const resize = (w: number, h: number) => {
    commit((current) => {
      const target = findLayer(current, selected)
      const box = target ? layerBounds(target) : null
      if (!target || !box) return current

      return updateLayer(
        current,
        selected,
        resizeLayer(target, {
          x: box.x,
          y: box.y,
          w: Math.max(1, w),
          h: Math.max(1, h),
          rotation: target.rotation,
        }),
      )
    })
  }

  return (
    <section className="border-b border-border px-3.5 py-3">
      <div className="mb-2.5 flex items-baseline justify-between">
        <span className="font-mono text-[10px] tracking-[0.1em] text-accent uppercase">
          {t('editor.object.selected')}
        </span>
        <button
          type="button"
          onClick={() => {
            onSelect(null)
          }}
          className="font-mono text-[10px] text-text-muted hover:text-text"
        >
          {t('editor.object.deselect')}
        </button>
      </div>

      <div className="mb-2.5 flex items-center gap-2.5">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent/15 text-accent">
          {isCapture ? '▣' : GLYPHS[layer!.kind]}
        </span>
        <span className="truncate text-[13px] font-medium">
          {isCapture ? t('editor.object.capture') : layer!.name}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Coord
          label="X"
          value={bounds.x}
          onChange={(next) => {
            move(next - bounds.x, 0)
          }}
        />
        <Coord
          label="Y"
          value={bounds.y}
          onChange={(next) => {
            move(0, next - bounds.y)
          }}
        />
        <Coord
          label={t('editor.object.width')}
          value={bounds.w}
          disabled={!resizable}
          onChange={(next) => {
            resize(next, bounds.h)
          }}
        />
        <Coord
          label={t('editor.object.height')}
          value={bounds.h}
          disabled={!resizable}
          onChange={(next) => {
            resize(bounds.w, next)
          }}
        />
      </div>
    </section>
  )
}

function Coord({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string
  value: number
  disabled?: boolean
  onChange: (value: number) => void
}) {
  return (
    <label className="flex items-center gap-1.5 rounded-control border border-border bg-surface-muted px-2">
      <span className="font-mono text-[10px] text-text-muted">{label}</span>
      <input
        type="number"
        value={Math.round(value)}
        disabled={disabled}
        onChange={(event) => {
          const next = Number(event.target.value)
          if (Number.isFinite(next)) onChange(next)
        }}
        className="h-8 w-full bg-transparent font-mono text-[11px] text-text outline-none disabled:text-text-muted"
      />
    </label>
  )
}

const GLYPHS: Record<Layer['kind'], string> = {
  text: 'T',
  arrow: '↗',
  shape: '▭',
  image: '▣',
  emoji: '☻',
  blur: '▒',
  badge: '①',
  spotlight: '◎',
  draw: '✎',
  redact: '▓',
}
