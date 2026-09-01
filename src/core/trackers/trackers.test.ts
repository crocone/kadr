import { describe, expect, it, vi } from 'vitest'

import { github } from './github'
import { createIssue } from './index'
import { linear } from './linear'
import { toAdf } from './jira'
import { EMPTY_TRACKER, type IssueDraft, type TrackerConfig, TrackerFailure } from './types'

const draft: IssueDraft = {
  title: 'Checkout is broken',
  body: 'It fails on submit.',
  image: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
  filename: 'shop-checkout.png',
}

const config = (patch: Partial<TrackerConfig> = {}): TrackerConfig => ({
  ...EMPTY_TRACKER,
  ...patch,
})

/** Responses are dealt out in request order, which also exposes the call order. */
function fetchReturning(...answers: (Response | (() => Response))[]) {
  const calls: { url: string; init: RequestInit }[] = []
  const fetchMock = vi.fn((url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init })
    const answer = answers[calls.length - 1]
    if (!answer) throw new Error(`unexpected request to ${String(url)}`)
    return Promise.resolve(typeof answer === 'function' ? answer() : answer)
  })
  return { calls, deps: { fetch: fetchMock as unknown as typeof globalThis.fetch } }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('createIssue', () => {
  it('refuses to go to the network with half-filled settings', async () => {
    const { deps, calls } = fetchReturning()

    await expect(createIssue('github', config({ token: 'ghp_x' }), draft, deps)).rejects.toThrow(
      TrackerFailure,
    )
    expect(calls).toHaveLength(0)
  })
})

describe('github', () => {
  const settings = config({ token: 'ghp_x', project: 'acme/site' })

  it('puts the frame in the repository and links it from the issue', async () => {
    const { deps, calls } = fetchReturning(
      json({ content: { download_url: 'https://raw.example/shot.png' } }, 201),
      json({ html_url: 'https://github.com/acme/site/issues/7', number: 7 }, 201),
    )

    const issue = await createIssue('github', settings, draft, deps)

    expect(calls[0]?.url).toBe(
      'https://api.github.com/repos/acme/site/contents/.kadr/screenshots/shop-checkout.png',
    )
    expect(calls[0]?.init.method).toBe('PUT')

    const created = JSON.parse(calls[1]?.init.body as string) as { title: string; body: string }
    expect(created.title).toBe('Checkout is broken')
    expect(created.body).toContain('![shop-checkout.png](https://raw.example/shot.png)')
    expect(issue).toEqual({ url: 'https://github.com/acme/site/issues/7', key: '#7' })
  })

  it('reports a bad token as an auth problem, not as a mystery', async () => {
    const { deps } = fetchReturning(json({ message: 'Bad credentials' }, 401))

    await expect(createIssue('github', settings, draft, deps)).rejects.toMatchObject({
      code: 'auth',
    })
  })

  it('takes the repository url the field asks for and works with owner/name', () => {
    for (const project of [
      'https://github.com/acme/site',
      'https://github.com/acme/site.git',
      'https://www.github.com/acme/site/',
      'github.com/acme/site/issues',
      'acme/site',
    ]) {
      expect(github.missing(config({ token: 'ghp_x', project }))).toBeNull()
    }

    expect(github.missing(config({ token: 'ghp_x', project: 'https://example.com/acme' }))).toBe(
      'project',
    )
  })

  it('addresses the api by owner/name even when the url was pasted', async () => {
    const { deps, calls } = fetchReturning(
      json({ content: { download_url: 'https://raw.example/shot.png' } }, 201),
      json({ html_url: 'https://github.com/acme/site/issues/7', number: 7 }, 201),
    )

    await createIssue(
      'github',
      config({ token: 'ghp_x', project: 'https://github.com/acme/site' }),
      draft,
      deps,
    )

    expect(calls[0]?.url).toBe(
      'https://api.github.com/repos/acme/site/contents/.kadr/screenshots/shop-checkout.png',
    )
  })

  it('separates a token without the rights from a token that was refused', async () => {
    const { deps } = fetchReturning(
      json({ message: 'Resource not accessible by personal access token' }, 403),
    )

    await expect(createIssue('github', settings, draft, deps)).rejects.toMatchObject({
      code: 'token-scope',
    })
  })

  it('does not create an issue when the frame could not be uploaded', async () => {
    const { deps, calls } = fetchReturning(json({ content: {} }, 201))

    await expect(createIssue('github', settings, draft, deps)).rejects.toMatchObject({
      code: 'upload-failed',
    })
    expect(calls).toHaveLength(1)
  })
})

