import { arrangeableItems, arrangeFrames, type ArrangeMode } from '@/core/doc/arrange'
import { useT } from '@/core/ui/app-context'
import { Button } from '@/core/ui/components'
import { Chip } from '@/core/ui/controls'

import type { DocumentController } from '../useDocument'

const MODES: readonly ArrangeMode[] = ['row', 'column', 'cascade']

/**
 * Multiple frames in one document (e.g. a three-screenshot conversation, before/after).
 *
 * Arranging positions objects rather than merging pixels: each frame stays a separate
 * item that can be moved, reordered, or removed, and the image is still rendered from
 * the model, not from a flattened canvas.
 */
export function FramesPanel({
  controller,
  onAddImage,
  onArranged,
}: {
  controller: DocumentController
  onAddImage: () => void
  onArranged: () => void
}) {
  const t = useT()
  const { doc, commit } = controller
  const count = arrangeableItems(doc).length

  return (
    <>
      <Button size="sm" onClick={onAddImage}>
        {t('editor.frames.add')}
      </Button>

      <div className="flex flex-wrap gap-1.5">
        {MODES.map((mode) => (
          <Chip
            key={mode}
            active={false}
            disabled={count < 2}
            onClick={() => {
              commit((current) => arrangeFrames(current, mode))
              onArranged()
            }}
          >
            {t(`editor.frames.${mode}`)}
          </Chip>
        ))}
      </div>

      <p className="text-[11px] text-text-muted">
        {count < 2 ? t('editor.frames.hint') : t('editor.frames.count', { n: count })}
      </p>
    </>
  )
}
