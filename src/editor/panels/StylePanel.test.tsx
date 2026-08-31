// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createDoc } from '@/core/doc/create'
import { serializePresets } from '@/core/doc/style-presets'
import type { Doc } from '@/core/doc/types'
import { translate } from '@/core/i18n'
import { listPresets } from '@/core/storage/db'
import { DEFAULT_SETTINGS } from '@/core/storage/settings'
import { AppContext, type AppContextValue } from '@/core/ui/app-context'

import type { DocumentController } from '../useDocument'
import { StylePanel } from './StylePanel'

afterEach(cleanup)

const app: AppContextValue = {
  settings: DEFAULT_SETTINGS,
  updateSettings: () => Promise.resolve(),
  locale: 'en',
  theme: 'dark',
  t: (key, params) => translate('en', key, params),
}

/** Stub controller: the panel is tested apart from the edit history. */
function controllerFor(doc: Doc): DocumentController & { doc: Doc } {
  const controller = {
    doc,
    edit: vi.fn(),
    commit: vi.fn((recipe?: (current: Doc) => Doc) => {
      if (recipe) controller.doc = recipe(controller.doc)
    }),
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: false,
    canRedo: false,
    setText: vi.fn(),
    reload: vi.fn(),
  }
  return controller
}

function panel(doc: Doc) {
  const controller = controllerFor(doc)
  const rendered = render(
    <AppContext value={app}>
      <StylePanel controller={controller} onApplied={vi.fn()} />
    </AppContext>,
  )
  return { controller, rendered }
}

function docWith(canvas: Partial<Doc['canvas']> = {}): Doc {
  const base = createDoc({ imageId: 'img_1', imageWidth: 400, imageHeight: 300 })
  return { ...base, canvas: { ...base.canvas, ...canvas } }
}

describe('StylePanel', () => {
  it('saves the current style under a name and keeps it in the database', async () => {
    panel(docWith({ padding: 120 }))

    await userEvent.click(screen.getByText('Save the current style'))
    await userEvent.type(screen.getByLabelText('Preset name'), 'Dark deck{Enter}')

    await waitFor(async () => {
      expect((await listPresets()).map((preset) => preset.name)).toEqual(['Dark deck'])
    })
    expect((await listPresets())[0]?.canvas.padding).toBe(120)
  })

  it('applies a saved preset to the document', async () => {
    const { controller } = panel(docWith({ padding: 120, radius: 30 }))

    await userEvent.click(screen.getByText('Save the current style'))
    await userEvent.type(screen.getByLabelText('Preset name'), 'Wide{Enter}')

    // The document has since changed: applying must restore the preset's padding.
    controller.doc = docWith({ padding: 8, radius: 0 })
    await userEvent.click(screen.getByText('Wide'))

    expect(controller.doc.canvas.padding).toBe(120)
    expect(controller.doc.canvas.radius).toBe(30)
  })

  it('complains about a file that holds no presets', async () => {
    panel(docWith())

    const input = screen.getByLabelText('Import')
    await userEvent.upload(input, new File(['{"hello":1}'], 'foreign.json', { type: 'text/plain' }))

    await waitFor(() => {
      expect(screen.getByText('This file holds no Kadr presets')).toBeDefined()
    })
  })

  it('adds imported presets next to its own', async () => {
    panel(docWith())

    const file = new File(
      [serializePresets([{ id: 'preset_x', name: 'Team blue', createdAt: 1, canvas: docStyle() }])],
      'presets.json',
      { type: 'application/json' },
    )
    await userEvent.upload(screen.getByLabelText('Import'), file)

    await waitFor(() => {
      expect(screen.getByText('Team blue')).toBeDefined()
    })
    expect((await listPresets()).map((preset) => preset.id)).toEqual(['preset_x'])
  })
})

function docStyle() {
  const canvas = docWith().canvas
  return {
    background: canvas.background,
    padding: canvas.padding,
    radius: canvas.radius,
    shadow: canvas.shadow,
    frame: { style: canvas.frame.style, theme: canvas.frame.theme, showUrl: canvas.frame.showUrl },
    mockup: canvas.mockup,
  }
}
