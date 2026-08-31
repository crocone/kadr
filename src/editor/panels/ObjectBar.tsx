import type { ReactElement } from 'react'

import {
  ANNOTATION_COLORS,
  duplicateLayer,
  findLayer,
  layerBounds,
  removeLayer,
  shiftLayerBy,
  updateLayer,
} from '@/core/doc/layers'
import { ARROW_STYLES } from '@/core/doc/arrows'
import { badgeLabel } from '@/core/doc/badges'
import { type Alignment, alignmentDelta } from '@/core/doc/snapping'
import type { Doc, Layer } from '@/core/doc/types'
import type { MessageKey } from '@/core/i18n'
import { useT } from '@/core/ui/app-context'
import { cn } from '@/core/ui/cn'
import { Button } from '@/core/ui/components'
import { ColorChoice } from '@/core/ui/controls'
import {
  IconAlignBottom,
  IconAlignCentreX,
  IconAlignCentreY,
  IconAlignLeft,
  IconAlignRight,
  IconAlignTop,
  IconClose,
  IconDuplicate,
  type IconProps,
} from '@/core/ui/icons'

import { specFor, type Tool } from '../tools'
import { FontPicker } from './FontPicker'
import type { DocumentController } from '../useDocument'

/**
 * Contextual bar for the selected object at the bottom of the canvas.
 *
 * Only the settings edited on every object live here (colour, width, arrow head);
 * rare ones stay in the right panel so the bar stays compact and quick.
 */
