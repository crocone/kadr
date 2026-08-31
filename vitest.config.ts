import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

const root = dirname(fileURLToPath(import.meta.url))

/** Separate from vite.config.ts: the CRXJS plugin builds the extension and is not needed in tests. */
export default defineConfig({
  resolve: {
    alias: { '@': resolve(root, 'src') },
  },
  plugins: [react()],
  test: {
    // The core is tested in node: jsdom is noticeably slower to start. Component
    // tests opt in with `// @vitest-environment jsdom` at the top of the file.
    environment: 'node',
    setupFiles: ['src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    restoreMocks: true,
  },
})
