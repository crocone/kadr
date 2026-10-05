/**
 * Clip model: a recording plus everything the editor did to it.
 *
 * The video itself never lives here. Bytes go to OPFS — a ten-minute WebM is
 * hundreds of megabytes, and IndexedDB would have to hold it as one blob, read
 * whole into memory to seek. The record keeps a file name and the numbers.
 *
 * Every time in this module is milliseconds from the start of the recording,
 * before any editing. Call it source time. The editor cuts, speeds up and trims,
 * so what the viewer sees runs on a different clock — the conversion between the
 * two lives in `edit.ts` and nowhere else.
 */
import type {
  Background,
  BrowserFrame,
  DocId,
  ImageId,
  Point,
  Rect,
  Shadow,
} from '@/core/doc/types'

import type { RecordEvent } from './timeline'

export type ClipId = string
export type ZoomId = string

/**
 * What was recorded. `tab` is `chrome.tabCapture`: the page only, no browser UI
 * and no other windows. `window` and `screen` come from `desktopCapture`, which
 * shows Chrome's own source picker — we never learn which one until the stream
 * arrives, so the kind is what the user asked for, not what they picked.
 */
export type RecordSource = 'tab' | 'window' | 'screen'

/** A span of source time. `end` is exclusive; `start <= end` always holds. */
export type TimeSpan = { start: number; end: number }

/**
 * A camera move. The centre is a fraction of the video frame, not pixels: the clip
 * may be cropped and is certainly scaled on export, and a pixel centre would drift
 * with every one of those.
 *
 * `hold` is the plateau — the span the camera stays zoomed in. The ramps live
 * outside it, so two zooms can be adjacent without their ramps fighting.
 */
export type ZoomSpan = {
  id: ZoomId
  hold: TimeSpan
  /** Ramp durations in ms, before `hold.start` and after `hold.end`. */
  rampIn: number
  rampOut: number
  at: Point
  scale: number
  /** Auto-zooms are rebuilt when the timeline changes; hand-made ones are not. */
  auto: boolean
}

export type ClickStyle = {
  show: boolean
  color: string
  /** Ring radius at its widest, as a fraction of the frame height. */
  size: number
  /** How long one ripple lives, ms. */
  duration: number
}

/**
 * What happens to the sound, separately from the picture.
 *
 * A cut removes a stretch of the clip; a silence keeps the picture and drops the sound
 * under it. They are different edits because they answer different needs: a cut is
 * "nothing happened here", a silence is "something happened, and I was coughing".
 * All times are source time, like everything else in this file.
 */
export type SoundEdit = {
  /** No sound at all: the export gets no audio track and the player stays quiet. */
  muted: boolean
  /** Kept range of the sound. Outside it the picture plays on in silence. */
  trim: TimeSpan
  /** Silenced spans, sorted and non-overlapping. */
  silences: TimeSpan[]
}

/**
 * Non-destructive edit. Nothing here touches the recorded file: the same source
 * plays under a different set of numbers, and a mistaken cut is one undo away.
 */
export type ClipEdit = {
  /** Kept range of the source. Everything outside is gone from playback and export. */
  trim: TimeSpan
  /** Playback rate for the whole clip. 1 — as recorded. */
  speed: number
  /** Crop in fractions of the frame; `null` — the whole frame. */
  crop: Rect | null
  /** Removed spans, sorted and non-overlapping. Pause cutting fills this. */
  cuts: TimeSpan[]
  zooms: ZoomSpan[]
  clicks: ClickStyle
  sound: SoundEdit
}

/**
 * Clip decoration. The same background, padding, radius, shadow and browser frame
 * the screenshot editor draws — deliberately the same fields, so `core/render` can
 * paint a video frame with the code that paints a capture.
 *
 * It is not a whole `DocCanvas`: a clip has no `preset` to fit and no mockup, and
 * a field the editor never shows is a field that silently rots.
 */
export type ClipDecoration = {
  background: Background
  padding: number
  radius: number
  shadow: Shadow
  /**
   * Browser chrome around the picture. The same `BrowserFrame` a screenshot carries, drawn
   * by the same painter — a clip and a shot of the same page should not disagree about
   * what a browser window looks like.
   */
  frame: BrowserFrame
}

export type Clip = {
  /** Schema version, same contract as `Doc`: migrations key off this. */
  version: 1
  id: ClipId
  title: string
  createdAt: number
  updatedAt: number
  source: RecordSource
  /** OPFS file name. The bytes are there; this record is the index. */
  file: string
  /** Container the recorder actually negotiated, e.g. `video/webm;codecs=vp9,opus`. */
  mime: string
  /** Source length in ms. */
  duration: number
  width: number
  height: number
  /** Bytes on disk: the library shows it and the OPFS budget is checked against it. */
  size: number
  /** Whether the stream carried audio — tab sound, microphone, or both. */
  audio: boolean
  page: { url: string; title: string; domain: string } | null
  /**
   * Page viewport at record time, in CSS pixels. `null` when nothing reported one — a
   * window or screen recording, or a page that refused the script.
   */
  viewport: { w: number; h: number } | null
  events: RecordEvent[]
  edit: ClipEdit
  decoration: ClipDecoration
  /** First frame, for the library card. */
  poster: ImageId | null
  /**
   * Frame exported to the screenshot editor, if the user ever did that. Keeps the
   * "grab a still out of the clip" round trip out of the library's guesswork.
   */
  stillDocId: DocId | null
}
