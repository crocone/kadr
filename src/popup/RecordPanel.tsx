import type { ComponentType } from 'react'
import { useEffect, useRef, useState } from 'react'

import type { MessageKey } from '@/core/i18n'
import { type RecordStatus, sendMessage } from '@/core/messaging'
import { ensureRecordingPermission, hasMicrophonePermission } from '@/core/permissions/recording'
import { formatDuration } from '@/core/record/format'
import type { RecordSource } from '@/core/record/types'
import { readSettings, writeSettings } from '@/core/storage/settings'
import { useT } from '@/core/ui/app-context'
import { cn } from '@/core/ui/cn'
import {
  type IconProps,
  IconMicrophone,
  IconPause,
  IconPlay,
  IconRecord,
  IconScreen,
  IconStop,
  IconVisible,
  IconWindow,
} from '@/core/ui/icons'

const SOURCES: {
  source: RecordSource
  title: MessageKey
  hint: MessageKey
  icon: ComponentType<IconProps>
}[] = [
  { source: 'tab', title: 'record.tab', hint: 'record.tab.hint', icon: IconVisible },
  { source: 'window', title: 'record.window', hint: 'record.window.hint', icon: IconWindow },
  { source: 'screen', title: 'record.screen', hint: 'record.screen.hint', icon: IconScreen },
]

/** The window that asks for the microphone and starts the recording once it has it. */
const MIC_PAGE = 'src/mic/index.html'

function elapsedOf(status: RecordStatus, now: number): number {
  return status.before + (status.startedAt === null ? 0 : Math.max(0, now - status.startedAt))
}

/**
 * Recording controls.
 *
 * The permission is requested here and nowhere else: `permissions.request` only works
 * inside a user gesture, so it has to happen in this click handler, before the first
 * `await` that could push the call outside the gesture window. The service worker,
 * which does everything else, can never ask.
 *
 * The microphone is the exception, and it goes the other way: its prompt cannot be
 * shown from this popup — the bubble takes focus, the popup closes, the request dies
 * with it — nor from the offscreen document that records a tab. So when it has never
 * been allowed, a small window of ours asks first and starts the recording itself.
 */
