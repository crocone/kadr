import { type ReactNode, useMemo } from 'react'
import {
  Circle,
  Group,
  Image as KonvaImage,
  Layer as KonvaLayer,
  Line,
  Rect,
  Shape,
} from 'react-konva'

import { frameRect, safeZonesFor } from '@/core/doc/canvas-presets'
import { captureDecoration, hasDecoration, screenCorners, tiltSkew } from '@/core/doc/frames'
import { CAPTURE_ID, captureSourceRect } from '@/core/doc/capture-ops'
import { controlPointOf, isCurved } from '@/core/doc/arrows'
import { badgeNumbers } from '@/core/doc/layers'
import type { Guide } from '@/core/doc/snapping'
import type {
  Doc,
  GradientBackground,
  Layer,
  LayerId,
  Point,
  Rect as DocRect,
  WallpaperBackground,
} from '@/core/doc/types'
import Konva from 'konva'

import { withAlpha } from '@/core/render/color'
import { OVERLAY_NAME } from '@/core/render/export'
import { cssFilterString, isNeutral } from '@/core/render/filters'
import { coverRect } from '@/core/render/fit'
import {
  makeTile,
  MESH_BLOBS,
  ringRadii,
  TILE_OVERSAMPLE,
  TILED_PATTERNS,
} from '@/core/render/wallpaper'

import { LayerNode } from './layers/LayerNode'
import { decorationScene } from './scene/decoration'

/**
 * Document content. A separate component because it renders both the preview and the
 * export: export shoots this same scene at document scale (core/render/export).
 *
 * Overlays are tagged with `OVERLAY_NAME` — export hides them by that name so safe
 * zones and guides never end up in the file.
 */

/** Id of the crop region: the handle frame attaches to it. */
export const CROP_REGION_ID = 'crop-region'

