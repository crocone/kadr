/**
 * Guide-recording orchestration (PLAN.md §6.5).
 *
 * Everything the page cannot do lives here: capturing the tab frame, the
 * two-frames-per-second limiter, writing steps to the database, surviving navigation.
 *
 * A step is written to the database the moment it happens — not at the end, not in
 * batches: MV3 can suspend the service worker at any time, and anything held in its
 * memory is lost silently. For the same reason the pointer to the active session lives
 * in `storage.session`, not in a module variable.
 *
 * Following a link kills the content script along with its listeners, so on
 * `tabs.onUpdated` it is re-injected and continues the same session. That is also why
 * Scribe asks for a site permission: `activeTab` expires on the first navigation, and a
 * guide without page-to-page transitions is not a guide.
 */
import contentScriptPath from '@/content/index?iife'
import { CAPTURE_INTERVAL_MS } from '@/core/capture/plan'
import { domainOf, newImageId } from '@/core/doc'
import { translate } from '@/core/i18n'
import type { Locale } from '@/core/i18n'
import { sendTabMessage } from '@/core/messaging'
import { hasOrigin, originPatternOf } from '@/core/permissions/host-access'
import { type ActiveScribe, clearActive, readActive, writeActive } from '@/core/scribe/active'
import { captionOf } from '@/core/scribe/caption'
import type { GuideId, ScribeEvent, ScribeSession, ScribeStep } from '@/core/scribe/timeline'
import { getGuide, listSteps, putGuide, putImage, putStep } from '@/core/storage/db'

import { showDone } from './badge'
import { captureTabFrame } from './capture'
import { ensureContentScript } from './content-script'

/** Recording and step ids: same prefixes as documents and images. */
function newGuideId(): GuideId {
  return `guide_${crypto.randomUUID()}`
}

function newStepId(): string {
  return `step_${crypto.randomUUID()}`
}

/**
 * When a frame was last captured. Deliberately in worker memory: a freshly woken worker
 * forgets the throttle — rightly so, since well over half a second has passed by then.
 */
let lastFrameAt = 0

/**
 * The most recently captured frame and when it was taken.
 *
 * Waiting in the limiter's queue is not an option: while a frame waits, the user
 * manages two more clicks and the shot arrives attached to someone else's step. But
 * leaving the step without a frame is also pointless — the neighbouring click happened
 * a fraction of a second earlier, the page is the same, and the previous frame is just
 * as true for it. So the frame is reused.
 *
 * This was the gap in the numbering: filling a field and clicking the next one arrive
 * within milliseconds, the second got no frame, and the finished guide had a step with
 * no picture.
 */
let lastFrame: { imageId: string; url: string } | null = null

function frameAllowed(now: number): boolean {
  if (now - lastFrameAt < CAPTURE_INTERVAL_MS) return false
  lastFrameAt = now
  return true
}

export async function startScribe(tab: {
  id: number
  windowId: number
  url: string
  title: string
}): Promise<GuideId> {
  const now = Date.now()
  const session: ScribeSession = {
    id: newGuideId(),
    title: tab.title || domainOf(tab.url),
    startedAt: now,
    updatedAt: now,
    status: 'recording',
    tabId: tab.id,
    origin: originPatternOf(tab.url) ?? '',
    droppedFrames: 0,
  }

  // A frame from the previous recording does not belong to the new one.
  lastFrame = null

  await putGuide(session)
  await writeActive({
    guideId: session.id,
    tabId: tab.id,
    origin: session.origin,
    steps: 0,
    dropped: 0,
  })

  await ensureContentScript(tab.id, contentScriptPath)
  await sendTabMessage(tab.id, 'content:scribeBegin', { steps: 0, dropped: 0 })
  return session.id
}

export async function stopScribe(): Promise<GuideId | null> {
  const active = await readActive()
  await clearActive()
  if (!active) return null

  const session = await getGuide(active.guideId)
  if (session) {
    await putGuide({
      ...session,
      status: 'done',
      updatedAt: Date.now(),
      droppedFrames: active.dropped,
    })
  }

  await sendTabMessage(active.tabId, 'content:scribeEnd', {}).catch(() => undefined)
  return active.guideId
}

/**
 * A step from the page. The frame is captured right here, synchronously with the write:
 * deferring it would capture an already-changed page.
 */
