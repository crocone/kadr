/**
 * The sound lane under the timeline.
 *
 * A loudness envelope, drawn in source time like the track above it, with the sound
 * edit laid over: two handles that trim the sound, and the silenced stretches as
 * blocks that move and resize the way cuts do. Dragging across empty lane silences
 * what was dragged over; a click without a drag is a seek, like anywhere else.
 *
 * The lane is a map, not a meter. Its job is to show where somebody spoke, so that a
 * cough, a doorbell or a false start can be found and covered without listening to the
 * whole take again.
 */
import { useEffect, useRef, useState } from 'react'

import {
  addSilence,
  removeSilence,
  replaceSilence,
  setMuted,
  setSoundTrim,
  tidySilences,
  type Waveform,
} from '@/core/record/sound'
import type { ClipEdit, TimeSpan } from '@/core/record/types'
import { useT } from '@/core/ui/app-context'
import { cn } from '@/core/ui/cn'
import { IconMute, IconSound } from '@/core/ui/icons'

type Drag =
  | { kind: 'select'; anchor: number; at: number }
  | { kind: 'trim'; edge: 'start' | 'end' }
  | { kind: 'silence'; index: number; part: 'body' | 'start' | 'end'; from: TimeSpan; at: number }

/** A silence shorter than this cannot be grabbed by its edges, so it cannot shrink to nothing. */
const MIN_SILENCE_MS = 80
/** A drag shorter than this is a click: it seeks instead of silencing a sliver. */
const MIN_SELECT_MS = 120
/** The two trim handles cannot cross. */
const MIN_TRIM_MS = 100

const LANE_HEIGHT = 40

const TRIM_EDGES = ['start', 'end'] as const

