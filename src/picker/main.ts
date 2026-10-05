/**
 * The window that records a window or a screen.
 *
 * It exists because of a squeeze with no other way out, and every alternative was tried
 * against a real browser first.
 *
 * `chooseDesktopMedia` refuses to run in a service worker without naming a target tab,
 * and an id issued against a tab may only be opened by frames inside that tab — never by
 * the offscreen document. The offscreen document cannot ask for one itself: it is given
 * `chrome.runtime` and no other extension API. A popup cannot host the dialog either,
 * because Chrome closes a popup the moment focus moves to it, taking the callback along.
 *
 * And an ordinary window is not enough on its own: Chrome binds the id to the exact frame
 * that asked for it, so handing it to another document fails just as the tab-bound one
 * did. Whoever opens the dialog must also open the stream. So this window does both, and
 * then keeps the recorder for the whole take — minimised, out of the way, but alive.
 *
 * Since it has to live anyway, it earns its keep: once recording starts it becomes a
 * small control panel — clock, pause, stop — for whoever restores it from the taskbar.
 *
 * It closes itself when the recording is over. If it is ever left on screen with an error
 * in it, that is deliberate: the message is the only evidence of what went wrong.
 */
import '@/styles/index.css'

import { DEFAULT_LOCALE, resolveSystemLocale, translate } from '@/core/i18n'
import type { Locale } from '@/core/i18n'
import { sendMessage } from '@/core/messaging'
import { formatDuration } from '@/core/record/format'
import { registerRecorderHandlers } from '@/core/record/host'
import { hostStatus, PickerDismissed, startRecording } from '@/core/record/recorder'
import type { ClipId, RecordSource } from '@/core/record/types'
import { readSettings } from '@/core/storage/settings'

registerRecorderHandlers()

/**
 * The worker restores this window for the stop — media does not decode minimized, and
 * the finished file is probed here. On screen it should say what it is doing rather
 * than still offering a Stop for a recording already stopping. The message is not
 * consumed: the recorder handler above is the one that answers it.
 */
chrome.runtime.onMessage.addListener((message: unknown) => {
  if (
    typeof message === 'object' &&
    message !== null &&
    (message as { type?: string }).type === 'recorder:stop'
  ) {
    void currentLocale().then(showSaving)
  }
  return false
})

function askedFor(): { source: RecordSource; clipId: ClipId; microphone: boolean } {
  const query = new URLSearchParams(location.search)
  return {
    source: query.get('source') === 'screen' ? 'screen' : 'window',
    clipId: query.get('clip') ?? '',
    microphone: query.get('mic') === '1',
  }
}

async function currentLocale(): Promise<Locale> {
  const settings = await readSettings().catch(() => null)
  if (settings && settings.locale !== 'system') return settings.locale
  return chrome.i18n?.getUILanguage
    ? resolveSystemLocale(chrome.i18n.getUILanguage())
    : DEFAULT_LOCALE
}

function paint(text: string): void {
  const root = document.getElementById('root')
  if (root) root.textContent = text
}

let ticker: ReturnType<typeof setInterval> | null = null

function showSaving(locale: Locale): void {
  if (ticker !== null) clearInterval(ticker)
  ticker = null
  paint(translate(locale, 'record.picker.saving'))
}

/**
 * The control panel. Plain DOM on purpose — three elements do not need a framework,
 * and this page has to stay light: it lives for the whole recording.
 */
