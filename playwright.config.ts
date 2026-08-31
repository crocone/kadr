import { defineConfig } from '@playwright/test'

/**
 * Extension E2E scenarios. They cover what Vitest cannot: that the built package
 * actually installs in Chrome, pages open at their URLs, and IndexedDB and
 * chrome.storage work for real, not in mocks (PLAN.md §11, phase 6).
 *
 * The extension loads from `dist/`, so a run requires `npm run build` — which
 * `npm run test:e2e` performs itself.
 */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  // Each worker launches its own Chrome with the extension: nothing to gain from
  // parallelism, and a sequential run reads better in the log.
  workers: 1,
  // CI needs the html report on top of annotations: it's what gets attached as an
  // artifact when a scenario fails.
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  use: { trace: process.env.CI ? 'on-first-retry' : 'off' },
})
