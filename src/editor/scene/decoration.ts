/**
 * Renders the browser chrome and device body.
 *
 * Everything is drawn as one shape behind the capture, in the capture's own
 * coordinate system: the origin is its top-left corner, so the header goes into
 * negative Y and the body extends in all directions. That way the decoration
 * inherits the capture's rotation and tilt for free, with no second set of
 * transforms to keep in sync with the first.
 *
 * Shapes only — rects, circles, text. No third-party images: device bodies are
 * someone else's industrial designs, and a rounded rectangle with the right
 * proportions reads as a phone just as well.
 */
import type Konva from 'konva'

import {
  BASE,
  chromeHeight,
  customMockupRect,
  DEVICES,
  displayUrl,
  faviconFor,
} from '@/core/doc/frames'
import type { BrowserFrame, Decoration, DeviceMockup } from '@/core/doc/types'

type Palette = {
  head: string
  headEdge: string
  bar: string
  barEdge: string
  text: string
  muted: string
}

const LIGHT: Palette = {
  head: '#e9eaee',
  headEdge: '#d3d5dc',
  bar: '#ffffff',
  barEdge: '#dcdee5',
  text: '#31333d',
  muted: '#8b8f9c',
}

const DARK: Palette = {
  head: '#25262b',
  headEdge: '#34363d',
  bar: '#33353c',
  barEdge: '#3f424a',
  text: '#e6e7ea',
  muted: '#8f939e',
}

/** Traffic-light dots on the left: the one detail that says macOS. */
const TRAFFIC = ['#ff5f57', '#febc2e', '#28c840']

function roundedRect(
  context: Konva.Context,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number | number[],
) {
  context.beginPath()
  const r = Array.isArray(radius) ? radius : [radius, radius, radius, radius]
  const [tl = 0, tr = 0, br = 0, bl = 0] = r

  context.moveTo(x + tl, y)
  context.lineTo(x + w - tr, y)
  context.quadraticCurveTo(x + w, y, x + w, y + tr)
  context.lineTo(x + w, y + h - br)
  context.quadraticCurveTo(x + w, y + h, x + w - br, y + h)
  context.lineTo(x + bl, y + h)
  context.quadraticCurveTo(x, y + h, x, y + h - bl)
  context.lineTo(x, y + tl)
  context.quadraticCurveTo(x, y, x + tl, y)
  context.closePath()
}

function fillRounded(
  context: Konva.Context,
  color: string,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number | number[],
) {
  roundedRect(context, x, y, w, h, radius)
  context.setAttr('fillStyle', color)
  context.fill()
}

/** Browser header above the capture. Width and height are in capture coordinates. */
function drawBrowser(
  context: Konva.Context,
  width: number,
  height: number,
  frame: BrowserFrame,
  domain: string | null,
  radius: number,
) {
  const palette = frame.theme === 'dark' ? DARK : LIGHT
  const head = chromeHeight(width)
  const mac = frame.style === 'macos'

  // Header and capture form one box: rounded on top only, the capture rounds the bottom.
  fillRounded(context, palette.head, 0, -head, width, height + head, [radius, radius, 0, 0])

  // Thin line under the header: without it the header blends into a light capture.
  context.setAttr('strokeStyle', palette.headEdge)
  context.setAttr('lineWidth', Math.max(1, head * 0.02))
  context.beginPath()
  context.moveTo(0, -0.5)
  context.lineTo(width, -0.5)
  context.stroke()

  const dot = head * 0.16
  const gap = dot * 2.6
  const left = head * 0.42

  if (mac) {
    TRAFFIC.forEach((color, index) => {
      context.beginPath()
      context.arc(left + index * gap, -head / 2, dot / 2, 0, Math.PI * 2)
      context.setAttr('fillStyle', color)
      context.fill()
    })
  } else {
    // Windows: three glyphs on the right — minimize, maximize, close.
    const size = head * 0.22
    const step = head * 0.62
    const right = width - head * 0.5
    context.setAttr('strokeStyle', palette.muted)
    context.setAttr('lineWidth', Math.max(1, head * 0.025))

    context.beginPath()
    context.moveTo(right - step * 2 - size / 2, -head / 2)
    context.lineTo(right - step * 2 + size / 2, -head / 2)
    context.stroke()

    context.beginPath()
    context.rect(right - step - size / 2, -head / 2 - size / 2, size, size)
    context.stroke()

    context.beginPath()
    context.moveTo(right - size / 2, -head / 2 - size / 2)
    context.lineTo(right + size / 2, -head / 2 + size / 2)
    context.moveTo(right + size / 2, -head / 2 - size / 2)
    context.lineTo(right - size / 2, -head / 2 + size / 2)
    context.stroke()
  }

  if (!frame.showUrl) return

  // Address bar. Centered on macOS, left-aligned on Windows — like the real thing.
  const barH = head * 0.5
  const barY = -head / 2 - barH / 2
  const barX = mac ? left + gap * 3 : head * 0.5
  const barW = mac ? width - barX * 2 : width - barX - head * 2.4
  if (barW <= barH) return

  fillRounded(context, palette.bar, barX, barY, barW, barH, barH / 2)
  context.setAttr('strokeStyle', palette.barEdge)
  context.setAttr('lineWidth', 1)
  context.stroke()

  const icon = barH * 0.56
  const iconX = barX + barH * 0.28
  const { letter, color } = faviconFor(frame.url || (domain ?? ''))

  fillRounded(context, color, iconX, barY + (barH - icon) / 2, icon, icon, icon * 0.28)
  context.setAttr('fillStyle', '#ffffff')
  context.setAttr('font', `600 ${icon * 0.68}px system-ui, sans-serif`)
  context.setAttr('textAlign', 'center')
  context.setAttr('textBaseline', 'middle')
  context.fillText(letter, iconX + icon / 2, barY + barH / 2 + icon * 0.02)

  const text = displayUrl(frame.url, domain)
  if (!text) return

  context.setAttr('fillStyle', palette.text)
  context.setAttr('font', `${barH * 0.46}px system-ui, sans-serif`)
  context.setAttr('textAlign', 'left')
  context.save()
  // Text is clipped to the bar rather than spilling onto the capture.
  context.beginPath()
  context.rect(iconX + icon, barY, barW - (iconX - barX) - icon - barH * 0.4, barH)
  context.clip()
  context.fillText(text, iconX + icon + barH * 0.3, barY + barH / 2)
  context.restore()
}

