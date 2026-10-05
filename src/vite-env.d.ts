/// <reference types="vite/client" />

/** CRXJS resolves to the built script's path, for chrome.scripting.executeScript. */
declare module '*?script' {
  const src: string
  export default src
}

declare module '*?script&module' {
  const src: string
  export default src
}

/** Self-contained IIFE bundle: no loader, no dynamic import. */
declare module '*?iife' {
  const src: string
  export default src
}

/**
 * `gifenc` ships without types. Only the three entry points the clip exporter uses are
 * declared — a hand-written full surface for a library we call in one file would rot
 * silently the first time it changed.
 */
declare module 'gifenc' {
  export function quantize(rgba: Uint8ClampedArray, maxColors: number): number[][]
  export function applyPalette(rgba: Uint8ClampedArray, palette: number[][]): Uint8Array
  export function GIFEncoder(): {
    writeFrame: (
      index: Uint8Array,
      width: number,
      height: number,
      options: { palette: number[][]; delay: number },
    ) => void
    finish: () => void
    bytes: () => Uint8Array
  }
}

/**
 * `captureStream` on a media element is Chromium-only and not in the DOM lib. The clip
 * exporter uses it to lift the recorded audio track into the WebM it renders, which is
 * the whole reason that format keeps its sound.
 */
interface HTMLMediaElement {
  captureStream?: () => MediaStream
}