export function DocScene({
  doc,
  frame,
  background,
  mockupImage,
  showSafeZones,
  draft,
  selected,
  onSelectLayer,
  onMoveLayer,
  onMoveCapture,
  onDragSnap,
  onEditLayer,
  onArrowControl,
  eraser,
  domain,
  editing,
  guides,
  cropRect,
  onCropRect,
  interactive = true,
  children,
}: {
  doc: Doc
  frame: HTMLImageElement | null
  /** Background image, when the background kind is 'image'. */
  background: HTMLImageElement | null
  /** Custom mockup image, if one is selected. */
  mockupImage?: HTMLImageElement | null
  showSafeZones: boolean
  /** Layer currently being drawn by a gesture: not in the document yet. */
  draft?: Layer | null
  selected?: LayerId | null
  onSelectLayer?: (id: LayerId) => void
  onMoveLayer?: (id: LayerId, delta: { x: number; y: number }) => void
  onMoveCapture?: (delta: { x: number; y: number }) => void
  onDragSnap?: (id: string, delta: { x: number; y: number }) => { x: number; y: number }
  onEditLayer?: (id: string) => void
  /** Arrow curvature: `done` separates dragging the handle from the end of the gesture. */
  onArrowControl?: (id: string, control: Point, done: boolean) => void
  /** Eraser position and radius — the ring under the cursor. */
  eraser?: { at: Point; radius: number } | null
  /** Capture domain: shown in the frame's address bar until a URL is set manually. */
  domain?: string | null
  /** Layer being typed: it is rendered by the input field, not the scene. */
  editing?: string | null
  /** Snap lines: live only during a gesture and never reach the exported file. */
  guides?: Guide[]
  /** Crop region in document coordinates. While present, crop mode is on. */
  cropRect?: DocRect | null
  onCropRect?: (rect: DocRect) => void
  /**
   * Whether content catches the mouse. With an active tool it must not: otherwise a
   * click on the capture would swallow the event before the scene, and a drawing
   * gesture over the capture would never start.
   */
  interactive?: boolean
  /** Selection frame: lives in the same Konva layer as the content. */
  children?: ReactNode
}) {
  const { canvas } = doc
  const rect = frameRect(doc)
  const shadow = canvas.shadow
  const zones = showSafeZones ? safeZonesFor(canvas.preset) : []
  const numbers = badgeNumbers(doc.layers)

  const source = frame
    ? captureSourceRect(doc, { w: frame.naturalWidth, h: frame.naturalHeight })
    : null

  const layerProps = (layer: Layer) => ({
    layer,
    frame,
    // Blur samples from the visible part of the capture: after a crop that is no longer the whole image.
    ...(source ? { source } : {}),
    frameRect: rect,
    canvas: { w: canvas.w, h: canvas.h },
    interactive,
    selected: layer.id === selected,
    onSelect: (id: string) => onSelectLayer?.(id),
    onDragEnd: (id: string, delta: { x: number; y: number }) => {
      onMoveLayer?.(id, delta)
    },
    ...(onDragSnap ? { onDragSnap } : {}),
    ...(onEditLayer ? { onEdit: onEditLayer } : {}),
    // The key is added only when a number exists: with exactOptionalPropertyTypes,
    // badgeNumber={undefined} is not allowed.
    ...(numbers.has(layer.id) ? { badgeNumber: numbers.get(layer.id)! } : {}),
  })

  // The decoration sits in the same coordinate system as the capture, so it inherits
  // its rotation and tilt without a second set of transforms.
  const placed = {
    x: rect.x + rect.w / 2,
    y: rect.y + rect.h / 2,
    offsetX: rect.w / 2,
    offsetY: rect.h / 2,
    width: rect.w,
    height: rect.h,
    rotation: doc.capture.rotation,
    ...tiltSkew(doc.capture.tilt),
  }

  const decoration = captureDecoration(doc)
  const decorated = hasDecoration(decoration)
  const shadowProps = {
    shadowColor: shadow.color,
    shadowBlur: shadow.blur,
    shadowOffsetX: shadow.offsetX,
    shadowOffsetY: shadow.offsetY,
    shadowOpacity: shadow.opacity,
  }

  return (
    <KonvaLayer>
      <BackgroundShape doc={doc} image={background} />

      {frame && doc.capture.visible && decorated ? (
        // The shadow belongs to the decoration: otherwise the capture would cast it onto its own frame.
        <Shape
          {...placed}
          {...shadowProps}
          listening={false}
          sceneFunc={decorationScene(decoration, domain ?? null, mockupImage)}
        />
      ) : null}

      {frame && doc.capture.visible ? (
        <KonvaImage
          id={CAPTURE_ID}
          image={frame}
          // Rotate around the capture's center, not a corner: a corner pivot drags the image off canvas.
          {...placed}
          cornerRadius={screenCorners(decoration, rect)}
          {...(decorated ? {} : shadowProps)}
          listening={interactive}
          draggable={interactive && onMoveCapture !== undefined}
          onMouseDown={(event) => {
            event.cancelBubble = true
            onSelectLayer?.(CAPTURE_ID)
          }}
          onDragMove={(event) => {
            if (!onDragSnap) return
            const node = event.target
            const centre = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }
            const snapped = onDragSnap(CAPTURE_ID, {
              x: node.x() - centre.x,
              y: node.y() - centre.y,
            })
            node.position({ x: centre.x + snapped.x, y: centre.y + snapped.y })
          }}
          onDragEnd={(event) => {
            const node = event.target
            onMoveCapture?.({
              x: node.x() - (rect.x + rect.w / 2),
              y: node.y() - (rect.y + rect.h / 2),
            })
          }}
          {...(doc.capture.crop
            ? {
                crop: {
                  x: doc.capture.crop.x,
                  y: doc.capture.crop.y,
                  width: doc.capture.crop.w,
                  height: doc.capture.crop.h,
                },
              }
            : {})}
          {...(isNeutral(doc.capture.filters) ? {} : { sceneFunc: filteredImage(frame, doc) })}
        />
      ) : null}

      {doc.layers.map((layer) =>
        // The layer being typed is hidden: otherwise it would show through under the input field.
        layer.id === editing ? null : <LayerNode key={layer.id} {...layerProps(layer)} />,
      )}

      {draft ? <LayerNode {...layerProps(draft)} /> : null}

      {onArrowControl ? (
        <ArrowHandle doc={doc} selected={selected ?? null} onControl={onArrowControl} />
      ) : null}
      {(guides ?? []).map((guide, index) => (
        <Line
          key={index}
          name={OVERLAY_NAME}
          listening={false}
          points={
            guide.axis === 'x'
              ? [guide.at, 0, guide.at, canvas.h]
              : [0, guide.at, canvas.w, guide.at]
          }
          stroke="#6d5cf5"
          strokeWidth={1}
          // Stroke width is in screen pixels: at 30% zoom a one-document-unit line
          // would be thinner than a pixel and simply not render.
          strokeScaleEnabled={false}
        />
      ))}
      {eraser ? (
        <Circle
          name={OVERLAY_NAME}
          listening={false}
          x={eraser.at.x}
          y={eraser.at.y}
          radius={eraser.radius}
          stroke="#f0526b"
          strokeWidth={1.5}
          // Ring stroke in screen pixels: equally thin at any zoom.
          strokeScaleEnabled={false}
        />
      ) : null}
      {cropRect ? (
        <CropRegion
          canvas={canvas}
          rect={cropRect}
          {...(onCropRect ? { onChange: onCropRect } : {})}
        />
      ) : null}
      {children}

      {zones.length > 0 ? (
        <Group name={OVERLAY_NAME} listening={false}>
          {zones.map((zone, index) => (
            <Rect
              key={index}
              x={zone.rect.x * canvas.w}
              y={zone.rect.y * canvas.h}
              width={zone.rect.w * canvas.w}
              height={zone.rect.h * canvas.h}
              stroke={zone.kind === 'overlay' ? '#f97316' : '#ffffff'}
              strokeWidth={2}
              dash={[8, 6]}
              opacity={0.85}
              // Fill only for overlay zones: with exactOptionalPropertyTypes,
              // fill={undefined} is not allowed, so the prop is built conditionally.
              {...(zone.kind === 'overlay' ? { fill: 'rgba(249,115,22,0.14)' } : {})}
            />
          ))}
        </Group>
      ) : null}
    </KonvaLayer>
  )
}