export async function recordStep(
  event: ScribeEvent,
  sender: chrome.runtime.MessageSender,
  locale: Locale,
): Promise<{ steps: number; dropped: number } | null> {
  const active = await readActive()
  if (!active || sender.tab?.id !== active.tabId) return null

  const windowId = sender.tab.windowId
  let imageId: string | null = null

  if (windowId !== undefined && frameAllowed(event.at)) {
    try {
      const frame = await captureTabFrame(windowId, event.viewport.dpr)
      imageId = newImageId()
      await putImage({
        id: imageId,
        blob: frame.blob,
        width: frame.width,
        height: frame.height,
        dpr: event.viewport.dpr,
        createdAt: event.at,
        source: { url: event.url, title: event.title, domain: domainOf(event.url) },
      })
      lastFrame = { imageId, url: event.url }
    } catch (error) {
      console.warn('[kadr] scribe frame failed', error)
      imageId = null
    }
  } else if (lastFrame?.url === event.url) {
    // A fresh frame of the same page: less than half a second old, showing exactly the
    // same thing. One frame for two adjacent steps is more honest than a step with no
    // picture.
    imageId = lastFrame.imageId
  }

  const previous = (await listSteps(active.guideId)).at(-1)

  /**
   * Typing into a field that was just clicked is the same step, not the next one.
   *
   * Otherwise the guide reads "Click the 'Email' field", "Fill in 'Email'" — two items
   * for one action. The click is replaced by the input in place: its frame is already
   * captured, and captured before typing — exactly the one needed.
   */
  if (
    event.kind === 'input' &&
    event.element !== null &&
    previous?.kind === 'click' &&
    previous.element?.selector === event.element.selector &&
    previous.url === event.url
  ) {
    const merged: ScribeStep = {
      ...previous,
      kind: 'input',
      at: event.at,
      target: event.target,
      rect: event.rect ?? previous.rect,
      captionEdited: false,
      caption: '',
    }
    merged.caption = captionOf(merged, locale)
    await putStep(merged)
    return { steps: active.steps, dropped: active.dropped }
  }

  const index = active.steps + 1
  const step: ScribeStep = {
    id: newStepId(),
    guideId: active.guideId,
    index,
    kind: event.kind,
    at: event.at,
    point: event.point,
    element: event.element,
    target: event.target,
    rect: event.rect,
    url: event.url,
    title: event.title,
    imageId,
    viewport: event.viewport,
    caption: '',
    captionEdited: false,
    docId: null,
  }
  step.caption = captionOf(step, locale)

  await putStep(step)

  const next: ActiveScribe = {
    ...active,
    steps: index,
    dropped: active.dropped + (imageId ? 0 : 1),
  }
  await writeActive(next)

  return { steps: next.steps, dropped: next.dropped }
}

/**
 * A page-to-page transition, recorded as its own step: without it ten steps from three
 * different pages read as one continuous stream, with no telling where the user ended up.
 *
 * No frame for this step: the page has just loaded and there is nothing worth shooting —
 * the very next click will capture it properly.
 */
async function recordNavigation(active: ActiveScribe, tab: chrome.tabs.Tab): Promise<void> {
  const url = tab.url ?? ''
  const steps = await listSteps(active.guideId)
  const previous = steps.at(-1)
  if (previous?.url.split('#')[0] === url.split('#')[0]) return

  const index = active.steps + 1
  const step: ScribeStep = {
    id: newStepId(),
    guideId: active.guideId,
    index,
    kind: 'navigate',
    at: Date.now(),
    point: null,
    element: null,
    target: null,
    rect: null,
    url,
    title: tab.title ?? '',
    imageId: null,
    viewport: null,
    caption: '',
    captionEdited: false,
    docId: null,
  }
  step.caption = `${step.title || url}`

  await putStep(step)
  await writeActive({ ...active, steps: index })
}

/**
 * A tab finished loading. If it is the recorded tab — put the script and HUD back.
 *
 * Leaving for another site stops the recording: the permission was granted for one
 * origin, and capturing a page the user gave no access to is out of the question.
 */
export async function onTabUpdated(
  tabId: number,
  info: chrome.tabs.OnUpdatedInfo,
  tab: chrome.tabs.Tab,
  locale: Locale,
): Promise<void> {
  if (info.status !== 'complete') return

  const active = await readActive()
  if (active?.tabId !== tabId) return

  const url = tab.url ?? ''
  if (!(await hasOrigin(url))) {
    await stopScribe()
    showDone(translate(locale, 'scribe.leftSite'))
    return
  }

  await recordNavigation(active, tab)

  const fresh = (await readActive()) ?? active
  await ensureContentScript(tabId, contentScriptPath)
  await sendTabMessage(tabId, 'content:scribeBegin', {
    steps: fresh.steps,
    dropped: fresh.dropped,
  }).catch(() => undefined)
}

/** Recording is bound to its tab: closing the tab ends the recording rather than losing it. */
export async function onTabRemoved(tabId: number): Promise<void> {
  const active = await readActive()
  if (active?.tabId === tabId) await stopScribe()
}

export async function scribeStatus(): Promise<{
  recording: boolean
  guideId: GuideId | null
  steps: number
  dropped: number
}> {
  const active = await readActive()
  return {
    recording: active !== null,
    guideId: active?.guideId ?? null,
    steps: active?.steps ?? 0,
    dropped: active?.dropped ?? 0,
  }
}
