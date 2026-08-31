import { describe, expect, it } from 'vitest'

import { hotkeyFor, type KeyContext, type KeyEvent } from './hotkeys'

const press = (key: string, modifiers: Partial<KeyEvent> = {}): KeyEvent => ({
  key,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...modifiers,
})

const context = (patch: Partial<KeyContext> = {}): KeyContext => ({
  inField: false,
  cropping: false,
  hasSelection: false,
  ...patch,
})

describe('hotkeyFor', () => {
  it('opens the palette on Ctrl+K', () => {
    expect(hotkeyFor(press('k', { ctrlKey: true }), context())).toEqual({
      kind: 'command',
      command: 'palette',
    })
  })

  it('takes Cmd as Ctrl', () => {
    expect(hotkeyFor(press('s', { metaKey: true }), context())).toEqual({
      kind: 'command',
      command: 'save',
    })
  })

  // Ctrl+Z and Ctrl+Shift+Z are one key with two meanings.
  it('undoes, and redoes with Shift', () => {
    expect(hotkeyFor(press('z', { ctrlKey: true }), context())).toEqual({
      kind: 'command',
      command: 'undo',
    })
    expect(hotkeyFor(press('z', { ctrlKey: true, shiftKey: true }), context())).toEqual({
      kind: 'command',
      command: 'redo',
    })
  })

  it('leaves text editing to the field', () => {
    expect(hotkeyFor(press('c', { ctrlKey: true }), context({ inField: true }))).toBeNull()
    expect(hotkeyFor(press('v', { ctrlKey: true }), context({ inField: true }))).toBeNull()
    expect(hotkeyFor(press('t'), context({ inField: true }))).toBeNull()
  })

  // Save is not intercepted by input fields: Ctrl+S in a field is still about the document.
  it('still saves from inside a field', () => {
    expect(hotkeyFor(press('s', { ctrlKey: true }), context({ inField: true }))).toEqual({
      kind: 'command',
      command: 'save',
    })
  })

  it('duplicates only when there is something to duplicate', () => {
    expect(hotkeyFor(press('d', { ctrlKey: true }), context())).toBeNull()
    expect(hotkeyFor(press('d', { ctrlKey: true }), context({ hasSelection: true }))).toEqual({
      kind: 'command',
      command: 'duplicate',
    })
  })

  it('picks a tool by its letter', () => {
    expect(hotkeyFor(press('a'), context())).toEqual({ kind: 'tool', tool: 'arrow' })
    expect(hotkeyFor(press('X'), context())).toEqual({ kind: 'tool', tool: 'eraser' })
  })

  it('means nothing for a letter no tool claims', () => {
    expect(hotkeyFor(press('q'), context())).toBeNull()
  })

  it('applies the crop on Enter, but only while cropping', () => {
    expect(hotkeyFor(press('Enter'), context())).toBeNull()
    expect(hotkeyFor(press('Enter'), context({ cropping: true }))).toEqual({ kind: 'applyCrop' })
  })

  it('deletes the selected object', () => {
    expect(hotkeyFor(press('Delete'), context({ hasSelection: true }))).toEqual({ kind: 'delete' })
    expect(hotkeyFor(press('Backspace'), context({ hasSelection: true }))).toEqual({
      kind: 'delete',
    })
    expect(hotkeyFor(press('Delete'), context())).toBeNull()
  })

  it('nudges by one, and by ten with Shift', () => {
    expect(hotkeyFor(press('ArrowRight'), context({ hasSelection: true }))).toEqual({
      kind: 'nudge',
      delta: { x: 1, y: 0 },
    })
    expect(
      hotkeyFor(press('ArrowUp', { shiftKey: true }), context({ hasSelection: true })),
    ).toEqual({ kind: 'nudge', delta: { x: 0, y: -10 } })
  })

  it('has nothing to nudge without a selection', () => {
    expect(hotkeyFor(press('ArrowRight'), context())).toBeNull()
  })

  it('escapes from anywhere on the canvas', () => {
    expect(hotkeyFor(press('Escape'), context({ cropping: true }))).toEqual({ kind: 'escape' })
  })

  it('ignores Alt combinations: they belong to the browser', () => {
    expect(hotkeyFor(press('a', { altKey: true }), context())).toBeNull()
  })

  it('raises and lowers the selected layer with the brackets', () => {
    expect(hotkeyFor(press(']', { ctrlKey: true }), context({ hasSelection: true }))).toEqual({
      kind: 'command',
      command: 'raise',
    })
    expect(hotkeyFor(press('[', { ctrlKey: true }), context({ hasSelection: true }))).toEqual({
      kind: 'command',
      command: 'lower',
    })
  })

  it('has nothing to raise without a selection', () => {
    expect(hotkeyFor(press(']', { ctrlKey: true }), context())).toBeNull()
  })
})
