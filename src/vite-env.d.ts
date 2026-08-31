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
