// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { selectArea } from './area'
import { overlayRootsForTests } from './host'

/**
 * The overlay waits for the frozen frame to load, and jsdom does not load images —
 * so tests advance the timers past the safety timeout before dispatching events:
 * until then the listeners are not attached yet.
 */
const FRAME_WAIT_MS = 2000
const FRAME_ID = 7

function hosts(): Element[] {
  return [...document.documentElement.querySelectorAll('[data-kadr-overlay]')]
}

/**
 * Take the last registered root: a failed test may leave its overlay in the
 * registry, and the first in the list would belong to it.
 */
function root(): ShadowRoot {
  const roots = overlayRootsForTests()
  const found = roots[roots.length - 1]
  if (!found) throw new Error('overlay is not mounted')
  return found
}

function layer(): Element {
  const found = root().querySelector('.layer')
  if (!found) throw new Error('overlay layer is not mounted')
  return found
}

function find<T extends Element>(selector: string): T {
  const found = root().querySelector<T>(selector)
  if (!found) throw new Error(`missing ${selector}`)
  return found
}

function visible(selector: string): boolean {
  return find<HTMLElement>(selector).style.display !== 'none'
}

function mouse(type: string, x: number, y: number): MouseEvent {
  return new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, button: 0 })
}

function key(name: string, init: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent('keydown', { key: name, bubbles: true, ...init })
}

function keyUp(name: string): KeyboardEvent {
  return new KeyboardEvent('keyup', { key: name, bubbles: true })
}

/**
 * jsdom does not implement elementFromPoint at all, so the method is stubbed
 * entirely: the cursor lands on an element with a predefined rect.
 */
function stubElementUnderCursor(box: { x: number; y: number; w: number; h: number }): void {
  const element = document.createElement('section')
  element.id = 'target'
  element.getBoundingClientRect = () =>
    ({ left: box.x, top: box.y, width: box.w, height: box.h }) as DOMRect
  document.body.append(element)
  document.elementFromPoint = () => element
}

/** A frame from point to point: the three events the overlay expects in this order. */
function dragFrame(from: [number, number], to: [number, number]): void {
  layer().dispatchEvent(mouse('mousedown', ...from))
  layer().dispatchEvent(mouse('mousemove', ...to))
  layer().dispatchEvent(mouse('mouseup', ...to))
}

/**
 * The selection promise comes back wrapped: `await` on a function returning a
 * promise would unwrap it and wait for a selection the test has not made yet.
 */
async function openOverlay(): Promise<{ selection: Promise<unknown> }> {
  const selection = selectArea('data:image/png;base64,', FRAME_ID, 1)
  await vi.advanceTimersByTimeAsync(FRAME_WAIT_MS + 1)
  return { selection }
}

async function stillOpen(selection: Promise<unknown>): Promise<boolean> {
  const settled = await Promise.race([selection, Promise.resolve().then(() => 'pending')])
  return settled === 'pending'
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  // The overlay only removes itself through finish: without Esc a failed test would
  // leave its shadow root in the registry, and the next test would pick it up.
  window.dispatchEvent(key('Escape'))
  vi.useRealTimers()
  for (const host of hosts()) host.remove()
  document.body.replaceChildren()
  delete (document as Partial<Document>).elementFromPoint
})

