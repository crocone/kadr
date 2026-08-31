import { ERASER_SIZES } from '@/core/doc/erase'
import { useT } from '@/core/ui/app-context'
import { cn } from '@/core/ui/cn'
import { IconEraser } from '@/core/ui/icons'

import type { ToolController } from '../useTool'

/**
 * Tool settings at the bottom of the canvas, in the same spot as the object bar.
 *
 * The eraser leaves nothing selected after use, so its settings can't live in the
 * object bar: they are needed before the gesture, not after.
 */
export function ToolOptions({ tools }: { tools: ToolController }) {
  const t = useT()
  if (tools.tool !== 'eraser') return null

  const { eraser, setEraser } = tools

  return (
    <div className="pointer-events-auto flex items-center gap-4 rounded-panel border border-border bg-raised px-3 py-2 shadow-float">
      <span className="flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent/15 text-accent">
          <IconEraser size={16} />
        </span>
        <span className="flex flex-col leading-tight">
          <span className="text-[13px] font-semibold">{t('editor.tool.eraser')}</span>
          <span className="font-mono text-[10px] text-text-muted">
            {t('editor.object.key', { key: 'X' })}
          </span>
        </span>
      </span>

      <label className="flex items-center gap-2">
        <span className="text-[11px] text-text-muted">{t('editor.eraser.size')}</span>
        <input
          type="range"
          min={ERASER_SIZES.min}
          max={ERASER_SIZES.max}
          step={1}
          value={eraser.size}
          onChange={(event) => {
            setEraser({ size: Number(event.target.value) })
          }}
          className="w-28 accent-accent"
        />
        <span className="w-8 font-mono text-[11px] text-text-soft">{eraser.size}</span>
      </label>

      <span className="flex items-center gap-2">
        <span className="text-[11px] text-text-muted">{t('editor.eraser.mode')}</span>
        <span className="flex items-center gap-1">
          {(['part', 'object'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => {
                setEraser({ mode })
              }}
              className={cn(
                'h-7 rounded-md border px-2 text-[11px] transition-colors',
                eraser.mode === mode
                  ? 'border-accent bg-accent/15 text-text'
                  : 'border-border text-text-muted hover:border-border-strong',
              )}
            >
              {t(`editor.eraser.${mode}`)}
            </button>
          ))}
        </span>
      </span>
    </div>
  )
}
