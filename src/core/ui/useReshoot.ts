/**
 * Reshoot launched from an extension page.
 *
 * The host permission is requested here, not in the background, and that's not a style
 * choice: Chrome rejects `permissions.request` outside a user gesture, and a service
 * worker can never have one. So the chain always starts with a button press on our own
 * page, and only then does the background open a window and shoot.
 *
 * It has to ask for all sites, not one. Also not a choice: Chrome's
 * `captureVisibleTab` accepts only `activeTab` or literally `<all_urls>`, and
 * `activeTab` is granted by a gesture on the tab itself — which a page opened by the
 * reshoot can never have. A single-site permission gets a flat error from the tab.
 *
 * Hence the split: Scribe runs on `activeTab` and asks for one site; reshoot asks for
 * all — separately, on a button, with an explanation. Refusal leaves reshoot
 * unavailable; everything else keeps working.
 */
import { useCallback, useState } from 'react'

import { ensureAllUrls } from '@/core/permissions/host-access'
import { isRepeatable } from '@/core/capture/recipe'
import type { Doc, DocId } from '@/core/doc/types'
import { type ReshootOutcome, sendMessage } from '@/core/messaging'

export type ReshootTarget = { docId: DocId; url: string }

export type ReshootState = {
  running: boolean
  /** Error message key, or `null`. An empty results array is also a failure. */
  error: 'reshoot.noPermission' | 'reshoot.failed' | null
  results: ReshootOutcome[]
}

/** Whether reshoot can be offered at all: shots taken before 1.1 have no recipe. */
export function canReshoot(doc: Pick<Doc, 'recipe'>): boolean {
  return isRepeatable(doc.recipe)
}

export function targetOf(doc: Doc): ReshootTarget | null {
  const recipe = doc.recipe
  if (!isRepeatable(recipe)) return null
  return { docId: doc.id, url: recipe.url }
}

export function useReshoot(): ReshootState & {
  run: (targets: readonly ReshootTarget[]) => Promise<ReshootOutcome[]>
  dismiss: () => void
} {
  const [state, setState] = useState<ReshootState>({
    running: false,
    error: null,
    results: [],
  })

  const run = useCallback(async (targets: readonly ReshootTarget[]) => {
    if (targets.length === 0) return []
    setState({ running: true, error: null, results: [] })

    // Permission first, while the gesture is still "hot": any await before it can
    // close the gesture window, and Chrome refuses before even asking the user.
    const granted = await ensureAllUrls()
    if (!granted) {
      setState({ running: false, error: 'reshoot.noPermission', results: [] })
      return []
    }

    const response = await sendMessage('reshoot:run', {
      docIds: targets.map((target) => target.docId),
    })

    if (!response.ok) {
      setState({ running: false, error: 'reshoot.failed', results: [] })
      return []
    }

    setState({ running: false, error: null, results: response.results })
    return response.results
  }, [])

  const dismiss = useCallback(() => {
    setState({ running: false, error: null, results: [] })
  }, [])

  return { ...state, run, dismiss }
}