export function RecordPanel({
  tab,
  onBusy,
}: {
  tab: chrome.tabs.Tab | null
  onBusy: (busy: boolean) => void
}) {
  const t = useT()
  const [status, setStatus] = useState<RecordStatus | null>(null)
  const [stopping, setStopping] = useState(false)
  const [microphone, setMicrophone] = useState(true)
  const [error, setError] = useState<MessageKey | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const busy = useRef(false)

  useEffect(() => {
    void sendMessage('record:status', {}).then(setStatus)
    void readSettings().then((settings) => {
      setMicrophone(settings.recordMicrophone)
    })
  }, [])

  // The clock ticks in the popup rather than arriving with the status: a number sent
  // once would be stale the moment it was drawn.
  useEffect(() => {
    if (!status?.recording || status.paused) return
    const timer = setInterval(() => {
      setNow(Date.now())
    }, 500)
    return () => {
      clearInterval(timer)
    }
  }, [status?.recording, status?.paused])

  const start = (source: RecordSource) => {
    if (busy.current) return
    busy.current = true
    onBusy(true)
    setError(null)

    void (async () => {
      if (!(await ensureRecordingPermission(source))) {
        setError('capture.error.no-recording-permission')
        return
      }

      if (microphone && !(await hasMicrophonePermission())) {
        const query = `?source=${source}${tab?.id === undefined ? '' : `&tab=${tab.id}`}`
        await chrome.windows.create({
          url: chrome.runtime.getURL(`${MIC_PAGE}${query}`),
          type: 'popup',
          focused: true,
          width: 460,
          height: 280,
        })
        // The window takes it from here; this popup would close on losing focus anyway.
        window.close()
        return
      }

      const response = await sendMessage('record:start', {
        source,
        microphone,
        ...(tab?.id === undefined ? {} : { tabId: tab.id }),
      })
      if (!response.ok) {
        // A dismissed source picker is not an error worth a red line: the user changed
        // their mind, and saying so back to them helps nobody.
        if (response.error !== 'cancelled') setError(`capture.error.${response.error}`)
        return
      }
      // The window closes only once recording is actually running: a picker dialog needs
      // the popup gone, an error message needs it open.
      window.close()
    })()
      .catch(() => {
        setError('capture.error.capture-failed')
      })
      .finally(() => {
        busy.current = false
        onBusy(false)
      })
  }

  // Stopping takes seconds — the host merges the parts and probes the file — and the
  // worker joins a repeated stop to the running one. The button still locks and says so:
  // a Stop that looks dead is a Stop that gets pressed again.
  const stop = () => {
    if (stopping) return
    setStopping(true)
    void sendMessage('record:stop', {}).then(() => {
      window.close()
    })
  }

  const togglePause = () => {
    if (!status) return
    void sendMessage('record:pause', { paused: !status.paused }).then((answer) => {
      setStatus({
        ...status,
        paused: answer.paused,
        startedAt: answer.paused ? null : Date.now(),
        before: answer.paused ? elapsedOf(status, Date.now()) : status.before,
      })
    })
  }

  if (status?.recording) {
    const elapsed = elapsedOf(status, now)
    return (
      <div className="mx-3 mb-2 flex items-center gap-2 rounded-xl border border-danger/40 bg-danger/10 px-3 py-2.5">
        <span className={cn('text-danger', status.paused ? 'opacity-50' : 'animate-pulse')}>
          <IconRecord size={16} />
        </span>
        <span className="flex-1 text-[13px] font-medium tabular-nums">
          {t(status.paused ? 'record.paused' : 'record.running', {
            time: formatDuration(elapsed),
          })}
        </span>
        <button
          type="button"
          title={t(status.paused ? 'record.resume' : 'record.pause')}
          aria-label={t(status.paused ? 'record.resume' : 'record.pause')}
          onClick={togglePause}
          disabled={stopping}
          className="grid h-7 w-7 place-items-center rounded-lg text-text-soft transition-colors hover:bg-surface-muted hover:text-text disabled:opacity-50"
        >
          {status.paused ? <IconPlay size={14} /> : <IconPause size={14} />}
        </button>
        <button
          type="button"
          onClick={stop}
          disabled={stopping}
          className="flex items-center gap-1.5 rounded-lg bg-danger px-2.5 py-1.5 text-[12px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          <IconStop size={12} />
          {t(stopping ? 'record.stopping' : 'record.stop')}
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1.5 px-3 pb-2">
      <div className="grid grid-cols-3 gap-2">
        {SOURCES.map(({ source, title, hint, icon: Icon }) => (
          <button
            key={source}
            type="button"
            title={t(hint)}
            onClick={() => {
              start(source)
            }}
            className={cn(
              'flex flex-col gap-1.5 rounded-xl border border-border bg-surface-muted p-2.5 text-left',
              'transition-colors hover:border-border-strong disabled:opacity-60',
            )}
          >
            <span className="flex items-center gap-1.5 text-danger">
              <IconRecord size={9} />
              <span className="text-text-soft">
                <Icon size={16} />
              </span>
            </span>
            <span className="text-[12.5px] font-medium">{t(title)}</span>
          </button>
        ))}
      </div>

      <label className="flex cursor-pointer items-center gap-2 px-0.5 py-1 text-[11.5px] text-text-muted">
        <input
          type="checkbox"
          checked={microphone}
          onChange={(event) => {
            const checked = event.target.checked
            setMicrophone(checked)
            // Remembered: a voice-over is a habit, not a per-take decision.
            void writeSettings({ recordMicrophone: checked })
          }}
          className="accent-accent"
        />
        <IconMicrophone size={13} />
        {t('record.microphone')}
      </label>

      {error ? (
        <p role="alert" className="rounded-lg bg-danger/10 px-2.5 py-2 text-xs text-danger">
          {t(error)}
        </p>
      ) : null}
    </div>
  )
}
