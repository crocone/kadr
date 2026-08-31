import { describe, expect, it } from 'vitest'

import { canRedo, canUndo, createHistory, pushHistory, redo, replaceHistory, undo } from './history'

describe('history', () => {
  it('starts empty and cannot undo or redo', () => {
    const history = createHistory('a')
    expect(canUndo(history)).toBe(false)
    expect(canRedo(history)).toBe(false)
  })

  it('walks back and forth through snapshots', () => {
    let history = pushHistory(pushHistory(createHistory('a'), 'b'), 'c')
    expect(history.present).toBe('c')

    history = undo(history)
    expect(history.present).toBe('b')
    history = undo(history)
    expect(history.present).toBe('a')
    expect(canUndo(history)).toBe(false)

    history = redo(history)
    expect(history.present).toBe('b')
    expect(canRedo(history)).toBe(true)
  })

  it('drops the redo branch once a new snapshot lands', () => {
    const history = redo(pushHistory(undo(pushHistory(createHistory('a'), 'b')), 'c'))
    expect(history.present).toBe('c')
    expect(history.future).toEqual([])
  })

  it('ignores a snapshot identical to the current one', () => {
    const history = createHistory('a')
    expect(pushHistory(history, 'a')).toBe(history)
  })

  it('replaces the present without growing the stack, for continuous gestures', () => {
    const history = replaceHistory(pushHistory(createHistory('a'), 'b'), 'b2')
    expect(history.present).toBe('b2')
    expect(history.past).toEqual(['a'])
  })

  it('trims the oldest snapshots past the limit', () => {
    let history = createHistory(0, 3)
    for (let i = 1; i <= 6; i++) history = pushHistory(history, i)
    expect(history.past).toEqual([3, 4, 5])
    expect(history.present).toBe(6)
  })
})
