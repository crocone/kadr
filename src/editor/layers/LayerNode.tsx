import Konva from 'konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import { useEffect, useMemo, useRef } from 'react'
import {
  Arrow,
  Circle,
  Ellipse,
  Group,
  Image as KonvaImage,
  Line,
  Rect,
  Shape,
  Text,
} from 'react-konva'

import { arrowShape } from '@/core/doc/arrows'
import { badgeLabel } from '@/core/doc/badges'
import { hasDecoration, screenCorners } from '@/core/doc/frames'
import type { Layer, Rect as DocRect } from '@/core/doc/types'
import { withAlpha } from '@/core/render/color'
import { documentRectToImageRect } from '@/core/render/fit'

import { DimWithHole } from '../DocScene'
import { decorationScene } from '../scene/decoration'
import { useStoredImage } from '../useStoredImage'

export type LayerNodeProps = {
  layer: Layer
  /** Capture underneath: blur and redaction sample pixels from it. */
  frame: HTMLImageElement | null
  frameRect: DocRect
  /** Visible part of the image in its own pixels: after a crop this is not the whole capture. */
  source?: DocRect
  canvas: { w: number; h: number }
  /** Badge number is computed from layer order, not stored in the layer. */
  badgeNumber?: number
  /**
   * Whether the layer catches the mouse. With an active tool it must not: otherwise
   * the layer would swallow the event before the scene, and a drawing gesture over
   * it would never start.
   */
  interactive?: boolean
  /** Selection is drawn as a separate outline in DocScene, not as a stroke on the layer itself. */
  selected: boolean
  onSelect: (id: string) => void
  onDragEnd: (id: string, delta: { x: number; y: number }) => void
  /** Snapping during a gesture: returns a correction to the delta and draws guides. */
  onDragSnap?: (id: string, delta: { x: number; y: number }) => { x: number; y: number }
  /** Double-clicking a text layer opens typing right on the canvas. */
  onEdit?: (id: string) => void
}

/**
 * One document layer as a Konva node.
 *
 * Dragging is reported upward as a delta, not an absolute position: layers have
 * different geometry — a point, a rect, a list of points — and a delta applies to
 * all of them the same way.
 */
