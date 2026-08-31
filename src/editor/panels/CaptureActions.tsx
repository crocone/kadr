import { useT } from '@/core/ui/app-context'
import { Button } from '@/core/ui/components'

import type { DocumentController } from '../useDocument'

import { ReshootButton } from './ReshootButton'

/**
 * Floating actions above the frame. Crop mode shows only apply/cancel — the
 * other buttons would just confuse there.
 */
export function CaptureActions({
  controller,
  cropping,
  canReset,
  onCrop,
  onApply,
  onCancel,
  onFit,
  onReset,
}: {
  controller: DocumentController
  cropping: boolean
  canReset: boolean
  onCrop: () => void
  onApply: () => void
  onCancel: () => void
  onFit: () => void
  onReset: () => void
}) {
  const t = useT()

  if (cropping) {
    return (
      <Bar>
        <span className="px-1.5 text-xs text-text-muted">{t('editor.capture.cropHint')}</span>
        <Button size="sm" variant="primary" onClick={onApply}>
          {t('editor.capture.apply')}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
      </Bar>
    )
  }

  return (
    <Bar>
      <Button size="sm" variant="primary" onClick={onCrop}>
        {t('editor.capture.crop')}
      </Button>
      <Button size="sm" onClick={onFit}>
        {t('editor.capture.fit')}
      </Button>
      <Button size="sm" variant="ghost" disabled={!canReset} onClick={onReset}>
        {t('editor.capture.reset')}
      </Button>
      <ReshootButton controller={controller} />
    </Bar>
  )
}

function Bar({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute top-14 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-panel border border-border bg-surface p-1 shadow-panel">
      {children}
    </div>
  )
}