describe('linear', () => {
  const settings = config({ token: 'lin_api_x', project: 'team_1' })

  it('uploads through the handed-out url and then creates the issue', async () => {
    const { deps, calls } = fetchReturning(
      json({
        data: {
          fileUpload: {
            success: true,
            uploadFile: {
              uploadUrl: 'https://uploads.linear.app/put/1',
              assetUrl: 'https://uploads.linear.app/asset/1',
              headers: [{ key: 'x-amz-acl', value: 'private' }],
            },
          },
        },
      }),
      new Response(null, { status: 200 }),
      json({
        data: {
          issueCreate: {
            success: true,
            issue: { identifier: 'ENG-17', url: 'https://linear.app/acme/issue/ENG-17' },
          },
        },
      }),
    )

    const issue = await createIssue('linear', settings, draft, deps)

    expect(calls[0]?.url).toBe('https://api.linear.app/graphql')
    // A Linear personal key goes as-is, no Bearer — the service rejects it otherwise.
    expect((calls[0]?.init.headers as Record<string, string>).Authorization).toBe('lin_api_x')
    expect(calls[1]?.url).toBe('https://uploads.linear.app/put/1')
    expect((calls[1]?.init.headers as Record<string, string>)['x-amz-acl']).toBe('private')

    const created = JSON.parse(calls[2]?.init.body as string) as {
      variables: { input: { description: string; teamId: string } }
    }
    expect(created.variables.input.teamId).toBe('team_1')
    expect(created.variables.input.description).toContain('https://uploads.linear.app/asset/1')
    expect(issue).toEqual({ url: 'https://linear.app/acme/issue/ENG-17', key: 'ENG-17' })
  })

  // Without permission for the storage host the browser applies CORS to the upload,
  // the signed url answers no headers for it, and the send dies on "failed to fetch".
  it('asks for the storage host the file actually goes to', () => {
    expect(linear.origins(settings)).toContain('https://storage.googleapis.com/*')
  })

  it('treats an error inside a 200 answer as an error', async () => {
    const { deps } = fetchReturning(json({ errors: [{ message: 'Authentication required' }] }))

    await expect(createIssue('linear', settings, draft, deps)).rejects.toMatchObject({
      code: 'bad-response',
    })
  })
})

describe('jira', () => {
  const settings = config({
    baseUrl: 'https://acme.atlassian.net/',
    email: 'me@acme.dev',
    token: 'jira_x',
    project: 'ENG',
  })

  it('creates the issue and attaches the frame to it', async () => {
    const { deps, calls } = fetchReturning(json({ key: 'ENG-3' }, 201), json([{ id: '1' }], 200))

    const issue = await createIssue('jira', settings, draft, deps)

    expect(calls[0]?.url).toBe('https://acme.atlassian.net/rest/api/3/issue')
    expect((calls[0]?.init.headers as Record<string, string>).Authorization).toBe(
      `Basic ${btoa('me@acme.dev:jira_x')}`,
    )
    expect(calls[1]?.url).toBe('https://acme.atlassian.net/rest/api/3/issue/ENG-3/attachments')
    expect((calls[1]?.init.headers as Record<string, string>)['X-Atlassian-Token']).toBe('no-check')
    expect(issue).toEqual({ url: 'https://acme.atlassian.net/browse/ENG-3', key: 'ENG-3' })
  })

  it('keeps the issue when only the attachment failed', async () => {
    const { deps } = fetchReturning(json({ key: 'ENG-4' }, 201), json({}, 413))

    await expect(createIssue('jira', settings, draft, deps)).resolves.toEqual({
      url: 'https://acme.atlassian.net/browse/ENG-4',
      key: 'ENG-4',
      warning: 'upload-failed',
    })
  })
})

describe('toAdf', () => {
  it('lays the text out as paragraphs: v3 takes a document, not a string', () => {
    expect(toAdf('First line\n\nSecond line')).toEqual({
      type: 'doc',
      version: 1,
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'First line' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Second line' }] },
      ],
    })
  })

  it('never leaves the document without content', () => {
    expect(toAdf('')).toEqual({
      type: 'doc',
      version: 1,
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '' }] }],
    })
  })
})
