import type Konva from 'konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Stage as KonvaStage } from 'react-konva'

import type { Guide } from '@/core/doc/snapping'
import type { Doc, LayerId, Point, Rect, TextLayer } from '@/core/doc/types'
import {
  clampZoom,
  fitView,
  initialView,
  type View,
  ZOOM_STEP,
  zoomAt,
  zoomAtCentre,
} from '@/core/render/view'
import { useT } from '@/core/ui/app-context'

import { CROP_REGION_ID, DocScene } from './DocScene'
import { SelectionFrame, type TransformBox } from './layers/SelectionFrame'
import { TextEditor } from './TextEditor'
import type { ToolController } from './useTool'
import { ZoomBar } from './ZoomBar'

/**
 * The stage fills the panel; the document moves inside it via zoom and pan.
 * Fitting a long page entirely is pointless — at 20x reduction there is nothing to
 * read — so by default it fits to width.
 *
 * The document rendering itself lives in DocScene: export shoots that same scene.
 */
export function Stage({
  doc,
  frame,
  background,
  mockupImage,
  showSafeZones,
  stageRef,
  fitToken,
  tools,
  selected,
  onSelect,
  onMoveLayer,
  onMoveCapture,
  onTransform,
  cropRect,
  onCropRect,
  onDragSnap,
  guides,
  editing,
  onEditLayer,
  onEditDone,
  onArrowControl,
  domain,
}: {
  doc: Doc
  frame: HTMLImageElement | null
  background: HTMLImageElement | null
  mockupImage: HTMLImageElement | null
  showSafeZones: boolean
  stageRef: RefObject<Konva.Stage | null>
  tools: ToolController
  /** Selected layer, or the capture itself (CAPTURE_ID). */
  selected: string | null
  onSelect: (id: string | null) => void
  onMoveLayer: (id: LayerId, delta: { x: number; y: number }) => void
  onMoveCapture: (delta: { x: number; y: number }) => void
  onTransform: (id: string, box: TransformBox) => void
  /** While set, crop mode is on: the selection frame attaches to it. */
  cropRect: Rect | null
  onCropRect: (rect: Rect) => void
  onDragSnap: (id: string, delta: { x: number; y: number }) => { x: number; y: number }
  guides: Guide[]
  /** Text layer being typed, together with its input field. */
  editing: TextLayer | null
  onEditLayer: (id: string) => void
  onEditDone: (text: string) => void
  onArrowControl: (id: string, control: Point, done: boolean) => void
  /** Capture domain — for the browser frame's address bar. */
  domain: string | null
  /**
   * Fit-request counter. Bumped when the canvas size changes: a hand-adjusted view
   * is tagged with the counter value it was made under, so after a size change the
   * tags no longer match and the scene falls back to the computed view on its own.
   */
  fitToken: number
}) {
  const t = useT()
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })

  /** null — the user has not touched the view yet; token — which canvas size it was tuned for. */
  const [userView, setUserView] = useState<{ token: number; view: View } | null>(null)

  useEffect(() => {
    const element = wrapperRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(element)
    return () => {
      observer.disconnect()
    }
  }, [])

  const canvasSize = useMemo(
    () => ({ w: doc.canvas.w, h: doc.canvas.h }),
    [doc.canvas.w, doc.canvas.h],
  )

  // A computed view, not state: until the user intervenes it follows the panel size
  // by itself — no effect calling setState after a measurement.
  //
  // On open the document fits to width (a long page is for reading, not for viewing
  // whole); after a size change it fits entirely: you picked a format, see the format.
  const defaultView = useMemo(
    () => (fitToken === 0 ? initialView(canvasSize, size) : fitView(canvasSize, size)),
    [fitToken, canvasSize, size],
  )
  const view = userView?.token === fitToken ? userView.view : defaultView

  const setView = useCallback(
    (next: View | null) => {
      setUserView(next ? { token: fitToken, view: next } : null)
    },
    [fitToken],
  )

  /**
   * Chrome downscales by 10-20x in a single pass by default, which looks mushy.
   * Resizing the canvas resets the context state, so smoothing quality is re-applied
   * after every view change.
   */
  useEffect(() => {
    const context = stageRef.current?.getLayers()[0]?.getContext()._context
    if (!context) return
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    stageRef.current?.batchDraw()
  }, [view, frame, background, stageRef])

  const onWheel = useCallback(
    (event: KonvaEventObject<WheelEvent>) => {
      event.evt.preventDefault()
      const pointer = event.target.getStage()?.getPointerPosition()
      if (!pointer) return

      setUserView((current) => {
        const from = current?.token === fitToken ? current.view : defaultView
        if (!from) return current
        const factor = event.evt.deltaY > 0 ? 1 / ZOOM_STEP : ZOOM_STEP
        return { token: fitToken, view: zoomAt(from, pointer, from.zoom * factor) }
      })
    },
    [defaultView, fitToken],
  )

  const step = useCallback(
    (factor: number) => {
      setUserView((current) => {
        const from = current?.token === fitToken ? current.view : defaultView
        if (!from) return current
        return { token: fitToken, view: zoomAtCentre(from, size, clampZoom(from.zoom * factor)) }
      })
    },
    [defaultView, fitToken, size],
  )

  /** "1:1" means file pixels, not document pixels: the capture was shot at physical screen pixels. */
  const nativeZoom = frame && doc.capture.width > 0 ? frame.naturalWidth / doc.capture.width : 1

  return (
    <div ref={wrapperRef} className="relative h-full w-full overflow-hidden">
      {view === null ? null : (
        <>
          <KonvaStage
            ref={stageRef}
            width={size.width}
            height={size.height}
            scaleX={view.zoom}
            scaleY={view.zoom}
            x={view.x}
            y={view.y}
            // Panning only with the select tool: with an active tool, dragging draws.
            draggable={tools.tool === 'select' && cropRect === null}
            onWheel={onWheel}
            onDragMove={(event) => {
              if (event.target !== stageRef.current) return
              setView({ zoom: view.zoom, x: event.target.x(), y: event.target.y() })
            }}
            onMouseDown={(event) => {
              // Clicking empty space clears the selection — the event target is the stage itself.
              if (event.target === event.target.getStage()) onSelect(null)
              tools.onMouseDown(event)
            }}
            onMouseMove={tools.onMouseMove}
            onMouseUp={tools.onMouseUp}
            onMouseLeave={tools.onMouseUp}
          >
            <DocScene
              doc={doc}
              frame={frame}
              background={background}
              mockupImage={mockupImage}
              showSafeZones={showSafeZones}
              draft={tools.draft}
              selected={selected}
              onSelectLayer={onSelect}
              onMoveLayer={onMoveLayer}
              onMoveCapture={onMoveCapture}
              onDragSnap={onDragSnap}
              onEditLayer={onEditLayer}
              onArrowControl={onArrowControl}
              domain={domain}
              eraser={
                tools.tool === 'eraser' && tools.eraserAt
                  ? { at: tools.eraserAt, radius: tools.eraser.size }
                  : null
              }
              editing={editing?.id ?? null}
              guides={guides}
              cropRect={cropRect}
              onCropRect={onCropRect}
              interactive={tools.tool === 'select' && cropRect === null}
            >
              <SelectionFrame
                nodeId={cropRect ? CROP_REGION_ID : selected}
                liveWidth={doc.layers.some(
                  (layer) => layer.id === selected && layer.kind === 'text',
                )}
                onTransform={(box) => {
                  if (cropRect) {
                    onCropRect({ x: box.x, y: box.y, w: box.w, h: box.h })
                    return
                  }
                  if (selected) onTransform(selected, box)
                }}
              />
            </DocScene>
          </KonvaStage>

          {editing ? <TextEditor layer={editing} view={view} onDone={onEditDone} /> : null}

          <ZoomBar
            zoom={view.zoom}
            labels={{
              zoomIn: t('editor.zoom.in'),
              zoomOut: t('editor.zoom.out'),
              fit: t('editor.zoom.fit'),
              actual: t('editor.zoom.actual'),
            }}
            onZoomIn={() => {
              step(ZOOM_STEP)
            }}
            onZoomOut={() => {
              step(1 / ZOOM_STEP)
            }}
            onFit={() => {
              setView(fitView(canvasSize, size))
            }}
            onActualSize={() => {
              setView(zoomAtCentre(view, size, nativeZoom))
            }}
          />
        </>
      )}
    </div>
  )
}
