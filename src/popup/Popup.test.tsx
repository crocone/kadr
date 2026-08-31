// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AppProvider } from '@/core/ui/AppProvider'

import { Popup } from './Popup'

// Tests run without globals, so RTL's auto-cleanup does not hook itself up.
afterEach(cleanup)

describe('Popup', () => {
  it('offers all four capture modes with their hotkeys', async () => {
    render(
      <AppProvider>
        <Popup />
      </AppProvider>,
    )

    // Wait for the hotkey chip specifically: it arrives via a second request, after the modes.
    await waitFor(() => {
      expect(screen.getByText('Alt+Shift+F')).toBeDefined()
    })
    for (const label of ['Full page', 'Visible area', 'Select area', 'Pick element']) {
      expect(screen.getByText(label)).toBeDefined()
    }
    for (const hotkey of ['Alt+Shift+F', 'Alt+Shift+V', 'Alt+Shift+A', 'Alt+Shift+E']) {
      expect(screen.getByText(hotkey)).toBeDefined()
    }
  })

  /**
   * A shortcut goes to whichever extension was installed first; the second one's
   * command stays unbound. The popup must show that, or it looks like our bug —
   * press Alt+Shift+A and get someone else's overlay.
   */
  it('says a hotkey is unassigned when Chrome gave it to someone else', async () => {
    // `getAll` has a callback overload and `vi.mocked` latches onto it, so the
    // promise form is spelled out explicitly — otherwise the mock expects `void`.
    const getAll = vi.mocked<() => Promise<chrome.commands.Command[]>>(chrome.commands.getAll)
    getAll.mockResolvedValueOnce([
      { name: 'capture-fullpage', shortcut: 'Alt+Shift+F' },
      { name: 'capture-visible', shortcut: 'Alt+Shift+V' },
      { name: 'capture-area', shortcut: '' },
      { name: 'capture-element', shortcut: 'Alt+Shift+E' },
    ])

    render(
      <AppProvider>
        <Popup />
      </AppProvider>,
    )

    // Two "Not set" entries here: the area mode that lost its key, and scroll capture,
    // which gets no suggested shortcut at all — Chrome allows only four.
    await waitFor(() => {
      expect(screen.getAllByText('Not set').length).toBeGreaterThan(0)
    })
    expect(screen.getByText('Set shortcuts')).toBeDefined()
    expect(screen.queryByText('Alt+Shift+A')).toBeNull()
  })

  it('shows an empty state before anything has been captured', async () => {
    render(
      <AppProvider>
        <Popup />
      </AppProvider>,
    )

    await waitFor(() => {
      expect(screen.getByText('Nothing captured yet')).toBeDefined()
    })
  })
})
