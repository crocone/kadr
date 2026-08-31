/**
 * Records user actions on the page (PLAN.md §6.5).
 *
 * The one rule: the page must keep working. Listeners sit in the capture phase but
 * intercept nothing — no `preventDefault`, no `stopPropagation`. A recording that
 * breaks a button is useless twice over: no instruction, and the job not done.
 *
 * The frame is requested from the background on `pointerdown`, not `click`: between
 * the two the page reacts — opens a menu, navigates away — and the "before the press"
 * shot the instruction needs would become an "after" shot.
 *
 * Field values are never stored. An input step is recorded on `change` and says only
 * "something was typed here"; password fields are skipped entirely, clicks on them
 * included. The value is read exactly once, and only to know whether there is anything
 * to hide: filled fields are masked before the frame, or a typed phone number would
 * ride into the finished guide — visible in full on the shot, however carefully the
 * timeline is handled.
 */
import { refOf } from '@/core/dom/selector'
import { elementKindOf } from '@/core/scribe/caption'
import type { ScribeEvent } from '@/core/scribe/timeline'
import { sendMessage } from '@/core/messaging'

import { t } from '../i18n'
import { createOverlayHost, type OverlayHost } from '../overlay/host'
import { hideScrollbars, restoreScrollbars } from '../page-prep'

const CSS = `
  .hud {
    position: fixed;
    right: 20px;
    bottom: 20px;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px 8px 12px;
    border-radius: 10px;
    border: 1px solid rgba(255, 255, 255, 0.07);
    background: rgba(20, 21, 25, 0.94);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
    pointer-events: auto;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #e5484d;
    animation: pulse 1.6s ease-in-out infinite;
  }
  @keyframes pulse { 50% { opacity: 0.25; } }
  .count { color: #fff; font-weight: 600; }
  .dropped { color: #8b919c; }
  .stop {
    all: unset;
    padding: 4px 10px;
    border-radius: 7px;
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
    font-size: 11px;
    cursor: pointer;
  }
  .stop:hover { background: rgba(255, 255, 255, 0.18); }
  .mask {
    all: unset;
    padding: 4px 10px;
    border-radius: 7px;
    background: rgba(255, 255, 255, 0.06);
    color: #8b919c;
    font-size: 11px;
    cursor: pointer;
  }
  .mask[aria-pressed='true'] { background: rgba(109, 92, 245, 0.35); color: #fff; }
`

type Recorder = {
  host: OverlayHost
  count: HTMLElement
  dropped: HTMLElement
  /** Whether to hide typed values on frames. Toggled by a HUD button. */
  maskValues: boolean
  detach: () => void
}

let active: Recorder | null = null

function isPassword(element: Element | null): boolean {
  return element instanceof HTMLInputElement && element.type === 'password'
}

/**
 * The real event target. Inside shadow DOM `target` is already retargeted to the
 * host — which is fine: a selector into someone else's closed tree cannot be built
 * anyway, and the host is findable with a plain `querySelector`.
 */
function targetOf(event: Event): Element | null {
  const target = event.target
  return target instanceof Element ? target : null
}

function describe(element: Element): {
  element: ReturnType<typeof refOf>
  target: ReturnType<typeof elementKindOf>
  rect: { x: number; y: number; w: number; h: number }
} {
  const box = element.getBoundingClientRect()
  return {
    element: refOf(element),
    target: elementKindOf({
      tag: element.tagName,
      role: element.getAttribute('role'),
      type: element.getAttribute('type'),
      href: element.hasAttribute('href'),
    }),
    // Viewport coordinates: the frame is shot with this exact viewport, and the
    // step marker is drawn in the same coordinates.
    rect: { x: box.left, y: box.top, w: box.width, h: box.height },
  }
}

function viewportOf() {
  return {
    w: document.documentElement.clientWidth,
    h: document.documentElement.clientHeight,
    dpr: window.devicePixelRatio,
  }
}

/**
 * What the user has typed must not appear in the frame.
 *
 * We never store field values — but the shot is taken from the live page, where a
 * typed phone number is fully visible, and on every following frame too. A privacy
 * promise kept only for the timeline is not a kept promise.
 *
 * Blur does not cut it: letters under `blur` keep their shape, and a ten-digit phone
 * number reads off a zoomed shot with no effort. It is the text that must be hidden,
 * not its outline.
 *
 * So text fields get `-webkit-text-security` — the same dot mask the browser uses for
 * passwords: you can see the field is filled but not with what, and layout does not
 * shift a pixel. Other field types — number, date — where the mask has no effect
 * simply get their text not painted.
 */
const TEXT_LIKE = new Set(['', 'text', 'search', 'tel', 'url', 'email', 'password'])

function maskField(field: HTMLElement): void {
  const type = field instanceof HTMLInputElement ? field.type.toLowerCase() : ''

  if (field instanceof HTMLTextAreaElement || TEXT_LIKE.has(type)) {
    field.style.setProperty('-webkit-text-security', 'disc', 'important')
    // The property is vendor-prefixed, and a silent refusal to apply it would mean a
    // frame with the phone number exposed. Verify it took — if not, hide the text for sure.
    if (field.style.getPropertyValue('-webkit-text-security') === 'disc') return
  }

  field.style.setProperty('color', 'transparent', 'important')
  field.style.setProperty('-webkit-text-fill-color', 'transparent', 'important')
  field.style.setProperty('text-shadow', 'none', 'important')
}

/**
 * Waits for the browser to paint what we just changed.
 *
 * Two frames, not one: the first `requestAnimationFrame` fires before the paint, so
 * the change is not shown yet. The second comes after it.
 *
 * A fallback timer is mandatory: an invisible tab gets no animation frames at all,
 * and waiting for the paint would become waiting forever — a lost step instead of a shot.
 */
