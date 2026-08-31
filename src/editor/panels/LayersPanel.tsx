import { useState } from 'react'

import { CAPTURE_ID, clearCaptureImage, hasCaptureImage } from '@/core/doc/capture-ops'
import {
  badgeNumbers,
  duplicateLayer,
  moveLayer,
  removeLayer,
  reorderLayers,
  updateLayer,
} from '@/core/doc/layers'
import type { Layer } from '@/core/doc/types'
import { useT } from '@/core/ui/app-context'
import { cn } from '@/core/ui/cn'
import {
  IconClose,
  IconDuplicate,
  IconEye,
  IconEyeOff,
  IconLock,
  IconLower,
  IconRaise,
  IconUnlock,
} from '@/core/ui/icons'

import type { DocumentController } from '../useDocument'

const GLYPHS: Record<Layer['kind'], string> = {
  text: 'T',
  arrow: '↗',
  shape: '▭',
  image: '🖼',
  emoji: '☺',
  blur: '▒',
  badge: '①',
  spotlight: '◎',
  draw: '✎',
  redact: '▓',
}

/**
 * Layers panel. The list reads top-down while the document stores layers bottom-up:
 * the top list item paints last, as in every editor — hence the index reversal.
 */
export function LayersPanel({
  controller,
  selected,
  onSelect,
  onReplaceImage,
}: {
  controller: DocumentController
  selected: string | null
  onSelect: (id: string | null) => void
  /** The capture is a list row like any other: it can be hidden, deleted, replaced. */
  onReplaceImage: () => void
}) {
  const t = useT()
  const { doc, commit } = controller
  const [dragging, setDragging] = useState<number | null>(null)

  const numbers = badgeNumbers(doc.layers)
  const ordered = [...doc.layers].reverse()

  const toModelIndex = (listIndex: number) => doc.layers.length - 1 - listIndex

  const drop = (listIndex: number) => {
    if (dragging === null || dragging === listIndex) return
    commit((current) => reorderLayers(current, toModelIndex(dragging), toModelIndex(listIndex)))
    setDragging(null)
  }

  /** "Up" in the list means later in the document: the top item paints last. */
  const shift = (id: string, to: 'up' | 'down') => {
    commit((current) => moveLayer(current, id, to))
  }

  const captureRow = (
    <li
      onClick={() => {
        onSelect(CAPTURE_ID)
      }}
      className={cn(
        'flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-xs',
        selected === CAPTURE_ID
          ? 'bg-accent/15 text-text'
          : 'text-text-muted hover:bg-surface-muted',
      )}
    >
      <span className="w-4 text-center">▣</span>
      <span className="min-w-0 flex-1 truncate">
        {hasCaptureImage(doc) ? t('editor.object.capture') : t('editor.capture.empty')}
      </span>

      {hasCaptureImage(doc) ? (
        <>
          <IconButton
            title={t(doc.capture.visible ? 'editor.layers.hide' : 'editor.layers.show')}
            onClick={() => {
              commit((current) => ({
                ...current,
                capture: { ...current.capture, visible: !current.capture.visible },
              }))
            }}
          >
            {doc.capture.visible ? <IconEye size={14} /> : <IconEyeOff size={14} />}
          </IconButton>
          <IconButton title={t('editor.capture.replace')} onClick={onReplaceImage}>
            <IconDuplicate size={14} />
          </IconButton>
          <IconButton
            title={t('editor.layers.delete')}
            onClick={() => {
              commit(clearCaptureImage)
            }}
          >
            <IconClose size={14} />
          </IconButton>
        </>
      ) : (
        <IconButton title={t('editor.capture.load')} onClick={onReplaceImage}>
          <IconDuplicate size={14} />
        </IconButton>
      )}
    </li>
  )

  return (
    <div className="flex flex-col gap-2.5">
      {doc.layers.length === 0 ? (
        <ul className="flex flex-col gap-0.5">{captureRow}</ul>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {ordered.map((layer, listIndex) => (
            <li
              key={layer.id}
              draggable
              onDragStart={(event) => {
                // Chrome won't start the drag at all without data in dataTransfer.
                event.dataTransfer.setData('text/plain', layer.id)
                event.dataTransfer.effectAllowed = 'move'
                setDragging(listIndex)
              }}
              onDragOver={(event) => {
                event.preventDefault()
              }}
              onDrop={(event) => {
                event.preventDefault()
                // Otherwise it bubbles to the editor, which expects a dropped file.
                event.stopPropagation()
                drop(listIndex)
              }}
              onClick={() => {
                onSelect(layer.id)
              }}
              className={cn(
                'flex cursor-grab items-center gap-1.5 rounded-md px-1.5 py-1 text-xs',
                layer.id === selected
                  ? 'bg-accent/15 text-text'
                  : 'text-text-muted hover:bg-surface-muted',
                dragging === listIndex && 'opacity-50',
              )}
            >
              <span className="w-4 text-center">{GLYPHS[layer.kind]}</span>
              <span className="min-w-0 flex-1 truncate">
                {layer.kind === 'badge'
                  ? `${layer.name} ${numbers.get(layer.id) ?? ''}`
                  : layer.name}
              </span>

              <IconButton
                title={t('editor.layers.raise')}
                onClick={() => {
                  shift(layer.id, 'up')
                }}
              >
                <IconRaise size={14} />
              </IconButton>
              <IconButton
                title={t('editor.layers.lower')}
                onClick={() => {
                  shift(layer.id, 'down')
                }}
              >
                <IconLower size={14} />
              </IconButton>
              <IconButton
                title={t(layer.visible ? 'editor.layers.hide' : 'editor.layers.show')}
                onClick={() => {
                  commit((current) => updateLayer(current, layer.id, { visible: !layer.visible }))
                }}
              >
                {layer.visible ? <IconEye size={14} /> : <IconEyeOff size={14} />}
              </IconButton>
              <IconButton
                title={t(layer.locked ? 'editor.layers.unlock' : 'editor.layers.lock')}
                onClick={() => {
                  commit((current) => updateLayer(current, layer.id, { locked: !layer.locked }))
                }}
              >
                {layer.locked ? <IconLock size={14} /> : <IconUnlock size={14} />}
              </IconButton>
              <IconButton
                title={t('editor.layers.duplicate')}
                onClick={() => {
                  commit((current) => duplicateLayer(current, layer.id).doc)
                }}
              >
                <IconDuplicate size={14} />
              </IconButton>
              <IconButton
                title={t('editor.layers.delete')}
                onClick={() => {
                  commit((current) => removeLayer(current, layer.id))
                  if (selected === layer.id) onSelect(null)
                }}
              >
                <IconClose size={14} />
              </IconButton>
            </li>
          ))}
          {captureRow}
        </ul>
      )}
    </div>
  )
}

function IconButton({
  title,
  onClick,
  children,
}: {
  title: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
      className="rounded p-0.5 text-text-muted transition-colors hover:text-text"
    >
      {children}
    </button>
  )
}