function BackgroundShape({ doc, image }: { doc: Doc; image: HTMLImageElement | null }) {
  const { canvas } = doc
  const background = canvas.background

  if (background.kind === 'transparent') return null

  if (background.kind === 'solid') {
    return <Rect x={0} y={0} width={canvas.w} height={canvas.h} fill={background.color} />
  }

  if (background.kind === 'gradient') {
    return <GradientRect canvas={canvas} background={background} />
  }

  if (background.kind === 'wallpaper') {
    return <Wallpaper canvas={canvas} background={background} />
  }

  if (!image) return null

  if (background.fit === 'tile') {
    return (
      <Rect
        x={0}
        y={0}
        width={canvas.w}
        height={canvas.h}
        fillPatternImage={image}
        fillPatternRepeat="repeat"
      />
    )
  }

  const rect = coverRect(
    { w: image.naturalWidth, h: image.naturalHeight },
    { width: canvas.w, height: canvas.h },
    background.fit,
  )

  return (
    <Group clipX={0} clipY={0} clipWidth={canvas.w} clipHeight={canvas.h}>
      <KonvaImage image={image} x={rect.x} y={rect.y} width={rect.w} height={rect.h} />
    </Group>
  )
}

/** Angle in degrees → start and end points across the canvas diagonal. */
function gradientPoints(canvas: Doc['canvas'], angle: number) {
  const radians = (angle * Math.PI) / 180
  const dx = Math.cos(radians)
  const dy = Math.sin(radians)
  const half = { x: canvas.w / 2, y: canvas.h / 2 }
  const reach = Math.abs(dx) * half.x + Math.abs(dy) * half.y

  return {
    start: { x: half.x - dx * reach, y: half.y - dy * reach },
    end: { x: half.x + dx * reach, y: half.y + dy * reach },
  }
}

