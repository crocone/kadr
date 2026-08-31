/**
 * Jira: issue first, then the attachment.
 *
 * Two non-obvious Jira Cloud requirements. First: the API v3 description is not text
 * but an ADF document, so the markdown body is split into paragraphs. Second: the
 * attachment upload needs the `X-Atlassian-Token: no-check` header or XSRF protection
 * rejects it; `Content-Type` must be left unset — `FormData` sets it along with the
 * multipart boundary.
 */
import {
  type CreatedIssue,
  failFor,
  type IssueDraft,
  readJson,
  request,
  type Tracker,
  type TrackerConfig,
  TrackerFailure,
} from './types'

type CreatedIssueResponse = { key?: string }

/** Default issue type: Jira requires one, and "Task" exists in every project. */
const ISSUE_TYPE = 'Task'

function baseUrlOf(config: TrackerConfig): string {
  return config.baseUrl.trim().replace(/\/+$/, '')
}

function headers(config: TrackerConfig): Record<string, string> {
  return {
    Authorization: `Basic ${btoa(`${config.email.trim()}:${config.token}`)}`,
    Accept: 'application/json',
  }
}

/** Minimal ADF: paragraphs split on blank lines. Jira detects links on its own. */
export function toAdf(text: string): unknown {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)

  return {
    type: 'doc',
    version: 1,
    content: (paragraphs.length > 0 ? paragraphs : ['']).map((block) => ({
      type: 'paragraph',
      content: [{ type: 'text', text: block }],
    })),
  }
}

export const jira: Tracker = {
  kind: 'jira',

  origins: (config) => {
    const base = baseUrlOf(config)
    try {
      return [`${new URL(base).origin}/*`]
    } catch {
      return []
    }
  },

  missing: (config) => {
    if (!/^https?:\/\/.+/.test(baseUrlOf(config))) return 'baseUrl'
    if (!config.email.trim()) return 'email'
    if (!config.token.trim()) return 'token'
    if (!config.project.trim()) return 'project'
    return null
  },

  async create(draft: IssueDraft, config: TrackerConfig, deps): Promise<CreatedIssue> {
    const base = baseUrlOf(config)

    const created = await request(deps, `${base}/rest/api/3/issue`, {
      method: 'POST',
      headers: { ...headers(config), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          project: { key: config.project.trim() },
          summary: draft.title,
          description: toAdf(draft.body),
          issuetype: { name: ISSUE_TYPE },
        },
      }),
    })
    if (!created.ok) await failFor(created)

    const issue = await readJson<CreatedIssueResponse>(created)
    if (!issue.key) throw new TrackerFailure('bad-response', 'no issue key in the response')

    const form = new FormData()
    form.append('file', draft.image, draft.filename)

    const attached = await request(deps, `${base}/rest/api/3/issue/${issue.key}/attachments`, {
      method: 'POST',
      headers: { ...headers(config), 'X-Atlassian-Token': 'no-check' },
      body: form,
    })
    // The issue already exists and its link must not be lost over the attachment:
    // a failed image comes back as a warning, not an exception.
    const url = `${base}/browse/${issue.key}`
    return attached.ok ? { url, key: issue.key } : { url, key: issue.key, warning: 'upload-failed' }
  },
}
