// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { createDoc } from '@/core/doc/create'
import type { Doc } from '@/core/doc/types'
import type { StoredDoc } from '@/core/storage/db'

import { useDocument } from './useDocument'

function stored(): StoredDoc {
  const doc = createDoc({ imageId: 'img_1', imageWidth: 800, imageHeight: 600 })
  return { ...doc, domain: 'example.com', text: null, thumbnail: null }
}

const setPadding =
  (value: number) =>
  (doc: Doc): Doc => ({ ...doc, canvas: { ...doc.canvas, padding: value } })

describe('useDocument', () => {
  it('starts with nothing to undo', () => {
    const { result } = renderHook(() => useDocument(stored()))

    expect(result.current.canUndo).toBe(false)
    expect(result.current.canRedo).toBe(false)
  })

  it('makes a single edit undoable', () => {
    const { result } = renderHook(() => useDocument(stored()))
    const before = result.current.doc.canvas.padding

    act(() => {
      result.current.commit(setPadding(200))
    })
    expect(result.current.doc.canvas.padding).toBe(200)

    act(() => {
      result.current.undo()
    })
    expect(result.current.doc.canvas.padding).toBe(before)
  })

  /**
   * The key property: dragging a slider is one history step, not a hundred, and it
   * undoes as a whole, back to the pre-gesture state.
   */
  it('collapses a whole gesture into one history step', () => {
    const { result } = renderHook(() => useDocument(stored()))
    const before = result.current.doc.canvas.padding

    act(() => {
      for (const value of [70, 90, 120, 180]) result.current.edit(setPadding(value))
      result.current.commit()
    })
    expect(result.current.doc.canvas.padding).toBe(180)

    act(() => {
      result.current.undo()
    })
    expect(result.current.doc.canvas.padding).toBe(before)
    expect(result.current.canUndo).toBe(false)
  })

  it('keeps two gestures as two separate steps', () => {
    const { result } = renderHook(() => useDocument(stored()))

    act(() => {
      result.current.edit(setPadding(100))
      result.current.commit()
    })
    act(() => {
      result.current.edit(setPadding(200))
      result.current.commit()
    })

    act(() => {
      result.current.undo()
    })
    expect(result.current.doc.canvas.padding).toBe(100)

    act(() => {
      result.current.undo()
    })
    expect(result.current.doc.canvas.padding).toBe(64)
  })

  it('redoes what was undone, and forgets it after a new edit', () => {
    const { result } = renderHook(() => useDocument(stored()))

    act(() => {
      result.current.commit(setPadding(150))
    })
    act(() => {
      result.current.undo()
    })
    expect(result.current.canRedo).toBe(true)

    act(() => {
      result.current.redo()
    })
    expect(result.current.doc.canvas.padding).toBe(150)

    act(() => {
      result.current.undo()
      result.current.commit(setPadding(42))
    })
    expect(result.current.canRedo).toBe(false)
  })

  it('undoes on Ctrl+Z and redoes on Ctrl+Y', () => {
    const { result } = renderHook(() => useDocument(stored()))

    act(() => {
      result.current.commit(setPadding(150))
    })

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }))
    })
    expect(result.current.doc.canvas.padding).toBe(64)

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ctrlKey: true }))
    })
    expect(result.current.doc.canvas.padding).toBe(150)
  })

  it('treats an edit after an undo as the start of a fresh gesture', () => {
    const { result } = renderHook(() => useDocument(stored()))

    act(() => {
      result.current.edit(setPadding(100))
      result.current.commit()
    })
    act(() => {
      result.current.undo()
    })
    act(() => {
      result.current.edit(setPadding(220))
      result.current.commit()
    })

    act(() => {
      result.current.undo()
    })
    expect(result.current.doc.canvas.padding).toBe(64)
  })
})
