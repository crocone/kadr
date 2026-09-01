/**
 * Renders the browser chrome and device body.
 *
 * Everything is drawn as one shape behind the capture, in the capture's own
 * coordinate system: the origin is its top-left corner, so the header goes into
 * negative Y and the body extends in all directions. That way the decoration
 * inherits the capture's rotation and tilt for free, with no second set of
 * transforms to keep in sync with the first.
 *
 * Shapes only — rects, circles, gradients, text. No third-party images: device
 * bodies are someone else's industrial designs, and a metal gradient with the
 * right proportions reads as a phone just as well.
 *
 * Only the outer silhouette casts the document shadow. Konva puts the shadow on
 * the context before calling the painter, so every later fill would cast one of
 * its own — a traffic light with a drop shadow is how a mockup starts looking fake.
 */
import type Konva from 'konva'

import {
  BASE,
  BUTTON_DEPTH,
  chromeHeight,
  customMockupRect,
  DEVICES,
  displayUrl,
  faviconFor,
  TAB_STRIP,
} from '@/core/doc/frames'
import type { DeviceMaterial, DeviceSpec } from '@/core/doc/frames'
import type { BrowserFrame, Decoration, DeviceMockup } from '@/core/doc/types'

type Palette = {
  /** Tab strip, the topmost row. */
  strip: string
  /** Toolbar and the active tab — one colour, so the tab merges into the row below. */
  toolbar: string
  tabEdge: string
  /** Address pill. */
  omni: string
  omniEdge: string
  /** Hairline under the toolbar and along the window top. */
  edge: string
  gloss: string
  text: string
  muted: string
  /** Placeholder bars standing in for the other tabs. */
  ghost: string
}

const LIGHT: Palette = {
  strip: '#dee1e6',
  toolbar: '#ffffff',
  tabEdge: 'rgba(0,0,0,0.07)',
  omni: '#f1f3f4',
  omniEdge: 'rgba(0,0,0,0.06)',
  edge: 'rgba(0,0,0,0.12)',
  gloss: 'rgba(255,255,255,0.65)',
  text: '#3c4043',
  muted: '#5f6368',
  ghost: '#b4bac1',
}

const DARK: Palette = {
  strip: '#1c1d20',
  toolbar: '#35363a',
  tabEdge: 'rgba(255,255,255,0.06)',
  omni: '#202124',
  omniEdge: 'rgba(255,255,255,0.07)',
  edge: 'rgba(0,0,0,0.5)',
  gloss: 'rgba(255,255,255,0.07)',
  text: '#e8eaed',
  muted: '#9aa0a6',
  ghost: '#5f6368',
}

/** Traffic-light dots on the left: the one detail that says macOS. */
const TRAFFIC = ['#ff5f57', '#febc2e', '#28c840']

/**
 * Metal finishes, from the lit corner to the shaded one and back.
 *
 * Four stops rather than two: a flat two-stop ramp reads as grey plastic, while the
 * bright band returning near the bottom edge is what makes an anodised rim look bent.
 */
const FINISH: Record<DeviceMaterial, { light: string[]; dark: string[] }> = {
  titanium: {
    light: ['#d3cec6', '#a49d93', '#7d766c', '#bab4ab'],
    dark: ['#54514d', '#39352f', '#24211d', '#46423c'],
  },
  obsidian: {
    light: ['#e6e3dd', '#c6c1b8', '#a09a90', '#d8d4cd'],
    dark: ['#43454a', '#2a2c30', '#17181b', '#3a3c41'],
  },
  aluminium: {
    light: ['#e2e4e7', '#c0c3c8', '#93979d', '#d2d5d9'],
    dark: ['#3f4145', '#2c2e31', '#1a1b1e', '#37393d'],
  },
}

/**
 * The glass border around the screen, and the cutouts punched into it.
 *
 * The border is a shade off black on purpose: against a pure-black island the
 * difference is what makes the cutout visible at all.
 */
const GLASS = '#101318'
const CUTOUT = '#000000'

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
  const limit = Math.min(w, h) / 2
  const [tl = 0, tr = 0, br = 0, bl = 0] = r.map((value) => Math.max(0, Math.min(limit, value)))

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
  color: string | CanvasGradient,
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

function strokeRounded(
  context: Konva.Context,
  color: string,
  width: number,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number | number[],
) {
  roundedRect(context, x, y, w, h, radius)
  context.setAttr('strokeStyle', color)
  context.setAttr('lineWidth', Math.max(0.5, width))
  context.stroke()
}