function GradientRect({
  canvas,
  background,
}: {
  canvas: Doc['canvas']
  background: GradientBackground
}) {
  const { start, end } = gradientPoints(canvas, background.angle)
  return (
    <Rect
      x={0}
      y={0}
      width={canvas.w}
      height={canvas.h}
      fillLinearGradientStartPoint={start}
      fillLinearGradientEndPoint={end}
      fillLinearGradientColorStops={[0, background.from, 1, background.to]}
    />
  )
}

/**
 * Wallpaper: a gradient of the same two colors plus a pattern on top.
 *
 * Repeating patterns are tiled in document units, so page length does not affect
 * render cost. The tile is generated at 2x and scaled down by half — it stays crisp
 * when exporting at 2x.
 */
function Wallpaper({
  canvas,
  background,
}: {
  canvas: Doc['canvas']
  background: WallpaperBackground
}) {
  const { start, end } = gradientPoints(canvas, background.angle)
  const tile = useMemo(
    () => makeTile(background.pattern, background.to),
    [background.pattern, background.to],
  )

  const base = (
    <Rect
      x={0}
      y={0}
      width={canvas.w}
      height={canvas.h}
      fillLinearGradientStartPoint={start}
      fillLinearGradientEndPoint={end}
      fillLinearGradientColorStops={[0, background.from, 1, background.from]}
    />
  )

  if (TILED_PATTERNS.includes(background.pattern)) {
    return (
      <Group>
        {base}
        {tile ? (
          <Rect
            x={0}
            y={0}
            width={canvas.w}
            height={canvas.h}
            // Konva types this as HTMLImageElement, but createPattern accepts any
            // CanvasImageSource — a canvas works fine and avoids a round trip
            // through a data URL.
            fillPatternImage={tile as unknown as HTMLImageElement}
            fillPatternRepeat="repeat"
            fillPatternScaleX={1 / TILE_OVERSAMPLE}
            fillPatternScaleY={1 / TILE_OVERSAMPLE}
            opacity={0.5}
          />
        ) : null}
      </Group>
    )
  }

  const diagonal = Math.hypot(canvas.w, canvas.h)

  if (background.pattern === 'rings') {
    return (
      <Group clipX={0} clipY={0} clipWidth={canvas.w} clipHeight={canvas.h}>
        {base}
        {ringRadii().map((fraction, index) => (
          <Circle
            key={index}
            x={canvas.w / 2}
            y={canvas.h / 2}
            radius={fraction * diagonal * 0.5}
            stroke={background.to}
            strokeWidth={Math.max(1, diagonal / 400)}
            opacity={0.45}
          />
        ))}
      </Group>
    )
  }

  // mesh: soft blobs over the fill — a gradient that does not look linear.
  return (
    <Group clipX={0} clipY={0} clipWidth={canvas.w} clipHeight={canvas.h}>
      {base}
      {MESH_BLOBS.map((blob, index) => {
        const colour = blob.colour === 'from' ? background.from : background.to
        const radius = blob.radius * diagonal * 0.5
        return (
          <Circle
            key={index}
            x={blob.x * canvas.w}
            y={blob.y * canvas.h}
            radius={radius}
            fillRadialGradientStartPoint={{ x: 0, y: 0 }}
            fillRadialGradientEndPoint={{ x: 0, y: 0 }}
            fillRadialGradientStartRadius={0}
            fillRadialGradientEndRadius={radius}
            fillRadialGradientColorStops={[0, colour, 1, withAlpha(colour, 0)]}
          />
        )
      })}
    </Group>
  )
}

/**
 * Curvature handle on the selected arrow.
 *
 * The curve bends via a single point that is not on the line: dragging the line
 * itself would mean guessing whether a move or a bend was intended. The handle is
 * tagged as an overlay, so it never reaches the export.
 */
