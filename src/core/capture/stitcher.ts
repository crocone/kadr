/**
 * Full-page stitching. Frames land on the canvas at their actual scrollY, so
 * the last one, overlapping the previous, lines up exactly — no doubled band.
 *
 * Fixed elements are hidden right after the first frame, not right before the
 * second: between those moments there is a scroll with its own paint wait, and
 * the header manages to disappear before the next shot. In the reverse order
 * the frame got captured before the repaint, and the header appeared twice
 * (PLAN.md §3).
 */
import { planFullPageCapture } from './plan'
import type { PageMetrics, StitchPlan } from './types'

export type StitchDeps = {
  /** Scrolls the page and returns the actual position — it may differ. */
  scrollTo: (y: number) => Promise<number>
  captureFrame: () => Promise<ImageBitmap>
  /** Hides and restores `position: fixed` elements. Sticky ones stay in frame. */
  setFixedHidden: (hidden: boolean) => Promise<void>
  onProgress?: (done: number, total: number) => void
}

/** Where a frame lands. Split from deps so step order is testable without OffscreenCanvas. */
export type StitchSink = {
  drawFrame: (frame: ImageBitmap, y: number) => void
}

export type StitchResult = {
  bitmap: ImageBitmap
  plan: StitchPlan
}

export async function runStitch(
  plan: StitchPlan,
  deps: StitchDeps,
  sink: StitchSink,
): Promise<void> {
  const dpr = plan.devicePixelRatio

  for (const step of plan.steps) {
    const scrollY = await deps.scrollTo(step.scrollY)

    const frame = await deps.captureFrame()
    sink.drawFrame(frame, Math.round(scrollY * dpr))
    frame.close()

    if (step.index === 0) await deps.setFixedHidden(true)
    deps.onProgress?.(step.index + 1, plan.steps.length)
  }

  await deps.setFixedHidden(false)
}

export async function stitchFullPage(
  metrics: PageMetrics,
  deps: StitchDeps,
): Promise<StitchResult> {
  const plan = planFullPageCapture(metrics)

  const canvas = new OffscreenCanvas(plan.canvasWidth, plan.canvasHeight)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('OffscreenCanvas 2d context unavailable')

  await runStitch(plan, deps, {
    drawFrame: (frame, y) => {
      ctx.drawImage(frame, 0, y)
    },
  })

  return { bitmap: canvas.transferToImageBitmap(), plan }
}