function line(context: Konva.Context, color: string, width: number, points: [number, number][]) {
  const [first, ...rest] = points
  if (!first) return

  context.beginPath()
  context.moveTo(first[0], first[1])
  for (const [x, y] of rest) context.lineTo(x, y)
  context.setAttr('strokeStyle', color)
  context.setAttr('lineWidth', Math.max(1, width))
  context.setAttr('lineCap', 'round')
  context.setAttr('lineJoin', 'round')
  context.stroke()
}

function dot(context: Konva.Context, color: string, x: number, y: number, r: number) {
  context.beginPath()
  context.arc(x, y, r, 0, Math.PI * 2)
  context.setAttr('fillStyle', color)
  context.fill()
}

function label(
  context: Konva.Context,
  text: string,
  x: number,
  y: number,
  size: number,
  color: string,
  weight = 400,
  align: 'left' | 'center' = 'left',
) {
  context.setAttr('fillStyle', color)
  context.setAttr('font', `${weight} ${size}px system-ui, -apple-system, sans-serif`)
  context.setAttr('textAlign', align)
  context.setAttr('textBaseline', 'middle')
  context.fillText(text, x, y)
}

/** The silhouette has been laid down; from here on nothing should cast a shadow. */
function clearShadow(context: Konva.Context) {
  context.setAttr('shadowColor', 'rgba(0,0,0,0)')
  context.setAttr('shadowBlur', 0)
  context.setAttr('shadowOffsetX', 0)
  context.setAttr('shadowOffsetY', 0)
}

/**
 * A browser tab: rounded on top, and flaring outwards at the bottom so it merges
 * into the toolbar. The flare is the whole reason a drawn tab looks like a tab.
 */
function tabPath(context: Konva.Context, x: number, y: number, w: number, h: number, r: number) {
  context.beginPath()
  context.moveTo(x - r, y + h)
  context.quadraticCurveTo(x, y + h, x, y + h - r)
  context.lineTo(x, y + r)
  context.quadraticCurveTo(x, y, x + r, y)
  context.lineTo(x + w - r, y)
  context.quadraticCurveTo(x + w, y, x + w, y + r)
  context.lineTo(x + w, y + h - r)
  context.quadraticCurveTo(x + w, y + h, x + w + r, y + h)
  context.closePath()
}

/** Padlock in the address bar — the detail every real omnibox has. */
function padlock(context: Konva.Context, x: number, y: number, size: number, color: string) {
  const w = size * 0.72
  const h = size * 0.56
  fillRounded(context, color, x - w / 2, y - h / 2 + size * 0.12, w, h, size * 0.14)

  context.beginPath()
  context.arc(x, y - h / 2 + size * 0.1, w * 0.32, Math.PI, 0)
  context.setAttr('strokeStyle', color)
  context.setAttr('lineWidth', Math.max(1, size * 0.13))
  context.stroke()
}

/** Reload glyph: a nearly closed ring with an arrowhead where it opens. */
function reload(context: Konva.Context, x: number, y: number, r: number, color: string, w: number) {
  context.beginPath()
  context.arc(x, y, r, Math.PI * 0.42, Math.PI * 2)
  context.setAttr('strokeStyle', color)
  context.setAttr('lineWidth', Math.max(1, w))
  context.setAttr('lineCap', 'round')
  context.stroke()

  const tip = r * 0.5
  line(context, color, w, [
    [x + r - tip, y - tip * 0.2],
    [x + r, y + tip * 0.35],
    [x + r + tip, y - tip * 0.2],
  ])
}

