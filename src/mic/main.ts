/**
 * The window that asks for the microphone.
 *
 * Chrome shows a permission prompt only for a document it can draw a bubble against.
 * The offscreen document that records a tab is not one — `getUserMedia` there fails on
 * the spot when the microphone was never allowed — and the popup is not one either,
 * because the bubble takes focus and a popup that loses focus is a popup that closes,
 * taking the request with it. So the question is put from here: a plain window, open
 * long enough to hear the answer.
 *
 * Once allowed, the grant belongs to the extension and every one of its documents, and
 * this window never has to open again. It then starts the recording itself rather than
 * handing back to a popup that no longer exists.
 */
import '@/styles/index.css'

import { DEFAULT_LOCALE, resolveSystemLocale, translate } from '@/core/i18n'
import type { Locale, MessageKey } from '@/core/i18n'
import { sendMessage } from '@/core/messaging'
import type { RecordSource } from '@/core/record/types'
import { readSettings } from '@/core/storage/settings'

function askedFor(): { source: RecordSource; tabId: number | undefined } {
  const query = new URLSearchParams(location.search)
  const source = query.get('source')
  const tab = Number(query.get('tab'))
  return {
    source: source === 'tab' || source === 'window' || source === 'screen' ? source : 'tab',
    tabId: Number.isInteger(tab) && tab >= 0 ? tab : undefined,
  }
}

async function currentLocale(): Promise<Locale> {
  const settings = await readSettings().catch(() => null)
  if (settings && settings.locale !== 'system') return settings.locale
  return chrome.i18n?.getUILanguage
    ? resolveSystemLocale(chrome.i18n.getUILanguage())
    : DEFAULT_LOCALE
}

function paint(text: string, action?: { label: string; onClick: () => void }): void {
  const root = document.getElementById('root')
  if (!root) return
  root.textContent = ''

  const message = document.createElement('p')
  message.className = 'max-w-[320px]'
  message.textContent = text
  root.append(message)

  if (action) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className =
      'mt-4 rounded-lg border border-border bg-surface-muted px-3 py-1.5 text-[12px] font-medium text-text transition-colors hover:border-border-strong'
    button.textContent = action.label
    button.addEventListener('click', action.onClick)
    root.append(button)
  }
}

async function askMicrophone(): Promise<boolean> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    for (const track of stream.getTracks()) track.stop()
    return true
  } catch (error) {
    console.warn('[kadr] mic: the microphone was refused', error)
    return false
  }
}

async function start(locale: Locale, microphone: boolean): Promise<void> {
  const request = askedFor()
  paint(translate(locale, microphone ? 'record.mic.starting' : 'record.picker.hint'))

  const response = await sendMessage('record:start', {
    source: request.source,
    microphone,
    ...(request.tabId === undefined ? {} : { tabId: request.tabId }),
  }).catch(() => ({ ok: false as const, error: 'capture-failed' as const }))

  if (response.ok || response.error === 'cancelled') {
    window.close()
    return
  }
  // A failure stays on screen: this window is the only place the reason is written.
  paint(translate(locale, `capture.error.${response.error}` as MessageKey))
}

async function run(): Promise<void> {
  const locale = await currentLocale()
  paint(translate(locale, 'record.mic.asking'))

  if (await askMicrophone()) {
    await start(locale, true)
    return
  }

  paint(translate(locale, 'record.mic.denied'), {
    label: translate(locale, 'record.mic.without'),
    onClick: () => {
      void start(locale, false)
    },
  })
}

void run().catch((error: unknown) => {
  console.error('[kadr] mic window failed', error)
  paint(String(error))
})
