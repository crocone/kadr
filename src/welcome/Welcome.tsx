import type { ComponentType } from 'react'

import type { MessageKey } from '@/core/i18n'
import { sendMessage } from '@/core/messaging'
import { useT } from '@/core/ui/app-context'
import { Button, Card, Hotkey } from '@/core/ui/components'
import {
  IconArea,
  IconElement,
  IconFullPage,
  type IconProps,
  IconResponsive,
  IconVisible,
} from '@/core/ui/icons'

/**
 * Onboarding: opens once, on install (phase 6).
 *
 * Only what users won't find on their own: the four capture modes with hotkeys, the
 * privacy promise, and the way to settings. No editor tour — the editor explains
 * itself through its panels, not tooltips.
 */
const MODES: {
  title: MessageKey
  hint: MessageKey
  hotkey: string
  icon: ComponentType<IconProps>
}[] = [
  {
    title: 'capture.visible',
    hint: 'capture.visible.hint',
    hotkey: 'Alt+Shift+V',
    icon: IconVisible,
  },
  {
    title: 'capture.fullPage',
    hint: 'capture.fullPage.hint',
    hotkey: 'Alt+Shift+F',
    icon: IconFullPage,
  },
  { title: 'capture.area', hint: 'capture.area.hint', hotkey: 'Alt+Shift+A', icon: IconArea },
  {
    title: 'capture.element',
    hint: 'capture.element.hint',
    hotkey: 'Alt+Shift+E',
    icon: IconElement,
  },
]

export function Welcome() {
  const t = useT()

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 p-8">
      <header className="flex items-center gap-3">
        <span className="h-7 w-7 rounded-lg bg-accent" />
        <h1 className="text-lg font-semibold">{t('welcome.title')}</h1>
      </header>

      <p className="max-w-xl text-sm leading-relaxed text-text-soft">{t('welcome.lead')}</p>

      <Card className="flex flex-col gap-3 p-5">
        <h2 className="font-mono text-[10px] tracking-[0.1em] text-text-muted uppercase">
          {t('welcome.capture')}
        </h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {MODES.map((mode) => (
            <li
              key={mode.title}
              className="flex items-center gap-3 rounded-control border border-border p-2.5"
            >
              <span className="text-text-soft">
                <mode.icon size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium">{t(mode.title)}</span>
                <span className="block truncate text-[11px] text-text-muted">{t(mode.hint)}</span>
              </span>
              <Hotkey>{mode.hotkey}</Hotkey>
            </li>
          ))}
        </ul>
        <p className="flex items-center gap-2 text-[11.5px] text-text-muted">
          <IconResponsive size={15} />
          {t('welcome.responsive')}
        </p>
        <p className="text-[11.5px] text-text-muted">{t('welcome.pin')}</p>
      </Card>

      <Card className="flex flex-col gap-2 p-5">
        <h2 className="font-mono text-[10px] tracking-[0.1em] text-text-muted uppercase">
          {t('welcome.privacy')}
        </h2>
        <p className="text-[12.5px] leading-relaxed text-text-soft">{t('welcome.privacy.body')}</p>
      </Card>

      <Card className="flex flex-col gap-2 p-5">
        <h2 className="font-mono text-[10px] tracking-[0.1em] text-text-muted uppercase">
          {t('welcome.next')}
        </h2>
        <p className="text-[12.5px] leading-relaxed text-text-soft">{t('welcome.next.body')}</p>
        <div className="mt-1 flex flex-wrap gap-2">
          <Button
            variant="primary"
            onClick={() => {
              void chrome.runtime.openOptionsPage()
            }}
          >
            {t('popup.openOptions')}
          </Button>
          <Button
            onClick={() => {
              void sendMessage('library:open', {})
            }}
          >
            {t('popup.openLibrary')}
          </Button>
        </div>
      </Card>
    </div>
  )
}
