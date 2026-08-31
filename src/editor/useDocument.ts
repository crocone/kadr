/**
 * State of the document being edited.
 *
 * History is a stack of whole-`Doc` snapshots, not commands: undo/redo works the same
 * for drawing and for a shadow slider.
 *
 * A continuous gesture — a drag, a slider move — must become one undo step. So the
 * gesture's first `edit` pushes the pre-edit state into history, and later ones just
 * replace the current snapshot; `commit` closes the gesture. The reverse doesn't
 * work: if you overwrote the snapshot first and created the step at the end, the
 * pre-gesture state would already be lost with nothing left to undo.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  canRedo as canRedoOf,
  canUndo as canUndoOf,
  createHistory,
  type History,
  pushHistory,
  redo as redoOf,
  replaceHistory,
  undo as undoOf,
} from '@/core/doc/history'
import type { Doc } from '@/core/doc/types'
import { putDoc, type StoredDoc } from '@/core/storage/db'

const SAVE_DEBOUNCE_MS = 600

export type DocumentController = {
  doc: Doc
  /** Edit within a gesture. The first call opens a history step, later calls amend it. */
  edit: (recipe: (doc: Doc) => Doc) => void
  /** Closes the gesture. With a recipe — a one-off edit as its own step. */
  commit: (recipe?: (doc: Doc) => Doc) => void
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
  /** OCR text: the library searches by it; it has no place in edit history. */
  setText: (text: string) => void
  /**
   * Re-read a document changed from outside — currently done by reshoot. Without it,
   * the editor's autosave would half a second later overwrite the new capture with
   * the very old one the reshoot was meant to replace.
   */
  reload: (doc: StoredDoc) => void
}

/** Library metadata lives alongside the document and is untouched by edits. */
type DocMeta = Pick<StoredDoc, 'domain' | 'thumbnail'>

export function useDocument(initial: StoredDoc): DocumentController {
  const [history, setHistory] = useState<History<Doc>>(() => createHistory<Doc>(initial))
  const inGesture = useRef(false)
  const [text, setText] = useState<string | null>(initial.text)
  const meta = useRef<DocMeta>({
    domain: initial.domain,
    thumbnail: initial.thumbnail,
  })

  const doc = history.present

  const edit = useCallback((recipe: (doc: Doc) => Doc) => {
    // The decision happens here, not inside the updater: React runs updaters on
    // flush, and by then the ref would already say "gesture in progress" for every
    // edit in the batch — the first edit would not create a step, leaving nothing to undo.
    const startsGesture = !inGesture.current
    inGesture.current = true

    setHistory((current) => {
      const next = touch(recipe(current.present))
      return startsGesture ? pushHistory(current, next) : replaceHistory(current, next)
    })
  }, [])

  const commit = useCallback((recipe?: (doc: Doc) => Doc) => {
    if (recipe) {
      setHistory((current) => pushHistory(current, touch(recipe(current.present))))
    }
    inGesture.current = false
  }, [])

  /**
   * A reshoot is not an edit: there is nothing to undo, the capture comes from the
   * database, not from history. So history starts over instead of being appended.
   */
  const reload = useCallback((next: StoredDoc) => {
    inGesture.current = false
    meta.current = { domain: next.domain, thumbnail: next.thumbnail }
    setText(next.text)
    setHistory(createHistory<Doc>(next))
  }, [])

  const undo = useCallback(() => {
    inGesture.current = false
    setHistory(undoOf)
  }, [])

  const redo = useCallback(() => {
    inGesture.current = false
    setHistory(redoOf)
  }, [])

  // Debounced save: a slider move should not hit the database a hundred times.
  useEffect(() => {
    const timer = setTimeout(() => {
      void putDoc({ ...doc, ...meta.current, text })
    }, SAVE_DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
    }
  }, [doc, text])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      const key = event.key.toLowerCase()
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault()
        inGesture.current = false
        setHistory(undoOf)
      } else if (key === 'y' || (key === 'z' && event.shiftKey)) {
        event.preventDefault()
        inGesture.current = false
        setHistory(redoOf)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  return useMemo(
    () => ({
      doc,
      edit,
      commit,
      undo,
      redo,
      canUndo: canUndoOf(history),
      canRedo: canRedoOf(history),
      setText,
      reload,
    }),
    [doc, edit, commit, undo, redo, history, reload],
  )
}

function touch(doc: Doc): Doc {
  return { ...doc, updatedAt: Date.now() }
}
