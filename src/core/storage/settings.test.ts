import { describe, expect, it } from 'vitest'

import { DEFAULT_SETTINGS, onSettingsChanged, readSettings, writeSettings } from './settings'

describe('settings', () => {
  it('returns defaults when nothing is stored', async () => {
    expect(await readSettings()).toEqual(DEFAULT_SETTINGS)
  })

  // Zero outbound requests until AI is enabled by hand — that's the store-listing promise.
  it('keeps AI off, and without a key, by default', () => {
    expect(DEFAULT_SETTINGS.aiEnabled).toBe(false)
    expect(DEFAULT_SETTINGS.aiKey).toBe('')
    expect(DEFAULT_SETTINGS.aiTransport).toBe('byok')
  })

  it('merges a patch over stored values', async () => {
    await writeSettings({ theme: 'dark' })
    await writeSettings({ captureDelaySec: 3 })

    const settings = await readSettings()
    expect(settings.theme).toBe('dark')
    expect(settings.captureDelaySec).toBe(3)
    expect(settings.locale).toBe(DEFAULT_SETTINGS.locale)
  })

  it('notifies subscribers, so open surfaces stay in sync', async () => {
    const seen: string[] = []
    const unsubscribe = onSettingsChanged((settings) => seen.push(settings.theme))

    await writeSettings({ theme: 'dark' })
    unsubscribe()
    await writeSettings({ theme: 'light' })

    expect(seen).toEqual(['dark'])
  })
})
