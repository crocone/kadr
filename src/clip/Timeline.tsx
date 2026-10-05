/**
 * The clip timeline.
 *
 * Drawn in source time — the clock the recording was made on — because everything the
 * editor manipulates lives there: the trim bounds, the cut spans, the zoom holds. The
 * playhead is the one thing that arrives in output time and is converted on the way in.
 *
 * Click marks along the bottom are not decoration. They are why a person can tell dead
 * air from a stretch where something was happening, and they are what the cut and zoom
 * buttons act on — showing the input to those decisions is cheaper than explaining it.
 *
 * The sound lane below the track is the same idea for the ear: where somebody spoke,
 * and what the sound edit did about it. It is its own component because its gestures
 * differ — a drag across it silences, a drag across the track above seeks.
 */
import { useRef } from 'react'

import {
  removeCut,
  replaceCut,
  setTrim,
  tidyCuts,
  toOutputNearest,
  toSource,
} from '@/core/record/edit'
import { formatPrecise } from '@/core/record/format'
import type { Waveform } from '@/core/record/sound'
import type { Clip, ClipEdit, TimeSpan } from '@/core/record/types'
import { useT } from '@/core/ui/app-context'
import { cn } from '@/core/ui/cn'

import { SoundLane } from './SoundLane'

type Drag = 'start' | 'end' | 'seek'

/**
 * A cut being reshaped: which one, which part of it, and what it looked like when the
 * gesture began. The original is kept because a move is applied to it as a whole rather
 * than accumulated frame by frame — accumulating drifts, and a span that drifts while
 * being dragged is a span nobody can place.
 */
type CutDrag = { index: number; part: 'body' | 'start' | 'end'; from: TimeSpan; at: number }

/** A cut shorter than this cannot be grabbed by its edges, so it cannot be shrunk to nothing. */
const MIN_CUT_MS = 80

