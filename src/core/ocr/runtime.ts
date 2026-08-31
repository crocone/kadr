/**
 * OCR files shipped inside the extension package.
 *
 * One list shared by both sides: the build copies files from it, and the engine
 * requests them by it. If they drift apart, the failure only shows up in the live
 * extension — the worker loads but the core 404s.
 *
 * Names are not hashed: the core looks up its binary next to the loader by name.
 */

/** Directory for these files inside the package. */
export const OCR_DIR = 'ocr'

export const WORKER_FILE = `${OCR_DIR}/worker.min.js`

/**
 * The core variant is chosen once here, not detected at runtime.
 *
 * `relaxedsimd` exists in every Chromium since 114 and the extension requires 124,
 * so there is nothing to detect. `lstm` because the engine only runs in that mode:
 * the full model set is twice as heavy and unnecessary for screenshot text.
 *
 * Shipping all six variants "just in case" would add twenty megabytes to the package.
 */
export const CORE_FILE = `${OCR_DIR}/tesseract-core-relaxedsimd-lstm.wasm.js`

/** What to copy from node_modules and under what name. */
export const OCR_RUNTIME: readonly { from: string; to: string }[] = [
  { from: 'tesseract.js/dist/worker.min.js', to: WORKER_FILE },
  { from: 'tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js', to: CORE_FILE },
]
