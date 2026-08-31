/**
 * Settings live in `chrome.storage.local`, not `sync`: sync would ship them to
 * Google's cloud along with the AI provider keys (PLAN.md §7).
 */
import type { Transport } from '@/core/ai/types'
import type { Locale } from '@/core/i18n/locales'
import { EMPTY_TRACKER, type TrackerConfig, type TrackerKind } from '@/core/trackers/types'

export type ThemePreference = 'system' | 'light' | 'dark'
export type LocalePreference = 'system' | Locale

export type Settings = {
  theme: ThemePreference
  locale: LocalePreference
  /** Capture delay in seconds: time to open a menu or a hover state. */
  captureDelaySec: 0 | 3 | 5 | 10
  /** Filename template, see PLAN.md §6. */
  filenameTemplate: string
  /** AI is off by default and makes zero requests until enabled. */
  aiEnabled: boolean
  /** Own key or the Kadr server. Server mode is premium and comes later. */
  aiTransport: Transport
  /** OpenAI-compatible endpoint URL: the provider is defined by it, not by a code branch. */
  aiBaseUrl: string
  aiModel: string
  /**
   * Model for image editing. Separate from the text model: providers use different
   * models, and a chat model called on /images/edits returns a 400.
   */
  aiImageModel: string
  /**
   * Provider key. Kept in local, not sync: sync would ship it to Google's cloud
   * with the rest of the settings (PLAN.md §7).
   */
  aiKey: string
  /** Tracker the editor suggests by default. */
  tracker: TrackerKind
  /** Tracker tokens. Same place and same reason as the AI key: local only. */
  trackers: Record<TrackerKind, TrackerConfig>
}

export const DEFAULT_SETTINGS: Settings = {
  // The design is dark and the product is styled for it: light theme remains a choice,
  // not what a light-system user lands in by default.
  theme: 'dark',
  locale: 'system',
  captureDelaySec: 0,
  filenameTemplate: '{domain}-{title}-{date}',
  aiEnabled: false,
  aiTransport: 'byok',
  aiBaseUrl: '',
  aiModel: '',
  aiImageModel: '',
  aiKey: '',
  tracker: 'github',
  trackers: { github: EMPTY_TRACKER, linear: EMPTY_TRACKER, jira: EMPTY_TRACKER },
}

const STORAGE_KEY = 'settings'

/**
 * The defaults merge is shallow, so `trackers` needs its own merge: an old stored
 * object may not know about a tracker added later, and accessing it would hit
 * `undefined`.
 */
function withDefaults(stored: Partial<Settings> | undefined): Settings {
  const merged = { ...DEFAULT_SETTINGS, ...stored }
  return {
    ...merged,
    trackers: {
      ...DEFAULT_SETTINGS.trackers,
      ...stored?.trackers,
    },
  }
}

export async function readSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(STORAGE_KEY)
  return withDefaults(stored[STORAGE_KEY] as Partial<Settings> | undefined)
}

export async function writeSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await readSettings()), ...patch }
  await chrome.storage.local.set({ [STORAGE_KEY]: next })
  return next
}

/** Settings change subscription: keeps popup, editor, and options in sync. */
export function onSettingsChanged(listener: (settings: Settings) => void): () => void {
  const handler = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: chrome.storage.AreaName,
  ) => {
    if (area !== 'local' || !(STORAGE_KEY in changes)) return
    listener(withDefaults(changes[STORAGE_KEY]?.newValue as Partial<Settings> | undefined))
  }
  chrome.storage.onChanged.addListener(handler)
  return () => chrome.storage.onChanged.removeListener(handler)
}
