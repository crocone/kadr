import { useEffect, useState } from 'react'

import {
  FEEDBACK_FORM_URL,
  markPromptSeen,
  readFeedbackState,
  shouldShowPrompt,
  storeReviewUrl,
} from '@/core/feedback'
import { useT } from '@/core/ui/app-context'
import { Button, ToolButton } from '@/core/ui/components'
import { IconClose } from '@/core/ui/icons'

/**
 * One-time strip under the top bar. Shown on the next editor open after enough
 * exports, not right after one: the user is starting something, not mid-gesture.
 * Any click, "hide" included, retires it for good.
 */
export function FeedbackBar() {
  const t = useT()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    let cancelled = false
    void readFeedbackState().then((state) => {
      if (!cancelled && shouldShowPrompt(state)) setVisible(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (!visible) return null

  const retire = () => {
    setVisible(false)
    void markPromptSeen()
  }
  const open = (url: string) => {
    window.open(url, '_blank', 'noopener')
    retire()
  }

  return (
    <div
      role="status"
      className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-raised px-3.5 text-[12px]"
    >
      <span className="text-text-muted">{t('feedback.prompt')}</span>
      <Button
        size="sm"
        onClick={() => {
          open(storeReviewUrl())
        }}
      >
        {t('feedback.rate')}
      </Button>
      <Button
        size="sm"
        onClick={() => {
          open(FEEDBACK_FORM_URL)
        }}
      >
        {t('feedback.send')}
      </Button>
      <span className="flex-1" />
      <ToolButton className="h-6 w-6 rounded-md" title={t('feedback.dismiss')} onClick={retire}>
        <IconClose size={14} />
      </ToolButton>
    </div>
  )
}
