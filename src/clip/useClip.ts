/**
 * Loading a clip, keeping its edits saved, and remembering what they were before.
 *
 * The record and the bytes live apart — IndexedDB holds the numbers, OPFS holds the
 * video — so opening a clip is two loads, and either can come back empty: storage
 * cleared, a profile moved, a file deleted by hand. A missing file is reported rather
 * than papered over, because a player showing nothing with no explanation is the worst
 * of the possible answers.
 *
 * History is the screenshot editor's, unchanged: a stack of whole snapshots rather than
 * commands, so undo works the same for a dragged trim handle and for a background. It
 * costs nothing to store because a `Clip` holds no pixels either — a file name and some
 * numbers.
 *
 * A continuous gesture is one undo step. The first change of a drag pushes the previous
 * state onto the stack and the rest amend the top of it; the gesture closes on pointer
 * release. Doing it the other way round — overwrite now, push a step at the end — loses
 * the pre-gesture state, which is the one thing undo is for.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

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
import { newImageId } from '@/core/doc'
import { defaultEdit } from '@/core/record/defaults'
import { clipFile } from '@/core/record/opfs'
import { probeVideo } from '@/core/record/probe'
import type { Clip, ClipEdit, ClipId } from '@/core/record/types'
import { getClip, putClip, putImage } from '@/core/storage/db'

const SAVE_DELAY_MS = 400

export type ClipState = {
  clip: Clip | null
  /** The recorded file itself: the exporter demuxes it, the sound lane reads its peaks. */
  file: File | null
  /** Object URL of the recorded file; `null` while loading or when it is gone. */
  url: string | null
  loaded: boolean
  missing: boolean
}

export type ClipController = ClipState & {
  /** Edit within a gesture. The first call opens a history step, later calls amend it. */
  update: (edit: ClipEdit) => void
  patch: (change: Partial<Clip>) => void
  /** Closes the gesture, so the next change starts a new undo step. */
  commit: () => void
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
}

export function clipIdFromUrl(): ClipId | null {
  return new URLSearchParams(location.search).get('clip')
}

/**
 * A record that says 0×0 and 0:00 over a real file: the probe after recording failed —
 * a document nobody can see is not always allowed to decode video — and the numbers
 * never made it in. This editor is the first visible document to hold the file, so it
 * asks again and repairs the record; the debounced save below writes it back.
 */
async function repairClip(clip: Clip, file: File): Promise<Clip> {
  if (clip.duration > 0 && clip.width > 0 && clip.height > 0) return clip

  const probed = await probeVideo(file).catch(() => null)
  if (!probed || probed.duration <= 0) return clip

  let poster = clip.poster
  if (poster === null && probed.poster) {
    try {
      const blob = await (await fetch(probed.poster)).blob()
      poster = newImageId()
      await putImage({
        id: poster,
        blob,
        width: 0,
        height: 0,
        dpr: 1,
        createdAt: Date.now(),
        source: null,
      })
    } catch {
      poster = null
    }
  }

  return {
    ...clip,
    duration: probed.duration,
    width: probed.width || clip.width,
    height: probed.height || clip.height,
    poster,
    // A zero-length keep window is the broken duration written into the edit; a trim
    // someone actually made against a real duration is left alone.
    edit: clip.duration <= 0 ? defaultEdit(probed.duration) : clip.edit,
    updatedAt: Date.now(),
  }
}

export function useClip(id: ClipId | null): ClipController {
  const [history, setHistory] = useState<History<Clip> | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [missing, setMissing] = useState(false)
  const inGesture = useRef(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clip = history?.present ?? null

  useEffect(() => {
    let objectUrl: string | null = null

    void (async () => {
      const found = id ? await getClip(id) : undefined
      if (!found) {
        setMissing(true)
        setLoaded(true)
        return
      }

      const file = await clipFile(found.file)
      if (file) {
        setHistory(createHistory<Clip>(await repairClip(found, file)))
        objectUrl = URL.createObjectURL(file)
        setFile(file)
        setUrl(objectUrl)
      } else {
        setHistory(createHistory<Clip>(found))
        setMissing(true)
      }
      setLoaded(true)
    })()

    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [id])

  const patch = useCallback((change: Partial<Clip>) => {
    // The decision is taken here rather than inside the updater: React runs updaters on
    // flush, and by then the ref would already read "gesture in progress" for the very
    // first change of the drag — which is the one that has to open the step.
    const startsGesture = !inGesture.current
    inGesture.current = true

    setHistory((current) => {
      if (!current) return current
      const next = { ...current.present, ...change, updatedAt: Date.now() }
      return startsGesture ? pushHistory(current, next) : replaceHistory(current, next)
    })
  }, [])

  const update = useCallback(
    (edit: ClipEdit) => {
      patch({ edit })
    },
    [patch],
  )

  const commit = useCallback(() => {
    inGesture.current = false
  }, [])

  const undo = useCallback(() => {
    inGesture.current = false
    setHistory((current) => (current ? undoOf(current) : current))
  }, [])

  const redo = useCallback(() => {
    inGesture.current = false
    setHistory((current) => (current ? redoOf(current) : current))
  }, [])

  // Debounced save: every pixel of a dragged handle is a state change, and writing each
  // one would put a hundred transactions inside a single gesture.
  useEffect(() => {
    if (!clip) return

    const timer = setTimeout(() => {
      void putClip(clip)
    }, SAVE_DELAY_MS)
    saveTimer.current = timer

    return () => {
      clearTimeout(timer)
    }
  }, [clip])

  // A pending save must not be lost to a closing tab: the debounce is short, but a trim
  // adjusted and immediately closed is exactly the case it would lose.
  useEffect(() => {
    const flush = () => {
      if (saveTimer.current === null || !clip) return
      clearTimeout(saveTimer.current)
      saveTimer.current = null
      void putClip(clip)
    }
    window.addEventListener('pagehide', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
    }
  }, [clip])

  return {
    clip,
    file,
    url,
    loaded,
    missing,
    update,
    patch,
    commit,
    undo,
    redo,
    canUndo: history !== null && canUndoOf(history),
    canRedo: history !== null && canRedoOf(history),
  }
}