/** The tab strip: window buttons, the active tab, a couple of neighbours, and a plus. */
function drawTabs(
  context: Konva.Context,
  width: number,
  top: number,
  tabH: number,
  frame: BrowserFrame,
  domain: string | null,
  p: Palette,
) {
  const mac = frame.style === 'macos'
  const mid = top + tabH / 2
  let tabsX = tabH * 0.4
  let tabsRight = width - tabH * 0.6

  if (mac) {
    const r = tabH * 0.15
    const gap = r * 3.4
    const left = tabH * 0.62

    TRAFFIC.forEach((color, index) => {
      dot(context, color, left + index * gap, mid, r)
      context.beginPath()
      context.arc(left + index * gap, mid, r, 0, Math.PI * 2)
      context.setAttr('strokeStyle', 'rgba(0,0,0,0.14)')
      context.setAttr('lineWidth', Math.max(0.5, r * 0.12))
      context.stroke()
    })

    tabsX = left + gap * 2 + r * 3.2
  } else {
    // Windows: minimise, restore, close on the right of the strip.
    const size = tabH * 0.24
    const step = tabH * 1.05
    const right = width - tabH * 0.7
    const w = Math.max(1, tabH * 0.045)

    line(context, p.muted, w, [
      [right - step * 2 - size / 2, mid],
      [right - step * 2 + size / 2, mid],
    ])
    strokeRounded(
      context,
      p.muted,
      w,
      right - step - size / 2,
      mid - size / 2,
      size,
      size,
      size * 0.12,
    )
    line(context, p.muted, w, [
      [right - size / 2, mid - size / 2],
      [right + size / 2, mid + size / 2],
    ])
    line(context, p.muted, w, [
      [right + size / 2, mid - size / 2],
      [right - size / 2, mid + size / 2],
    ])

    tabsRight = right - step * 2 - tabH
  }

  const room = tabsRight - tabsX
  if (room < tabH * 2) return

  const tabW = Math.min(Math.max(width * 0.19, tabH * 4), room * 0.5)
  const tabY = top + tabH * 0.2
  const tabHeight = top + tabH - tabY
  const corner = tabH * 0.2

  // The active tab reaches the toolbar and shares its colour, so the two read as one surface.
  tabPath(context, tabsX + corner, tabY, tabW, tabHeight, corner)
  context.setAttr('fillStyle', p.toolbar)
  context.fill()
  context.setAttr('strokeStyle', p.tabEdge)
  context.setAttr('lineWidth', 1)
  context.stroke()

  const pad = tabH * 0.26
  const icon = tabH * 0.34
  const iconX = tabsX + corner + pad
  const { letter, color } = faviconFor(frame.url || (domain ?? ''))

  fillRounded(context, color, iconX, tabY + tabHeight / 2 - icon / 2, icon, icon, icon * 0.26)
  label(
    context,
    letter,
    iconX + icon / 2,
    tabY + tabHeight / 2,
    icon * 0.66,
    '#ffffff',
    600,
    'center',
  )

  const textX = iconX + icon + pad * 0.6
  const closeX = tabsX + corner + tabW - pad * 0.9
  if (frame.showUrl) {
    const title = (displayUrl(frame.url, domain).split('/')[0] ?? '').replace(/^www\./, '')
    context.save()
    context.beginPath()
    context.rect(textX, tabY, Math.max(0, closeX - textX - pad * 0.5), tabHeight)
    context.clip()
    label(context, title, textX, tabY + tabHeight / 2, tabH * 0.3, p.text, 500)
    context.restore()
  }

  const cross = tabH * 0.1
  line(context, p.muted, Math.max(1, tabH * 0.032), [
    [closeX - cross, tabY + tabHeight / 2 - cross],
    [closeX + cross, tabY + tabHeight / 2 + cross],
  ])
  line(context, p.muted, Math.max(1, tabH * 0.032), [
    [closeX + cross, tabY + tabHeight / 2 - cross],
    [closeX - cross, tabY + tabHeight / 2 + cross],
  ])

  // Neighbouring tabs: a favicon dot and a title bar each, no invented site names.
  let x = tabsX + corner + tabW + corner
  for (let index = 0; index < 2; index += 1) {
    if (x + tabW * 0.9 > tabsRight) break

    line(context, p.ghost, 1, [
      [x, mid - tabH * 0.16],
      [x, mid + tabH * 0.16],
    ])
    dot(context, p.ghost, x + pad + icon * 0.5, mid, icon * 0.42)
    fillRounded(
      context,
      p.ghost,
      x + pad + icon * 1.3,
      mid - tabH * 0.06,
      Math.min(tabW * 0.44, tabsRight - x - pad - icon * 1.6),
      tabH * 0.12,
      tabH * 0.06,
    )
    x += tabW * 0.92
  }

  if (x + tabH * 0.8 < tabsRight) {
    const plus = tabH * 0.14
    line(context, p.muted, Math.max(1, tabH * 0.045), [
      [x + tabH * 0.4 - plus, mid],
      [x + tabH * 0.4 + plus, mid],
    ])
    line(context, p.muted, Math.max(1, tabH * 0.045), [
      [x + tabH * 0.4, mid - plus],
      [x + tabH * 0.4, mid + plus],
    ])
  }
}