export function ObjectBar({ controller, layer }: { controller: DocumentController; layer: Layer }) {
  const t = useT()
  const { commit, edit } = controller

  const patch = (fields: Partial<Layer>) => {
    commit((current) => updateLayer(current, layer.id, fields))
  }

  const colour = colourOf(layer)
  const width = widthOf(layer)

  /**
   * Alignment reads the document at click time, not the layer from props: a gesture
   * may have moved the layer since render, and stale bounds would misplace the shift.
   */
  const align = (alignment: Alignment) => {
    commit((current) => {
      const target = findLayer(current, layer.id)
      const bounds = target ? layerBounds(target) : null
      if (!target || !bounds) return current

      const { dx, dy } = alignmentDelta(bounds, canvasRect(current), alignment)
      return updateLayer(current, layer.id, shiftLayerBy(target, { x: dx, y: dy }))
    })
  }

  return (
    <div className="pointer-events-auto flex items-center gap-4 rounded-panel border border-border bg-raised px-3 py-2 shadow-float">
      <span className="flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent/15 text-accent">
          {GLYPHS[layer.kind]}
        </span>
        <span className="flex flex-col leading-tight">
          <span className="text-[13px] font-semibold">{t(titleKeyFor(layer.kind))}</span>
          <span className="font-mono text-[10px] text-text-muted">
            {t('editor.object.key', { key: keyFor(layer.kind).toUpperCase() })}
          </span>
        </span>
      </span>

      {colour !== null ? (
        <span className="flex items-center gap-2">
          <span className="text-[11px] text-text-muted">{t('editor.layer.colour')}</span>
          <ColorChoice
            colors={ANNOTATION_COLORS}
            value={colour}
            labels={{ custom: t('editor.color.custom'), screen: t('editor.color.screen') }}
            onPick={(next) => {
              patch(colourPatch(layer, next))
            }}
          />
        </span>
      ) : null}

      {width !== null ? (
        <span className="flex items-center gap-2">
          <span className="text-[11px] text-text-muted">{t('editor.layer.width')}</span>
          <span className="flex items-center gap-1">
            {[3, 6, 12].map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  patch(widthPatch(layer, value))
                }}
                className={cn(
                  'grid h-7 w-9 place-items-center rounded-md border transition-colors',
                  Math.round(width) === value
                    ? 'border-accent bg-accent/15'
                    : 'border-border hover:border-border-strong',
                )}
              >
                <span
                  className="block w-5 rounded-full bg-text-soft"
                  style={{ height: Math.max(1, value / 2) }}
                />
              </button>
            ))}
          </span>
        </span>
      ) : null}

      {layer.kind === 'text' ? (
        <span className="flex items-center gap-2">
          <FontPicker
            value={layer.fontFamily}
            onPick={(fontFamily) => {
              patch({ fontFamily })
            }}
          />

          <span className="flex items-center gap-1" title={t('editor.text.size')}>
            {[20, 32, 48, 72].map((size) => (
              <button
                key={size}
                type="button"
                onClick={() => {
                  patch({ fontSize: size })
                }}
                className={cn(
                  'h-7 w-8 rounded-md border text-[11px] transition-colors',
                  layer.fontSize === size
                    ? 'border-accent bg-accent/15 text-text'
                    : 'border-border text-text-muted hover:border-border-strong',
                )}
              >
                {size}
              </button>
            ))}
          </span>

          <span className="flex items-center gap-1" title={t('editor.text.weight')}>
            {[400, 600, 800].map((weight) => (
              <button
                key={weight}
                type="button"
                onClick={() => {
                  patch({ fontWeight: weight })
                }}
                className={cn(
                  'h-7 w-8 rounded-md border text-[12px] transition-colors',
                  layer.fontWeight === weight
                    ? 'border-accent bg-accent/15 text-text'
                    : 'border-border text-text-muted hover:border-border-strong',
                )}
                style={{ fontWeight: weight }}
              >
                A
              </button>
            ))}
          </span>

          <span className="flex items-center gap-1" title={t('editor.text.align')}>
            {(['left', 'center', 'right'] as const).map((align) => (
              <button
                key={align}
                type="button"
                onClick={() => {
                  patch({ align })
                }}
                className={cn(
                  'grid h-7 w-8 place-items-center rounded-md border transition-colors',
                  layer.align === align
                    ? 'border-accent bg-accent/15 text-text'
                    : 'border-border text-text-muted hover:border-border-strong',
                )}
              >
                <span className="flex w-4 flex-col gap-[3px]">
                  <span className="block h-[1.5px] w-full rounded bg-current" />
                  <span
                    className={cn(
                      'block h-[1.5px] w-2/3 rounded bg-current',
                      align === 'center' ? 'self-center' : align === 'right' ? 'self-end' : '',
                    )}
                  />
                  <span className="block h-[1.5px] w-full rounded bg-current" />
                </span>
              </button>
            ))}
          </span>
        </span>
      ) : null}

      {layer.kind === 'badge' ? (
        <span className="flex items-center gap-2">
          <span className="text-[11px] text-text-muted">{t('editor.badge.style')}</span>
          <span className="flex items-center gap-1">
            {(['number', 'roman', 'bullet'] as const).map((style) => (
              <button
                key={style}
                type="button"
                title={t(`editor.badge.${style}`)}
                onClick={() => {
                  patch({ style })
                }}
                className={cn(
                  'grid h-7 w-8 place-items-center rounded-md border text-[12px] transition-colors',
                  layer.style === style
                    ? 'border-accent bg-accent/15 text-text'
                    : 'border-border text-text-muted hover:border-border-strong',
                )}
              >
                {badgeLabel(style === 'bullet' ? 1 : 2, style)}
              </button>
            ))}
          </span>
        </span>
      ) : null}

      {layer.kind === 'arrow' ? (
        <span className="flex items-center gap-2">
          <span className="text-[11px] text-text-muted">{t('editor.object.head')}</span>
          <span className="flex items-center gap-1">
            {ARROW_STYLES.map((style) => (
              <button
                key={style}
                type="button"
                title={t(`editor.arrow.${style}`)}
                onClick={() => {
                  patch({ style })
                }}
                className={cn(
                  'grid h-7 w-8 place-items-center rounded-md border text-xs transition-colors',
                  layer.style === style
                    ? 'border-accent bg-accent/15 text-text'
                    : 'border-border text-text-muted hover:border-border-strong',
                )}
              >
                {ARROW_GLYPHS[style]}
              </button>
            ))}
          </span>
        </span>
      ) : null}

      <span className="flex items-center gap-2">
        <span className="text-[11px] text-text-muted">{t('editor.align.title')}</span>
        <span className="flex items-center gap-0.5">
          {ALIGNMENTS.map(({ alignment, Glyph }) => (
            <button
              key={alignment}
              type="button"
              title={t(`editor.align.${alignment}`)}
              onClick={() => {
                align(alignment)
              }}
              className="grid h-7 w-7 place-items-center rounded-md text-text-muted transition-colors hover:bg-surface-muted hover:text-text"
            >
              <Glyph size={16} />
            </button>
          ))}
        </span>
      </span>

      <span className="ml-auto flex items-center gap-1">
        <Button
          size="sm"
          variant="ghost"
          title={t('editor.layers.duplicate')}
          onClick={() => {
            commit((current) => duplicateLayer(current, layer.id).doc)
          }}
        >
          <IconDuplicate size={14} />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          title={t('editor.layers.delete')}
          onClick={() => {
            commit((current) => removeLayer(current, layer.id))
          }}
        >
          <IconClose size={14} />
        </Button>
        <input
          type="range"
          min={0.05}
          max={1}
          step={0.01}
          value={layer.opacity}
          title={t('editor.layer.opacity')}
          onChange={(event) => {
            edit((current) =>
              updateLayer(current, layer.id, { opacity: Number(event.target.value) }),
            )
          }}
          onPointerUp={() => {
            commit()
          }}
          className="ml-1 w-20 accent-accent"
        />
      </span>
    </div>
  )
}

