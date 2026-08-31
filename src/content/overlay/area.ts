/**
 * Area selection over a frozen frame.
 *
 * The overlay shows a tab screenshot taken a moment earlier, not the live page.
 * That buys three things at once: the loupe shows the actual pixels of the future
 * file, the crop matches the selection pixel for pixel, and the page cannot shift
 * between selecting and shooting.
 *
 * Releasing the mouse does not take the shot: the frame can be adjusted with eight
 * handles, snapped to a ratio, and only then routed — to the editor, the clipboard,
 * or downloads.
 */
import { type SelectionAction, type SelectionResponse, sendMessage } from '@/core/messaging'

import { t } from '../i18n'

import {
  clampRect,
  drawRect,
  fullRect,
  type Handle,
  HANDLES,
  moveRect,
  type Point,
  type Preset,
  PRESETS,
  ratioOf,
  type Rect,
  rectFrom,
  resizeRect,
  sizeLabel,
} from './geometry'
import { createOverlayHost, describeElement, swallowPageEvents } from './host'

const LOUPE_SIZE = 132
const LOUPE_ZOOM = 6
const MIN_SELECTION = 4
const BAR_GAP = 14

const CSS = `
  .frame { position: fixed; left: 0; top: 0; }
  .layer { cursor: crosshair; }
  .veil {
    position: fixed;
    inset: 0;
    background: rgba(10, 12, 16, 0.35);
  }
  .veil.light { background: rgba(10, 12, 16, 0.12); }
  .sel {
    position: fixed;
    border: 1px solid #8b7dff;
    box-shadow: 0 0 0 100vmax rgba(10, 12, 16, 0.45);
    display: none;
  }
  .sel.plain { box-shadow: none; background: rgba(109, 92, 245, 0.12); }
  .grid {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background-image:
      linear-gradient(to right, rgba(139, 125, 255, 0.45) 1px, transparent 1px),
      linear-gradient(to bottom, rgba(139, 125, 255, 0.45) 1px, transparent 1px);
    background-size: 33.3333% 100%, 100% 33.3333%;
  }
  .h {
    position: absolute;
    width: 10px;
    height: 10px;
    margin: -5px 0 0 -5px;
    border: 1.5px solid #6d5cf5;
    border-radius: 2px;
    background: #fff;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.45);
  }
  .h[data-handle='nw'] { left: 0; top: 0; cursor: nwse-resize; }
  .h[data-handle='n'] { left: 50%; top: 0; cursor: ns-resize; }
  .h[data-handle='ne'] { left: 100%; top: 0; cursor: nesw-resize; }
  .h[data-handle='e'] { left: 100%; top: 50%; cursor: ew-resize; }
  .h[data-handle='se'] { left: 100%; top: 100%; cursor: nwse-resize; }
  .h[data-handle='s'] { left: 50%; top: 100%; cursor: ns-resize; }
  .h[data-handle='sw'] { left: 0; top: 100%; cursor: nesw-resize; }
  .h[data-handle='w'] { left: 0; top: 50%; cursor: ew-resize; }
  .badge {
    position: fixed;
    padding: 4px 8px;
    border-radius: 7px;
    background: rgba(20, 21, 25, 0.94);
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    color: #e7e9ee;
    display: none;
    pointer-events: none;
  }
  .bar {
    position: fixed;
    display: none;
    align-items: center;
    gap: 2px;
    padding: 6px;
    border-radius: 13px;
    border: 1px solid rgba(255, 255, 255, 0.07);
    background: rgba(20, 21, 25, 0.95);
    box-shadow: 0 16px 44px rgba(0, 0, 0, 0.55);
    cursor: default;
  }
  .bar button {
    all: unset;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 8px 12px;
    border-radius: 9px;
    font: 500 12.5px/1 ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    color: #c3c9d3;
    cursor: pointer;
    white-space: nowrap;
  }
  .bar button:hover { background: rgba(255, 255, 255, 0.08); color: #fff; }
  .bar button.primary { background: #6d5cf5; color: #fff; }
  .bar button.primary:hover { background: #7f70fb; }
  .bar button.icon { padding: 8px 10px; }
  .bar svg { width: 14px; height: 14px; flex: none; }
  .loupe {
    position: fixed;
    width: ${LOUPE_SIZE}px;
    height: ${LOUPE_SIZE}px;
    border-radius: 10px;
    border: 1px solid rgba(255, 255, 255, 0.5);
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
    pointer-events: none;
    image-rendering: pixelated;
  }
  .hex {
    position: fixed;
    padding: 2px 6px;
    border-radius: 6px;
    background: rgba(14, 16, 19, 0.9);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11px;
    pointer-events: none;
  }
`

