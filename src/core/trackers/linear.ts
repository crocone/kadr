/**
 * Linear: GraphQL for the issue, a presigned URL for the file.
 *
 * The order is dictated by the service: `fileUpload` hands out a URL and headers, the
 * file goes there with a plain PUT, and only then can `assetUrl` go into the issue
 * description. A Linear personal key goes into `Authorization` as-is, without
 * `Bearer` — not an oversight, their API requires it.
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

const API = 'https://api.linear.app/graphql'

const UPLOAD_MUTATION = `mutation FileUpload($size: Int!, $contentType: String!, $filename: String!) {
  fileUpload(size: $size, contentType: $contentType, filename: $filename) {
    success
    uploadFile { uploadUrl assetUrl headers { key value } }
  }
}`

const CREATE_MUTATION = `mutation IssueCreate($input: IssueCreateInput!) {
  issueCreate(input: $input) { success issue { identifier url } }
}`

type GraphQlAnswer<T> = { data?: T; errors?: { message?: string }[] }

type UploadData = {
  fileUpload?: {
    success?: boolean
    uploadFile?: {
      uploadUrl?: string
      assetUrl?: string
      headers?: { key: string; value: string }[]
    }
  }
}

type CreateData = {
  issueCreate?: { success?: boolean; issue?: { identifier?: string; url?: string } }
}

async function graphql<T>(
  deps: Parameters<Tracker['create']>[2],
  config: TrackerConfig,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const response = await request(deps, API, {
    method: 'POST',
    headers: { Authorization: config.token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  })
  if (!response.ok) await failFor(response)

  const answer = await readJson<GraphQlAnswer<T>>(response)
  // GraphQL answers 200 even on failure: the error is in the body, not the status.
  if (answer.errors?.length) {
    throw new TrackerFailure('bad-response', answer.errors[0]?.message ?? 'graphql error')
  }
  if (!answer.data) throw new TrackerFailure('bad-response', 'empty graphql answer')
  return answer.data
}

export const linear: Tracker = {
  kind: 'linear',

  /**
   * The file goes not to api.linear.app but to the storage host that arrives in the
   * response — a presigned Google Cloud Storage url. That host must be listed here:
   * the signed url answers no CORS headers, and only a granted host permission lets
   * an extension page reach it at all. The url arrives mid-send, too late to ask for
   * permission — the user gesture that opens the prompt is long gone by then.
   */
  origins: () => [
    'https://api.linear.app/*',
    'https://uploads.linear.app/*',
    'https://storage.googleapis.com/*',
  ],

  missing: (config) => {
    if (!config.token.trim()) return 'token'
    if (!config.project.trim()) return 'project'
    return null
  },

  async create(draft: IssueDraft, config: TrackerConfig, deps): Promise<CreatedIssue> {
    const upload = await graphql<UploadData>(deps, config, UPLOAD_MUTATION, {
      size: draft.image.size,
      contentType: draft.image.type || 'image/png',
      filename: draft.filename,
    })

    const target = upload.fileUpload?.uploadFile
    if (!upload.fileUpload?.success || !target?.uploadUrl || !target.assetUrl) {
      throw new TrackerFailure('upload-failed', 'linear did not hand out an upload url')
    }

    const put = await request(deps, target.uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': draft.image.type || 'image/png',
        ...Object.fromEntries((target.headers ?? []).map(({ key, value }) => [key, value])),
      },
      body: draft.image,
    })
    if (!put.ok) throw new TrackerFailure('upload-failed', `storage answered ${put.status}`)

    const created = await graphql<CreateData>(deps, config, CREATE_MUTATION, {
      input: {
        teamId: config.project.trim(),
        title: draft.title,
        description: `${draft.body}\n\n![${draft.filename}](${target.assetUrl})`,
      },
    })

    const issue = created.issueCreate?.issue
    if (!created.issueCreate?.success || !issue?.url) {
      throw new TrackerFailure('bad-response', 'linear created no issue')
    }
    return { url: issue.url, key: issue.identifier ?? '' }
  },
}
