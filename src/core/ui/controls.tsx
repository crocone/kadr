import type { ReactNode } from 'react'

import { cn } from './cn'
import { eyedropperAvailable, pickColorFromScreen } from './eyedropper'
import { IconEyedropper, IconPlus } from './icons'

/**
 * Slider for continuous values.
 *
 * `onInput` fires on every move, `onCommit` on release. That way the whole gesture
 * lands in history as one step, not a hundred (see useDocument).
 */
export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  onInput,
  onCommit,
  format,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  unit?: string
  onInput: (value: number) => void
  onCommit: () => void
  format?: (value: number) => string
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-baseline justify-between">
        <span className="text-[11px] text-text-muted">{label}</span>
        <span className="font-mono text-[10px] tabular-nums text-text-soft">
          {format ? format(value) : `${Math.round(value)}${unit ?? ''}`}
        </span>
      </span>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => {
          onInput(Number(event.target.value))
        }}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
        className="h-4 w-full accent-accent"
      />
    </label>
  )
}

/** Color: exact-hex field, system picker, and screen eyedropper. */
export function ColorInput({
  label,
  value,
  screenLabel,
  onChange,
  onCommit,
}: {
  label: string
  value: string
  /** Eyedropper label. Without it there's no button: a silent icon is worse than none. */
  screenLabel?: string
  onChange: (value: string) => void
  onCommit: () => void
}) {
  return (
    <label className="flex items-center justify-between gap-2">
      <span className="text-[11px] text-text-muted">{label}</span>
      <span className="flex items-center gap-1.5">
        <input
          type="text"
          value={value}
          spellCheck={false}
          onChange={(event) => {
            onChange(event.target.value)
          }}
          onBlur={onCommit}
          className="h-7 w-[76px] rounded-md border border-border bg-surface-muted px-1.5 font-mono text-[10px] text-text"
        />
        <input
          type="color"
          value={normalizeHex(value)}
          onChange={(event) => {
            onChange(event.target.value)
          }}
          onBlur={onCommit}
          className="h-7 w-7 cursor-pointer rounded-md border border-border bg-surface-muted p-0.5"
        />
        {screenLabel && eyedropperAvailable() ? (
          <button
            type="button"
            title={screenLabel}
            onClick={() => {
              void pickColorFromScreen().then((color) => {
                if (!color) return
                onChange(color)
                onCommit()
              })
            }}
            className="grid h-7 w-7 place-items-center rounded-md border border-border text-text-muted transition-colors hover:border-border-strong hover:text-text"
          >
            <IconEyedropper size={13} />
          </button>
        ) : null}
      </span>
    </label>
  )
}

export type SegmentedOption<T extends string> = {
  value: T
  label: string
  title?: string
  /** Visible but unavailable: e.g. a density the canvas can't handle. */
  disabled?: boolean
}

/**
 * Multi-value segmented switch.
 *
 * `size="lg"` and `tone="accent"` match the export panel design: large cells, the
 * chosen format filled with accent. Sidebar switches stay small and muted — there are
 * a dozen in a row there, and an accent on each would turn into noise.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = 'sm',
  tone = 'muted',
  label,
}: {
  options: readonly SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  size?: 'sm' | 'lg'
  tone?: 'muted' | 'accent'
  /** Group name for screen readers: an unlabeled switch has none. */
  label?: string
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn(
        'flex rounded-control bg-surface-muted',
        size === 'lg' ? 'gap-1 border border-border p-1' : 'gap-0.5 p-0.5',
      )}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={option.value === value}
          disabled={option.disabled}
          title={option.title ?? option.label}
          onClick={() => {
            onChange(option.value)
          }}
          className={cn(
            'flex-1 truncate rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-35',
            size === 'lg' ? 'px-2 py-2.5 text-[13px]' : 'px-1.5 py-1 text-[11px]',
            option.value === value
              ? tone === 'accent'
                ? 'bg-accent font-semibold text-accent-fg'
                : // A large cell sits in a muted trough, and `raised` is indistinguishable
                  // from it in the dark theme: the selection is lit one shade lighter.
                  cn('font-medium text-text shadow-sm', size === 'lg' ? 'bg-border' : 'bg-raised')
              : 'text-text-muted enabled:hover:text-text',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function NumberField({
  label,
  value,
  min,
  max,
  onChange,
  onCommit,
}: {
  label: string
  value: number
  min?: number
  max?: number
  onChange: (value: number) => void
  onCommit: () => void
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-text-muted">{label}</span>
      <input
        type="number"
        value={Math.round(value)}
        min={min}
        max={max}
        onChange={(event) => {
          const next = Number(event.target.value)
          if (Number.isFinite(next)) onChange(next)
        }}
        onBlur={onCommit}
        className="h-8 w-full rounded-control border border-border bg-surface-muted px-2 font-mono text-[11px] text-text"
      />
    </label>
  )
}

/** Sidebar section: letter-spaced monospace heading. */
export function PanelSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <h2 className="font-mono text-[10px] tracking-[0.1em] text-text-muted uppercase">{title}</h2>
      {children}
    </section>
  )
}