/** The seven styles from §2, one glyph each — text labels won't fit in the bar. */
const ARROW_GLYPHS: Record<(typeof ARROW_STYLES)[number], string> = {
  straight: '→',
  curved: '↷',
  elbow: '⌐',
  double: '↔',
  thin: '⟶',
  thick: '➜',
  sketch: '⇢',
}

/** The full canvas — alignment targets its edges and centre. */
function canvasRect(doc: Doc) {
  return { x: 0, y: 0, w: doc.canvas.w, h: doc.canvas.h }
}

const ALIGNMENTS: readonly { alignment: Alignment; Glyph: (props: IconProps) => ReactElement }[] = [
  { alignment: 'left', Glyph: IconAlignLeft },
  { alignment: 'centreX', Glyph: IconAlignCentreX },
  { alignment: 'right', Glyph: IconAlignRight },
  { alignment: 'top', Glyph: IconAlignTop },
  { alignment: 'centreY', Glyph: IconAlignCentreY },
  { alignment: 'bottom', Glyph: IconAlignBottom },
]

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

function colourOf(layer: Layer): string | null {
  switch (layer.kind) {
    case 'text':
    case 'arrow':
    case 'badge':
    case 'draw':
      return layer.color
    case 'shape':
      return layer.stroke
    default:
      return null
  }
}

function colourPatch(layer: Layer, color: string): Partial<Layer> {
  return layer.kind === 'shape' ? { stroke: color } : { color }
}

function widthOf(layer: Layer): number | null {
  switch (layer.kind) {
    case 'arrow':
    case 'draw':
      return layer.width
    case 'shape':
      return layer.strokeWidth
    default:
      return null
  }
}

function widthPatch(layer: Layer, width: number): Partial<Layer> {
  return layer.kind === 'shape' ? { strokeWidth: width } : { width }
}

/**
 * Shortcut key of the tool that creates the layer. Images have none (they arrive by
 * paste); emoji no longer do — emoji are now placed as text, but old layers remain.
 */
function keyFor(kind: Layer['kind']): string {
  if (kind === 'image' || kind === 'emoji') return '—'

  const tool: Tool =
    kind === 'shape' ? 'rect' : kind === 'draw' ? 'pen' : kind === 'redact' ? 'blur' : kind
  return specFor(tool).key
}

/** Titles are listed explicitly: a template string doesn't type-check as a MessageKey. */
function titleKeyFor(kind: Layer['kind']): MessageKey {
  switch (kind) {
    case 'text':
      return 'editor.tool.text'
    case 'arrow':
      return 'editor.tool.arrow'
    case 'shape':
      return 'editor.tool.rect'
    case 'emoji':
      return 'editor.tool.emoji'
    case 'badge':
      return 'editor.tool.badge'
    case 'spotlight':
      return 'editor.tool.spotlight'
    case 'draw':
      return 'editor.tool.pen'
    default:
      return 'editor.tool.blur'
  }
}
