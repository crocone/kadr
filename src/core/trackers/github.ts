/**
 * GitHub: commit the file to the repo, then open an issue linking to it.
 *
 * GitHub's API has no direct way to attach an image to an issue — the attachment
 * uploader exists only in the web UI. So the frame is committed to the same repo via
 * the Contents API and referenced in the issue body by its raw URL. The settings say
 * so openly: the extension writes to the repo, and the user should know where.
 */
import { base64Of } from '@/core/bytes'

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

const API = 'https://api.github.com'

/** Where frames go. A dedicated folder, so they're visible and easy to clean up. */
const FOLDER = '.kadr/screenshots'

type ContentsResponse = { content?: { download_url?: string | null } }
type IssueResponse = { html_url?: string; number?: number }

/**
 * The field is labelled "where to create issues", so a pasted repository url is the
 * natural answer — the API wants `owner/repo`, and both forms are reduced to it here
 * rather than being refused as "not filled in". A url copied from a repository page
 * carries extra path after the name, so only the first two segments are kept.
 */
export function repoOf(config: TrackerConfig): string {
  const path = config.project
    .trim()
    .split(/[?#]/)[0]
    ?.replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//, '')
  const [owner, repo] = (path ?? '').split('/')
  if (!owner || !repo) return ''
  return `${owner}/${repo.replace(/\.git$/, '')}`
}

function headers(config: TrackerConfig): Record<string, string> {
  return {
    Authorization: `Bearer ${config.token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  }
}

export const github: Tracker = {
  kind: 'github',

  origins: () => [`${API}/*`],

  missing: (config) => {
    if (!config.token.trim()) return 'token'
    if (!/^[\w.-]+\/[\w.-]+$/.test(repoOf(config))) return 'project'
    return null
  },

  async create(draft: IssueDraft, config: TrackerConfig, deps): Promise<CreatedIssue> {
    const repo = repoOf(config)
    const path = `${FOLDER}/${draft.filename}`

    const upload = await request(deps, `${API}/repos/${repo}/contents/${encodeURI(path)}`, {
      method: 'PUT',
      headers: headers(config),
      body: JSON.stringify({
        message: `kadr: ${draft.filename}`,
        content: await base64Of(draft.image),
      }),
    })
    if (!upload.ok) await failFor(upload)

    const uploaded = await readJson<ContentsResponse>(upload)
    const imageUrl = uploaded.content?.download_url
    if (!imageUrl) throw new TrackerFailure('upload-failed', 'no download url in the response')

    const created = await request(deps, `${API}/repos/${repo}/issues`, {
      method: 'POST',
      headers: headers(config),
      body: JSON.stringify({
        title: draft.title,
        body: `${draft.body}\n\n![${draft.filename}](${imageUrl})`,
      }),
    })
    if (!created.ok) await failFor(created)

    const issue = await readJson<IssueResponse>(created)
    if (!issue.html_url) throw new TrackerFailure('bad-response', 'no issue url in the response')
    return { url: issue.html_url, key: `#${issue.number ?? '?'}` }
  },
}