export function LayerNode(props: LayerNodeProps) {
  const { layer, onSelect, onDragEnd, onDragSnap, onEdit, interactive = true } = props

  /**
   * Drag start position. The node sits at its own document coordinates — a label at
   * its point, a shape at its rect corner — so its position during the gesture is an
   * address, not a delta. Delta = current minus start; without the subtraction the
   * layer moved twice as far and "flew off sideways".
   */
  const from = useRef({ x: 0, y: 0 })

  const common = {
    id: layer.id,
    name: 'layer',
    visible: layer.visible,
    opacity: layer.opacity,
    rotation: layer.rotation,
    listening: interactive,
    draggable: interactive && !layer.locked,
    onMouseDown: (event: KonvaEventObject<MouseEvent>) => {
      event.cancelBubble = true
      onSelect(layer.id)
    },
    onDblClick: () => {
      onEdit?.(layer.id)
    },
    onDragStart: (event: KonvaEventObject<DragEvent>) => {
      const node = event.target
      from.current = { x: node.x(), y: node.y() }
    },
    onDragMove: (event: KonvaEventObject<DragEvent>) => {
      if (!onDragSnap) return
      const node = event.target
      const start = from.current
      const snapped = onDragSnap(layer.id, { x: node.x() - start.x, y: node.y() - start.y })
      node.position({ x: start.x + snapped.x, y: start.y + snapped.y })
    },
    onDragEnd: (event: KonvaEventObject<DragEvent>) => {
      const node = event.target
      const start = from.current
      onDragEnd(layer.id, { x: node.x() - start.x, y: node.y() - start.y })
      // The delta went into the document — reset the node, or it would shift twice.
      node.position(start)
    },
  }

  switch (layer.kind) {
    case 'text':
      return (
        <Text
          {...common}
          x={layer.at.x}
          y={layer.at.y}
          text={layer.text}
          fontFamily={layer.fontFamily}
          fontSize={layer.fontSize}
          fontStyle={String(layer.fontWeight)}
          fill={layer.color}
          align={layer.align}
          {...(layer.width ? { width: layer.width, wrap: 'word' as const } : {})}
        />
      )

    case 'arrow': {
      const shape = arrowShape(layer)
      return (
        <Arrow
          {...common}
          x={0}
          y={0}
          points={shape.points}
          tension={shape.tension}
          stroke={layer.color}
          fill={layer.color}
          strokeWidth={shape.width}
          pointerLength={shape.width * 2.2}
          pointerWidth={shape.width * 2}
          pointerAtBeginning={shape.pointerAtBeginning}
          lineCap="round"
          {...(shape.dash ? { dash: shape.dash } : {})}
        />
      )
    }

    case 'shape':
      return <ShapeNode {...props} common={common} />

    case 'emoji':
      return (
        <Text {...common} x={layer.at.x} y={layer.at.y} text={layer.emoji} fontSize={layer.size} />
      )

    case 'badge':
      return (
        <Group {...common} x={layer.at.x} y={layer.at.y}>
          <Circle
            x={layer.size / 2}
            y={layer.size / 2}
            radius={layer.size / 2}
            fill={layer.color}
            shadowColor="#000000"
            shadowBlur={8}
            shadowOpacity={0.3}
          />
          <Text
            width={layer.size}
            height={layer.size}
            text={badgeLabel(props.badgeNumber ?? layer.number ?? 1, layer.style)}
            // A bullet dot renders larger than a digit: at the same size it looks like a speck.
            fontSize={layer.size * (layer.style === 'bullet' ? 0.8 : 0.52)}
            fontStyle="700"
            fill="#ffffff"
            align="center"
            verticalAlign="middle"
          />
        </Group>
      )

    case 'spotlight':
      return <SpotlightNode {...props} common={common} />

    case 'draw':
      return (
        <Line
          {...common}
          x={0}
          y={0}
          points={layer.points}
          stroke={layer.mode === 'highlighter' ? withAlpha(layer.color, 0.4) : layer.color}
          strokeWidth={layer.mode === 'highlighter' ? layer.width * 2.5 : layer.width}
          lineCap="round"
          lineJoin="round"
          tension={0.3}
          {...(layer.mode === 'highlighter'
            ? { globalCompositeOperation: 'multiply' as const }
            : {})}
        />
      )

    case 'blur':
    case 'redact':
      return <BlurNode {...props} common={common} />

    case 'image':
      return <ImageNode {...props} common={common} />
  }
}

type CommonProps = Record<string, unknown>

/**
 * Image layer: the document's second and later frames.
 *
 * While the image loads, a placeholder outline stands in — not emptiness: otherwise
 * laying out three screenshots looks like two of them got lost.
 */
function ImageNode({ layer, common }: LayerNodeProps & { common: CommonProps }) {
  const image = useStoredImage(layer.kind === 'image' ? layer.imageId : null)
  const mockup = useStoredImage(
    layer.kind === 'image' ? (layer.decoration?.customMockup?.imageId ?? null) : null,
  )
  if (layer.kind !== 'image') return null

  const { rect, decoration } = layer

  if (!image) {
    return (
      <Rect
        {...common}
        x={rect.x}
        y={rect.y}
        width={rect.w}
        height={rect.h}
        stroke="#4a4d55"
        strokeWidth={1}
        dash={[6, 6]}
      />
    )
  }

  const box = { x: rect.x, y: rect.y, width: rect.w, height: rect.h }
  const shadow = decoration?.shadow
  const shadowProps = shadow
    ? {
        shadowColor: shadow.color,
        shadowBlur: shadow.blur,
        shadowOffsetX: shadow.offsetX,
        shadowOffsetY: shadow.offsetY,
        shadowOpacity: shadow.opacity,
      }
    : {}

  return (
    <>
      {/* The decoration is drawn behind the image in its own coordinates — same as the
          document's capture: in a responsive series all frames are equal, and each needs a frame. */}
      {hasDecoration(decoration) ? (
        <Shape
          {...box}
          {...shadowProps}
          listening={false}
          sceneFunc={decorationScene(decoration!, null, mockup)}
        />
      ) : null}

      <KonvaImage
        {...common}
        image={image}
        {...box}
        cornerRadius={decoration ? screenCorners(decoration, rect) : 8}
        {...(hasDecoration(decoration) ? {} : shadowProps)}
      />
    </>
  )
}