/** Device body around the capture. */
function drawDevice(
  context: Konva.Context,
  width: number,
  height: number,
  mockup: Exclude<DeviceMockup, 'none'>,
  theme: 'light' | 'dark',
) {
  const spec = DEVICES[mockup]
  const side = Math.min(width, height)
  const bezel = side * spec.bezel
  const bodyRadius = side * spec.bodyRadius

  const body = theme === 'dark' ? '#1c1d21' : '#2b2d33'
  const edge = theme === 'dark' ? '#35373e' : '#4a4d55'

  if (spec.base) {
    // Laptop base: a strip under the screen, overhanging both sides, with a notch in the middle.
    const baseH = width * BASE.height
    const overhang = width * BASE.overhang
    const baseY = height + bezel

    fillRounded(context, edge, -bezel - overhang, baseY, width + (bezel + overhang) * 2, baseH, [
      0,
      0,
      baseH * 0.6,
      baseH * 0.6,
    ])
    context.beginPath()
    context.arc(width / 2, baseY, width * 0.055, 0, Math.PI)
    context.setAttr('fillStyle', body)
    context.fill()
  }

  fillRounded(
    context,
    body,
    -bezel,
    -bezel,
    width + bezel * 2,
    height + bezel * 2,
    bodyRadius + bezel,
  )

  // Highlight along the body edge — otherwise a dark body vanishes on a dark background.
  roundedRect(context, -bezel, -bezel, width + bezel * 2, height + bezel * 2, bodyRadius + bezel)
  context.setAttr('strokeStyle', edge)
  context.setAttr('lineWidth', Math.max(1, bezel * 0.22))
  context.stroke()

  if (spec.cutout === 'island') {
    const w = width * 0.28
    const h = bezel * 0.62
    fillRounded(context, '#0b0c0e', (width - w) / 2, -bezel + (bezel - h) / 2, w, h, h / 2)
  }

  if (spec.cutout === 'hole') {
    context.beginPath()
    context.arc(width / 2, -bezel / 2, bezel * 0.22, 0, Math.PI * 2)
    context.setAttr('fillStyle', '#0b0c0e')
    context.fill()
  }

  if (spec.cutout === 'notch') {
    const w = width * 0.16
    const h = bezel * 0.9
    fillRounded(context, body, (width - w) / 2, -h, w, h, [0, 0, h * 0.5, h * 0.5])
  }
}

/**
 * Decoration painter for a Konva node. Passed as `sceneFunc`, so it takes width and
 * height from the shape itself — which match the capture.
 */
export function decorationScene(
  decoration: Decoration,
  domain: string | null,
  custom: HTMLImageElement | null = null,
) {
  const { frame, mockup, radius, customMockup } = decoration

  return (context: Konva.Context, shape: Konva.Shape) => {
    const width = shape.width()
    const height = shape.height()
    if (width <= 0 || height <= 0) return

    if (mockup === 'custom') {
      // The custom image is stretched so that its screen region lands exactly on the capture.
      if (!custom || !customMockup) return

      const box = customMockupRect({ x: 0, y: 0, w: width, h: height }, customMockup)
      context.drawImage(custom, box.x, box.y, box.w, box.h)
      return
    }

    if (mockup !== 'none') {
      drawDevice(context, width, height, mockup, frame.theme)
      return
    }

    if (frame.style !== 'none') drawBrowser(context, width, height, frame, domain, radius)
  }
}