function ArrowHandle({
  doc,
  selected,
  onControl,
}: {
  doc: Doc
  selected: LayerId | null
  onControl: (id: string, control: Point, done: boolean) => void
}) {
  const layer = selected ? doc.layers.find((item) => item.id === selected) : undefined
  if (layer?.kind !== 'arrow' || !isCurved(layer) || layer.locked) return null

  const control = controlPointOf(layer)

  return (
    <Circle
      name={OVERLAY_NAME}
      x={control.x}
      y={control.y}
      radius={7}
      fill="#ffffff"
      stroke="#6d5cf5"
      strokeWidth={2}
      // Radius and stroke must not grow with zoom: the handle is not part of the drawing.
      strokeScaleEnabled={false}
      draggable
      onMouseDown={(event) => {
        event.cancelBubble = true
      }}
      onDragMove={(event) => {
        onControl(layer.id, { x: event.target.x(), y: event.target.y() }, false)
      }}
      onDragEnd={(event) => {
        onControl(layer.id, { x: event.target.x(), y: event.target.y() }, true)
      }}
    />
  )
}

/**
 * Crop region: everything outside is dimmed; the region moves and resizes by handles.
 * Confirmation is external, via a button: cropping is irreversible for later blur
 * layers, so it should not happen as a mouse-up side effect.
 */
function CropRegion({
  canvas,
  rect,
  onChange,
}: {
  canvas: Doc['canvas']
  rect: DocRect
  onChange?: (rect: DocRect) => void
}) {
  return (
    <Group name={OVERLAY_NAME}>
      <DimWithHole canvas={canvas} hole={rect} opacity={0.55} />
      <Rect
        id={CROP_REGION_ID}
        x={rect.x}
        y={rect.y}
        width={rect.w}
        height={rect.h}
        stroke="#6d5cf5"
        strokeWidth={2}
        dash={[8, 6]}
        // Nearly transparent but non-zero fill: without it the rect does not catch the mouse.
        fill="rgba(109, 92, 245, 0.001)"
        draggable
        onDragEnd={(event) => {
          onChange?.({ ...rect, x: event.target.x(), y: event.target.y() })
        }}
      />
    </Group>
  )
}

/**
 * Dims everything except the hole.
 *
 * The hole is punched with a second path and the even-odd fill rule, not with
 * `destination-out` compositing. Compositing erases across the whole Konva layer,
 * not just its group: the selection ended up showing a hole down to the scene
 * background instead of the capture.
 */
export function DimWithHole({
  canvas,
  hole,
  opacity,
  ellipse = false,
}: {
  canvas: { w: number; h: number }
  hole: DocRect
  opacity: number
  ellipse?: boolean
}) {
  return (
    <Shape
      listening={false}
      sceneFunc={(context) => {
        context.beginPath()
        context.rect(0, 0, canvas.w, canvas.h)
        if (ellipse) {
          context.ellipse(
            hole.x + hole.w / 2,
            hole.y + hole.h / 2,
            hole.w / 2,
            hole.h / 2,
            0,
            0,
            Math.PI * 2,
            false,
          )
        } else {
          context.rect(hole.x, hole.y, hole.w, hole.h)
        }
        context.closePath()
        context.setAttr('fillStyle', withAlpha('#0b1020', opacity))
        context.fill('evenodd')
      }}
    />
  )
}

/**
 * Custom capture rendering with filters. The filter goes on the context, not the
 * node: a Konva cache the size of a long page would rebuild on every slider move.
 * Corner radius and crop are reimplemented here too — they would be lost along with
 * the default rendering.
 */
function filteredImage(image: HTMLImageElement, doc: Doc) {
  const filter = cssFilterString(doc.capture.filters)
  const crop = doc.capture.crop
  const radius = doc.canvas.radius

  return (context: Konva.Context, shape: Konva.Shape) => {
    const w = shape.width()
    const h = shape.height()

    context.save()
    if (radius > 0) {
      context.beginPath()
      Konva.Util.drawRoundedRectPath(context, w, h, radius)
      context.closePath()
      context.clip()
    }

    context.setAttr('filter', filter)
    if (crop) context.drawImage(image, crop.x, crop.y, crop.w, crop.h, 0, 0, w, h)
    else context.drawImage(image, 0, 0, w, h)
    context.setAttr('filter', 'none')

    context.restore()
  }
}
