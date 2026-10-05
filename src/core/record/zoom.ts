/**
 * The camera: where it looks and how close.
 *
 * This is the part people pay Screen Studio for. A screen recording is shot at the
 * width of a monitor and watched in an issue comment at a third of that, so the button
 * being clicked is eight pixels tall. The fix is not a bigger export — it is a camera
 * that leans in on the thing being used and pulls back when the hand moves on.
 *
 * Everything is in fractions of the frame. A zoom recorded on a 2560-wide capture has
 * to survive a crop and a 720p export, and a pixel centre would survive neither.
 *
 * Zooms are proposed from the click timeline and then owned by the user: dragging one
 * on the timeline clears its `auto` flag, and rebuilding never touches it again.
 * A camera that silently re-decides what to look at after an edit is worse than no
 * camera.
 *
 * Pure module.
 */
import type { Point, Rect } from '@/core/doc/types'

import type { RecordEvent } from './timeline'
import type { ClipEdit, TimeSpan, ZoomSpan } from './types'

export type ZoomOptions = {
  /** Clicks closer than this belong to one move: the camera must not pump per click. */
  mergeWithin: number
  /** How long before the click the camera starts moving, ms. */
  preroll: number
  /** How long it stays after the last click of the group, ms. */
  hold: number
  rampIn: number
  rampOut: number
  minScale: number
  maxScale: number
  /**
   * How much of the frame height the acted-on element should fill once the camera has
   * arrived. Below a third it still reads as far away; above two thirds the context is
   * gone and the viewer cannot tell where on the page they are.
   */
  targetHeight: number
}

export const DEFAULT_ZOOM_OPTIONS: ZoomOptions = {
  mergeWithin: 1800,
  preroll: 320,
  hold: 900,
  rampIn: 420,
  rampOut: 520,
  minScale: 1.3,
  maxScale: 2.6,
  targetHeight: 0.42,
}

export type Camera = { scale: number; at: Point }

/** The still camera: the whole frame, dead centre. */
export const NEUTRAL_CAMERA: Camera = { scale: 1, at: { x: 0.5, y: 0.5 } }

function centreOf(event: RecordEvent): Point | null {
  if (event.rect && event.rect.w > 0 && event.rect.h > 0) {
    return { x: event.rect.x + event.rect.w / 2, y: event.rect.y + event.rect.h / 2 }
  }
  return event.point
}

/**
 * How close to lean in. A small element earns a bigger zoom, a wide one barely any —
 * which is the whole point: framing a full-width toolbar at 2.5x shows a slice of a
 * toolbar.
 *
 * Width is a ceiling, not a target. A menu item is short and wide: aiming for the height
 * alone would zoom to 2.5x and cut both ends off the very label the camera came to show.
 * So the scale can never be closer than the one that still leaves the element inside the
 * frame with a margin.
 */
function scaleFor(rect: Rect | null, options: ZoomOptions): number | null {
  if (!rect || rect.h <= 0) return (options.minScale + options.maxScale) / 2

  const forHeight = options.targetHeight / rect.h
  const fits = rect.w > 0 ? 0.85 / rect.w : options.maxScale
  const wanted = Math.min(forHeight, fits)

  // Below the minimum there is no move worth making: the element already fills enough of
  // the frame to read, and leaning in far enough to matter would cut its ends off. `null`
  // rather than a clamp to the minimum — a zoom that crops the button it was aimed at is
  // worse than no zoom.
  return wanted < options.minScale ? null : Math.min(options.maxScale, wanted)
}

/**
 * Clamp the camera so it never looks past the edge of the frame. Without this a click
 * near the corner would frame half a video and half nothing — and the "nothing" is
 * whatever the canvas was cleared to.
 */
export function clampCamera(camera: Camera): Camera {
  const scale = Math.max(1, camera.scale)
  const half = 0.5 / scale
  return {
    scale,
    at: {
      x: Math.min(1 - half, Math.max(half, camera.at.x)),
      y: Math.min(1 - half, Math.max(half, camera.at.y)),
    },
  }
}

/** Smoothstep. A linear ramp reads as a machine sliding a window; this reads as a camera. */
function ease(t: number): number {
  const x = Math.min(1, Math.max(0, t))
  return x * x * (3 - 2 * x)
}

let counter = 0

/** Ids are local to the clip and only need to be unique within it. */
function newZoomId(at: number): string {
  counter += 1
  return `zoom_${Math.round(at)}_${counter}`
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/**
 * The smallest rectangle holding everything the group acted on. Clicks with no element
 * behind them contribute their point, so a group of bare points still yields a box.
 */
function unionOf(group: readonly RecordEvent[]): Rect | null {
  let box: { left: number; top: number; right: number; bottom: number } | null = null

  for (const event of group) {
    const rect = event.rect ?? (event.point ? { ...event.point, w: 0, h: 0 } : null)
    if (!rect) continue

    box = box
      ? {
          left: Math.min(box.left, rect.x),
          top: Math.min(box.top, rect.y),
          right: Math.max(box.right, rect.x + rect.w),
          bottom: Math.max(box.bottom, rect.y + rect.h),
        }
      : { left: rect.x, top: rect.y, right: rect.x + rect.w, bottom: rect.y + rect.h }
  }

  return box ? { x: box.left, y: box.top, w: box.right - box.left, h: box.bottom - box.top } : null
}

function averagePoint(points: readonly Point[]): Point {
  const sum = points.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }), {
    x: 0,
    y: 0,
  })
  return { x: sum.x / points.length, y: sum.y / points.length }
}

