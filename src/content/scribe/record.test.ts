// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * What is visible on the page at the moment the background shoots the frame.
 *
 * The mask lives for exactly that split second and is removed right after, so
 * checking it after the response is pointless — the state is captured here, from
 * inside the send.
 */
const sent: { type: string; shown: Record<string, string>; hudHidden: boolean }[] = []

/** Lets a test hold the background's answer open, as a slow frame capture would. */
let hold: Promise<void> | null = null

function hudHiddenNow(): boolean {
  const host = document.querySelector<HTMLElement>('[data-kadr-overlay]')
  return host !== null && host.style.display === 'none'
}

function shownNow(): Record<string, string> {
  const shown: Record<string, string> = {}
  for (const field of document.querySelectorAll<HTMLInputElement>('input, textarea')) {
    if (field.style.getPropertyValue('-webkit-text-security') === 'disc') {
      shown[field.id] = '••••'
      continue
    }
    const hidden =
      field.style.getPropertyValue('-webkit-text-fill-color') === 'transparent' ||
      field.style.getPropertyValue('color') === 'transparent'
    shown[field.id] = hidden ? '' : field.value
  }
  return shown
}

vi.mock('@/core/messaging', () => ({
  sendMessage: vi.fn(async (type: string) => {
    sent.push({ type, shown: shownNow(), hudHidden: hudHiddenNow() })
    if (hold) await hold
    return { ok: true, steps: 1, dropped: 0 }
  }),
}))

vi.mock('../i18n', () => ({ t: (key: string) => key }))
vi.mock('../page-prep', () => ({ hideScrollbars: vi.fn(), restoreScrollbars: vi.fn() }))

const { beginRecording, endRecording } = await import('./record')

beforeEach(() => {
  sent.length = 0
  hold = null
  document.body.innerHTML = ''
  // jsdom does not paint, so animation frames have to be pushed by hand.
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    setTimeout(() => {
      callback(0)
    }, 0)
    return 1
  })
})

afterEach(() => {
  endRecording()
  vi.unstubAllGlobals()
})

describe('маска введённых значений', () => {
  /**
   * Blur was not good enough: letters under `blur` keep their shape, and a
   * ten-digit phone number read off a zoomed shot with no effort.
   */
  it('hides a typed value outright instead of blurring its shape', async () => {
    document.body.innerHTML = '<input id="tel" type="tel" value="+79611871905">'
    const field = document.querySelector<HTMLInputElement>('#tel')!

    beginRecording(0, 0)
    field.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    await vi.waitFor(() => {
      expect(sent).toHaveLength(1)
    })

    // While the frame is being shot, the value is not visible on the page.
    expect(sent[0]?.shown.tel).not.toContain('7961')
    // And it is not a blur: the field has no filter at all.
    expect(field.style.filter).toBe('')
  })

  it('leaves a number field with nothing painted, where the dot mask does not apply', async () => {
    document.body.innerHTML = '<input id="n" type="number" value="256"><button id="b">go</button>'

    beginRecording(0, 0)
    document
      .querySelector('#b')!
      .dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    await vi.waitFor(() => {
      expect(sent).toHaveLength(1)
    })

    expect(sent[0]?.shown.n).toBe('')
  })

  it('gives the page back exactly the style it had', async () => {
    document.body.innerHTML = '<input id="a" value="x" style="color: red"><input id="b" value="y">'
    const withStyle = document.querySelector<HTMLInputElement>('#a')!
    const without = document.querySelector<HTMLInputElement>('#b')!

    beginRecording(0, 0)
    withStyle.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    await vi.waitFor(() => {
      expect(sent).toHaveLength(1)
    })

    // Wait for the restore: it runs in a finally, the microtask after the response.
    await vi.waitFor(() => {
      expect(withStyle.getAttribute('style')).toBe('color: red')
    })
    expect(without.hasAttribute('style')).toBe(false)
  })

  /**
   * A click on a button blurs the field the user just filled: `pointerdown` and
   * `change` land within milliseconds. Run together, the first answer to come back
   * showed the HUD while the second frame was still being shot — and the recording
   * badge landed on the finished guide.
   */
  it('holds the next step until the previous frame is shot', async () => {
    document.body.innerHTML = '<input id="q" value="secret"><button id="go">go</button>'

    beginRecording(0, 0)

    let release!: () => void
    hold = new Promise((resolve) => {
      release = resolve
    })

    document
      .querySelector('#go')!
      .dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    document.querySelector('#q')!.dispatchEvent(new Event('change', { bubbles: true }))

    await vi.waitFor(() => {
      expect(sent).toHaveLength(1)
    })
    // The second step waits its turn while the first frame is still being shot.
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(sent).toHaveLength(1)

    release()
    await vi.waitFor(() => {
      expect(sent).toHaveLength(2)
    })
    // Its frame is shot with the HUD hidden and the value masked, same as the first.
    expect(sent[1]?.hudHidden).toBe(true)
    expect(sent[1]?.shown.q).not.toContain('secret')
  })

  it('never records a password field at all', async () => {
    document.body.innerHTML = '<input id="p" type="password" value="hunter2">'
    document
      .querySelector('#p')!
      .dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))

    beginRecording(0, 0)
    document
      .querySelector('#p')!
      .dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(sent).toHaveLength(0)
  })
})
