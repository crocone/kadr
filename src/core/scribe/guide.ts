/**
 * The guide as a whole: session, its steps, and operations on them (PLAN.md §6.5).
 *
 * Steps live in their own store; step documents are regular library documents. This is
 * the glue: build a step's doc on demand, return steps in order, and delete a guide
 * without losing or leaking anything.
 */
import type { DocId } from '@/core/doc/types'
import {
  deleteGuide,
  deleteImage,
  deleteStep,
  getDoc,
  getGuide,
  getImage,
  listSteps,
  putDoc,
  putGuide,
  putStep,
  putSteps,
} from '@/core/storage/db'

import { buildStepDoc, isGeneratedStepDoc } from './build'
import { resolveStyle, type ScribeStyle } from './style'
import type { GuideId, ScribeSession, ScribeStep, StepId } from './timeline'
import { moveStep, removeStep, sortSteps } from './timeline'

export type Guide = { session: ScribeSession; steps: ScribeStep[] }

export async function loadGuide(id: GuideId): Promise<Guide | null> {
  const session = await getGuide(id)
  if (!session) return null
  return { session, steps: sortSteps(await listSteps(id)) }
}

export async function renameGuide(session: ScribeSession, title: string): Promise<ScribeSession> {
  const next = { ...session, title: title.trim() || session.title, updatedAt: Date.now() }
  await putGuide(next)
  return next
}

export async function editCaption(step: ScribeStep, caption: string): Promise<ScribeStep> {
  const next = { ...step, caption, captionEdited: true }
  await putStep(next)

  // The caption also lives in the step's doc: otherwise image export would ship the old
  // text while the list shows the new one, silently diverging.
  if (next.docId) await syncCaption(next)
  return next
}

async function syncCaption(step: ScribeStep): Promise<void> {
  if (!step.docId) return
  const doc = await getDoc(step.docId)
  if (!doc) return

  await putDoc({
    ...doc,
    title: `${step.index}. ${step.caption}`,
    layers: doc.layers.map((layer) =>
      layer.kind === 'text' && layer.name === 'Caption' ? { ...layer, text: step.caption } : layer,
    ),
    updatedAt: Date.now(),
  })
}

/**
 * Reorder a step. The whole list is written, not the diff: renumbering touches
 * everything between the old and new positions, and computing that diff is just one
 * extra way to get it wrong. Guides have tens of steps; writing them all costs
 * milliseconds.
 */
export async function reorderSteps(
  steps: readonly ScribeStep[],
  from: number,
  to: number,
): Promise<ScribeStep[]> {
  const moved = moveStep(steps, from, to)
  await putSteps(moved)
  return moved
}

/**
 * Delete a step. Its frame goes with it, but only if nothing else references it: a
 * built doc lives its own life in the library, and two adjacent steps can share one
 * frame — the rate limiter yields two captures a second, so a click followed by an
 * input share a frame.
 */
export async function dropStep(steps: readonly ScribeStep[], id: StepId): Promise<ScribeStep[]> {
  const step = steps.find((candidate) => candidate.id === id)
  const left = removeStep(steps, id)

  await deleteStep(id)
  await putSteps(left)

  const shared = left.some((other) => other.imageId === step?.imageId)
  if (step?.imageId && !step.docId && !shared) await deleteImage(step.imageId)
  return left
}

/** Delete the whole guide. Orphaned frames — ones that never became documents — go too. */
export async function dropGuide(id: GuideId): Promise<void> {
  for (const imageId of await deleteGuide(id)) await deleteImage(imageId)
}

/**
 * Step document: built on demand, not at recording time.
 *
 * Building eagerly would create ten docs for a ten-step guide when the user opens one.
 * The built doc's id is remembered on the step — the same button opens the same doc
 * instead of spawning copies.
 */
export async function ensureStepDoc(step: ScribeStep, style?: ScribeStyle): Promise<DocId | null> {
  if (step.docId && (await getDoc(step.docId))) return step.docId

  const built = await buildAndStore(step, style)
  if (!built) return null

  await putStep({ ...step, docId: built })
  return built
}

/** Build a step's doc and store it in the library. `keepId` means rebuild in place. */
async function buildAndStore(
  step: ScribeStep,
  style?: ScribeStyle,
  keepId?: { id: DocId; createdAt: number },
): Promise<DocId | null> {
  if (!step.imageId) return null

  const image = await getImage(step.imageId)
  if (!image) return null

  const doc = buildStepDoc(
    step,
    {
      imageId: step.imageId,
      // Docs use CSS pixels, frames physical ones: same division as at capture time.
      width: Math.round(image.width / image.dpr),
      height: Math.round(image.height / image.dpr),
    },
    resolveStyle(style),
  )
  if (!doc) return null

  const stored = keepId ? { ...doc, id: keepId.id, createdAt: keepId.createdAt } : doc
  await putDoc({
    ...stored,
    domain: image.source?.domain ?? '',
    text: null,
    thumbnail: null,
  })
  return stored.id
}

/**
 * Apply a new style to the whole guide.
 *
 * Already-built steps are rebuilt in place, keeping their id so library cards and
 * links stay valid — but only steps with no manual additions: we must not erase
 * someone's arrow for a different outline color. Styling is cheap to redo; a lost
 * edit is unrecoverable.
 */
export async function applyStyle(
  session: ScribeSession,
  steps: readonly ScribeStep[],
  style: ScribeStyle,
): Promise<ScribeSession> {
  const next = { ...session, style, updatedAt: Date.now() }
  await putGuide(next)

  for (const step of steps) {
    if (!step.docId) continue
    const doc = await getDoc(step.docId)
    if (!doc || !isGeneratedStepDoc(doc, step)) continue

    await buildAndStore(step, style, { id: doc.id, createdAt: doc.createdAt })
  }

  return next
}
