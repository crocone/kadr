import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { CORE_FILE, OCR_RUNTIME, WORKER_FILE } from './runtime'

const root = resolve(__dirname, '../../..')

describe('OCR runtime', () => {
  // A file missing from the package means the worker loads but the core 404s —
  // visible only in the live extension.
  it('copies files that actually exist in node_modules', () => {
    for (const { from } of OCR_RUNTIME) {
      expect(existsSync(resolve(root, 'node_modules', from))).toBe(true)
    }
  })

  it('copies exactly what the engine asks for', () => {
    const copied = OCR_RUNTIME.map((file) => file.to)

    expect(copied).toContain(WORKER_FILE)
    expect(copied).toContain(CORE_FILE)
  })

  // The core path must end in `.js`: tesseract takes such a path as-is, while for a
  // directory it picks a variant itself — possibly one we didn't ship.
  it('names the core as a file, not as a folder', () => {
    expect(CORE_FILE.endsWith('.js')).toBe(true)
  })

  // The core variant matches the manifest requirements: relaxedsimd exists since
  // Chrome 114, and the extension requires 124.
  it('takes the relaxed SIMD lstm core', () => {
    expect(CORE_FILE).toContain('relaxedsimd-lstm')
  })

  it('carries no more than it needs', () => {
    expect(OCR_RUNTIME).toHaveLength(2)
  })
})
