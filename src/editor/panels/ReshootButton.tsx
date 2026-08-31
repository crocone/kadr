/**
 * Reshoot button above the frame.
 *
 * Deliberately sits next to "crop": both actions change the shot itself, not the
 * dressing around it. Documents without a capture recipe get no button at all —
 * shots taken before v1.1 have nothing to repeat, and a disabled button with an
 * explanation would be a promise we can't keep.
 */
import { useState } from 'react'

import { MAX_QUIET_DRIFT } from '@/core/capture/recipe'
import { revertCapture } from '@/core/doc/capture-ops'
import { getDoc } from '@/core/storage/db'
import { useT } from '@/core/ui/app-context'
import { Button } from '@/core/ui/components'
import { targetOf, useReshoot } from '@/core/ui/useReshoot'

import type { DocumentController } from '../useDocument'

export function ReshootButton({ controller }: { controller: DocumentController }) {
  const t = useT()
  const { run, running } = useReshoot()
  const [message, setMessage] = useState<string | null>(null)
  const [drifted, setDrifted] = useState(false)

  const target = targetOf(controller.doc)
  if (!target) return null

  const reshoot = async () => {
    setMessage(null)
    const [outcome] = await run([target])

    if (!outcome) {
      setMessage(t('reshoot.failed'))
      return
    }
    if (!outcome.ok) {
      setMessage(t(outcome.reason === 'element-not-found' ? 'reshoot.notFound' : 'reshoot.failed'))
      return
    }

    // The background rewrote the document while the editor holds its own copy:
    // without a reload, autosave would restore the old frame half a second later.
    const fresh = await getDoc(target.docId)
    if (fresh) controller.reload(fresh)

    setDrifted(outcome.drift > MAX_QUIET_DRIFT)
    setMessage(outcome.drift > MAX_QUIET_DRIFT ? t('reshoot.drift') : t('reshoot.done'))
  }

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        disabled={running}
        title={t('reshoot.hint')}
        onClick={() => {
          void reshoot()
        }}
      >
        {running ? t('reshoot.running') : t('reshoot.action')}
      </Button>
      {message ? (
        <div className="absolute top-full left-1/2 mt-2 flex w-max max-w-sm -translate-x-1/2 items-center gap-2 rounded-panel border border-border bg-surface px-3 py-2 text-xs text-text-muted shadow-panel">
          <span>{message}</span>
          {drifted ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                controller.commit((doc) => revertCapture(doc, Date.now()))
                setMessage(null)
                setDrifted(false)
              }}
            >
              {t('reshoot.revert')}
            </Button>
          ) : null}
        </div>
      ) : null}
    </>
  )
}
