/**
 * Screenshot straight into a ticket: GitHub, Linear, or Jira with the user's token
 *.
 *
 * Three trackers, three different protocols — no shared "single endpoint" like in the
 * AI layer. What is shared: each uploads the image first, then creates an issue
 * linking to it, all with the user's own key, directly to the service, no server of
 * ours in between.
 */

export type TrackerKind = 'github' | 'linear' | 'jira'

export const TRACKER_KINDS: readonly TrackerKind[] = ['github', 'linear', 'jira']

export type TrackerConfig = {
  /** GitHub: `owner/repo`. Linear: team id. Jira: project key. */
  project: string
  token: string
  /** Jira only: instance URL, e.g. `https://team.atlassian.net`. */
  baseUrl: string
  /** Jira only: account email — paired with the token in Basic auth. */
  email: string
}

export const EMPTY_TRACKER: TrackerConfig = { project: '', token: '', baseUrl: '', email: '' }

export type IssueDraft = {
  title: string
  /** Issue body in markdown: description plus page context. */
  body: string
  image: Blob
  filename: string
}

export type CreatedIssue = {
  /** Link to the created issue: the only thing the user needs to see. */
  url: string
  /** Human-readable number: `#42`, `ENG-17`, `PROJ-3`. */
  key: string
  /**
   * The issue was created but something failed along the way — e.g. the image didn't
   * attach. This cannot be an error: the issue exists and its link must be returned.
   */
  warning?: TrackerErrorCode
}

export type TrackerErrorCode =
  | 'not-configured'
  | 'no-permission'
  | 'auth'
  | 'not-found'
  | 'rate-limit'
  | 'upload-failed'
  | 'network'
  | 'bad-response'

export class TrackerFailure extends Error {
  constructor(
    readonly code: TrackerErrorCode,
    message?: string,
  ) {
    super(message ?? code)
    this.name = 'TrackerFailure'
  }
}

/** Service responses are decoded once, here: downstream only our codes exist. */
export function errorCodeForStatus(status: number): TrackerErrorCode {
  if (status === 401 || status === 403) return 'auth'
  if (status === 404) return 'not-found'
  if (status === 429) return 'rate-limit'
  return 'bad-response'
}

export type TrackerDeps = { fetch: typeof globalThis.fetch }

export type Tracker = {
  kind: TrackerKind
  /** Hosts the requests will hit: permission for them is requested before sending. */
  origins: (config: TrackerConfig) => string[]
  /** What's missing from the settings. `null` — ready to send. */
  missing: (config: TrackerConfig) => string | null
  create: (draft: IssueDraft, config: TrackerConfig, deps: TrackerDeps) => Promise<CreatedIssue>
}

/** Shared handling of a failed response: a code for the UI, a text snippet for the console. */
export async function failFor(response: Response): Promise<never> {
  const detail = await response.text().catch(() => '')
  throw new TrackerFailure(errorCodeForStatus(response.status), detail.slice(0, 300))
}

/**
 * A network error must be distinguished from an error response: the first is fixed by
 * retrying or connectivity, the second by settings. `fetch` also throws on blocked
 * CORS, which is likewise "couldn't reach them".
 */
export async function request(
  deps: TrackerDeps,
  url: string,
  init: RequestInit,
): Promise<Response> {
  try {
    return await deps.fetch(url, init)
  } catch (error) {
    throw new TrackerFailure('network', error instanceof Error ? error.message : undefined)
  }
}

export async function readJson<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T
  } catch {
    throw new TrackerFailure('bad-response', 'the service answered with something other than JSON')
  }
}
