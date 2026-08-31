import type { BadgeStyle } from '@/core/doc/types'
import { type ScribeStyle, STYLE_LIMITS } from '@/core/scribe/style'
import { useT } from '@/core/ui/app-context'
import { ColorInput, NumberField, Segmented } from '@/core/ui/controls'

const BADGE_STYLES: readonly BadgeStyle[] = ['number', 'roman', 'bullet']

const BADGE_LABELS: Record<BadgeStyle, string> = {
  number: '1',
  roman: 'I',
  bullet: '•',
}

/**
 * Guide annotation styling. Lives on the guide rather than in global settings: an
 * internal guide and a customer-facing one are styled differently.
 *
 * Laid out as equal columns, each a vertical stack. Mixing controls that label to the
 * left with controls that label above in one flex row makes every baseline disagree.
 */
export function StylePanel({
  style,
  onChange,
  onCommit,
  busy,
}: {
  style: ScribeStyle
  /** Live update while a control is being dragged. */
  onChange: (style: ScribeStyle) => void
  /** End of gesture: only here are the steps redrawn. */
  onCommit: () => void
  busy: boolean
}) {
  const t = useT()
  const set = <K extends keyof ScribeStyle>(key: K, value: ScribeStyle[K]) => {
    onChange({ ...style, [key]: value })
  }
  const toggle = (key: 'outline' | 'badge' | 'caption') => {
    onChange({ ...style, [key]: !style[key] })
    onCommit()
  }

  return (
    <section className="flex flex-col gap-3 rounded-panel border border-border bg-surface p-3">
      <header className="flex items-center gap-2">
        <h2 className="font-mono text-[10px] tracking-[0.1em] text-text-muted uppercase">
          {t('guide.style')}
        </h2>
        {busy ? (
          <span className="text-[11px] text-text-muted">{t('guide.style.applying')}</span>
        ) : null}
      </header>

      <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
        <Column title={t('guide.style.accent')}>
          <ColorInput
            label={t('guide.style.accent')}
            value={style.accent}
            onChange={(accent) => {
              set('accent', accent)
            }}
            onCommit={onCommit}
          />
        </Column>

        <Column
          title={t('guide.style.outline')}
          on={style.outline}
          onToggle={() => {
            toggle('outline')
          }}
        >
          <NumberField
            label={t('guide.style.width')}
            value={style.outlineWidth}
            min={STYLE_LIMITS.outlineWidth.min}
            max={STYLE_LIMITS.outlineWidth.max}
            onChange={(outlineWidth) => {
              set('outlineWidth', outlineWidth)
            }}
            onCommit={onCommit}
          />
        </Column>

        <Column
          title={t('guide.style.badge')}
          on={style.badge}
          onToggle={() => {
            toggle('badge')
          }}
        >
          <Segmented
            label={t('guide.style.badge')}
            value={style.badgeStyle}
            options={BADGE_STYLES.map((value) => ({ value, label: BADGE_LABELS[value] }))}
            onChange={(badgeStyle) => {
              set('badgeStyle', badgeStyle)
              onCommit()
            }}
          />
          <NumberField
            label={t('guide.style.size')}
            value={style.badgeSize}
            min={STYLE_LIMITS.badgeSize.min}
            max={STYLE_LIMITS.badgeSize.max}
            onChange={(badgeSize) => {
              set('badgeSize', badgeSize)
            }}
            onCommit={onCommit}
          />
        </Column>

        <Column
          title={t('guide.style.caption')}
          on={style.caption}
          onToggle={() => {
            toggle('caption')
          }}
        >
          <NumberField
            label={t('guide.style.size')}
            value={style.captionSize}
            min={STYLE_LIMITS.captionSize.min}
            max={STYLE_LIMITS.captionSize.max}
            onChange={(captionSize) => {
              set('captionSize', captionSize)
            }}
            onCommit={onCommit}
          />
          <ColorInput
            label={t('guide.style.captionColor')}
            value={style.captionColor}
            onChange={(captionColor) => {
              set('captionColor', captionColor)
            }}
            onCommit={onCommit}
          />
        </Column>
      </div>
    </section>
  )
}

/**
 * One column: a title (a checkbox when the whole annotation can be switched off) and
 * its controls stacked under it. A switched-off annotation keeps its height so the row
 * does not jump when it is toggled.
 */
function Column({
  title,
  on,
  onToggle,
  children,
}: {
  title: string
  on?: boolean
  onToggle?: () => void
  children: React.ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {onToggle ? (
        <label className="flex items-center gap-1.5 text-[11px] text-text-soft">
          <input type="checkbox" checked={on} onChange={onToggle} className="accent-accent" />
          {title}
        </label>
      ) : (
        <span className="text-[11px] text-text-soft">{title}</span>
      )}

      <div className={cnStack(on)}>{children}</div>
    </div>
  )
}

function cnStack(on: boolean | undefined): string {
  const base = 'flex flex-col gap-2'
  return on === false ? `${base} pointer-events-none opacity-40` : base
}