function ShapeNode({ layer, common }: LayerNodeProps & { common: CommonProps }) {
  if (layer.kind !== 'shape') return null
  const { rect } = layer

  const paint = {
    stroke: layer.stroke,
    strokeWidth: layer.strokeWidth,
    ...(layer.fill ? { fill: layer.fill } : {}),
  }

  if (layer.shape === 'ellipse') {
    return (
      <Ellipse
        {...common}
        x={rect.x + rect.w / 2}
        y={rect.y + rect.h / 2}
        radiusX={rect.w / 2}
        radiusY={rect.h / 2}
        {...paint}
      />
    )
  }

  if (layer.shape === 'line') {
    return (
      <Line
        {...common}
        x={0}
        y={0}
        points={[rect.x, rect.y, rect.x + rect.w, rect.y + rect.h]}
        lineCap="round"
        {...paint}
      />
    )
  }

  if (layer.shape === 'callout') {
    // Callout: a rectangle with a tail toward the bottom-left corner.
    const tail = [
      rect.x + rect.w * 0.2,
      rect.y + rect.h,
      rect.x,
      rect.y + rect.h * 1.5,
      rect.x + rect.w * 0.4,
      rect.y + rect.h,
    ]
    return (
      <Group {...common}>
        <Rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} cornerRadius={12} {...paint} />
        <Line points={tail} closed {...paint} />
      </Group>
    )
  }

  return (
    <Rect
      {...common}
      x={rect.x}
      y={rect.y}
      width={rect.w}
      height={rect.h}
      cornerRadius={6}
      {...paint}
    />
  )
}

/**
 * Dims everything except the chosen region.
 *
 * The hole is punched with a second path and the even-odd fill rule, not with
 * `destination-out` compositing: that erases across the whole Konva layer, not just
 * its group, leaving a hole down to the scene background instead of the capture.
 */
function SpotlightNode({ layer, canvas, common }: LayerNodeProps & { common: CommonProps }) {
  if (layer.kind !== 'spotlight') return null

  return (
    <Group {...common}>
      <DimWithHole
        canvas={canvas}
        hole={layer.rect}
        opacity={layer.dimOpacity}
        ellipse={layer.shape === 'ellipse'}
      />
    </Group>
  )
}

/**
 * Blur and pixelation as a layer: a piece of the capture is cut out and drawn on top
 * with a filter. The layer can be moved, weakened, or removed an hour later — the
 * pixels underneath stay intact (PLAN.md §4).
 */
function BlurNode({
  layer,
  frame,
  frameRect,
  source,
  common,
}: LayerNodeProps & { common: CommonProps }) {
  const ref = useRef<Konva.Image>(null)
  const region = layer.kind === 'blur' || layer.kind === 'redact' ? layer.rect : null
  const mode = layer.kind === 'blur' ? layer.mode : layer.kind === 'redact' ? layer.mode : 'blur'
  const strength = layer.kind === 'blur' ? layer.strength : 16

  /**
   * Offsets are measured from the visible part of the capture, not the image corner:
   * after a crop those differ. Memoization matters for the filter cache below — a new
   * object every render would rebuild the cache endlessly.
   */
  const crop = useMemo(() => {
    const visible =
      source ?? (frame ? { x: 0, y: 0, w: frame.naturalWidth, h: frame.naturalHeight } : null)
    if (!frame || !region || !visible) return null

    const inside = documentRectToImageRect(region, frameRect, { w: visible.w, h: visible.h })
    return inside ? { ...inside, x: inside.x + visible.x, y: inside.y + visible.y } : null
  }, [frame, region, source, frameRect])

  // Konva filters only work on a cached node, and the cache must be rebuilt on every change.
  useEffect(() => {
    const node = ref.current
    if (!node || !crop) return
    node.cache()
    node.getLayer()?.batchDraw()
  }, [crop, mode, strength, frame])

  if (!region) return null

  if (!frame || !crop || mode === 'fill') {
    return (
      <Rect
        {...common}
        x={region.x}
        y={region.y}
        width={region.w}
        height={region.h}
        fill="#0f172a"
      />
    )
  }

  return (
    <KonvaImage
      {...common}
      ref={ref}
      image={frame}
      x={region.x}
      y={region.y}
      width={region.w}
      height={region.h}
      crop={{ x: crop.x, y: crop.y, width: crop.w, height: crop.h }}
      filters={mode === 'pixelate' ? [Konva.Filters.Pixelate] : [Konva.Filters.Blur]}
      blurRadius={strength}
      pixelSize={Math.max(2, Math.round(strength))}
    />
  )
}
