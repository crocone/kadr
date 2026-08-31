/**
 * Document model. Both the preview and the export render from it — which removes
 * the whole class of "screen says one thing, file says another" bugs.
 *
 * Layers and canvas fields are deliberately wider than the current phase can use:
 * the type is a contract between phases, and adding a field later costs a storage
 * migration.
 */
import type { CaptureRecipe } from '@/core/capture/recipe'

export type DocId = string
export type ImageId = string
export type LayerId = string

export type Rect = { x: number; y: number; w: number; h: number }
export type Point = { x: number; y: number }

export type SolidBackground = { kind: 'solid'; color: string }
export type GradientBackground = {
  kind: 'gradient'
  from: string
  to: string
  /** Angle in degrees, 0 — left to right. */
  angle: number
}
export type ImageBackground = { kind: 'image'; imageId: ImageId; fit: 'cover' | 'contain' | 'tile' }

/**
 * Wallpapers are drawn in code from a colour pair: the pattern is a type, not an
 * image file. No third-party wallpapers in the repo, ever, so there's
 * nothing to store — a pattern name and two colours suffice.
 */
export type WallpaperPattern = 'mesh' | 'dots' | 'grid' | 'stripes' | 'rings'
export type WallpaperBackground = {
  kind: 'wallpaper'
  pattern: WallpaperPattern
  from: string
  to: string
  angle: number
}
export type TransparentBackground = { kind: 'transparent' }
export type Background =
  | SolidBackground
  | GradientBackground
  | WallpaperBackground
  | ImageBackground
  | TransparentBackground

export type ShadowPreset = 'none' | 'soft' | 'hard' | 'float' | 'neon'
export type Shadow = {
  preset: ShadowPreset
  offsetX: number
  offsetY: number
  blur: number
  opacity: number
  color: string
}

export type BrowserFrameStyle = 'none' | 'macos' | 'windows11'
export type BrowserFrame = {
  style: BrowserFrameStyle
  theme: 'light' | 'dark'
  url: string
  showUrl: boolean
}

export type DeviceMockup =
  'none' | 'iphone-16-pro' | 'pixel-9-pro' | 'ipad-pro-m4' | 'macbook-pro' | 'custom'

/**
 * User-supplied mockup: an image plus where the screen sits on it.
 *
 * The zone is stored as fractions of the image, not pixels: swap the mockup for
 * the same one at twice the size and the markup stays valid.
 */
export type CustomMockup = { imageId: ImageId; screen: Rect }

export type CanvasPreset =
  | 'auto'
  | 'custom'
  | '16:9'
  | '4:3'
  | '1:1'
  | '3:2'
  | '4:5'
  | '9:16'
  | '21:9'
  | 'x'
  | 'linkedin'
  | 'instagram'
  | 'youtube'
  | 'vk'
  | 'telegram'
  | 'max'

export type DocCanvas = {
  w: number
  h: number
  preset: CanvasPreset
  background: Background
  /** Gap between the capture and the canvas edge, px. */
  padding: number
  /** Capture corner radius, px. */
  radius: number
  shadow: Shadow
  frame: BrowserFrame
  mockup: DeviceMockup
  /** Set when mockup === 'custom'. */
  customMockup: CustomMockup | null
}

export type ImageFilters = {
  brightness: number
  contrast: number
  saturation: number
  hue: number
}

export type DocCapture = {
  imageId: ImageId
  /**
   * Natural capture size in CSS pixels. Stored explicitly rather than derived
   * from the canvas: when the aspect changes, the canvas grows around the
   * capture, and without these numbers the shot would have to be stretched to
   * fit the canvas — i.e. distorted.
   */
  width: number
  height: number
  /** The capture can be hidden or removed like a layer; then `imageId` is empty. */
  visible: boolean
  /** Capture scale relative to its original size. */
  scale: number
  rotation: number
  tilt: Point
  offset: Point
  filters: ImageFilters
  crop: Rect | null
}

type LayerBase = {
  id: LayerId
  name: string
  visible: boolean
  locked: boolean
  opacity: number
  rotation: number
}

