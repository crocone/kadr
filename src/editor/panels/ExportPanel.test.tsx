// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { translate } from '@/core/i18n'
import { DEFAULT_SETTINGS } from '@/core/storage/settings'
import { AppContext, type AppContextValue } from '@/core/ui/app-context'

import type { ExportController } from '../useExport'
import { ExportPanel } from './ExportPanel'

afterEach(cleanup)

const app: AppContextValue = {
  settings: DEFAULT_SETTINGS,
  updateSettings: () => Promise.resolve(),
  locale: 'ru',
  theme: 'dark',
  t: (key, params) => translate('ru', key, params),
}

function controllerFor(patch: Partial<ExportController> = {}): ExportController {
  return {
    format: 'png',
    setFormat: vi.fn(),
    quality: 0.92,
    setQuality: vi.fn(),
    density: 2,
    setDensity: vi.fn(),
    maxDensity: 3,
    stripMeta: false,
    setStripMeta: vi.fn(),
    targets: [],
    toggleTarget: vi.fn(),
    output: { width: 1280, height: 720, bytes: 480 * 1024 },
    status: 'idle',
    sharedLink: null,
    save: vi.fn(),
    copy: vi.fn(),
    saveOriginal: vi.fn(),
    ...patch,
  }
}

function panel(patch: Partial<ExportController> = {}) {
  const controller = controllerFor(patch)
  render(
    <AppContext value={app}>
      <ExportPanel controller={controller} />
    </AppContext>,
  )
  return controller
}

describe('ExportPanel', () => {
  it('says what comes out: the pixel size and the weight of the file', () => {
    panel()
    expect(screen.getByText(/1280 × 720/).textContent).toContain('1280 × 720 · ≈ 480')
  })

  it('offers the density as steps and marks the current one', () => {
    panel({ density: 2 })
    expect(screen.getByRole('tab', { name: '×2' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: '×1' }).getAttribute('aria-selected')).toBe('false')
  })

  it('shows a density the canvas cannot take, but does not let it be picked', () => {
    const controller = panel({ maxDensity: 2 })
    expect(screen.getByRole<HTMLButtonElement>('tab', { name: '×3' }).disabled).toBe(true)
    expect(controller.setDensity).not.toHaveBeenCalled()
  })

  it('hides the quality slider for PNG and shows it for JPEG', () => {
    panel({ format: 'png' })
    expect(screen.queryByText('Качество')).toBeNull()

    cleanup()
    panel({ format: 'jpeg' })
    expect(screen.getByText('Качество')).not.toBeNull()
  })

  it('sends the shot by link and keeps the rest of the destinations out of reach', async () => {
    const controller = panel()
    const user = userEvent.setup()

    await user.click(screen.getByLabelText('Ссылка'))
    expect(controller.toggleTarget).toHaveBeenCalledWith('link')

    for (const label of ['Telegram', 'Slack', 'Диск']) {
      expect(screen.getByLabelText<HTMLInputElement>(label).disabled).toBe(true)
    }
  })

  it('explains what the metadata switch does once it is on', async () => {
    const controller = panel()
    const user = userEvent.setup()

    await user.click(screen.getByRole('switch', { name: 'Убрать метаданные страницы' }))
    expect(controller.setStripMeta).toHaveBeenCalledWith(true)

    cleanup()
    panel({ stripMeta: true })
    expect(screen.getByText(/В имени файла остаётся только дата/)).not.toBeNull()
  })

  it('reports the copied link and refuses to work twice while rendering', () => {
    panel({ sharedLink: 'chrome-extension://kadr-test/src/editor/index.html?doc=doc_1' })
    expect(screen.getByText('Ссылка скопирована')).not.toBeNull()

    cleanup()
    panel({ status: 'working' })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Рендер…' }).disabled).toBe(true)
  })
})
