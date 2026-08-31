/**
 * Tracker registry and the single send entry point.
 *
 * Host permission is requested here, right before the first request: the base build
 * ships without host-permissions, and tracker origins are requested at send time
 *. Chrome grants such permission only on a user gesture — and sending
 * to a ticket starts with exactly one.
 */
import { github } from './github'
import { jira } from './jira'
import { linear } from './linear'
import {
  type CreatedIssue,
  type IssueDraft,
  type Tracker,
  type TrackerConfig,
  TrackerFailure,
  type TrackerDeps,
  type TrackerKind,
} from './types'

export * from './context'
export * from './types'

export const TRACKERS: Record<TrackerKind, Tracker> = { github, jira, linear }

export function trackerFor(kind: TrackerKind): Tracker {
  return TRACKERS[kind]
}

/** Whether the needed hosts are already granted — the panel uses this to decide whether to ask. */
export async function hasAccess(kind: TrackerKind, config: TrackerConfig): Promise<boolean> {
  const origins = trackerFor(kind).origins(config)
  if (origins.length === 0) return false
  return await chrome.permissions.contains({ origins })
}

export async function requestAccess(kind: TrackerKind, config: TrackerConfig): Promise<boolean> {
  const origins = trackerFor(kind).origins(config)
  if (origins.length === 0) return false
  return await chrome.permissions.request({ origins })
}

/**
 * Create an issue. Settings are validated before touching the network: "token is
 * missing" is cheaper and clearer than a 401 from the service.
 */
export async function createIssue(
  kind: TrackerKind,
  config: TrackerConfig,
  draft: IssueDraft,
  deps: TrackerDeps = { fetch: globalThis.fetch.bind(globalThis) },
): Promise<CreatedIssue> {
  const tracker = trackerFor(kind)
  const missing = tracker.missing(config)
  if (missing) throw new TrackerFailure('not-configured', missing)

  return await tracker.create(draft, config, deps)
}