export type TextLayer = LayerBase & {
  kind: 'text'
  at: Point
  text: string
  fontFamily: string
  fontSize: number
  fontWeight: number
  color: string
  align: 'left' | 'center' | 'right'
  /**
   * Text-box width. `null` — sized to content: the line grows as you type.
   * The transformer drags this, not the font size: stretching the glyphs
   * themselves is deformation, not resizing a caption.
   */
  width: number | null
}

export type ArrowLayer = LayerBase & {
  kind: 'arrow'
  points: Point[]
  style: 'straight' | 'curved' | 'elbow' | 'double' | 'thin' | 'thick' | 'sketch'
  color: string
  width: number
}

export type ShapeLayer = LayerBase & {
  kind: 'shape'
  shape: 'rect' | 'ellipse' | 'line' | 'callout'
  rect: Rect
  stroke: string
  strokeWidth: number
  fill: string | null
}

/**
 * Capture chrome: browser frame or device body, rounding and shadow.
 *
 * Shared by the document capture and image layers, because in a responsive
 * series they are equal frames: the chrome goes on the chosen one, not on
 * whichever came first.
 */
export type Decoration = {
  frame: BrowserFrame
  mockup: DeviceMockup
  customMockup: CustomMockup | null
  radius: number
  shadow: Shadow
}

export type ImageLayer = LayerBase & {
  kind: 'image'
  imageId: ImageId
  rect: Rect
  /** `null` — an undecorated image, as it was before frames existed. */
  decoration: Decoration | null
}
export type EmojiLayer = LayerBase & { kind: 'emoji'; at: Point; emoji: string; size: number }

/** Blur is a layer, not burned-in pixels: it can be moved or removed later. */
export type BlurLayer = LayerBase & {
  kind: 'blur'
  rect: Rect
  mode: 'blur' | 'pixelate'
  strength: number
}

/** What the badge shows: a number, a roman numeral, or a plain bullet. */
export type BadgeStyle = 'number' | 'roman' | 'bullet'

export type BadgeLayer = LayerBase & {
  kind: 'badge'
  at: Point
  /** The number is computed at render time from badge order; this is a manual override. */
  number: number | null
  style: BadgeStyle
  color: string
  size: number
}

export type SpotlightLayer = LayerBase & {
  kind: 'spotlight'
  rect: Rect
  shape: 'rect' | 'ellipse'
  dimOpacity: number
}

export type DrawLayer = LayerBase & {
  kind: 'draw'
  points: number[]
  color: string
  width: number
  mode: 'pen' | 'highlighter'
}

export type PiiKind = 'email' | 'phone' | 'card' | 'token' | 'name' | 'address' | 'avatar' | 'other'

/** A redaction finding: kept as its own layer type so the findings panel can track it. */
export type RedactLayer = LayerBase & {
  kind: 'redact'
  rect: Rect
  mode: 'blur' | 'pixelate' | 'fill'
  piiKind: PiiKind
  confidence: number
  source: 'manual' | 'ocr' | 'ai'
}

export type Layer =
  | TextLayer
  | ArrowLayer
  | ShapeLayer
  | ImageLayer
  | EmojiLayer
  | BlurLayer
  | BadgeLayer
  | SpotlightLayer
  | DrawLayer
  | RedactLayer

export type LayerKind = Layer['kind']

/**
 * A past capture of the document. Re-capture doesn't discard the old shot but
 * moves it here: before/after diff material comes for free, and a mistaken
 * re-capture can be reverted without shooting again.
 */
export type CaptureVersion = {
  imageId: ImageId
  width: number
  height: number
  capturedAt: number
}

export type Doc = {
  /** Schema version: storage migrations key off this, not the extension version. */
  version: 1
  id: DocId
  title: string
  createdAt: number
  updatedAt: number
  source: { url: string; title: string; domain: string } | null
  tags: string[]
  canvas: DocCanvas
  capture: DocCapture
  layers: Layer[]
  /**
   * How this capture was taken. Optional: documents shot before 1.1 sit in the
   * database without these fields, and IndexedDB returns them exactly as stored —
   * so no migration is needed, and such documents just don't get a re-capture
   * button.
   */
  recipe?: CaptureRecipe | null
  /** Past captures, newest last. */
  history?: CaptureVersion[]
}
