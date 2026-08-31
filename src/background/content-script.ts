/**
 * On-demand content-script injection under `activeTab` — declarative `content_scripts`
 * would require host permissions at install time (PLAN.md §8).
 *
 * The subtlety that made the very first capture fail with "Receiving end does not
 * exist": CRXJS injects not the module itself but a loader that pulls it in via dynamic
 * `import()`. `executeScript` resolves as soon as the loader starts — before the module
 * has registered its message handlers. So after injecting, wait for the script with a
 * ping instead of assuming it is ready.
 */
import { CaptureFailure } from '@/core/capture/types'

export const READY_TIMEOUT_MS = 3000
export const READY_POLL_MS = 50

export type ContentScriptDeps = {
  /** Whether the content script answers right now. Connection errors count as `false`. */
  ping: () => Promise<boolean>
  inject: () => Promise<void>
  sleep: (ms: number) => Promise<void>
  now: () => number
}

export async function ensureReady(
  deps: ContentScriptDeps,
  timeoutMs = READY_TIMEOUT_MS,
  pollMs = READY_POLL_MS,
): Promise<void> {
  if (await deps.ping()) return

  try {
    await deps.inject()
  } catch (error) {
    throw new CaptureFailure('content-unreachable', String(error))
  }

  const deadline = deps.now() + timeoutMs
  for (;;) {
    if (await deps.ping()) return
    if (deps.now() >= deadline) {
      throw new CaptureFailure(
        'content-unreachable',
        `content script did not answer within ${timeoutMs}ms`,
      )
    }
    await deps.sleep(pollMs)
  }
}

export async function ensureContentScript(tabId: number, file: string): Promise<void> {
  await ensureReady({
    ping: async () => {
      try {
        const response: unknown = await chrome.tabs.sendMessage(tabId, { type: 'ping' })
        return typeof response === 'object' && response !== null && 'ok' in response
      } catch {
        return false
      }
    },
    inject: async () => {
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: false },
        files: [file],
      })
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
  })
}
