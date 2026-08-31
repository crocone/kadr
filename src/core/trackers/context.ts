/**
 * Shot context for the issue body: page URL, browser, and screen resolution.
 *
 * Exactly the three lines a screenshot bug report usually lacks, and exactly the ones
 * nobody types by hand. Collected here, not in the panel: the issue body
 * is identical for all three trackers.
 */

export type ShotContext = {
  /** URL of the captured page. Empty — the shot didn't come from a page. */
  url: string
  /** Size of the shot itself in pixels: a region is smaller than the window, and that matters. */
  shot: { w: number; h: number } | null
  screen: { w: number; h: number } | null
  dpr: number
  userAgent: string
  capturedAt: Date
}

/**
 * Browser name from the user-agent. Check order matters: Edge, Opera, and Yandex
 * put "Chrome" in the UA too, so Chrome is detected last.
 */
export function browserName(userAgent: string): string {
  const versionOf = (pattern: RegExp): string => pattern.exec(userAgent)?.[1] ?? ''
  const named = (name: string, pattern: RegExp): string => `${name} ${versionOf(pattern)}`.trimEnd()

  if (userAgent.includes('YaBrowser')) return named('Yandex Browser', /YaBrowser\/(\d+)/)
  if (userAgent.includes('Edg/')) return named('Edge', /Edg\/(\d+)/)
  if (userAgent.includes('OPR/')) return named('Opera', /OPR\/(\d+)/)
  if (userAgent.includes('Vivaldi')) return named('Vivaldi', /Vivaldi\/(\d+)/)
  if (userAgent.includes('Firefox/')) return named('Firefox', /Firefox\/(\d+)/)
  if (userAgent.includes('Chrome/')) return named('Chrome', /Chrome\/(\d+)/)
  if (userAgent.includes('Safari/')) return named('Safari', /Version\/(\d+)/)
  return 'Unknown browser'
}

export function osName(userAgent: string): string {
  if (userAgent.includes('Windows NT 10')) return 'Windows 10/11'
  if (userAgent.includes('Windows')) return 'Windows'
  if (userAgent.includes('Mac OS X')) return 'macOS'
  if (userAgent.includes('Android')) return 'Android'
  if (/(iPhone|iPad)/.test(userAgent)) return 'iOS'
  if (userAgent.includes('Linux')) return 'Linux'
  return 'Unknown OS'
}

const size = (value: { w: number; h: number } | null): string =>
  value ? `${value.w}×${value.h}` : '—'

/**
 * Issue body: the human's text first, the context table after. Not the other way
 * around — issue lists show the first lines, and those should be the description,
 * not a user-agent string.
 */
export function issueBody(description: string, context: ShotContext): string {
  const rows: [string, string][] = [
    ['Page', context.url || '—'],
    ['Shot', `${size(context.shot)} @ ${context.dpr}×`],
    ['Screen', size(context.screen)],
    ['Browser', `${browserName(context.userAgent)} · ${osName(context.userAgent)}`],
    ['Captured', context.capturedAt.toISOString()],
  ]

  const table = ['| | |', '| --- | --- |', ...rows.map(([key, value]) => `| ${key} | ${value} |`)]
  const text = description.trim()
  return `${text ? `${text}\n\n` : ''}${table.join('\n')}`
}

/** Context of the current editor tab: everything knowable without asking the page. */
export function contextFrom(
  page: { url: string } | null,
  shot: { w: number; h: number } | null,
  now = new Date(),
): ShotContext {
  return {
    url: page?.url ?? '',
    shot,
    screen: typeof screen === 'undefined' ? null : { w: screen.width, h: screen.height },
    dpr: typeof devicePixelRatio === 'undefined' ? 1 : devicePixelRatio,
    userAgent: typeof navigator === 'undefined' ? '' : navigator.userAgent,
    capturedAt: now,
  }
}
