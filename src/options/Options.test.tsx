// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { readSettings } from '@/core/storage/settings'
import { AppProvider } from '@/core/ui/AppProvider'

import { Options } from './Options'

function renderOptions() {
  return render(
    <AppProvider>
      <Options />
    </AppProvider>,
  )
}

// Tests run without globals, so RTL's auto-cleanup does not hook itself up.
afterEach(cleanup)

describe('Options', () => {
  it('renders the settings sections', async () => {
    renderOptions()

    await waitFor(() => {
      expect(screen.getByText('Appearance')).toBeDefined()
    })
    for (const heading of ['Appearance', 'Capture', 'AI', 'Privacy']) {
      expect(screen.getByText(heading)).toBeDefined()
    }
  })

  it('writes a theme change to storage and paints it on the document', async () => {
    renderOptions()
    await waitFor(() => {
      expect(screen.getByText('Appearance')).toBeDefined()
    })

    await userEvent.selectOptions(screen.getByLabelText('Theme'), 'dark')

    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe('dark')
    })
    expect((await readSettings()).theme).toBe('dark')
  })

  it('keeps AI off until the user turns it on', async () => {
    renderOptions()

    const toggle = await screen.findByRole('switch', { name: 'Enable AI features' })
    expect((toggle as HTMLInputElement).checked).toBe(false)

    await userEvent.click(toggle)
    expect((await readSettings()).aiEnabled).toBe(true)
  })
})
