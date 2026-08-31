import type { ComponentType } from 'react'
import { useEffect, useState } from 'react'

import type { MessageKey } from '@/core/i18n'
import { CAPTURE_COMMANDS, CAPTURE_MODES, type CaptureMode, sendMessage } from '@/core/messaging'
import { ensureOrigin } from '@/core/permissions/host-access'
import { listDocs, type StoredDoc } from '@/core/storage/db'
import { useT } from '@/core/ui/app-context'
import { cn } from '@/core/ui/cn'
import { Button, Hotkey } from '@/core/ui/components'
import {
  IconArea,
  IconElement,
  IconFullPage,
  IconLibrary,
  type IconProps,
  IconResponsive,
  IconScroll,
  IconScribe,
  IconSettings,
  IconVisible,
} from '@/core/ui/icons'

import { RecentShot } from './RecentShot'

const MODE_LABELS: Record<
  CaptureMode,
  { title: MessageKey; hint: MessageKey; icon: ComponentType<IconProps> }
> = {
  visible: { title: 'capture.visible', hint: 'capture.visible.hint', icon: IconVisible },
  fullPage: { title: 'capture.fullPage', hint: 'capture.fullPage.hint', icon: IconFullPage },
  area: { title: 'capture.area', hint: 'capture.area.hint', icon: IconArea },
  element: { title: 'capture.element', hint: 'capture.element.hint', icon: IconElement },
  scroll: { title: 'capture.scroll', hint: 'capture.scroll.hint', icon: IconScroll },
}

const SHORTCUTS_PAGE = 'chrome://extensions/shortcuts'

/**
 * Shortcuts are asked from Chrome, not hardcoded: `suggested_key` is a request, not a
 * fact. A taken combination goes to whichever extension was installed first, leaving
 * our command silently unbound — a popup showing a hardcoded "Alt+Shift+A" would lie,
 * and the user would blame us for the bug.
 */
async function readShortcuts(): Promise<Partial<Record<CaptureMode, string>>> {
  const found: Partial<Record<CaptureMode, string>> = {}
  for (const command of await chrome.commands.getAll()) {
    const mode = command.name ? CAPTURE_COMMANDS[command.name] : undefined
    if (mode && command.shortcut) found[mode] = command.shortcut
  }
  return found
}

/** Visible area goes first and full-width: it's the most common capture. */
const PRIMARY: CaptureMode = 'visible'
const PrimaryIcon = MODE_LABELS[PRIMARY].icon
const SECONDARY = CAPTURE_MODES.filter((mode) => mode !== PRIMARY)