describe('selectArea', () => {
  it('keeps the overlay open after the drag and offers the actions', async () => {
    const { selection } = await openOverlay()
    expect(hosts()).toHaveLength(1)

    dragFrame([100, 120], [340, 400])

    // No shot taken: the frame can still be adjusted, so the overlay stays.
    expect(await stillOpen(selection)).toBe(true)
    expect(visible('.bar')).toBe(true)
    expect(find<HTMLElement>('.badge').textContent).toBe('240 × 280')

    window.dispatchEvent(key('Escape'))
    await expect(selection).resolves.toEqual({ ok: false, cancelled: true })
  })

  it('returns the dragged rect on Enter and removes the overlay', async () => {
    const { selection } = await openOverlay()

    dragFrame([100, 120], [340, 400])
    window.dispatchEvent(key('Enter'))

    await expect(selection).resolves.toEqual({
      ok: true,
      rect: { x: 100, y: 120, w: 240, h: 280 },
      action: 'edit',
      scope: 'viewport',
      frameId: FRAME_ID,
      // Scroll position at selection time: the re-capture recipe uses it to map
      // the frame from viewport to page coordinates.
      scroll: { x: 0, y: 0 },
    })
    expect(hosts()).toHaveLength(0)
  })

  it('normalises a drag made right-to-left and upwards', async () => {
    const { selection } = await openOverlay()

    dragFrame([400, 500], [250, 300])
    window.dispatchEvent(key('Enter'))

    await expect(selection).resolves.toMatchObject({
      ok: true,
      rect: { x: 250, y: 300, w: 150, h: 200 },
    })
  })

  it('carries the action of the pressed button', async () => {
    const { selection } = await openOverlay()

    dragFrame([10, 10], [210, 110])
    find<HTMLElement>('.bar button[data-action="download"]').dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    )

    await expect(selection).resolves.toMatchObject({ ok: true, action: 'download' })
  })

  it('reports a clipboard that would not take the image', async () => {
    const { selection } = await openOverlay()

    dragFrame([10, 10], [210, 110])
    find<HTMLElement>('.bar button[data-action="copy"]').dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    )

    // jsdom supports neither ClipboardItem nor canvas: the overlay must survive the
    // failure and honestly report the copy did not land.
    await expect(selection).resolves.toMatchObject({ action: 'copy', copied: false })
  })

  it('cancels from the close button and from Escape', async () => {
    const first = await openOverlay()
    first.selection.catch(() => undefined)
    dragFrame([10, 10], [210, 110])
    find<HTMLElement>('.bar button[data-action="cancel"]').dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    )
    await expect(first.selection).resolves.toEqual({ ok: false, cancelled: true })

    const second = await openOverlay()
    window.dispatchEvent(key('Escape'))
    await expect(second.selection).resolves.toEqual({ ok: false, cancelled: true })
    expect(hosts()).toHaveLength(0)
  })

  it('locks the frame to a ratio chosen on the chips', async () => {
    const { selection } = await openOverlay()

    find<HTMLElement>('.chip[data-preset="1:1"]').dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    )
    dragFrame([100, 100], [300, 140])
    window.dispatchEvent(key('Enter'))

    // Width 200 leads, the height is pulled up to match.
    await expect(selection).resolves.toMatchObject({
      rect: { x: 100, y: 100, w: 200, h: 200 },
    })
  })

  it('takes the whole viewport on the screen chip', async () => {
    const { selection } = await openOverlay()

    find<HTMLElement>('.chip[data-preset="screen"]').dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    )
    window.dispatchEvent(key('Enter'))

    await expect(selection).resolves.toMatchObject({
      rect: { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight },
    })
  })

  it('resizes an existing frame by its handle', async () => {
    const { selection } = await openOverlay()

    dragFrame([100, 100], [300, 200])
    // The east handle drags only the right edge; the left one stays put.
    find<HTMLElement>('.h[data-handle="e"]').dispatchEvent(mouse('mousedown', 300, 150))
    layer().dispatchEvent(mouse('mousemove', 500, 150))
    layer().dispatchEvent(mouse('mouseup', 500, 150))
    window.dispatchEvent(key('Enter'))

    await expect(selection).resolves.toMatchObject({
      rect: { x: 100, y: 100, w: 400, h: 100 },
    })
  })

  it('moves the frame when dragged from the inside', async () => {
    const { selection } = await openOverlay()

    dragFrame([100, 100], [300, 200])
    layer().dispatchEvent(mouse('mousedown', 200, 150))
    layer().dispatchEvent(mouse('mousemove', 240, 190))
    layer().dispatchEvent(mouse('mouseup', 240, 190))
    window.dispatchEvent(key('Enter'))

    await expect(selection).resolves.toMatchObject({
      rect: { x: 140, y: 140, w: 200, h: 100 },
    })
  })

  it('takes a whole element in page coordinates while Alt is held', async () => {
    const { selection } = await openOverlay()
    stubElementUnderCursor({ x: 40, y: 60, w: 300, h: 900 })

    window.dispatchEvent(key('Alt'))
    layer().dispatchEvent(mouse('mousemove', 100, 100))
    layer().dispatchEvent(new MouseEvent('click', { bubbles: true }))

    // scope: 'page' routes the capture to the element strategy — it is taller than the viewport.
    await expect(selection).resolves.toEqual({
      ok: true,
      rect: { x: 40, y: 60, w: 300, h: 900 },
      action: 'edit',
      scope: 'page',
      label: 'section#target',
    })
  })

  it('gives the previous frame back when Alt is released without a click', async () => {
    const { selection } = await openOverlay()
    dragFrame([100, 120], [340, 400])
    stubElementUnderCursor({ x: 40, y: 60, w: 300, h: 200 })

    window.dispatchEvent(key('Alt'))
    layer().dispatchEvent(mouse('mousemove', 100, 100))
    window.dispatchEvent(keyUp('Alt'))
    window.dispatchEvent(key('Enter'))

    await expect(selection).resolves.toMatchObject({
      rect: { x: 100, y: 120, w: 240, h: 280 },
      scope: 'viewport',
    })
  })

  it('treats a stray click as no selection and stays open', async () => {
    const { selection } = await openOverlay()

    layer().dispatchEvent(mouse('mousedown', 200, 200))
    layer().dispatchEvent(mouse('mouseup', 201, 201))

    expect(await stillOpen(selection)).toBe(true)
    expect(visible('.bar')).toBe(false)
    expect(hosts()).toHaveLength(1)

    window.dispatchEvent(key('Escape'))
    await expect(selection).resolves.toEqual({ ok: false, cancelled: true })
  })

  it('falls back to the whole viewport when Enter comes without a frame', async () => {
    const { selection } = await openOverlay()

    window.dispatchEvent(key('Enter'))

    await expect(selection).resolves.toMatchObject({
      ok: true,
      rect: { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight },
      scope: 'viewport',
    })
  })

  it('does not swallow its own events while blocking the page', async () => {
    const { selection } = await openOverlay()
    const pageClicks: string[] = []
    document.body.addEventListener('click', () => pageClicks.push('page'))

    // A click past the overlay never reaches the page...
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(pageClicks).toEqual([])

    // ...while the overlay's own drag still works.
    dragFrame([10, 10], [80, 90])
    window.dispatchEvent(key('Enter'))
    await expect(selection).resolves.toMatchObject({
      rect: { x: 10, y: 10, w: 70, h: 80 },
    })
  })
})
