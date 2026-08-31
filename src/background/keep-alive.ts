/**
 * An MV3 service worker is suspended after ~30 s without events, and picking an area or
 * element can take the user arbitrarily long — waiting on a reply does not reset the
 * timer by itself. Periodically calling an extension API does: it is the documented way
 * to survive a long operation.
 */
const PING_INTERVAL_MS = 20_000

export function keepServiceWorkerAlive(): () => void {
  const timer = setInterval(() => {
    void chrome.runtime.getPlatformInfo()
  }, PING_INTERVAL_MS)

  return () => {
    clearInterval(timer)
  }
}