/** Toolbar row: navigation glyphs, the address pill, and the menu. */
function drawToolbar(
  context: Konva.Context,
  width: number,
  barH: number,
  frame: BrowserFrame,
  domain: string | null,
  p: Palette,
) {
  const mid = -barH / 2
  const stroke = Math.max(1, barH * 0.055)
  const r = barH * 0.17
  const step = barH * 0.82
  const first = barH * 0.6

  line(context, p.muted, stroke, [
    [first + r * 0.5, mid - r],
    [first - r * 0.5, mid],
    [first + r * 0.5, mid + r],
  ])
  line(context, p.muted, stroke, [
    [first + step - r * 0.5, mid - r],
    [first + step + r * 0.5, mid],
    [first + step - r * 0.5, mid + r],
  ])
  reload(context, first + step * 2, mid, r, p.muted, stroke)

  const menuX = width - barH * 0.62
  for (let index = -1; index <= 1; index += 1) {
    dot(context, p.muted, menuX, mid + index * barH * 0.19, Math.max(1, barH * 0.045))
  }

  const omniX = first + step * 2.8
  const omniW = menuX - barH * 0.55 - omniX
  const omniH = barH * 0.58
  if (omniW <= omniH) return

  fillRounded(context, p.omni, omniX, mid - omniH / 2, omniW, omniH, omniH / 2)
  strokeRounded(context, p.omniEdge, 1, omniX, mid - omniH / 2, omniW, omniH, omniH / 2)

  if (!frame.showUrl) return

  const lockX = omniX + omniH * 0.62
  padlock(context, lockX, mid, omniH * 0.44, p.muted)

  const text = displayUrl(frame.url, domain)
  if (!text) return

  const textX = lockX + omniH * 0.5
  context.save()
  context.beginPath()
  context.rect(textX, mid - omniH / 2, omniX + omniW - textX - omniH * 0.4, omniH)
  context.clip()
  label(context, text, textX, mid + omniH * 0.02, omniH * 0.46, p.text)
  context.restore()
}

/** Browser window above the capture. Width and height are in capture coordinates. */
function drawBrowser(
  context: Konva.Context,
  width: number,
  height: number,
  frame: BrowserFrame,
  domain: string | null,
  radius: number,
) {
  const p = frame.theme === 'dark' ? DARK : LIGHT
  const head = chromeHeight(width)
  const tabH = head * TAB_STRIP
  const barH = head - tabH
  const top = -head

  // Window and capture form one box, rounded on all four corners: the capture rounds
  // its own bottom, and a square corner behind it would poke out as a grey wedge.
  fillRounded(context, p.strip, 0, top, width, height + head, radius)
  clearShadow(context)

  // Toolbar row, flush with the capture below it.
  fillRounded(context, p.toolbar, 0, -barH, width, barH, 0)

  drawTabs(context, width, top, tabH, frame, domain, p)
  drawToolbar(context, width, barH, frame, domain, p)

  // Hairline under the toolbar: without it the row blends into a light capture.
  line(context, p.edge, Math.max(1, head * 0.012), [
    [0, -0.5],
    [width, -0.5],
  ])
  // And a lit top edge, so the window has a rim instead of ending in flat colour.
  line(context, p.gloss, 1, [
    [radius * 0.7, top + 0.5],
    [width - radius * 0.7, top + 0.5],
  ])
}

/** Buttons straddling the body edge, drawn first so the body covers their inner half. */
function drawButtons(
  context: Konva.Context,
  width: number,
  height: number,
  mockup: Exclude<DeviceMockup, 'none'>,
  color: string,
) {
  const spec = DEVICES[mockup]
  const side = Math.min(width, height)
  const bezel = side * spec.bezel
  const depth = side * BUTTON_DEPTH

  for (const button of spec.buttons) {
    const y = height * button.at
    const h = height * button.len
    const w = depth + bezel * 0.6
    const x = button.side === 'left' ? -bezel - depth : width + bezel - w + depth

    fillRounded(context, color, x, y, w, h, depth * 0.9)
  }
}

/** Where the laptop deck sits, in capture coordinates. */
function baseBox(width: number, height: number, bezel: number) {
  const h = width * BASE.height
  const overhang = width * BASE.overhang

  return {
    h,
    y: height + bezel,
    left: -bezel - overhang,
    right: width + bezel + overhang,
    /** The deck is narrower at the bottom than at the hinge — that taper is the whole look. */
    taper: h * 0.5,
  }
}

/** Laptop deck under the screen: a tapered slab, drawn before the lid so it shares the shadow. */
function fillBase(
  context: Konva.Context,
  width: number,
  height: number,
  bezel: number,
  stops: string[],
) {
  const { h, y, left, right, taper } = baseBox(width, height, bezel)
  const r = h * 0.55
  // The deck is seen edge on, so its light runs top to bottom, not across the body.
  const fill = context.createLinearGradient(0, y, 0, y + h)
  fill.addColorStop(0, stops[1] ?? '#bbb')
  fill.addColorStop(0.35, stops[0] ?? '#ddd')
  fill.addColorStop(1, stops[2] ?? '#999')

  context.beginPath()
  context.moveTo(left, y)
  context.lineTo(right, y)
  context.lineTo(right - taper, y + h - r)
  context.quadraticCurveTo(right - taper, y + h, right - taper - r, y + h)
  context.lineTo(left + taper + r, y + h)
  context.quadraticCurveTo(left + taper, y + h, left + taper, y + h - r)
  context.closePath()
  context.setAttr('fillStyle', fill)
  context.fill()
}