function showPanel(locale: Locale): void {
  const root = document.getElementById('root')
  if (!root) return

  root.textContent = ''

  const panel = document.createElement('div')
  panel.className = 'flex flex-col items-center gap-3'

  const clock = document.createElement('div')
  clock.className = 'flex items-center gap-2 text-[15px] font-medium tabular-nums text-text'
  const dot = document.createElement('span')
  dot.className = 'h-2.5 w-2.5 rounded-full bg-danger animate-pulse'
  const time = document.createElement('span')
  time.textContent = formatDuration(0)
  clock.append(dot, time)

  const controls = document.createElement('div')
  controls.className = 'flex items-center gap-2'

  const pause = document.createElement('button')
  pause.type = 'button'
  pause.className =
    'rounded-lg border border-border bg-surface-muted px-2.5 py-1.5 text-[12px] font-medium text-text transition-colors hover:border-border-strong'
  pause.textContent = translate(locale, 'record.pause')

  const stop = document.createElement('button')
  stop.type = 'button'
  stop.className =
    'rounded-lg bg-danger px-2.5 py-1.5 text-[12px] font-medium text-white transition-opacity hover:opacity-90'
  stop.textContent = translate(locale, 'record.stop')

  controls.append(pause, stop)

  const hint = document.createElement('p')
  hint.className = 'max-w-[260px] text-[11.5px] text-text-muted'
  hint.textContent = translate(locale, 'record.picker.keepOpen')

  panel.append(clock, controls, hint)
  root.append(panel)

  const tick = () => {
    const status = hostStatus()
    if (!status.recording) return
    time.textContent = formatDuration(status.elapsed)
    dot.classList.toggle('animate-pulse', !status.paused)
    dot.classList.toggle('opacity-50', status.paused)
    pause.textContent = translate(locale, status.paused ? 'record.resume' : 'record.pause')
  }

  // Pause goes through the worker, not straight to the recorder: the worker banks the
  // elapsed clock on every pause, and an event timeline that counts paused seconds
  // would drift against the file.
  pause.addEventListener('click', () => {
    void sendMessage('record:pause', { paused: !hostStatus().paused }).then(tick)
  })

  stop.addEventListener('click', () => {
    showSaving(locale)
    void sendMessage('record:stop', {})
  })

  ticker = setInterval(tick, 500)
}

/**
 * Where this window goes once it turns into the panel.
 *
 * A window take keeps it on screen, tucked into a corner: it is not part of what is
 * being recorded, so a visible clock and a Stop button cost nothing. A screen take is
 * the opposite — everything visible is in the frame — so there it shrinks and
 * minimizes, and the panel waits in the taskbar for whoever wants it.
 */
async function placeWindow(source: RecordSource): Promise<void> {
  const width = 360
  const height = 220

  try {
    const here = await chrome.windows.getCurrent()
    if (here.id === undefined) return

    if (source === 'window') {
      const corner = {
        width,
        height,
        left: Math.max(0, screen.availWidth - width - 24),
        top: Math.max(0, screen.availHeight - height - 24),
      }
      await chrome.windows.update(here.id, corner)

      /**
       * Starting a window capture yanks this window out of the way — the chosen window
       * comes forward and on some setups this one is minimized along with the rest. The
       * panel is the whole point of staying visible, so for the first seconds it puts
       * itself back; after that a minimize is the user's own and is respected.
       */
      const id = here.id
      const until = Date.now() + 5000
      const guard = setInterval(() => {
        if (Date.now() > until) {
          clearInterval(guard)
          return
        }
        void chrome.windows.getCurrent().then(async (again) => {
          if (again.state !== 'minimized') return
          console.warn('[kadr] picker: the panel was minimized right after start, restoring')
          // State first, bounds second: Chrome refuses to change both in one call.
          await chrome.windows.update(id, { state: 'normal' }).catch(() => undefined)
          await chrome.windows.update(id, corner).catch(() => undefined)
        })
      }, 300)
    } else {
      // Two calls: Chrome refuses to change bounds and state together.
      await chrome.windows.update(here.id, { width, height })
      await chrome.windows.update(here.id, { state: 'minimized' })
    }
  } catch {
    // Left wherever Chrome put it; the recording does not depend on geometry.
  }
}

async function run(): Promise<void> {
  const request = askedFor()
  const locale = await currentLocale()
  paint(translate(locale, 'record.picker.hint'))

  // `startRecording` opens the dialog itself when it is given no stream id, which is the
  // whole point: the asking and the opening happen in one frame.
  await startRecording({ ...request, streamId: null, audio: false })

  await sendMessage('record:hostStarted', { clipId: request.clipId, ok: true })
  showPanel(locale)
  await placeWindow(request.source)
}

void run().catch(async (error: unknown) => {
  const request = askedFor()
  const cancelled = error instanceof PickerDismissed

  if (!cancelled) console.error('[kadr] picker failed', error)
  await sendMessage('record:hostStarted', {
    clipId: request.clipId,
    ok: false,
    cancelled,
    error: error instanceof Error ? error.message : String(error),
  }).catch(() => undefined)

  // A dismissed dialog needs no explanation and the worker closes the window; a real
  // failure stays on screen, because it is the only place the reason is written down.
  if (!cancelled) paint(String(error))
})