/**
 * Collapsible right-panel group. Collapsed, it shows a summary — "Hard · 8px",
 * "1280 × 720 · PNG": the setting is visible without expanding, and the panel doesn't
 * become an endless column of sliders.
 */
export function PanelGroup({
  title,
  summary,
  open,
  onToggle,
  action,
  children,
}: {
  title: string
  summary?: ReactNode
  open: boolean
  onToggle: () => void
  /** Header action: "reset", "+", and the like. */
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="border-b border-border last:border-b-0">
      <div className="flex items-center gap-2 px-3.5 py-2.5">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span
            className={cn(
              'text-[10px] text-text-muted transition-transform',
              open ? 'rotate-0' : '-rotate-90',
            )}
          >
            ▾
          </span>
          <span className="text-[13px] font-semibold">{title}</span>
          {!open && summary ? (
            <span className="ml-auto truncate font-mono text-[10px] text-text-muted">
              {summary}
            </span>
          ) : null}
        </button>
        {open && action ? action : null}
      </div>
      {open ? <div className="flex flex-col gap-2.5 px-3.5 pb-3.5">{children}</div> : null}
    </section>
  )
}

/** Row of color swatches: quick picks without the eyedropper. */
export function Swatches({
  colors,
  value,
  onPick,
}: {
  colors: readonly string[]
  value: string
  onPick: (color: string) => void
}) {
  return (
    <div className="flex items-center gap-1.5">
      {colors.map((color) => (
        <button
          key={color}
          type="button"
          title={color}
          onClick={() => {
            onPick(color)
          }}
          style={{ backgroundColor: color }}
          className={cn(
            'h-6 w-6 rounded-md border transition-transform hover:scale-110',
            color.toLowerCase() === value.toLowerCase()
              ? 'border-accent ring-2 ring-accent/40'
              : 'border-border',
          )}
        />
      ))}
    </div>
  )
}

/** Row of toggle chips: size presets, platforms. */
export function Chip({
  active,
  children,
  ...props
}: {
  active: boolean
  children: ReactNode
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      type="button"
      className={cn(
        'rounded-md border px-2 py-1 text-[11px] transition-colors',
        active
          ? 'border-accent bg-accent text-accent-fg'
          : 'border-border bg-surface-muted text-text-muted hover:border-border-strong hover:text-text',
      )}
    >
      {children}
    </button>
  )
}

/**
 * Color choice: preset swatches, custom color, and screen eyedropper.
 *
 * Swatches come first because nine times out of ten they're what gets picked; the
 * system picker and eyedropper sit right next to them instead of a separate panel
 * you'd have to visit for a color.
 */
export function ColorChoice({
  colors,
  value,
  labels,
  onPick,
}: {
  colors: readonly string[]
  value: string
  labels: { custom: string; screen: string }
  onPick: (color: string) => void
}) {
  // Eyedropper availability doesn't change during the page's lifetime, so this is a
  // plain check, not state: caching the immutable is just another way to drift.
  const screenPicker = eyedropperAvailable()

  return (
    <span className="flex items-center gap-1.5">
      <Swatches colors={colors} value={value} onPick={onPick} />

      <label
        title={labels.custom}
        className="relative grid h-6 w-6 cursor-pointer place-items-center overflow-hidden rounded-md border border-border"
        style={{ backgroundColor: value }}
      >
        <input
          type="color"
          value={normalizeHex(value)}
          onChange={(event) => {
            onPick(event.target.value)
          }}
          className="absolute inset-0 cursor-pointer opacity-0"
        />
        <IconPlus size={12} className="mix-blend-difference text-white" />
      </label>

      {screenPicker ? (
        <button
          type="button"
          title={labels.screen}
          onClick={() => {
            void pickColorFromScreen().then((color) => {
              if (color) onPick(color)
            })
          }}
          className="grid h-6 w-6 place-items-center rounded-md border border-border text-text-muted transition-colors hover:border-border-strong hover:text-text"
        >
          <IconEyedropper size={13} />
        </button>
      ) : null}
    </span>
  )
}

/** `input[type=color]` accepts only #rrggbb: anything else is silently replaced with black. */
function normalizeHex(value: string): string {
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(value)
  if (short) return `#${short[1]!}${short[1]!}${short[2]!}${short[2]!}${short[3]!}${short[3]!}`

  return /^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'
}