/** Hinge line along the top of the deck, and the notch the lid is opened by. */
function detailBase(
  context: Konva.Context,
  width: number,
  height: number,
  bezel: number,
  shade: string,
  lit: string,
) {
  const { h, y, left, right, taper } = baseBox(width, height, bezel)

  line(context, shade, Math.max(1, h * 0.16), [
    [left + taper * 0.2, y + h * 0.06],
    [right - taper * 0.2, y + h * 0.06],
  ])
  line(context, lit, Math.max(1, h * 0.07), [
    [left + taper * 0.7, y + h * 0.22],
    [right - taper * 0.7, y + h * 0.22],
  ])

  // No recess at the hinge: on a laptop seen head on the finger notch is on the front
  // edge, out of sight. A dark blob in the middle of the deck only reads as a smudge.
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
  const rim = bezel * spec.rim
  const bodyRadius = side * spec.bodyRadius + bezel

  const stops = FINISH[spec.material][theme]
  const metal = context.createLinearGradient(-bezel, -bezel, width + bezel, height + bezel)
  stops.forEach((color, index) => {
    metal.addColorStop(index / (stops.length - 1), color)
  })

  const lit = theme === 'dark' ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.5)'
  const shade = theme === 'dark' ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.28)'

  if (spec.base) fillBase(context, width, height, bezel, stops)
  drawButtons(context, width, height, mockup, stops[2] ?? '#555')

  fillRounded(context, metal, -bezel, -bezel, width + bezel * 2, height + bezel * 2, bodyRadius)
  clearShadow(context)

  if (spec.base) detailBase(context, width, height, bezel, shade, lit)

  // Polished rim: a lit hairline just inside the edge, a dark one on the edge itself.
  strokeRounded(
    context,
    lit,
    Math.max(1, bezel * 0.12),
    -bezel + bezel * 0.09,
    -bezel + bezel * 0.09,
    width + bezel * 1.82,
    height + bezel * 1.82,
    bodyRadius - bezel * 0.09,
  )
  strokeRounded(
    context,
    shade,
    1,
    -bezel,
    -bezel,
    width + bezel * 2,
    height + bezel * 2,
    bodyRadius,
  )

  // Black glass border between the rim and the screen.
  const inset = bezel - rim
  const glassRadius = side * spec.screenRadius + inset
  fillRounded(context, GLASS, -inset, -inset, width + inset * 2, height + inset * 2, glassRadius)
  strokeRounded(
    context,
    'rgba(255,255,255,0.09)',
    Math.max(0.5, inset * 0.12),
    -inset,
    -inset,
    width + inset * 2,
    height + inset * 2,
    glassRadius,
  )

  drawCutout(context, width, spec.cutout, inset)
}

/** Camera hardware in the top bezel: island, punch-hole, notch, or a bare lens. */
function drawCutout(
  context: Konva.Context,
  width: number,
  cutout: DeviceSpec['cutout'],
  inset: number,
) {
  const mid = -inset / 2

  if (cutout === 'island') {
    const w = Math.min(width * 0.3, inset * 10)
    const h = inset * 0.74
    const y = -inset + (inset - h) / 2
    fillRounded(context, CUTOUT, (width - w) / 2, y, w, h, h / 2)
    strokeRounded(context, 'rgba(255,255,255,0.07)', 0.6, (width - w) / 2, y, w, h, h / 2)
    // Lens and sensor, the two dots that sit inside a real island.
    dot(context, '#141a26', width / 2 + w * 0.31, y + h / 2, h * 0.3)
    dot(context, 'rgba(96,138,198,0.55)', width / 2 + w * 0.31, y + h / 2, h * 0.13)
    dot(context, '#0c0f14', width / 2 - w * 0.33, y + h / 2, h * 0.16)
    return
  }

  if (cutout === 'hole') {
    dot(context, CUTOUT, width / 2, mid, inset * 0.4)
    dot(context, 'rgba(88,128,190,0.5)', width / 2, mid, inset * 0.17)
    return
  }

  if (cutout === 'camera') {
    dot(context, CUTOUT, width / 2, mid, inset * 0.22)
    dot(context, 'rgba(96,138,198,0.45)', width / 2, mid, inset * 0.09)
    return
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
