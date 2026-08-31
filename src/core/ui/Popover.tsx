/**
 * Popover panel anchored to its button.
 *
 * Button and panel share one wrapper and the panel is positioned absolutely inside it.
 * A portal and coordinate math would be overkill: the popover hangs under a top-bar
 * button, and with a portal we'd have to chase scroll and resize by hand.
 *
 * Closes on Escape and on an outside press. "Outside" is measured from the whole
 * wrapper, not just the panel: otherwise pressing the trigger button would first close
 * the panel via the outside handler and then reopen it via `onClick`, making it
 * impossible to close the popover with its own button. We listen for `pointerdown`,
 * not `click` — the panel should leave immediately.
 */
import { type ReactNode, useEffect, useRef } from 'react'

import { cn } from './cn'

export function Popover({
  open,
  onClose,
  label,
  trigger,
  align = 'end',
  className,
  children,
}: {
  open: boolean
  onClose: () => void
  /** Panel name for screen readers: an unnamed dialog has none at all. */
  label: string
  /** Button the panel hangs from. It controls opening and closing. */
  trigger: ReactNode
  /** Which edge of the button the panel is flush with. */
  align?: 'start' | 'end'
  className?: string
  children: ReactNode
}) {
  const anchorRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // Otherwise Escape travels on to the editor and also clears the canvas selection.
      event.stopPropagation()
      onClose()
    }

    const onPointerDown = (event: PointerEvent) => {
      const anchor = anchorRef.current
      if (!anchor || anchor.contains(event.target as Node)) return
      onClose()
    }

    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [open, onClose])

  return (
    <div ref={anchorRef} className="relative">
      {trigger}
      {open ? (
        <div
          role="dialog"
          aria-label={label}
          className={cn(
            'absolute top-[calc(100%+8px)] z-30 rounded-panel border border-border bg-surface shadow-float',
            align === 'end' ? 'right-0' : 'left-0',
            className,
          )}
        >
          {children}
        </div>
      ) : null}
    </div>
  )
}