export function Timeline({
  clip,
  waveform,
  outputTime,
  onSeek,
  onEdit,
  onCommit,
}: {
  clip: Clip
  /** Loudness envelope for the sound lane; `null` until it is read, or when there is none. */
  waveform: Waveform | null
  outputTime: number
  onSeek: (outputMs: number) => void
  onEdit: (edit: ClipEdit) => void
  /** Closes the gesture: a whole drag is one undo step, not one per pixel. */
  onCommit: () => void
}) {
  const t = useT()
  const track = useRef<HTMLDivElement | null>(null)
  const drag = useRef<Drag | null>(null)
  const cutDrag = useRef<CutDrag | null>(null)

  const duration = Math.max(1, clip.duration)
  const { edit } = clip
  const percent = (at: number) => `${((at / duration) * 100).toFixed(3)}%`

  const sourceAtPointer = (clientX: number): number => {
    const box = track.current?.getBoundingClientRect()
    if (!box || box.width === 0) return 0
    const ratio = Math.min(1, Math.max(0, (clientX - box.left) / box.width))
    return ratio * duration
  }

  const onPointerDown = (event: React.PointerEvent, what: Drag) => {
    drag.current = what
    event.currentTarget.setPointerCapture(event.pointerId)
    if (what === 'seek') seek(sourceAtPointer(event.clientX))
  }

  /**
   * Reshaping a cut. Both edges move it, the body slides it, and neither may cross the
   * other: a cut whose end precedes its start would silently remove nothing while looking
   * like it removes everything.
   */
  const onCutDown = (event: React.PointerEvent, index: number, part: CutDrag['part']) => {
    const span = edit.cuts[index]
    if (!span) return

    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    cutDrag.current = { index, part, from: span, at: sourceAtPointer(event.clientX) }
  }

  const dragCut = (at: number): void => {
    const held = cutDrag.current
    if (!held) return

    const shift = at - held.at
    const next =
      held.part === 'body'
        ? { start: held.from.start + shift, end: held.from.end + shift }
        : held.part === 'start'
          ? { start: Math.min(at, held.from.end - MIN_CUT_MS), end: held.from.end }
          : { start: held.from.start, end: Math.max(at, held.from.start + MIN_CUT_MS) }

    onEdit(replaceCut(edit, held.index, next))
  }

  const onPointerMove = (event: React.PointerEvent) => {
    if (cutDrag.current) {
      dragCut(sourceAtPointer(event.clientX))
      return
    }
    if (!drag.current) return
    const at = sourceAtPointer(event.clientX)

    if (drag.current === 'seek') {
      seek(at)
      return
    }
    // The handles cannot cross: a trim with its end before its start is not a shorter
    // clip, it is an empty one.
    const next =
      drag.current === 'start'
        ? { start: Math.min(at, edit.trim.end - 100), end: edit.trim.end }
        : { start: edit.trim.start, end: Math.max(at, edit.trim.start + 100) }
    onEdit(setTrim(edit, next))
  }

  const onPointerUp = () => {
    drag.current = null
    // Overlaps are merged here rather than mid-drag: doing it while the handle is moving
    // renumbers the list under the hand holding it.
    if (cutDrag.current) {
      cutDrag.current = null
      onEdit(tidyCuts(edit))
    }
    onCommit()
  }

  /**
   * Seeking is in output time even though the track is drawn in source time: a click on
   * a removed span would otherwise put the playhead somewhere playback can never be.
   * `toOutputNearest` lands such a click on the seam instead of refusing it.
   */
  const seek = (source: number) => {
    const bounded = Math.min(edit.trim.end, Math.max(edit.trim.start, source))
    onSeek(toOutputNearest(edit, bounded))
  }

  const playhead = toSource(edit, outputTime)

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 font-mono text-[11px] text-text-muted tabular-nums">
        <span>{formatPrecise(outputTime)}</span>
        <span className="flex-1" />
        <span>{t('clip.trim')}</span>
        <span>
          {formatPrecise(edit.trim.start)} — {formatPrecise(edit.trim.end)}
        </span>
      </div>

      <div
        ref={track}
        onPointerDown={(event) => {
          onPointerDown(event, 'seek')
        }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className="relative h-16 cursor-pointer touch-none rounded-lg border border-border bg-surface-muted select-none"
      >
        {/* Outside the trim: still there, plainly not part of the clip. */}
        <div
          className="absolute inset-y-0 left-0 rounded-l-lg bg-surface/80"
          style={{ width: percent(edit.trim.start) }}
        />
        <div
          className="absolute inset-y-0 right-0 rounded-r-lg bg-surface/80"
          style={{ width: percent(duration - edit.trim.end) }}
        />

        {/*
          A cut is a thing to adjust, not only a thing to undo. Clicking one used to
          delete it outright, which made "cut the pauses" all or nothing: the moment one
          span was a few frames too greedy, the only move left was to put every span back.
          Now the body slides it, the edges resize it, and removing it is its own button.
        */}
        {edit.cuts.map((cut, index) => (
          <div
            key={index}
            onPointerDown={(event) => {
              onCutDown(event, index, 'body')
            }}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            title={t('clip.cut.drag')}
            className="group/cut absolute inset-y-0 cursor-grab bg-danger/25 hover:bg-danger/35"
            style={{ left: percent(cut.start), width: percent(cut.end - cut.start) }}
          >
            {(['start', 'end'] as const).map((edge) => (
              <span
                key={edge}
                onPointerDown={(event) => {
                  onCutDown(event, index, edge)
                }}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                className={cn(
                  'absolute inset-y-0 w-1.5 cursor-ew-resize bg-danger/70 hover:bg-danger',
                  edge === 'start' ? 'left-0' : 'right-0',
                )}
              />
            ))}

            <button
              type="button"
              title={t('clip.cut.remove')}
              aria-label={t('clip.cut.remove')}
              onPointerDown={(event) => {
                event.stopPropagation()
              }}
              onClick={(event) => {
                event.stopPropagation()
                onEdit(removeCut(edit, (cut.start + cut.end) / 2))
              }}
              className="absolute top-1 left-1/2 grid h-4 w-4 -translate-x-1/2 place-items-center rounded-full bg-bg/85 text-[10px] leading-none text-text-muted opacity-0 group-hover/cut:opacity-100 hover:text-danger focus-visible:opacity-100"
            >
              ×
            </button>
          </div>
        ))}

        {edit.zooms.map((zoom) => (
          <button
            key={zoom.id}
            type="button"
            title={t('clip.zoom.remove')}
            onPointerDown={(event) => {
              event.stopPropagation()
            }}
            onClick={(event) => {
              event.stopPropagation()
              onEdit({ ...edit, zooms: edit.zooms.filter((other) => other.id !== zoom.id) })
            }}
            className="absolute bottom-4 h-3 rounded-sm bg-accent/60 hover:bg-accent"
            style={{
              left: percent(zoom.hold.start - zoom.rampIn),
              width: percent(zoom.hold.end - zoom.hold.start + zoom.rampIn + zoom.rampOut),
            }}
          />
        ))}

        {/* Clicks: the marks the pause and zoom buttons reason about. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-1 h-2">
          {clip.events
            .filter((event) => event.kind === 'click')
            .map((event, at) => (
              <span
                key={`${event.at}-${at}`}
                className="absolute top-0 h-2 w-px bg-text-muted"
                style={{ left: percent(event.at) }}
              />
            ))}
        </div>

        {[
          { at: edit.trim.start, what: 'start' as const },
          { at: edit.trim.end, what: 'end' as const },
        ].map(({ at, what }) => (
          <button
            key={what}
            type="button"
            aria-label={t(what === 'start' ? 'clip.trim.start' : 'clip.trim.end')}
            onPointerDown={(event) => {
              event.stopPropagation()
              onPointerDown(event, what)
            }}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            className={cn(
              'absolute inset-y-0 -ml-1.5 w-3 cursor-ew-resize rounded-sm bg-accent/70 hover:bg-accent',
            )}
            style={{ left: percent(at) }}
          />
        ))}

        <div
          className="pointer-events-none absolute inset-y-0 w-0.5 bg-text"
          style={{ left: percent(playhead) }}
        />
      </div>

      {clip.audio ? (
        <SoundLane
          duration={clip.duration}
          edit={edit}
          waveform={waveform}
          playhead={playhead}
          onSeek={seek}
          onEdit={onEdit}
          onCommit={onCommit}
        />
      ) : null}
    </div>
  )
}