function nextPaint(ms = 250): Promise<void> {
  return new Promise((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      resolve()
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(finish)
    })
    setTimeout(finish, ms)
  })
}

function maskedFields(): HTMLElement[] {
  const fields: HTMLElement[] = []

  for (const node of document.querySelectorAll('input, textarea')) {
    if (node instanceof HTMLInputElement) {
      // Checkboxes and buttons reveal nothing personal, and a masked checkbox would
      // make a "tick the box" step unreadable.
      if (['checkbox', 'radio', 'button', 'submit', 'reset', 'range'].includes(node.type)) continue
      if (node.value) fields.push(node)
    } else if (node instanceof HTMLTextAreaElement && node.value) {
      fields.push(node)
    }
  }
  return fields
}

/**
 * Sends a step. The HUD hides for the duration: the background shoots this same tab,
 * and a lingering "recording" badge would land in every frame of the guide.
 */
async function send(event: ScribeEvent): Promise<void> {
  const recorder = active
  if (!recorder) return

  const masked = recorder.maskValues ? maskedFields() : []
  // The inline style is saved and restored wholesale: the mask sets several
  // properties, and restoring them one by one is a way to eventually forget one.
  const restore = masked.map((field) => field.getAttribute('style'))

  recorder.host.element.style.display = 'none'
  for (const field of masked) maskField(field)

  try {
    // The background shoots whatever the browser has painted. Without waiting for the
    // paint, the shot could include the recording badge and unmasked values —
    // occasionally and unpredictably, which is worse than always.
    await nextPaint()
    const answer = await sendMessage('scribe:step', { event })
    if (answer.ok) paint(answer.steps, answer.dropped)
  } catch (error) {
    // The worker may have restarted mid-recording: the step is lost, recording goes on.
    console.warn('[kadr] scribe step lost', error)
  } finally {
    masked.forEach((field, at) => {
      const was = restore[at]
      if (was === null || was === undefined) field.removeAttribute('style')
      else field.setAttribute('style', was)
    })
    if (active === recorder) recorder.host.element.style.display = ''
  }
}

function paint(steps: number, dropped: number): void {
  if (!active) return
  active.count.textContent = t('scribe.hud.steps', { n: steps })
  active.dropped.textContent = dropped > 0 ? t('scribe.hud.dropped', { n: dropped }) : ''
}

export function beginRecording(steps: number, dropped: number): void {
  if (active) {
    paint(steps, dropped)
    return
  }

  // The scrollbar never belongs in a frame — regular capture hides it, and recording
  // should be no exception. Hidden once per session: doing it before every frame
  // would jolt the layout on every click.
  void hideScrollbars()

  const host = createOverlayHost(CSS)
  const hud = document.createElement('div')
  hud.className = 'layer'
  // The layer must not catch the mouse: the live page being recorded is underneath.
  hud.style.pointerEvents = 'none'
  hud.innerHTML = `
    <div class="hud">
      <span class="dot"></span>
      <span class="count"></span>
      <span class="dropped"></span>
      <button class="mask" type="button" aria-pressed="true">${t('scribe.hud.mask')}</button>
      <button class="stop" type="button">${t('scribe.hud.stop')}</button>
    </div>
  `
  host.root.append(hud)

  const onPointerDown = (event: PointerEvent) => {
    // Alt means "do not record this step": every guide involves clicks the user
    // makes for themselves, not for the reader.
    if (event.altKey || event.button !== 0) return

    const element = targetOf(event)
    if (!element || isPassword(element)) return
    // Do not record our own HUD.
    if (element === host.element) return

    void send({
      kind: 'click',
      at: Date.now(),
      point: { x: event.clientX, y: event.clientY },
      url: location.href,
      title: document.title,
      viewport: viewportOf(),
      ...describe(element),
    })
  }

  // Input is recorded on `change`, not per keystroke: otherwise one field would
  // produce thirty steps, and "press p, press a, press s" is not a guide.
  const onChange = (event: Event) => {
    const element = targetOf(event)
    if (!element || isPassword(element)) return
    if (
      !(element instanceof HTMLInputElement) &&
      !(element instanceof HTMLTextAreaElement) &&
      !(element instanceof HTMLSelectElement)
    ) {
      return
    }
    // Checkboxes and radios were already recorded by the click on them: a second
    // step for the same action reads as two different ones.
    if (element instanceof HTMLInputElement && ['checkbox', 'radio'].includes(element.type)) return

    void send({
      kind: 'input',
      at: Date.now(),
      point: null,
      url: location.href,
      title: document.title,
      viewport: viewportOf(),
      ...describe(element),
    })
  }

  const onHudClick = (event: Event) => {
    const target = event.target
    if (!(target instanceof HTMLElement)) return

    if (target.closest('.stop')) {
      void sendMessage('scribe:stop', {})
      return
    }
    if (target.closest('.mask') && active) {
      active.maskValues = !active.maskValues
      const button = hud.querySelector('.mask')
      button?.setAttribute('aria-pressed', String(active.maskValues))
    }
  }

  window.addEventListener('pointerdown', onPointerDown, true)
  window.addEventListener('change', onChange, true)
  hud.addEventListener('click', onHudClick)

  active = {
    host,
    count: hud.querySelector<HTMLElement>('.count')!,
    dropped: hud.querySelector<HTMLElement>('.dropped')!,
    // Mask by default: leaking a phone number into a finished guide costs more than
    // one button press when values do need to be shown.
    maskValues: true,
    detach: () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('change', onChange, true)
    },
  }
  paint(steps, dropped)
}

export function endRecording(): void {
  if (!active) return
  active.detach()
  active.host.destroy()
  active = null
  restoreScrollbars()
}

export function isRecording(): boolean {
  return active !== null
}