const SVG = (path: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`

const ICONS: Record<SelectionAction | 'cancel', string> = {
  edit: SVG('<path d="M4 20h4L19 9a2.83 2.83 0 0 0-4-4L4 16v4Z"/>'),
  copy: SVG('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>'),
  download: SVG('<path d="M12 4v11m0 0 4-4m-4 4-4-4"/><path d="M5 19h14"/>'),
  cancel: SVG('<path d="m6 6 12 12M18 6 6 18"/>'),
}

/** Chip label: numeric ratios speak for themselves, word presets get translated. */
function presetLabel(preset: Preset): string {
  if (preset === 'free') return t('overlay.area.ratio.free')
  if (preset === 'screen') return t('overlay.area.ratio.screen')
  return preset
}

function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

type Drag =
  | { kind: 'draw'; anchor: Point }
  | { kind: 'move'; from: Point; origin: Rect }
  | { kind: 'resize'; handle: Handle }

export async function selectArea(
  frameUrl: string,
  frameId: number,
  devicePixelRatio: number,
): Promise<SelectionResponse> {
  const host = createOverlayHost(CSS)
  const release = swallowPageEvents(host.element)

  const layer = document.createElement('div')
  layer.className = 'layer'
  layer.innerHTML = `
    <img class="frame" alt="">
    <div class="veil"></div>
    <div class="sel">
      <div class="grid"></div>
      ${HANDLES.map((handle) => `<span class="h" data-handle="${handle}"></span>`).join('')}
    </div>
    <div class="badge"></div>
    <div class="bar">
      <button data-action="edit" class="primary">${ICONS.edit}${t('overlay.action.edit')}</button>
      <button data-action="copy">${ICONS.copy}${t('overlay.action.copy')}</button>
      <button data-action="download">${ICONS.download}${t('overlay.action.download')}</button>
      <button data-action="cancel" class="icon" title="${t('overlay.action.cancel')}">${ICONS.cancel}</button>
    </div>
    <canvas class="loupe" width="${LOUPE_SIZE}" height="${LOUPE_SIZE}"></canvas>
    <div class="hex"></div>
    <div class="card">
      <p class="text"></p>
      <div class="chips">
        ${PRESETS.map(
          (preset) =>
            `<button class="chip" data-preset="${preset}" aria-pressed="false">${presetLabel(preset)}</button>`,
        ).join('')}
      </div>
    </div>
    <div class="keys">
      <span><kbd>Esc</kbd> ${t('overlay.keys.cancel')}</span><i></i>
      <span><kbd>Enter</kbd> ${t('overlay.keys.shoot')}</span>
    </div>
  `
  host.root.append(layer)

  const image = layer.querySelector('img')!
  const veil = layer.querySelector<HTMLElement>('.veil')!
  const selection = layer.querySelector<HTMLElement>('.sel')!
  const badge = layer.querySelector<HTMLElement>('.badge')!
  const bar = layer.querySelector<HTMLElement>('.bar')!
  const loupe = layer.querySelector<HTMLCanvasElement>('.loupe')!
  const hex = layer.querySelector<HTMLElement>('.hex')!
  const cardText = layer.querySelector<HTMLElement>('.card .text')!
  const hostElement = host.element

  // The loupe is optional: selection still works if the 2d context is unavailable.
  const loupeCtx = loupe.getContext('2d', { willReadFrequently: true })
  if (loupeCtx) loupeCtx.imageSmoothingEnabled = false

  const loadFrame = async (url: string) => {
    // Race against a timeout: a broken frame must not leave the user with a hung overlay.
    await new Promise<void>((resolve) => {
      const done = () => {
        resolve()
      }
      image.addEventListener('load', done, { once: true })
      image.addEventListener('error', done, { once: true })
      setTimeout(done, 2000)
      image.src = url
    })

    // The frame is laid out at its natural size divided by dpr, not at 100vw: one
    // physical frame pixel then maps to exactly 1/dpr CSS pixels, and whether the
    // scrollbar made it into the shot no longer affects crop accuracy.
    image.style.width = `${image.naturalWidth / devicePixelRatio}px`
    image.style.height = `${image.naturalHeight / devicePixelRatio}px`
  }

  await loadFrame(frameUrl)

  return await new Promise<SelectionResponse>((resolve) => {
    /**
     * `idle` — no frame yet, `drawing` — being dragged, `ready` — editable and
     * shootable, `element` — Alt held, picking a whole element, `scrolling` —
     * Space held, scrolling the page under the overlay.
     */
    let phase: 'idle' | 'drawing' | 'ready' | 'element' | 'scrolling' = 'idle'
    let rect: Rect | null = null
    /** For an element we return page coordinates: it may not fit the viewport. */
    let pageRect: Rect | null = null
    let label: string | undefined
    let preset: Preset = 'free'
    let drag: Drag | null = null
    let currentFrameId = frameId
    /** Frame as it was before Alt: released without a click — back to what it was. */
    let rectBeforeAlt: Rect | null = null
    /** The loupe lives until the first press; handles and the bar take its place. */
    let loupeGone = !loupeCtx
    let pointer: Point = { x: 0, y: 0 }

    const bounds = (): Point => ({ x: window.innerWidth, y: window.innerHeight })

    const finish = (response: SelectionResponse) => {
      release()
      host.destroy()
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      resolve(response)
    }

    /**
     * Crops the frozen frame into a separate canvas. The frame arrived as a data URL,
     * so the canvas is not tainted and `toBlob` yields real pixels.
     */
    const cropToBlob = async (box: Rect): Promise<Blob> => {
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(box.w * devicePixelRatio)
      canvas.height = Math.round(box.h * devicePixelRatio)
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('2d context is unavailable')
      ctx.drawImage(
        image,
        box.x * devicePixelRatio,
        box.y * devicePixelRatio,
        canvas.width,
        canvas.height,
        0,
        0,
        canvas.width,
        canvas.height,
      )
      return await new Promise<Blob>((ok, fail) => {
        canvas.toBlob((blob) => {
          if (blob) ok(blob)
          else fail(new Error('canvas produced no blob'))
        }, 'image/png')
      })
    }

    /**
     * The clipboard is written here, not in the background: the Clipboard API needs a
     * user gesture and a focused document, and the service worker has neither. The
     * blob goes into ClipboardItem as a promise so the gesture window stays open while
     * the canvas encodes the PNG.
     */
    const writeClipboard = async (box: Rect): Promise<boolean> => {
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': cropToBlob(box) })])
        return true
      } catch (error) {
        console.warn('[kadr] clipboard write failed', error)
        return false
      }
    }

    const commit = async (action: SelectionAction) => {
      if (!rect) return
      const target = clampRect(rect, bounds())
      if (target.w < MIN_SELECTION || target.h < MIN_SELECTION) return

      const copied = action === 'copy' ? await writeClipboard(target) : undefined
      finish({
        ok: true,
        rect: target,
        action,
        scope: 'viewport',
        frameId: currentFrameId,
        scroll: { x: window.scrollX, y: window.scrollY },
        ...(copied === undefined ? {} : { copied }),
      })
    }

    const show = (element: HTMLElement, visible: boolean, display = 'block') => {
      element.style.display = visible ? display : 'none'
    }

    const paintCard = () => {
      if (phase === 'scrolling') {
        cardText.innerHTML = `<b>${t('overlay.area.scrolling')}</b> ${t('overlay.area.scrolling.hint')}`
        return
      }
      if (phase === 'element') {
        cardText.innerHTML = `<b>${t('overlay.element.hint')}</b> ${t('overlay.area.altHint')}`
        return
      }
      cardText.innerHTML = `<b>${t('overlay.area.title')}</b> ${t('overlay.area.hint')}`
    }

    /** The bar sits under the frame; if there is no room, above it or inside. */
    const placeBar = (box: Rect) => {
      const size = bounds()
      const width = bar.offsetWidth || 320
      const height = bar.offsetHeight || 44
      const below = box.y + box.h + BAR_GAP
      const top = below + height < size.y ? below : Math.max(BAR_GAP, box.y - height - BAR_GAP)
      const left = Math.min(
        Math.max(BAR_GAP, box.x + box.w / 2 - width / 2),
        Math.max(BAR_GAP, size.x - width - BAR_GAP),
      )
      bar.style.left = `${left}px`
      bar.style.top = `${top}px`
    }

    const paint = () => {
      const chrome = phase === 'ready'
      show(veil, !rect || phase === 'scrolling')
      veil.classList.toggle('light', phase === 'scrolling')
      show(selection, rect !== null && phase !== 'scrolling')
      show(badge, rect !== null && phase !== 'scrolling')
      show(bar, chrome, 'flex')
      show(image, phase !== 'scrolling' && phase !== 'element')
      // In element mode you adjust the pick, not the frame: handles and the thirds grid do not apply.
      selection.classList.toggle('plain', phase === 'element')
      for (const handle of selection.querySelectorAll<HTMLElement>('.h')) {
        show(handle, chrome, 'block')
      }
      show(selection.querySelector<HTMLElement>('.grid')!, phase !== 'element')

      if (!rect) return
      selection.style.left = `${rect.x}px`
      selection.style.top = `${rect.y}px`
      selection.style.width = `${rect.w}px`
      selection.style.height = `${rect.h}px`

      badge.textContent = sizeLabel(
        phase === 'element' && pageRect ? pageRect : rect,
        devicePixelRatio,
      )
      badge.style.left = `${Math.max(4, rect.x)}px`
      badge.style.top = `${rect.y > 28 ? rect.y - 26 : rect.y + 6}px`

      if (chrome) placeBar(rect)
    }

    const hideLoupe = () => {
      loupeGone = true
      show(loupe, false)
      show(hex, false)
    }

    const drawLoupe = (point: Point) => {
      if (!loupeCtx || loupeGone) return
      const source = LOUPE_SIZE / LOUPE_ZOOM
      const sx = point.x * devicePixelRatio - (source * devicePixelRatio) / 2
      const sy = point.y * devicePixelRatio - (source * devicePixelRatio) / 2

      loupeCtx.clearRect(0, 0, LOUPE_SIZE, LOUPE_SIZE)
      loupeCtx.drawImage(
        image,
        sx,
        sy,
        source * devicePixelRatio,
        source * devicePixelRatio,
        0,
        0,
        LOUPE_SIZE,
        LOUPE_SIZE,
      )

      const centre = LOUPE_SIZE / 2
      loupeCtx.strokeStyle = 'rgba(255,255,255,0.9)'
      loupeCtx.lineWidth = 1
      loupeCtx.strokeRect(centre - LOUPE_ZOOM / 2, centre - LOUPE_ZOOM / 2, LOUPE_ZOOM, LOUPE_ZOOM)

      const pixel = loupeCtx.getImageData(centre, centre, 1, 1).data
      hex.textContent = toHex(pixel[0] ?? 0, pixel[1] ?? 0, pixel[2] ?? 0)

      const size = bounds()
      const flipX = point.x + 24 + LOUPE_SIZE > size.x
      const flipY = point.y + 24 + LOUPE_SIZE + 22 > size.y
      const left = flipX ? point.x - LOUPE_SIZE - 24 : point.x + 24
      const top = flipY ? point.y - LOUPE_SIZE - 24 : point.y + 24
      loupe.style.left = `${left}px`
      loupe.style.top = `${top}px`
      hex.style.left = `${left}px`
      hex.style.top = `${top + LOUPE_SIZE + 4}px`
    }

    const setPreset = (next: Preset) => {
      preset = next
      for (const chip of layer.querySelectorAll<HTMLElement>('.chip')) {
        chip.setAttribute('aria-pressed', String(chip.dataset.preset === next))
      }

      if (next === 'screen') {
        pageRect = null
        label = undefined
        rect = fullRect(bounds())
        phase = 'ready'
        hideLoupe()
      } else if (rect && !pageRect) {
        // Refit the existing frame to the new ratio from its top-left corner.
        const ratio = ratioOf(next)
        if (ratio !== null) {
          rect = clampRect(
            drawRect({ x: rect.x, y: rect.y }, { x: rect.x + rect.w, y: rect.y + rect.h }, ratio),
            bounds(),
          )
        }
      }
      paint()
    }

    // --- Element picking with Alt ----------------------------------------------

    const elementUnder = (x: number, y: number): Element | null => {
      hostElement.style.display = 'none'
      const found = document.elementFromPoint(x, y)
      hostElement.style.display = ''
      return found
    }

    const highlightElement = (point: Point) => {
      const found = elementUnder(point.x, point.y)
      if (!found) return
      const box = found.getBoundingClientRect()
      if (box.width < MIN_SELECTION || box.height < MIN_SELECTION) return

      rect = { x: box.left, y: box.top, w: box.width, h: box.height }
      pageRect = {
        x: box.left + window.scrollX,
        y: box.top + window.scrollY,
        w: box.width,
        h: box.height,
      }
      label = describeElement(found)
      paint()
    }

    /**
     * Alt is a hold: an element pick counts on click, not on release. Otherwise it
     * is unclear what the frame holds — the whole element or only its visible part —
     * and the "capture the whole element" label would lie half the time.
     */
    const leaveElementMode = () => {
      if (phase !== 'element') return
      rect = rectBeforeAlt
      pageRect = null
      label = undefined
      phase = rect ? 'ready' : 'idle'
      paintCard()
      paint()
    }

    // --- Scrolling the page under the overlay ----------------------------------

    /**
     * A frozen frame and scrolling do not mix: the shot behind the frame predates the
     * scroll. So the frame is removed while scrolling — the live page shows through —
     * and on exit the background captures it again. Frame captures are rate-limited
     * to one per 550ms, so this cannot run on every wheel tick; scrolling is a mode.
     */
    const toggleScrolling = async () => {
      if (phase === 'scrolling') {
        // Refresh the frame before leaving the mode: showing the old shot over an
        // already-scrolled page would lie about what ends up in the file.
        const fresh = await sendMessage('capture:frame', {})
        if (fresh.ok) {
          currentFrameId = fresh.frameId
          await loadFrame(fresh.frameUrl)
        }
        phase = rect ? 'ready' : 'idle'
        paintCard()
        paint()
        return
      }
      if (drag) return
      phase = 'scrolling'
      hideLoupe()
      paintCard()
      paint()
    }

    // --- Events ----------------------------------------------------------------

    const onMouseMove = (event: MouseEvent) => {
      pointer = { x: event.clientX, y: event.clientY }
      if (phase === 'scrolling') return

      if (phase === 'element') {
        highlightElement(pointer)
        return
      }

      if (!drag) {
        drawLoupe(pointer)
        return
      }

      const ratio = ratioOf(preset)
      if (drag.kind === 'draw') {
        rect = clampRect(drawRect(drag.anchor, pointer, ratio), bounds())
      } else if (drag.kind === 'move' && rect) {
        rect = moveRect(drag.origin, pointer.x - drag.from.x, pointer.y - drag.from.y, bounds())
      } else if (drag.kind === 'resize' && rect) {
        rect = clampRect(resizeRect(rect, drag.handle, pointer, ratio), bounds())
      }
      paint()
    }

    const onMouseDown = (event: MouseEvent) => {
      if (event.button !== 0) return
      // Check for Element, not HTMLElement: the click may land on an <svg> inside a button.
      const target = event.target
      if (!(target instanceof Element)) return
      // Clicks on the chips or the bar are controls, not the start of a new frame.
      if (target.closest('.chips, .bar')) return

      if (phase === 'element') {
        event.preventDefault()
        return
      }

      pointer = { x: event.clientX, y: event.clientY }
      hideLoupe()
      // The frame was touched by hand — it is no longer the exact element picked with Alt.
      pageRect = null
      label = undefined

      const handle = target.closest<HTMLElement>('.h')?.dataset.handle as Handle | undefined
      if (handle && rect) {
        drag = { kind: 'resize', handle }
      } else if (
        rect &&
        pointer.x > rect.x &&
        pointer.x < rect.x + rect.w &&
        pointer.y > rect.y &&
        pointer.y < rect.y + rect.h
      ) {
        drag = { kind: 'move', from: pointer, origin: rect }
      } else {
        drag = { kind: 'draw', anchor: pointer }
        rect = rectFrom(pointer, pointer)
      }

      phase = 'drawing'
      paint()
    }

    const onMouseUp = () => {
      if (!drag) return
      drag = null

      if (!rect || rect.w < MIN_SELECTION || rect.h < MIN_SELECTION) {
        // Stray click, or a frame collapsed by a handle: back to the initial state.
        rect = null
        phase = 'idle'
        paint()
        return
      }

      phase = 'ready'
      paint()
    }

    const onClick = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      const chip = target.closest<HTMLElement>('.chip')
      if (chip?.dataset.preset) {
        event.preventDefault()
        event.stopPropagation()
        setPreset(chip.dataset.preset as Preset)
        return
      }

      const button = target.closest<HTMLElement>('.bar button')
      if (button?.dataset.action) {
        event.preventDefault()
        event.stopPropagation()
        const action = button.dataset.action
        if (action === 'cancel') finish({ ok: false, cancelled: true })
        else void commit(action as SelectionAction)
        return
      }

      if (phase === 'element') {
        event.preventDefault()
        event.stopPropagation()
        if (!pageRect) return
        // No action bar here: the element may be taller than the viewport, and only
        // the background can assemble it in full — there is nothing to copy yet.
        finish({
          ok: true,
          rect: pageRect,
          action: 'edit',
          scope: 'page',
          ...(label ? { label } : {}),
        })
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        finish({ ok: false, cancelled: true })
        return
      }

      if (event.key === 'Enter') {
        event.preventDefault()
        event.stopPropagation()
        if (!rect) {
          rect = fullRect(bounds())
          pageRect = null
        }
        void commit('edit')
        return
      }

      if (event.code === 'Space' && !event.repeat) {
        // Otherwise Space would page-scroll before the mode is even entered.
        event.preventDefault()
        event.stopPropagation()
        void toggleScrolling()
        return
      }

      if (event.key === 'Alt' && !event.repeat && phase !== 'scrolling' && !drag) {
        event.preventDefault()
        rectBeforeAlt = rect
        phase = 'element'
        hideLoupe()
        paintCard()
        highlightElement(pointer)
        paint()
      }
    }

    function onKeyUp(event: KeyboardEvent) {
      if (event.key === 'Alt') leaveElementMode()
    }

    layer.addEventListener('mousemove', onMouseMove)
    layer.addEventListener('mousedown', onMouseDown)
    layer.addEventListener('mouseup', onMouseUp)
    layer.addEventListener('click', onClick, true)
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)

    // Without a 2d context the loupe never draws, but the empty canvas frame would
    // still sit in the top-left corner — hide it right away.
    if (loupeGone) hideLoupe()

    paintCard()
    setPreset('free')
    paint()
  })
}