export function SoundLane({
  duration,
  edit,
  waveform,
  playhead,
  onSeek,
  onEdit,
  onCommit,
}: {
  duration: number
  edit: ClipEdit
  /** `null` while the sound is still being read, or when the file had none after all. */
  waveform: Waveform | null
  /** Source time under the playhead. */
  playhead: number
  onSeek: (sourceMs: number) => void
  onEdit: (edit: ClipEdit) => void
  onCommit: () => void
}) {
  const t = useT()
  const lane = useRef<HTMLDivElement | null>(null)
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const drag = useRef<Drag | null>(null)
  const [selection, setSelection] = useState<TimeSpan | null>(null)

  const { sound } = edit
  const total = Math.max(1, duration)
  const percent = (at: number) => `${((at / total) * 100).toFixed(3)}%`

  const sourceAt = (clientX: number): number => {
    const box = lane.current?.getBoundingClientRect()
    if (!box || box.width === 0) return 0
    const ratio = Math.min(1, Math.max(0, (clientX - box.left) / box.width))
    return ratio * total
  }

  /**
   * The envelope is painted once per waveform, at one column per bin, and stretched by
   * CSS. Nothing about the edit is drawn here: the edit is DOM laid over the canvas,
   * so a dragged handle never repaints two thousand bars.
   */
  useEffect(() => {
    const surface = canvas.current
    const context = surface?.getContext('2d')
    if (!surface || !context) return

    const bins = waveform?.peaks.length ?? 0
    surface.width = Math.max(1, bins)
    surface.height = LANE_HEIGHT * 2
    context.clearRect(0, 0, surface.width, surface.height)

    const middle = surface.height / 2
    context.strokeStyle = getComputedStyle(surface).color
    context.lineWidth = 1

    if (!waveform) {
      context.beginPath()
      context.moveTo(0, middle)
      context.lineTo(surface.width, middle)
      context.stroke()
      return
    }

    context.beginPath()
    for (let bin = 0; bin < bins; bin++) {
      const half = Math.max(1, (waveform.peaks[bin] ?? 0) * (middle - 2))
      context.moveTo(bin + 0.5, middle - half)
      context.lineTo(bin + 0.5, middle + half)
    }
    context.stroke()
  }, [waveform])

  const onLaneDown = (event: React.PointerEvent) => {
    if (sound.muted) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const at = sourceAt(event.clientX)
    drag.current = { kind: 'select', anchor: at, at }
  }

  const onTrimDown = (event: React.PointerEvent, edge: 'start' | 'end') => {
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { kind: 'trim', edge }
  }

  const onSilenceDown = (
    event: React.PointerEvent,
    index: number,
    part: 'body' | 'start' | 'end',
  ) => {
    const span = sound.silences[index]
    if (!span) return
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { kind: 'silence', index, part, from: span, at: sourceAt(event.clientX) }
  }

  const onMove = (event: React.PointerEvent) => {
    const held = drag.current
    if (!held) return
    const at = sourceAt(event.clientX)

    if (held.kind === 'select') {
      held.at = at
      const span = { start: Math.min(held.anchor, at), end: Math.max(held.anchor, at) }
      setSelection(span.end - span.start >= MIN_SELECT_MS ? span : null)
      return
    }

    if (held.kind === 'trim') {
      const next =
        held.edge === 'start'
          ? { start: Math.min(at, sound.trim.end - MIN_TRIM_MS), end: sound.trim.end }
          : { start: sound.trim.start, end: Math.max(at, sound.trim.start + MIN_TRIM_MS) }
      onEdit(setSoundTrim(edit, next))
      return
    }

    const shift = at - held.at
    const next =
      held.part === 'body'
        ? { start: held.from.start + shift, end: held.from.end + shift }
        : held.part === 'start'
          ? { start: Math.min(at, held.from.end - MIN_SILENCE_MS), end: held.from.end }
          : { start: held.from.start, end: Math.max(at, held.from.start + MIN_SILENCE_MS) }
    onEdit(replaceSilence(edit, held.index, next))
  }

  const onUp = () => {
    const held = drag.current
    drag.current = null
    if (!held) return

    if (held.kind === 'select') {
      setSelection(null)
      const span = { start: Math.min(held.anchor, held.at), end: Math.max(held.anchor, held.at) }
      if (span.end - span.start >= MIN_SELECT_MS) {
        onEdit(addSilence(edit, span))
        onCommit()
      } else {
        onSeek(held.anchor)
      }
      return
    }

    // Overlaps merge on release, not mid-drag — see `replaceSilence`.
    if (held.kind === 'silence') onEdit(tidySilences(edit))
    onCommit()
  }

  const toggleMuted = () => {
    onEdit(setMuted(edit, !sound.muted))
    onCommit()
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 text-[11px] text-text-muted">
        <button
          type="button"
          onClick={toggleMuted}
          title={t('clip.sound.keep')}
          className={cn(
            'flex items-center gap-1.5 rounded-control px-1.5 py-0.5 transition-colors',
            sound.muted ? 'text-text-muted hover:text-text' : 'text-accent',
          )}
        >
          {sound.muted ? <IconMute size={13} /> : <IconSound size={13} />}
          {t(sound.muted ? 'clip.sound.off' : 'clip.sound.on')}
        </button>
        <span className="min-w-0 flex-1 truncate">
          {waveform === null ? t('clip.sound.loading') : t('clip.sound.hint')}
        </span>
      </div>

      <div
        ref={lane}
        onPointerDown={onLaneDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        style={{ height: LANE_HEIGHT }}
        className={cn(
          'relative touch-none overflow-hidden rounded-lg border border-border bg-surface-muted select-none',
          sound.muted ? 'cursor-default' : 'cursor-crosshair',
        )}
      >
        <canvas
          ref={canvas}
          className={cn(
            'pointer-events-none absolute inset-0 h-full w-full text-accent',
            sound.muted && 'opacity-25',
          )}
        />

        {/* Outside the sound trim: the picture goes on, the sound does not. */}
        <div
          className="pointer-events-none absolute inset-y-0 left-0 bg-surface/80"
          style={{ width: percent(sound.trim.start) }}
        />
        <div
          className="pointer-events-none absolute inset-y-0 right-0 bg-surface/80"
          style={{ width: percent(total - sound.trim.end) }}
        />

        {sound.silences.map((span, index) => (
          <div
            key={index}
            onPointerDown={(event) => {
              onSilenceDown(event, index, 'body')
            }}
            onPointerMove={onMove}
            onPointerUp={onUp}
            title={t('clip.silence.drag')}
            className="group/silence absolute inset-y-0 cursor-grab bg-warning/30 hover:bg-warning/40"
            style={{ left: percent(span.start), width: percent(span.end - span.start) }}
          >
            {(['start', 'end'] as const).map((edge) => (
              <span
                key={edge}
                onPointerDown={(event) => {
                  onSilenceDown(event, index, edge)
                }}
                onPointerMove={onMove}
                onPointerUp={onUp}
                className={cn(
                  'absolute inset-y-0 w-1.5 cursor-ew-resize bg-warning/70 hover:bg-warning',
                  edge === 'start' ? 'left-0' : 'right-0',
                )}
              />
            ))}
            <button
              type="button"
              title={t('clip.silence.remove')}
              aria-label={t('clip.silence.remove')}
              onPointerDown={(event) => {
                event.stopPropagation()
              }}
              onClick={(event) => {
                event.stopPropagation()
                onEdit(removeSilence(edit, (span.start + span.end) / 2))
                onCommit()
              }}
              className="absolute top-0.5 left-1/2 grid h-4 w-4 -translate-x-1/2 place-items-center rounded-full bg-bg/85 text-[10px] leading-none text-text-muted opacity-0 group-hover/silence:opacity-100 hover:text-danger focus-visible:opacity-100"
            >
              ×
            </button>
          </div>
        ))}

        {selection ? (
          <div
            className="pointer-events-none absolute inset-y-0 bg-warning/25 ring-1 ring-warning/60 ring-inset"
            style={{
              left: percent(selection.start),
              width: percent(selection.end - selection.start),
            }}
          />
        ) : null}

        {!sound.muted
          ? TRIM_EDGES.map((edge) => (
              <button
                key={edge}
                type="button"
                aria-label={t(edge === 'start' ? 'clip.sound.trim.start' : 'clip.sound.trim.end')}
                onPointerDown={(event) => {
                  onTrimDown(event, edge)
                }}
                onPointerMove={onMove}
                onPointerUp={onUp}
                className="absolute inset-y-0 -ml-1 w-2 cursor-ew-resize rounded-sm bg-accent/60 hover:bg-accent"
                style={{ left: percent(sound.trim[edge]) }}
              />
            ))
          : null}

        <div
          className="pointer-events-none absolute inset-y-0 w-0.5 bg-text"
          style={{ left: percent(playhead) }}
        />
      </div>
    </div>
  )
}
