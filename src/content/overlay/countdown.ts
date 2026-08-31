/**
 * Countdown before a delayed capture. The overlay is removed before the shot, so it
 * never ends up in the file — unlike timers drawn directly into the page.
 */
import { t } from '../i18n'

import { createOverlayHost } from './host'

const CSS = `
  .layer { pointer-events: none; display: grid; place-items: center; }
  .dial {
    padding: 18px 26px;
    border-radius: 16px;
    background: rgba(14, 16, 19, 0.86);
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
    text-align: center;
  }
  .n { font-size: 44px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .caption { opacity: 0.75; }
`

export async function runCountdown(seconds: number): Promise<void> {
  if (seconds <= 0) return

  const host = createOverlayHost(CSS)
  const layer = document.createElement('div')
  layer.className = 'layer'
  layer.innerHTML = `<div class="dial"><div class="n"></div><div class="caption"></div></div>`
  host.root.append(layer)

  const number = layer.querySelector<HTMLElement>('.n')!
  const caption = layer.querySelector<HTMLElement>('.caption')!
  caption.textContent = t('overlay.countdown', { n: seconds })

  try {
    for (let left = seconds; left > 0; left--) {
      number.textContent = String(left)
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  } finally {
    host.destroy()
  }
}
