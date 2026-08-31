import type { ButtonHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'

import { cn } from './cn'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
}

/**
 * Button per the design: outlined muted text for secondary actions, solid accent for
 * the primary one. Heights 30 and 32 come from the mockup, not round numbers.
 */
export function Button({ variant = 'secondary', size = 'md', className, ...props }: ButtonProps) {
  return (
    <button
      {...props}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-control font-medium transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-45',
        size === 'sm' ? 'h-[30px] px-2.5 text-xs' : 'h-8 px-[11px] text-[12.5px]',
        variant === 'primary' && 'bg-accent font-semibold text-accent-fg hover:bg-accent-hover',
        variant === 'secondary' &&
          'border border-border text-text-soft hover:border-border-strong hover:text-text',
        variant === 'ghost' && 'text-text-muted hover:bg-surface-muted hover:text-text',
        variant === 'danger' && 'border border-border text-danger hover:bg-danger/10',
        className,
      )}
    />
  )
}

/** Square toolbar button. */
export function ToolButton({
  active,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      {...props}
      className={cn(
        'grid h-10 w-10 place-items-center rounded-tool text-[15px] transition-colors',
        active
          ? 'bg-accent text-accent-fg'
          : 'text-text-soft hover:bg-surface-muted hover:text-text',
        className,
      )}
    />
  )
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('rounded-panel border border-border bg-surface shadow-panel', className)}>
      {children}
    </div>
  )
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-text-soft">{label}</span>
      {children}
      {hint ? <span className="text-[11px] leading-relaxed text-text-muted">{hint}</span> : null}
    </label>
  )
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cn(
        'h-8 rounded-control border border-border bg-surface-muted px-2 text-xs text-text',
        'hover:border-border-strong disabled:opacity-45',
        className,
      )}
    />
  )
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <label className={cn('flex items-center gap-2.5', disabled ? '' : 'cursor-pointer')}>
      {/*
       * Toggle per the design: a checkbox here would read as "pick from a list", but
       * this is a state switch. The input stays in place and stays a `switch` — only
       * its look is hidden, so keyboard and screen readers work as before.
       */}
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.target.checked)
        }}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className={cn(
          'relative h-[18px] w-8 shrink-0 rounded-full transition-colors',
          'after:absolute after:top-[3px] after:left-[3px] after:h-3 after:w-3 after:rounded-full',
          'after:bg-white after:transition-transform after:content-[""]',
          checked ? 'bg-accent after:translate-x-3.5' : 'bg-border-strong',
          disabled ? 'opacity-45' : '',
          'peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent',
        )}
      />
      <span className={cn('text-xs text-text-soft', disabled && 'opacity-45')}>{label}</span>
    </label>
  )
}

export function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-md border border-border bg-surface-muted px-1.5 py-0.5 font-mono text-[10px] text-text-muted">
      {children}
    </span>
  )
}

/** Hotkey label: a monospace chip with a muted background, per the design. */
export function Hotkey({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-[5px] bg-surface-muted px-1.5 py-0.5 font-mono text-[10px] text-text-muted">
      {children}
    </span>
  )
}

export function Divider({ vertical }: { vertical?: boolean }) {
  return vertical ? (
    <span className="h-[22px] w-px shrink-0 bg-border" />
  ) : (
    <span className="my-1.5 h-px w-7 bg-border" />
  )
}
