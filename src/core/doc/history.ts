/**
 * History is a stack of whole-document snapshots, not commands: undo/redo works
 * the same for drawing and for a background change (PLAN.md §8). Snapshots are
 * cheap because `Doc` holds no pixels — only a reference to the capture in IndexedDB.
 */
export type History<T> = {
  past: T[]
  present: T
  future: T[]
  limit: number
}

export const DEFAULT_HISTORY_LIMIT = 100

export function createHistory<T>(present: T, limit = DEFAULT_HISTORY_LIMIT): History<T> {
  return { past: [], present, future: [], limit }
}

export function pushHistory<T>(history: History<T>, next: T): History<T> {
  if (Object.is(next, history.present)) return history
  const past = [...history.past, history.present]
  return {
    ...history,
    past: past.length > history.limit ? past.slice(past.length - history.limit) : past,
    present: next,
    future: [],
  }
}

/**
 * Replace the current snapshot without recording history: for continuous
 * gestures — dragging a layer or moving a slider writes one step, not a hundred.
 */
export function replaceHistory<T>(history: History<T>, next: T): History<T> {
  return { ...history, present: next }
}

export function canUndo<T>(history: History<T>): boolean {
  return history.past.length > 0
}

export function canRedo<T>(history: History<T>): boolean {
  return history.future.length > 0
}

export function undo<T>(history: History<T>): History<T> {
  const previous = history.past.at(-1)
  if (previous === undefined) return history
  return {
    ...history,
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  }
}

export function redo<T>(history: History<T>): History<T> {
  const [next, ...rest] = history.future
  if (next === undefined) return history
  return {
    ...history,
    past: [...history.past, history.present],
    present: next,
    future: rest,
  }
}
