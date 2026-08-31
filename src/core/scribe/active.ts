/**
 * Pointer to the recording in progress.
 *
 * Lives in `chrome.storage.session` — not in worker memory and not in IndexedDB.
 * Memory won't do: MV3 suspends the service worker mid-recording, and a revived
 * worker wouldn't know the tab is still being recorded. IndexedDB is too durable:
 * a recording must not survive a browser restart — someone who closed Chrome
 * mid-guide should come back to a clean slate, not an invisibly running recording.
 */
import type { GuideId } from './timeline'

const KEY = 'scribe:active'

export type ActiveScribe = {
  guideId: GuideId
  tabId: number
  /** Recording origin: navigating to another domain does not continue the recording — no permission there. */
  origin: string
  /** Steps recorded so far: the HUD shows this without reading the whole DB. */
  steps: number
  /** Frames skipped by the rate limiter: those steps remain caption-only. */
  dropped: number
}

export async function readActive(): Promise<ActiveScribe | null> {
  const stored = await chrome.storage.session.get(KEY)
  return (stored[KEY] as ActiveScribe | undefined) ?? null
}

export async function writeActive(active: ActiveScribe): Promise<void> {
  await chrome.storage.session.set({ [KEY]: active })
}

export async function clearActive(): Promise<void> {
  await chrome.storage.session.remove(KEY)
}
