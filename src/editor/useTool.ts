/**
 * Layer-creation gestures on the stage.
 *
 * While a gesture is in progress the layer lives as a draft outside the document: it
 * renders but never enters history. It lands in the document once, on release — so
 * one arrow is one undo step, not a hundred.
 */
import type Konva from 'konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import { useCallback, useRef, useState } from 'react'

import { eraseAlong, eraseAt, type EraserMode } from '@/core/doc/erase'
import { addLayer, createLayer } from '@/core/doc/layers'
import type { Layer, Point } from '@/core/doc/types'

import { isMeaningfulDrag, rectFromDrag, specFor, type Tool, toolPatch } from './tools'
import type { DocumentController } from './useDocument'

/** Eraser settings: they are about the tool, not the document, so they live here. */
export type EraserSettings = { size: number; mode: EraserMode }

export const DEFAULT_ERASER: EraserSettings = { size: 16, mode: 'part' }

export type ToolController = {
  tool: Tool
  setTool: (tool: Tool) => void
  eraser: EraserSettings
  setEraser: (patch: Partial<EraserSettings>) => void
  /** Current eraser position — for the ring under the cursor. Null when off canvas. */
  eraserAt: Point | null
  /** Draft rendered over the document until the gesture ends. */
  draft: Layer | null
  onMouseDown: (event: KonvaEventObject<MouseEvent>) => void
  onMouseMove: (event: KonvaEventObject<MouseEvent>) => void
  onMouseUp: () => void
}

function pointerIn(stage: Konva.Stage | null): Point | null {
  const position = stage?.getRelativePointerPosition()
  return position ? { x: position.x, y: position.y } : null
}

export function useTool(
  controller: DocumentController,
  /** Passes the whole layer, not just the id: the caller cares about the kind too — text starts typing immediately. */
  onCreated: (layer: Layer) => void,
): ToolController {
  const [tool, setTool] = useState<Tool>('select')
  const [draft, setDraft] = useState<Layer | null>(null)
  const [eraser, setEraserSettings] = useState<EraserSettings>(DEFAULT_ERASER)
  const [eraserAt, setEraserAt] = useState<Point | null>(null)
  const origin = useRef<Point | null>(null)
  const trail = useRef<Point[]>([])

  const setEraser = useCallback((patch: Partial<EraserSettings>) => {
    setEraserSettings((current) => ({ ...current, ...patch }))
  }, [])

  const finish = useCallback(
    (layer: Layer | null) => {
      origin.current = null
      trail.current = []
      setDraft(null)
      if (!layer) return

      controller.commit((doc) => addLayer(doc, layer))
      onCreated(layer)
      // Tools are one-shot: draw once, back to the pointer, as in other editors.
      setTool('select')
    },
    [controller, onCreated],
  )

  const onMouseDown = useCallback(
    (event: KonvaEventObject<MouseEvent>) => {
      const spec = specFor(tool)
      if (spec.gesture === 'none') return

      const point = pointerIn(event.target.getStage())
      if (!point) return

      // The eraser is checked before kind: it is the only gesture that creates no
      // layers, and used to be cut off early by the generic "nothing to create" check.
      if (spec.gesture === 'erase') {
        origin.current = point
        trail.current = [point]
        // edit, not commit: everything erased in one stroke is one undo step.
        controller.edit((doc) => eraseAt(doc, point, eraser.size, eraser.mode))
        return
      }

      if (!spec.kind) return

      if (spec.gesture === 'click') {
        const layer = { ...createLayer(spec.kind, { at: point }), ...toolPatch(tool) }
        finish(layer)
        return
      }

      origin.current = point
      trail.current = [point]

      if (spec.gesture === 'freehand') {
        setDraft({ ...createLayer(spec.kind, { points: [point] }), ...toolPatch(tool) })
      }
    },
    [tool, finish, controller, eraser],
  )

  const onMouseMove = useCallback(
    (event: KonvaEventObject<MouseEvent>) => {
      // The eraser ring follows the cursor even before pressing: the size is visible upfront.
      if (specFor(tool).gesture === 'erase') setEraserAt(pointerIn(event.target.getStage()))

      const from = origin.current
      if (!from) return

      const spec = specFor(tool)

      if (spec.gesture === 'erase') {
        const point = pointerIn(event.target.getStage())
        if (!point) return

        const previous = trail.current.at(-1) ?? point
        trail.current = [point]
        // Erase the whole path from the previous position: on a fast swipe mouse events
        // arrive a dozen pixels apart, and one circle per event would leave a dotted trail.
        controller.edit((doc) => eraseAlong(doc, previous, point, eraser.size, eraser.mode))
        return
      }

      if (!spec.kind) return

      const point = pointerIn(event.target.getStage())
      if (!point) return

      if (spec.gesture === 'freehand') {
        trail.current = [...trail.current, point]
        setDraft({
          ...createLayer(spec.kind, { points: trail.current }),
          ...toolPatch(tool),
        })
        return
      }

      // The last point is needed on release to tell a gesture from a stray click.
      trail.current = [from, point]

      const seed =
        spec.kind === 'arrow' ? { points: [from, point] } : { rect: rectFromDrag(from, point) }

      setDraft({ ...createLayer(spec.kind, seed), ...toolPatch(tool) })
    },
    [tool, controller, eraser],
  )

  const onMouseUp = useCallback(() => {
    const from = origin.current
    if (!from) return

    const spec = specFor(tool)

    if (spec.gesture === 'erase') {
      origin.current = null
      trail.current = []
      // Gesture over: the next erase becomes its own history step.
      controller.commit()
      return
    }
    const last = trail.current.at(-1) ?? from

    // A stray click must not leave a one-pixel layer behind.
    if (spec.gesture !== 'freehand' && !isMeaningfulDrag(from, last)) {
      finish(null)
      return
    }

    if (spec.gesture === 'freehand' && trail.current.length < 3) {
      finish(null)
      return
    }

    finish(draft)
  }, [tool, draft, finish, controller])

  return {
    tool,
    setTool,
    eraser,
    setEraser,
    eraserAt,
    draft,
    onMouseDown,
    onMouseMove,
    onMouseUp,
  }
}
