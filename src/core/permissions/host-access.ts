/**
 * Per-site permission, requested on a button press.
 *
 * The manifest declares `optional_host_permissions` as `<all_urls>` — otherwise
 * Chrome won't allow requesting an arbitrary origin. But we always ask for one
 * specific site: a "read and change data on all sites" dialog on a "recapture" click
 * is exactly the prompt that gets the extension uninstalled.
 *
 * Requests only work inside a user-gesture handler: Chrome rejects
 * `permissions.request` otherwise. So the chain always starts from a click in the
 * editor or the library, and the background only checks that the grant exists.
 *
 * The module lives in `core`, not `background`, precisely because of this role split:
 * a page requests, the background checks, and either one would otherwise have to
 * import the other's layer.
 */

/** Origin as `chrome.permissions` understands it: with a wildcard path. */
export function originPatternOf(url: string): string | null {
  try {
    const { protocol, host } = new URL(url)
    if (protocol !== 'http:' && protocol !== 'https:') return null
    return `${protocol}//${host}/*`
  } catch {
    return null
  }
}

export async function hasOrigin(url: string): Promise<boolean> {
  const origin = originPatternOf(url)
  if (!origin) return false
  return await chrome.permissions.contains({ origins: [origin] })
}

/**
 * Ensures access to the site, requesting it if missing.
 *
 * Returns `false` instead of throwing: a denied permission is a normal human answer,
 * not a failure. The caller shows a hint and moves on.
 */
export async function ensureOrigin(url: string): Promise<boolean> {
  const origin = originPatternOf(url)
  if (!origin) return false
  if (await chrome.permissions.contains({ origins: [origin] })) return true

  try {
    return await chrome.permissions.request({ origins: [origin] })
  } catch {
    // Outside a user gesture Chrome throws — that's our call-site mistake, not a denial.
    return false
  }
}

/**
 * Permissions for a batch of URLs: a per-domain recapture has many URLs of one site,
 * but `origins` needs unique patterns and there must be a single prompt.
 */
export async function ensureOrigins(urls: readonly string[]): Promise<boolean> {
  const origins = [...new Set(urls.map(originPatternOf).filter((o): o is string => o !== null))]
  if (origins.length === 0) return false
  if (await chrome.permissions.contains({ origins })) return true

  try {
    return await chrome.permissions.request({ origins })
  } catch {
    return false
  }
}

/**
 * Access to all sites. Highly undesirable to request — yet recapture has no other way.
 *
 * Chrome's `captureVisibleTab` requires either `activeTab` or literally `<all_urls>`:
 * the check compares against that exact pattern, and a single-site grant fails it —
 * the tab answers "Either the '<all_urls>' or 'activeTab' permission is required".
 * `activeTab` in turn is only granted on a user gesture on the tab itself, while
 * recapture opens the page on its own, without a single gesture on it.
 *
 * Hence: Scribe lives on `activeTab` and asks for one site, while recapture asks for
 * all sites — via a dedicated button, with an explanation, and only works after
 * consent.
 */
export const ALL_URLS = '<all_urls>'

export async function hasAllUrls(): Promise<boolean> {
  return await chrome.permissions.contains({ origins: [ALL_URLS] })
}

export async function ensureAllUrls(): Promise<boolean> {
  if (await hasAllUrls()) return true
  try {
    return await chrome.permissions.request({ origins: [ALL_URLS] })
  } catch {
    return false
  }
}

/** Revokes a grant: the settings page must show which sites got what. */
export async function dropOrigin(url: string): Promise<void> {
  const origin = originPatternOf(url)
  if (!origin) return
  await chrome.permissions.remove({ origins: [origin] })
}

/** All granted sites, for the settings page. */
export async function grantedOrigins(): Promise<string[]> {
  const all = await chrome.permissions.getAll()
  return (all.origins ?? []).filter((origin) => origin !== '<all_urls>')
}
