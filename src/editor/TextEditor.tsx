import { useEffect, useRef, useState } from 'react'

import type { TextLayer } from '@/core/doc/types'
import type { View } from '@/core/render/view'

/**
 * Text input right on the canvas.
 *
 * A `textarea` is laid over the scene, positioned and scaled by the same view: the
 * font, size, and color match, so typing happens exactly where the text will end up,
 * not in a side field.
 *
 * The edit goes into the document once, on finish: otherwise every letter would
 * become its own undo step.
 */
export function TextEditor({
  layer,
  view,
  onDone,
}: {
  layer: TextLayer
  view: View
  /** Empty text means "layer not needed" — the caller decides. */
  onDone: (text: string) => void
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const [value, setValue] = useState(layer.text)

  useEffect(() => {
    const field = ref.current
    if (!field) return
    field.focus()
    field.select()
  }, [])

  const done = () => {
    onDone(value)
  }

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(event) => {
        setValue(event.target.value)
      }}
      onBlur={done}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Escape') {
          event.preventDefault()
          done()
        }
        // Enter inserts a line break, Ctrl+Enter finishes: multi-line labels are the common case.
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault()
          done()
        }
      }}
      spellCheck={false}
      className="absolute z-10 resize-none overflow-hidden border-none bg-transparent p-0 outline-none"
      style={{
        left: view.x + layer.at.x * view.zoom,
        top: view.y + layer.at.y * view.zoom,
        // Font size scales with the view, not the field size: the line then matches
        // what Konva will draw at the same zoom.
        fontFamily: layer.fontFamily,
        fontSize: layer.fontSize * view.zoom,
        fontWeight: layer.fontWeight,
        lineHeight: 1.2,
        color: layer.color,
        textAlign: layer.align,
        caretColor: layer.color,
        // A set width matches the layer's; otherwise size by content, but never
        // narrower than a few letters: an empty field must stay visible.
        width: layer.width
          ? layer.width * view.zoom
          : Math.max(4, longestLine(value)) * layer.fontSize * view.zoom * 0.62,
        ...(layer.width ? { whiteSpace: 'pre-wrap' as const } : {}),
        height: (value.split('\n').length || 1) * layer.fontSize * view.zoom * 1.2,
      }}
    />
  )
}

function longestLine(text: string): number {
  return text.split('\n').reduce((longest, line) => Math.max(longest, line.length), 0)
}
