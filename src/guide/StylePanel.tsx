/**
 * Guide annotation styling (PLAN.md §6.5).
 *
 * The panel sits above the step list rather than in global settings: an internal guide
 * and a client-facing one are styled differently, and flipping a global setting between
 * them would be needless work. The result is visible right away on the thumbnails.
 */
import { type ScribeStyle, STYLE_LIMITS } from '@/core/scribe/style'
import { useT } from '@/core/ui/app-context'
import { ColorInput, NumberField, Segmented } from '@/core/ui/controls'

import type { BadgeStyle } from '@/core/doc/types'

const BADGE_STYLES: readonly BadgeStyle[] = ['number', 'roman', 'bullet']

const BADGE_LABELS: Record<BadgeStyle, string> = {
  number: '1',
  roman: 'I',
  bullet: '•',
}

export function StylePanel({
  style,
  onChange,
  onCommit,
  busy,
}: {
  style: ScribeStyle
  /** Live update while a color/size control is being dragged. */
  onChange: (style: ScribeStyle) => void
  /**
   * End of gesture. Steps are rebuilt only here: re-rendering ten documents on every
   * slider tick takes seconds, and only the final state matters anyway.
   */
  onCommit: () => void
  busy: boolean
}) {
  const t = useT()
  const set = <K extends keyof ScribeStyle>(key: K, value: ScribeStyle[K]) => {
    onChange({ ...style, [key]: value })
  }
  const commit = onCommit

  return (
    <section className="flex flex-wrap items-end gap-4 rounded-panel border border-border bg-surface p-3">
      <div className="min-w-48">
        <ColorInput
          label={t('guide.style.accent')}
          value={style.accent}
          onChange={(accent) => {
            set('accent', accent)
          }}
          onCommit={commit}
        />
      </div>

      <Toggle
        label={t('guide.style.outline')}
        on={style.outline}
        onToggle={() => {
          onChange({ ...style, outline: !style.outline })
          commit()
        }}
      >
        <div className="w-20">
          <NumberField
            label={t('guide.style.width')}
            value={style.outlineWidth}
            min={STYLE_LIMITS.outlineWidth.min}
            max={STYLE_LIMITS.outlineWidth.max}
            onChange={(outlineWidth) => {
              set('outlineWidth', outlineWidth)
            }}
            onCommit={commit}
          />
        </div>
      </Toggle>

      <Toggle
        label={t('guide.style.badge')}
        on={style.badge}
        onToggle={() => {
          onChange({ ...style, badge: !style.badge })
          commit()
        }}
      >
        <Segmented
          label={t('guide.style.badge')}
          value={style.badgeStyle}
          options={BADGE_STYLES.map((value) => ({ value, label: BADGE_LABELS[value] }))}
          onChange={(badgeStyle) => {
            set('badgeStyle', badgeStyle)
            commit()
          }}
        />
        <div className="w-20">
          <NumberField
            label={t('guide.style.size')}
            value={style.badgeSize}
            min={STYLE_LIMITS.badgeSize.min}
            max={STYLE_LIMITS.badgeSize.max}
            onChange={(badgeSize) => {
              set('badgeSize', badgeSize)
            }}
            onCommit={commit}
          />
        </div>
      </Toggle>

      <Toggle
        label={t('guide.style.caption')}
        on={style.caption}
        onToggle={() => {
          onChange({ ...style, caption: !style.caption })
          commit()
        }}
      >
        <div className="w-20">
          <NumberField
            label={t('guide.style.size')}
            value={style.captionSize}
            min={STYLE_LIMITS.captionSize.min}
            max={STYLE_LIMITS.captionSize.max}
            onChange={(captionSize) => {
              set('captionSize', captionSize)
            }}
            onCommit={commit}
          />
        </div>
        <div className="min-w-44">
          <ColorInput
            label={t('guide.style.captionColor')}
            value={style.captionColor}
            onChange={(captionColor) => {
              set('captionColor', captionColor)
            }}
            onCommit={commit}
          />
        </div>
      </Toggle>

      {busy ? (
        <span className="ml-auto self-center text-xs text-text-muted">
          {t('guide.style.applying')}
        </span>
      ) : null}
    </section>
  )
}

/** A disabled annotation hides its settings instead of graying them out. */
function Toggle({
  label,
  on,
  onToggle,
  children,
}: {
  label: string
  on: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="flex items-center gap-1.5 font-mono text-[10px] tracking-[0.08em] text-text-muted uppercase">
        <input type="checkbox" checked={on} onChange={onToggle} />
        {label}
      </label>
      {on ? <div className="flex items-center gap-2">{children}</div> : null}
    </div>
  )
}
