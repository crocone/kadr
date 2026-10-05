/**
 * The clip player.
 *
 * A hidden `<video>` supplies the pixels and the sound; everything visible is drawn on
 * a canvas by `drawClipFrame` — the same function the exporter uses. Nothing about the
 * camera or the click ripples is computed twice, so what is on screen while scrubbing is
 * what comes out of the encoder.
 *
 * Cuts are handled by seeking, not by pausing: when playback reaches a removed span the
 * video jumps to where the span ends. On a WebM without seek points that jump costs a
 * few frames of stutter, which is the honest price of not re-encoding the file every
 * time somebody drags a handle.
 *
 * The canvas keeps its full resolution and is scaled by CSS. That way zooming costs
 * nothing — no re-render, no second surface — and zooming in past 100% shows the real
 * pixels of the recording rather than an upscaled preview of it.
 */
import type { ReactNode } from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { isCut, keptSpans, toOutput, toSource } from '@/core/record/edit'
import { drawClipFrame, outputSize } from '@/core/record/render'
import { isSilent } from '@/core/record/sound'
import { ZOOM_STEP } from '@/core/render/view'
import type { Clip } from '@/core/record/types'

export function Player({
  clip,
  url,
  playing,
  seekTo,
  backdrop,
  zoom,
  onZoom,
  onZoomStep,
  onTime,
  onEnded,
  children,
}: {
  clip: Clip
  url: string
  playing: boolean
  /** Output time to jump to; a new object means a new request, even at the same moment. */
  seekTo: { at: number } | null
  /** Decoded picture for an image background, or `null` for every other kind. */
  backdrop: HTMLImageElement | null
  /** Display scale; `null` fits the clip to the panel and follows it as it resizes. */
  zoom: number | null
  /** The scale actually used, so the zoom bar can show a number even while fitting. */
  onZoom: (scale: number) => void
  /** Ctrl+wheel over the picture: a factor to multiply the current scale by. */
  onZoomStep: (factor: number) => void
  onTime: (outputMs: number) => void
  onEnded: () => void
  /** Rendered over the canvas and sized to it exactly — the crop rectangle lives here. */
  children?: ReactNode
}) {
  const video = useRef<HTMLVideoElement | null>(null)
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const viewport = useRef<HTMLDivElement | null>(null)
  const [panel, setPanel] = useState<{ w: number; h: number } | null>(null)

  /**
   * The panel is measured rather than left to CSS.
   *
   * `max-height: 100%` on an element inside an auto-height parent resolves to no limit at
   * all, so the canvas was constrained by width only and a tall recording simply ran off
   * the bottom of the panel with its overflow clipped — the whole page was there, but
   * nobody could see it.
   */
  useLayoutEffect(() => {
    const element = viewport.current
    if (!element) return

    const observer = new ResizeObserver(([entry]) => {
      const box = entry?.contentRect
      if (box) setPanel({ w: box.width, h: box.height })
    })
    observer.observe(element)
    return () => {
      observer.disconnect()
    }
  }, [])
  // The draw loop reads the current edit rather than closing over the one it started
  // with: a zoom added mid-playback must show up on the very next frame.
  const current = useRef(clip)
  useEffect(() => {
    current.current = clip
  }, [clip])

  const picture = useRef(backdrop)
  useEffect(() => {
    picture.current = backdrop
  }, [backdrop])

  useEffect(() => {
    const element = video.current
    if (!element || !seekTo) return
    element.currentTime = toSource(current.current.edit, seekTo.at) / 1000
  }, [seekTo])

  useEffect(() => {
    const element = video.current
    if (!element) return
    if (playing) void element.play().catch(() => undefined)
    else element.pause()
  }, [playing])

  useEffect(() => {
    const element = video.current
    if (element) element.playbackRate = clip.edit.speed
  }, [clip.edit.speed])

  useEffect(() => {
    let frame = 0

    const draw = () => {
      frame = requestAnimationFrame(draw)

      const element = video.current
      const surface = canvas.current
      const context = surface?.getContext('2d')
      if (!element || !surface || !context) return

      const clipNow = current.current
      let source = element.currentTime * 1000

      // Landed in a removed span — jump to the far side of it. `toSource` of the output
      // time gives exactly that seam, and it also handles the case where the span runs
      // to the end of the clip.
      if (isCut(clipNow.edit, source)) {
        const spans = keptSpans(clipNow.edit)
        const next = spans.find((span) => span.start > source)
        if (next) {
          element.currentTime = next.start / 1000
          source = next.start
        } else {
          // Past the last kept moment: playback is over, drawing is not. The loop keeps
          // rendering the final frame, so the decoration controls stay live on a clip
          // that has been watched to the end.
          if (!element.paused) {
            element.pause()
            onEnded()
          }
          source = Math.max(clipNow.edit.trim.start, (spans.at(-1)?.end ?? 0) - 1)
        }
      }

      const size = outputSize(clipNow)
      if (surface.width !== size.w || surface.height !== size.h) {
        surface.width = size.w
        surface.height = size.h
      }

      // The sound edit is applied the same way the cuts are: by the loop, from the
      // current edit, so a silence dragged over the playhead goes quiet on the next frame.
      const quiet = isSilent(clipNow.edit, source)
      if (element.muted !== quiet) element.muted = quiet

      drawClipFrame(context, element, clipNow, source, size, picture.current)
      onTime(toOutput(clipNow.edit, source) ?? 0)
    }

    frame = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(frame)
    }
  }, [onTime, onEnded])

  const size = outputSize(clip)
  // Fitting never enlarges: a small recording shown at 300% is a blurry recording.
  const fit = panel ? Math.min(1, panel.w / size.w, panel.h / size.h) : 1
  const scale = zoom ?? fit

  useEffect(() => {
    onZoom(scale)
  }, [scale, onZoom])

  return (
    <div
      ref={viewport}
      onWheel={(event) => {
        // Plain wheel scrolls the zoomed-in picture, as it does in any panel; only the
        // modifier zooms. Swapping the two is how you make a video editor that fights the
        // person trying to look at the bottom of a page.
        if (!event.ctrlKey && !event.metaKey) return
        event.preventDefault()
        onZoomStep(event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP)
      }}
      // `safe center` rather than plain centring: an oversized picture centred the normal
      // way overflows equally in both directions, and the part above the panel becomes
      // unreachable — you can scroll down to the bottom of the page and never back up to
      // its top. Safe alignment gives up centring instead of losing a side.
      style={{ placeItems: 'safe center' }}
      className="grid h-full w-full overflow-auto"
    >
      <video
        ref={video}
        src={url}
        playsInline
        preload="auto"
        className="hidden"
        onEnded={onEnded}
      />
      {/* The wrapper shrink-wraps the canvas, so anything laid over it with `inset-0`
          lands on the picture rather than on the letterboxing around it. */}
      <div className="relative" style={{ width: size.w * scale, height: size.h * scale }}>
        <canvas
          ref={canvas}
          style={{ width: '100%', height: '100%' }}
          className="block rounded-lg shadow-lg"
        />
        {children}
      </div>
    </div>
  )
}
