import type { ComponentType } from 'react'

import { useT } from '@/core/ui/app-context'
import { Divider, ToolButton } from '@/core/ui/components'
import {
  IconArrow,
  IconBadge,
  IconBlur,
  IconCallout,
  IconCrop,
  IconCursor,
  IconEllipse,
  IconHighlighter,
  IconEraser,
  type IconProps,
  IconPen,
  IconRect,
  IconSpotlight,
  IconText,
} from '@/core/ui/icons'

import { type Tool, TOOLS } from '../tools'

const ICONS: Record<Tool, ComponentType<IconProps>> = {
  select: IconCursor,
  text: IconText,
  arrow: IconArrow,
  rect: IconRect,
  ellipse: IconEllipse,
  callout: IconCallout,
  badge: IconBadge,
  spotlight: IconSpotlight,
  blur: IconBlur,
  pen: IconPen,
  eraser: IconEraser,
  highlighter: IconHighlighter,
  crop: IconCrop,
}

/**
 * Left tool rail. Dividers group by purpose:
 * pointer · shapes and labels · markup · drawing · crop.
 */
const BREAK_AFTER: readonly Tool[] = ['select', 'callout', 'spotlight', 'highlighter']

export function ToolRail({ tool, onPick }: { tool: Tool; onPick: (tool: Tool) => void }) {
  const t = useT()

  return (
    <div className="flex w-[58px] shrink-0 flex-col items-center gap-[3px] border-r border-border bg-raised py-2.5">
      {TOOLS.map((spec) => {
        const Glyph = ICONS[spec.tool]
        return (
          <div key={spec.tool} className="contents">
            <ToolButton
              active={spec.tool === tool}
              title={`${t(`editor.tool.${spec.tool}`)} · ${spec.key.toUpperCase()}`}
              aria-label={t(`editor.tool.${spec.tool}`)}
              aria-pressed={spec.tool === tool}
              onClick={() => {
                onPick(spec.tool)
              }}
            >
              <Glyph />
            </ToolButton>
            {BREAK_AFTER.includes(spec.tool) ? <Divider /> : null}
          </div>
        )
      })}
    </div>
  )
}
