/**
 * Keyboard parsing: what was pressed → what it means.
 *
 * A pure function, because "Ctrl+C in an input belongs to the input, but on the
 * canvas copies the image" is a rule, not an effect — it should be verified by a
 * test, not by clicking around the extension. Workspace performs the actions.
 */
import type { Point } from '@/core/doc/types'

import { type Tool, toolForKey } from './tools'

export type Command =
  'palette' | 'undo' | 'redo' | 'copy' | 'save' | 'paste' | 'duplicate' | 'raise' | 'lower'

export type Hotkey =
  | { kind: 'command'; command: Command }
  | { kind: 'tool'; tool: Tool }
  | { kind: 'nudge'; delta: Point }
  | { kind: 'escape' }
  | { kind: 'delete' }
  | { kind: 'applyCrop' }

export type KeyEvent = {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
}

export type KeyContext = {
  /** Focus is in an input field: almost everything belongs to the field. */
  inField: boolean
  /** Crop mode is active. */
  cropping: boolean
  /** Whether an object is selected — nothing to move or delete without one. */
  hasSelection: boolean
}

/** Arrow-key nudge step. With Shift — the big one, as in any editor. */
export const NUDGE_STEP = 1
export const NUDGE_STEP_FAST = 10

const DIRECTIONS: Record<string, Point | undefined> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
}

/** Shortcuts that inside an input field mean text editing, not canvas actions. */
const FIELD_KEYS = ['c', 'v', 'x', 'a', 'z', 'y']

const COMMANDS: Record<string, Command | undefined> = {
  k: 'palette',
  y: 'redo',
  c: 'copy',
  s: 'save',
  v: 'paste',
  d: 'duplicate',
  ']': 'raise',
  '[': 'lower',
}

/** Commands that require a selected object. */
const NEEDS_SELECTION: readonly Command[] = ['duplicate', 'raise', 'lower']

export function hotkeyFor(event: KeyEvent, context: KeyContext): Hotkey | null {
  const key = event.key.toLowerCase()

  if (event.ctrlKey || event.metaKey) {
    if (context.inField && FIELD_KEYS.includes(key)) return null

    // Ctrl+Z and Ctrl+Shift+Z are one key with two meanings, hence outside the table.
    if (key === 'z') return { kind: 'command', command: event.shiftKey ? 'redo' : 'undo' }

    const command = COMMANDS[key]
    if (!command) return null
    if (NEEDS_SELECTION.includes(command) && !context.hasSelection) return null

    return { kind: 'command', command }
  }

  if (context.inField || event.altKey) return null

  if (event.key === 'Escape') return { kind: 'escape' }
  if (event.key === 'Enter' && context.cropping) return { kind: 'applyCrop' }

  if ((event.key === 'Delete' || event.key === 'Backspace') && context.hasSelection) {
    return { kind: 'delete' }
  }

  const direction = DIRECTIONS[event.key]
  if (direction && context.hasSelection) {
    const step = event.shiftKey ? NUDGE_STEP_FAST : NUDGE_STEP
    return { kind: 'nudge', delta: { x: direction.x * step, y: direction.y * step } }
  }

  const tool = toolForKey(event.key)
  return tool ? { kind: 'tool', tool } : null
}
