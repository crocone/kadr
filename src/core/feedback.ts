/**
 * Feedback links and the one-time "how is it going?" prompt.
 *
 * The prompt fires after a handful of successful exports — the moment the user has
 * just got something out of the tool — and never again once it has been seen,
 * whatever they clicked. Nothing here is sent anywhere: the counter lives in
 * `chrome.storage.local` next to the settings.
 */

/** Ideas and bug reports. Swap for a Google Form once it exists. */
export const FEEDBACK_FORM_URL = 'https://github.com/crocone/kadr/issues/new/choose'

/** Exports (download or copy) after which the prompt shows. */
export const PROMPT_AFTER_EXPORTS = 5

/** Days after install during which the prompt stays quiet even past the export count. */
export const PROMPT_QUIET_DAYS = 3

export function storeReviewUrl(): string {
  return `https://chromewebstore.google.com/detail/${chrome.runtime.id}/reviews`
}

export type FeedbackState = {
  exports: number
  installedAt: number | null
  /** Set by any click on the prompt, including "hide". */
  promptSeen: boolean
}

const STORAGE_KEY = 'feedback'

const EMPTY: FeedbackState = { exports: 0, installedAt: null, promptSeen: false }

export async function readFeedbackState(): Promise<FeedbackState> {
  const stored = await chrome.storage.local.get(STORAGE_KEY)
  return { ...EMPTY, ...(stored[STORAGE_KEY] as Partial<FeedbackState> | undefined) }
}

async function patch(update: Partial<FeedbackState>): Promise<FeedbackState> {
  const next = { ...(await readFeedbackState()), ...update }
  await chrome.storage.local.set({ [STORAGE_KEY]: next })
  return next
}

/** Called once on install: the prompt waits a few days from here. */
export async function markInstalled(now = Date.now()): Promise<void> {
  const state = await readFeedbackState()
  if (state.installedAt === null) await patch({ installedAt: now })
}

export async function recordExport(): Promise<FeedbackState> {
  const state = await readFeedbackState()
  return patch({ exports: state.exports + 1 })
}

export async function markPromptSeen(): Promise<void> {
  await patch({ promptSeen: true })
}

export function shouldShowPrompt(state: FeedbackState, now = Date.now()): boolean {
  if (state.promptSeen) return false
  if (state.exports < PROMPT_AFTER_EXPORTS) return false
  // No install date means an upgrade from a build that did not record one: the
  // user has been around long enough.
  if (state.installedAt === null) return true
  return now - state.installedAt >= PROMPT_QUIET_DAYS * 24 * 60 * 60 * 1000
}
