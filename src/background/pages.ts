/**
 * Browser-internal pages cannot be captured — a platform restriction, not our bug.
 * Detect them up front to show a clear message instead of an empty frame (PLAN.md §10).
 */
const BLOCKED_SCHEMES = [
  'chrome:',
  'chrome-extension:',
  'edge:',
  'about:',
  'devtools:',
  'view-source:',
]

const BLOCKED_HOSTS = [
  'chromewebstore.google.com',
  'chrome.google.com/webstore',
  'microsoftedge.microsoft.com',
  'addons.opera.com',
]

export function isCapturableUrl(url: string | undefined): boolean {
  if (!url) return false
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (BLOCKED_SCHEMES.includes(parsed.protocol)) return false
  return !BLOCKED_HOSTS.some((blocked) => (parsed.host + parsed.pathname).startsWith(blocked))
}
