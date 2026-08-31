/**
 * Responsive series: the same screen at three widths.
 *
 * The width is set through the browser window, not by faking metrics:
 * `chrome.windows.update` really changes the viewport, so media queries, container
 * queries and lazy images behave exactly as for a visitor with that screen. Faking
 * that would take CDP, which was ruled out (PLAN.md §12).
 *
 * The price: the window visibly changes size for a couple of seconds. There is no
 * hiding it, so what matters is that the original size is always restored, including
 * when the capture fails midway.
 */
import type { Rect } from '@/core/doc/types'

export const RESPONSIVE_WIDTHS: readonly number[] = [375, 768, 1440]

/** How long to wait after a resize before shooting. */
export const RESETTLE_MS = 450

export type WindowState = 'normal' | 'maximized' | 'fullscreen' | 'minimized'

export type WindowBounds = { width: number; height: number; state: WindowState }

/**
 * `width` is what was asked for, `viewport` is what came back. They can differ: Chrome
 * will not let a window shrink below its minimum, so 375 can arrive with a wider viewport.
 */
export type Shot = { width: number; viewport: number; blob: Blob; pixels: Rect }

/**
 * Everything the series does outside itself. Passed as parameters, not imported: the
 * "un-maximize — shrink — wait — shoot — put back" schedule can only be tested this way.
 */
export type SeriesDeps = {
  windowBounds: () => Promise<WindowBounds>
  setWindowState: (state: WindowState) => Promise<void>
  resizeWindow: (width: number) => Promise<void>
  /** Current page viewport width: used to compute how much the browser chrome takes. */
  viewportWidth: () => Promise<number>
  captureViewport: () => Promise<{ blob: Blob; width: number; height: number }>
  wait: (ms: number) => Promise<void>
  onProgress?: (done: number, total: number) => void
}

/**
 * Shoots the series and returns the window to its original size and state.
 *
 * A maximized window is first returned to normal: Chrome silently ignores `width` for
 * `maximized`, and without this step the whole series is three identical desktop
 * frames. The same fact explains why measurements happen after, not before: a maximized
 * window has a different width and viewport.
 *
 * The window is wider than the viewport by the browser's own chrome, so the window
 * width is "target viewport plus that difference" — otherwise every width would be a
 * couple dozen pixels short, and a landing page at 375 would get the mobile layout with
 * a scrollbar.
 */
export async function captureSeries(widths: readonly number[], deps: SeriesDeps): Promise<Shot[]> {
  const original = await deps.windowBounds()
  const wasResized = original.state !== 'normal'

  const shots: Shot[] = []
  let normalWidth = original.width

  try {
    if (wasResized) {
      await deps.setWindowState('normal')
      await deps.wait(RESETTLE_MS)
      normalWidth = (await deps.windowBounds()).width
    }

    const viewport = await deps.viewportWidth()
    const chromeWidth = Math.max(0, normalWidth - viewport)

    for (const [index, width] of widths.entries()) {
      await deps.resizeWindow(width + chromeWidth)
      // A resize is not an instant repaint: media queries, fonts and lazy images only
      // settle after the pause.
      await deps.wait(RESETTLE_MS)

      // Measure the width instead of trusting the request: Chrome may refuse to shrink
      // the window that far, and labelling such a frame "375 px" would be a lie.
      const actual = await deps.viewportWidth()
      const shot = await deps.captureViewport()
      shots.push({
        width,
        viewport: actual,
        blob: shot.blob,
        pixels: { x: 0, y: 0, w: shot.width, h: shot.height },
      })
      deps.onProgress?.(index + 1, widths.length)
    }
  } finally {
    // Restore the size even after an error: leaving the user's window narrow is
    // breakage they fix by hand. Width first, then state: maximizing alone is not
    // enough — Chrome would remember the narrow size until the next un-maximize.
    await deps.resizeWindow(normalWidth).catch(() => undefined)
    if (wasResized) await deps.setWindowState(original.state).catch(() => undefined)
  }

  return shots
}

/** Widths from settings: an empty or garbage list silently falls back to the defaults. */
export function widthsFrom(raw: readonly number[] | undefined): number[] {
  const clean = (raw ?? [])
    .map((value) => Math.round(value))
    .filter((value) => Number.isFinite(value) && value >= 240 && value <= 3840)

  return clean.length > 0 ? [...new Set(clean)].sort((a, b) => a - b) : [...RESPONSIVE_WIDTHS]
}