/**
 * Build the camera moves from the click timeline.
 *
 * Clicks land in groups — a menu, then the item in it, then the field it opened — and
 * one group is one move. Grouping is by time and by place together: two clicks a second
 * apart at opposite corners are two different intentions, and holding one frame across
 * both would show neither.
 */
export function autoZooms(
  events: readonly RecordEvent[],
  edit: ClipEdit,
  options: ZoomOptions = DEFAULT_ZOOM_OPTIONS,
): ZoomSpan[] {
  const clicks = events
    .filter(
      (event) => event.kind === 'click' && event.at >= edit.trim.start && event.at <= edit.trim.end,
    )
    .filter((event) => centreOf(event) !== null)
    .sort((a, b) => a.at - b.at)

  const groups: RecordEvent[][] = []
  for (const click of clicks) {
    const group = groups.at(-1)
    const last = group?.at(-1)
    const near =
      last !== undefined &&
      click.at - last.at <= options.mergeWithin &&
      distance(centreOf(last)!, centreOf(click)!) < 0.25

    if (near) group!.push(click)
    else groups.push([click])
  }

  const zooms = groups.flatMap((group) => {
    const first = group[0]!
    const last = group.at(-1)!

    // One framing for everything the group touched.
    //
    // Neither of the two obvious answers works. The average of the click points aims at a
    // spot nobody pressed — with three clicks in a row the camera looked between the
    // buttons. Picking one of them, say the tightest, frames that one and pushes its
    // neighbour out: two clicks a line apart got a shot of the second, and the first
    // happened off-screen. The union of what was clicked contains all of it by
    // construction, and the scale is then whatever makes that union fit.
    const rect = unionOf(group)
    const at = rect
      ? { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }
      : averagePoint(group.map((event) => centreOf(event)!))

    const scale = scaleFor(rect, options)
    if (scale === null) return []

    const hold: TimeSpan = {
      start: Math.max(edit.trim.start, first.at - options.preroll),
      end: Math.min(edit.trim.end, last.at + options.hold),
    }
    return [
      {
        id: newZoomId(first.at),
        hold,
        rampIn: options.rampIn,
        rampOut: options.rampOut,
        at,
        scale,
        auto: true,
      } satisfies ZoomSpan,
    ]
  })

  return separate(zooms)
}

/**
 * Keep ramps from colliding. Two zooms whose ramps overlap would each pull the camera
 * halfway and produce a lurch between them, so the ramps are shortened until they meet
 * cleanly — the camera goes straight from one framing to the next.
 */
export function separate(zooms: readonly ZoomSpan[]): ZoomSpan[] {
  const sorted = [...zooms].sort((a, b) => a.hold.start - b.hold.start)

  return sorted.map((zoom, at) => {
    const previous = sorted[at - 1]
    const next = sorted[at + 1]
    let rampIn = zoom.rampIn
    let rampOut = zoom.rampOut

    if (previous) {
      const gap = zoom.hold.start - previous.hold.end
      // Split the gap between the two ramps rather than giving it to one of them: the
      // camera should be equally unhurried leaving and arriving.
      if (gap < zoom.rampIn + previous.rampOut) rampIn = Math.max(0, gap / 2)
    }
    if (next) {
      const gap = next.hold.start - zoom.hold.end
      if (gap < zoom.rampOut + next.rampIn) rampOut = Math.max(0, gap / 2)
    }
    return rampIn === zoom.rampIn && rampOut === zoom.rampOut ? zoom : { ...zoom, rampIn, rampOut }
  })
}

/**
 * How much of this zoom applies at a given source moment: 0 outside, 1 on the plateau,
 * eased along the ramps.
 */
export function envelopeAt(zoom: ZoomSpan, source: number): number {
  if (source >= zoom.hold.start && source <= zoom.hold.end) return 1
  if (source < zoom.hold.start) {
    if (zoom.rampIn <= 0) return 0
    return ease((source - (zoom.hold.start - zoom.rampIn)) / zoom.rampIn)
  }
  if (zoom.rampOut <= 0) return 0
  return ease(1 - (source - zoom.hold.end) / zoom.rampOut)
}

/**
 * Where the camera is at a source moment.
 *
 * Zooms are blended by weight against the neutral framing rather than switched between:
 * a hard switch at the seam of two overlapping zooms is a visible jump, and overlaps
 * happen the moment somebody drags a zoom on the timeline.
 */
export function cameraAt(zooms: readonly ZoomSpan[], source: number): Camera {
  let weight = 0
  let scale = 0
  let x = 0
  let y = 0

  for (const zoom of zooms) {
    const w = envelopeAt(zoom, source)
    if (w <= 0) continue
    weight += w
    scale += w * zoom.scale
    x += w * zoom.at.x
    y += w * zoom.at.y
  }

  if (weight <= 0) return NEUTRAL_CAMERA

  // More than one zoom fully applied: normalize instead of overshooting past their
  // scales. What is left over after the zooms is the neutral framing, so a lone zoom
  // at half weight sits exactly halfway between wide and close.
  const total = Math.max(1, weight)
  const rest = 1 - weight / total

  return clampCamera({
    scale: scale / total + rest,
    at: { x: x / total + rest * 0.5, y: y / total + rest * 0.5 },
  })
}
