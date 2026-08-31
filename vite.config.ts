import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { crx } from '@crxjs/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

import { OCR_RUNTIME } from './src/core/ocr/runtime.ts'
import manifest from './manifest.config.ts'

const root = dirname(fileURLToPath(import.meta.url))

/**
 * OCR files go into the package under their own names, no hashes.
 *
 * A regular import fails here twice over. The tesseract worker gets wrapped in a
 * blob, which the extension CSP won't execute — so it must live at its own URL. And
 * the wasm core looks for its binary next to itself by name: a renamed loader can no
 * longer find it.
 *
 * The list is shared with the engine (`src/core/ocr/runtime.ts`): what we ship is
 * what we request.
 */

function copyOcrRuntime(): Plugin {
  return {
    name: 'kadr:ocr-runtime',
    generateBundle() {
      for (const { from, to } of OCR_RUNTIME) {
        this.emitFile({
          type: 'asset',
          fileName: to,
          source: readFileSync(resolve(root, 'node_modules', from)),
        })
      }
    },
  }
}

export default defineConfig({
  resolve: {
    alias: { '@': resolve(root, 'src') },
  },
  plugins: [react(), tailwindcss(), crx({ manifest }), copyOcrRuntime()],
  build: {
    target: 'chrome124',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        popup: resolve(root, 'src/popup/index.html'),
        editor: resolve(root, 'src/editor/index.html'),
        options: resolve(root, 'src/options/index.html'),
        library: resolve(root, 'src/library/index.html'),
        guide: resolve(root, 'src/guide/index.html'),
        welcome: resolve(root, 'src/welcome/index.html'),
        offscreen: resolve(root, 'src/offscreen/index.html'),
      },
    },
  },
  server: {
    port: 5273,
    strictPort: true,
    hmr: { port: 5274 },
  },
  legacy: {
    // CRXJS writes the manifest during the build; Vite's WebSocket token check
    // is not applicable to an extension dev server on a fixed localhost port.
    skipWebSocketTokenCheck: true,
  },
})
