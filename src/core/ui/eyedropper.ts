/**
 * Screen eyedropper.
 *
 * Chrome does this natively — the `EyeDropper` browser API shows a loupe and returns
 * the color of any screen point, needing no screenshot and no permissions. A custom
 * implementation is impossible here: a page can't see pixels outside its own window,
 * and rightly so.
 */
type EyeDropperResult = { sRGBHex: string }

type EyeDropperInstance = {
  open: (options?: { signal?: AbortSignal }) => Promise<EyeDropperResult>
}

type WindowWithEyeDropper = typeof globalThis & {
  EyeDropper?: new () => EyeDropperInstance
}

export function eyedropperAvailable(): boolean {
  return typeof (globalThis as WindowWithEyeDropper).EyeDropper === 'function'
}

/**
 * Color of a screen point, or `null` when there's no eyedropper or the pick was
 * cancelled. Cancelling is not an error: Escape is a normal outcome, not a failure
 * to shout about.
 */
export async function pickColorFromScreen(): Promise<string | null> {
  const Picker = (globalThis as WindowWithEyeDropper).EyeDropper
  if (!Picker) return null

  try {
    const { sRGBHex } = await new Picker().open()
    return sRGBHex
  } catch {
    return null
  }
}
