import type { Rect } from '@/core/doc/types'

/** Page metrics taken by the content script before capture. */
export type PageMetrics = {
  scrollWidth: number
  scrollHeight: number
  viewportWidth: number
  viewportHeight: number
  devicePixelRatio: number
  scrollX: number
  scrollY: number
}

export type CaptureSource = {
  url: string
  title: string
  domain: string
}

/** One stitch step: where to scroll and which canvas row the frame lands on. */
export type StitchStep = {
  index: number
  scrollY: number
}

export type StitchPlan = {
  /** Canvas size in physical pixels. */
  canvasWidth: number
  canvasHeight: number
  devicePixelRatio: number
  steps: StitchStep[]
  /** Page is taller than the canvas allows: the frame will be truncated. */
  truncated: boolean
  /** Time estimate from the captureVisibleTab limit, ms. */
  estimatedMs: number
}

export type CaptureError =
  | 'unsupported-page'
  | 'cancelled'
  | 'no-active-tab'
  | 'content-unreachable'
  | 'capture-failed'
  /** Reshoot did not find the recorded element on the page: see `core/dom/selector`. */
  | 'element-not-found'

export class CaptureFailure extends Error {
  constructor(
    readonly reason: CaptureError,
    message?: string,
  ) {
    super(message ?? reason)
    this.name = 'CaptureFailure'
  }
}

export type SelectedRect = { rect: Rect; label?: string }