export function Popup() {
  const t = useT()
  const [recent, setRecent] = useState<StoredDoc[]>([])
  const [shortcuts, setShortcuts] = useState<Partial<Record<CaptureMode, string>> | null>(null)
  const [error, setError] = useState<MessageKey | null>(null)
  const [busy, setBusy] = useState(false)
  /** Whether a guide recording is running: the popup is also opened mid-recording to finish it. */
  const [scribe, setScribe] = useState<{ recording: boolean; steps: number } | null>(null)
  const [tab, setTab] = useState<chrome.tabs.Tab | null>(null)

  useEffect(() => {
    void listDocs(3).then(setRecent)
    void readShortcuts().then(setShortcuts)
    void sendMessage('scribe:status', {}).then(setScribe)
    // The active tab is fetched upfront: the site permission is requested from a click
    // handler, and any `await` before `permissions.request` risks falling outside the
    // gesture window, after which Chrome refuses silently.
    void chrome.tabs
      .query({ active: true, currentWindow: true })
      .then(([found]) => setTab(found ?? null))
  }, [])

  /** Until Chrome answers, the chip stays empty: no point flashing "unset" on every open. */
  const hotkeyOf = (mode: CaptureMode) =>
    shortcuts === null ? '' : (shortcuts[mode] ?? t('popup.hotkey.unset'))

  // Chrome allows suggested shortcuts for only four commands, so scroll capture ships
  // unbound by default — that's a deliberate choice, not a conflict.
  const someUnbound =
    shortcuts !== null && CAPTURE_MODES.some((mode) => mode !== 'scroll' && !shortcuts[mode])

  /**
   * The popup closes only once capture has actually started: the area-selection
   * overlay needs it closed, while an error message needs it open.
   */
  const capture = (mode: CaptureMode) => {
    setBusy(true)
    setError(null)
    void sendMessage('capture:start', { mode }).then(
      (response) => {
        if (response.ok) {
          window.close()
          return
        }
        setBusy(false)
        setError(`capture.error.${response.error}`)
      },
      () => {
        setBusy(false)
        setError('capture.error.capture-failed')
      },
    )
  }

  /**
   * The responsive series resizes the window, so the popup closes immediately:
   * watching the window jump from under the popup is unpleasant, and the result
   * arrives as an editor tab anyway.
   */
  const startSeries = () => {
    setBusy(true)
    setError(null)
    void sendMessage('capture:responsive', {}).then(
      (response) => {
        if (response.ok) {
          window.close()
          return
        }
        setBusy(false)
        setError(`capture.error.${response.error}`)
      },
      () => {
        setBusy(false)
        setError('capture.error.capture-failed')
      },
    )
  }

  /**
   * Guide recording requests the site permission right here: `permissions.request`
   * only works from a user gesture, and the service worker has none. Without access,
   * recording would break on the first link once `activeTab` expires.
   */
  const startScribe = () => {
    setBusy(true)
    setError(null)

    void (async () => {
      if (!tab?.url || !(await ensureOrigin(tab.url))) {
        setBusy(false)
        setError('scribe.noPermission')
        return
      }

      const response = await sendMessage(
        'scribe:start',
        tab.id === undefined ? {} : { tabId: tab.id },
      )
      if (!response.ok) {
        setBusy(false)
        setError(`capture.error.${response.error}`)
        return
      }
      window.close()
    })().catch(() => {
      setBusy(false)
      setError('capture.error.capture-failed')
    })
  }

  const stopScribe = () => {
    void sendMessage('scribe:stop', {}).then(() => {
      window.close()
    })
  }

  return (
    <div className="w-[380px] bg-surface text-text">
      <header className="flex items-center gap-2.5 border-b border-border px-4 py-3.5">
        <span className="h-5 w-5 rounded-md bg-accent" />
        <span className="text-sm font-semibold">{t('app.name')}</span>
        <span className="flex-1" />
        <button
          type="button"
          title={t('popup.openOptions')}
          aria-label={t('popup.openOptions')}
          onClick={() => {
            void chrome.runtime.openOptionsPage()
          }}
          className="grid h-[26px] w-[26px] place-items-center rounded-[7px] text-text-muted transition-colors hover:bg-surface-muted hover:text-text"
        >
          <IconSettings size={14} />
        </button>
      </header>

      <div className="grid grid-cols-2 gap-2 px-3 pt-3.5 pb-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            capture(PRIMARY)
          }}
          className="col-span-2 flex items-center gap-3 rounded-xl bg-accent px-3.5 py-3 text-left text-accent-fg transition-opacity hover:opacity-95 disabled:opacity-60"
        >
          <PrimaryIcon size={19} />
          <span className="flex-1">
            <span className="block text-sm font-semibold">{t(MODE_LABELS[PRIMARY].title)}</span>
            <span className="block text-[11.5px] opacity-75">{t(MODE_LABELS[PRIMARY].hint)}</span>
          </span>
          <span className="rounded-[5px] bg-white/15 px-1.5 py-[3px] font-mono text-[10px]">
            {hotkeyOf(PRIMARY)}
          </span>
        </button>

        {SECONDARY.map((mode) => {
          const label = MODE_LABELS[mode]
          return (
            <button
              key={mode}
              type="button"
              disabled={busy}
              onClick={() => {
                capture(mode)
              }}
              className={cn(
                'flex flex-col gap-2 rounded-xl border border-border bg-surface-muted p-3 text-left',
                'transition-colors hover:border-border-strong disabled:opacity-60',
              )}
            >
              <span className="text-text-soft">
                <label.icon size={19} />
              </span>
              <span className="text-[13.5px] font-medium">{t(label.title)}</span>
              <span className="font-mono text-[10px] text-text-muted">{hotkeyOf(mode)}</span>
            </button>
          )
        })}

        <button
          type="button"
          disabled={busy}
          onClick={startSeries}
          className={cn(
            'col-span-2 flex items-center gap-3 rounded-xl border border-border bg-surface-muted px-3 py-2.5 text-left',
            'transition-colors hover:border-border-strong disabled:opacity-60',
          )}
        >
          <span className="text-text-soft">
            <IconResponsive size={19} />
          </span>
          <span className="flex-1">
            <span className="block text-[13.5px] font-medium">{t('capture.responsive')}</span>
            <span className="block text-[11px] text-text-muted">
              {t('capture.responsive.hint')}
            </span>
          </span>
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={scribe?.recording ? stopScribe : startScribe}
          className={cn(
            'col-span-2 flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left',
            'transition-colors hover:border-border-strong disabled:opacity-60',
            scribe?.recording ? 'border-danger/40 bg-danger/10' : 'border-border bg-surface-muted',
          )}
        >
          <span className={scribe?.recording ? 'text-danger' : 'text-text-soft'}>
            <IconScribe size={19} />
          </span>
          <span className="flex-1">
            <span className="block text-[13.5px] font-medium">
              {scribe?.recording ? t('scribe.stop') : t('scribe.start')}
            </span>
            <span className="block text-[11px] text-text-muted">
              {scribe?.recording
                ? t('scribe.recording', { n: scribe.steps })
                : t('scribe.start.hint')}
            </span>
          </span>
        </button>
      </div>

      {someUnbound ? (
        <p className="mx-3 mb-2 rounded-lg bg-surface-muted px-2.5 py-2 text-[11px] text-text-muted">
          {t('popup.hotkey.taken')}{' '}
          <button
            type="button"
            onClick={() => {
              void chrome.tabs.create({ url: SHORTCUTS_PAGE })
            }}
            className="text-accent underline underline-offset-2"
          >
            {t('popup.hotkey.setup')}
          </button>
        </p>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="mx-3 mb-2 rounded-lg bg-danger/10 px-2.5 py-2 text-xs text-danger"
        >
          {t(error)}
        </p>
      ) : null}

      <section className="flex flex-col gap-1.5 px-3 pb-2">
        <h2 className="flex items-center font-mono text-[10px] tracking-[0.1em] text-text-muted uppercase">
          {t('popup.recent')}
          <button
            type="button"
            onClick={() => {
              void sendMessage('library:open', {})
            }}
            className="ml-auto flex items-center gap-1 rounded-md px-1 py-0.5 normal-case hover:bg-surface-muted hover:text-text"
          >
            <IconLibrary size={12} />
            {t('popup.openLibrary')}
          </button>
        </h2>
        {recent.length === 0 ? (
          <p className="text-[11px] text-text-muted">{t('popup.recent.empty')}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {recent.map((doc) => (
              <RecentShot key={doc.id} doc={doc} />
            ))}
          </ul>
        )}
      </section>

      <footer className="flex items-center gap-2 border-t border-border px-3 py-2.5">
        <Button
          size="sm"
          onClick={() => {
            void sendMessage('editor:open', {})
          }}
        >
          {t('popup.openEditor')}
        </Button>
        <span className="ml-auto flex items-center gap-1.5" title={t('popup.record.soon')}>
          <Hotkey>{t('common.soon')}</Hotkey>
        </span>
      </footer>
    </div>
  )
}
