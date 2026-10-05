/**
 * Choosing the part of the frame to keep.
 *
 * Cropping happens against the whole recording with the camera switched off — the
 * player shows the untouched frame while this is open. Cropping against a zoomed view
 * would mean dragging a rectangle over a moving picture and getting a different result
 * depending on when you let go.
 *
 * The rectangle is stored in fractions of the frame, like everything else positional in
 * a clip, so it survives the export scaling it down.
 */
import { useEffect, useRef, useState } from 'react'

import type { Rect } from '@/core/doc/types'
import { useT } from '@/core/ui/app-context'
import { Button } from '@/core/ui/components'

type Handle = 'draw' | 'move' | 'nw' | 'ne' | 'sw' | 'se' | null

/** Below this the crop is a mis-click, not an intention. */
const MIN_SIZE = 0.05

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/** Normalises a dragged rectangle: positive size, inside the frame, not vanishingly small. */
function tidy(rect: Rect): Rect {
  const x = clamp01(Math.min(rect.x, rect.x + rect.w))
  const y = clamp01(Math.min(rect.y, rect.y + rect.h))
  const w = Math.min(1 - x, Math.max(MIN_SIZE, Math.abs(rect.w)))
  const h = Math.min(1 - y, Math.max(MIN_SIZE, Math.abs(rect.h)))
  return { x, y, w, h }
}

export function CropOverlay({
  crop,
  onChange,
  onApply,
  onCancel,
}: {
  crop: Rect
  onChange: (crop: Rect) => void
  onApply: () => void
  onCancel: () => void
}) {
  const t = useT()
  const frame = useRef<HTMLDivElement | null>(null)
  const [handle, setHandle] = useState<Handle>(null)
  const start = useRef<{ pointer: { x: number; y: number }; crop: Rect } | null>(null)

  const pointAt = (event: React.PointerEvent): { x: number; y: number } => {
    const box = frame.current?.getBoundingClientRect()
    if (!box || box.width === 0 || box.height === 0) return { x: 0, y: 0 }
    return {
      x: clamp01((event.clientX - box.left) / box.width),
      y: clamp01((event.clientY - box.top) / box.height),
    }
  }

  const begin = (event: React.PointerEvent, what: Exclude<Handle, null>) => {
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    setHandle(what)

    // Dragging on the dimmed part starts a fresh rectangle from that corner. Without it
    // the only thing the overlay could do was nudge the box it opened with, which reads
    // exactly like a crop tool that does not work.
    //
    // The rectangle is not replaced here, though — only once the pointer actually moves.
    // A click that goes nowhere should leave the crop as it was rather than collapse it.
    start.current = { pointer: pointAt(event), crop }
  }

  const drag = (event: React.PointerEvent) => {
    const from = start.current
    if (!handle || !from) return

    const at = pointAt(event)
    const dx = at.x - from.pointer.x
    const dy = at.y - from.pointer.y

    if (handle === 'draw') {
      onChange(
        tidy({
          x: from.pointer.x,
          y: from.pointer.y,
          w: at.x - from.pointer.x,
          h: at.y - from.pointer.y,
        }),
      )
      return
    }

    if (handle === 'move') {
      onChange({
        ...from.crop,
        x: Math.min(1 - from.crop.w, Math.max(0, from.crop.x + dx)),
        y: Math.min(1 - from.crop.h, Math.max(0, from.crop.y + dy)),
      })
      return
    }

    const west = handle === 'nw' || handle === 'sw'
    const north = handle === 'nw' || handle === 'ne'

    onChange(
      tidy({
        x: west ? from.crop.x + dx : from.crop.x,
        y: north ? from.crop.y + dy : from.crop.y,
        w: west ? from.crop.w - dx : from.crop.w + dx,
        h: north ? from.crop.h - dy : from.crop.h + dy,
      }),
    )
  }

  const end = () => {
    setHandle(null)
    start.current = null
  }

  // Escape gets out of cropping, as it does out of every other selection in the app.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [onCancel])

  const percent = (value: number) => `${(value * 100).toFixed(3)}%`
  const corners: { at: Exclude<Handle, null | 'move'>; style: React.CSSProperties }[] = [
    {
      at: 'nw',
      style: { left: 0, top: 0, transform: 'translate(-50%, -50%)', cursor: 'nwse-resize' },
    },
    {
      at: 'ne',
      style: { right: 0, top: 0, transform: 'translate(50%, -50%)', cursor: 'nesw-resize' },
    },
    {
      at: 'sw',
      style: { left: 0, bottom: 0, transform: 'translate(-50%, 50%)', cursor: 'nesw-resize' },
    },
    {
      at: 'se',
      style: { right: 0, bottom: 0, transform: 'translate(50%, 50%)', cursor: 'nwse-resize' },
    },
  ]

  /** The four bands around the crop. Dimming them one by one leaves the kept area untouched. */
  const shade: React.CSSProperties[] = [
    { left: 0, top: 0, width: '100%', height: percent(crop.y) },
    { left: 0, top: percent(crop.y + crop.h), width: '100%', bottom: 0 },
    { left: 0, top: percent(crop.y), width: percent(crop.x), height: percent(crop.h) },
    { left: percent(crop.x + crop.w), top: percent(crop.y), right: 0, height: percent(crop.h) },
  ]

  return (
    <div
      ref={frame}
      onPointerDown={(event) => {
        begin(event, 'draw')
      }}
      onPointerMove={drag}
      onPointerUp={end}
      onPointerCancel={end}
      className="absolute inset-0 cursor-crosshair touch-none select-none"
    >
      {/* Everything outside the crop is dimmed rather than hidden: what is being given
          up has to stay visible while the decision is being made. */}
      {shade.map((style, at) => (
        <div key={at} style={style} className="pointer-events-none absolute bg-bg/65" />
      ))}

      <div
        onPointerDown={(event) => {
          begin(event, 'move')
        }}
        className="absolute cursor-move border-2 border-accent"
        style={{
          left: percent(crop.x),
          top: percent(crop.y),
          width: percent(crop.w),
          height: percent(crop.h),
        }}
      >
        {corners.map((corner) => (
          <span
            key={corner.at}
            onPointerDown={(event) => {
              begin(event, corner.at)
            }}
            style={corner.style}
            className="absolute h-3.5 w-3.5 rounded-sm border border-white bg-accent"
          />
        ))}
      </div>

      <p className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded-md bg-bg/85 px-2.5 py-1 text-[11px] text-text-soft">
        {t('clip.crop.hint')}
      </p>

      {/*
        The buttons sit inside the area that starts a new rectangle on `pointerdown`, so
        they have to stop the event before it gets there. Without this line, pressing
        "Crop" first began a zero-size selection under the button and only then applied
        it: the crop reset itself and nothing else happened.
      */}
      <div
        onPointerDown={(event) => {
          event.stopPropagation()
        }}
        className="absolute right-3 bottom-3 flex gap-2"
      >
        <Button size="sm" onClick={onCancel}>
          {t('clip.crop.cancel')}
        </Button>
        <Button size="sm" variant="primary" onClick={onApply}>
          {t('clip.crop.apply')}
        </Button>
      </div>
    </div>
  )
}
