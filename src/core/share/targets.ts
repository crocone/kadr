/**
 * Where a finished frame can go besides the downloads folder.
 *
 * Only one target works so far — a link to the shot in the library. It works honestly
 * with no network, keys, or sign-in: the doc is already in IndexedDB and the link opens
 * it in the editor. It doesn't leave this machine, and the panel's caption says so.
 *
 * Telegram, Slack, and Drive are drawn in the panel but disabled: each needs its own
 * token and settings section, like the trackers in `core/trackers`. The target list and
 * readiness flag live here so the panel doesn't decide for the product what works.
 */
import type { DocId } from '@/core/doc/types'

export type ShareTarget = 'link' | 'telegram' | 'slack' | 'drive'

export const SHARE_TARGETS: readonly ShareTarget[] = ['link', 'telegram', 'slack', 'drive']

/** Targets that actually deliver. The rest are visible in the panel but not clickable. */
export function isShareTargetReady(target: ShareTarget): boolean {
  return target === 'link'
}

const EDITOR_PAGE = 'src/editor/index.html'

/** Editor link for a shot: the same URL the background opens it with. */
export function editorLink(docId: DocId): string {
  return chrome.runtime.getURL(`${EDITOR_PAGE}?doc=${docId}`)
}
