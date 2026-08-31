// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createDoc } from '@/core/doc/create'
import { createLayer } from '@/core/doc/layers'
import { getDoc, putDoc, type StoredDoc } from '@/core/storage/db'
import { AppProvider } from '@/core/ui/AppProvider'

import { Library } from './Library'

afterEach(cleanup)

function storedDoc(overrides: Partial<StoredDoc> = {}): StoredDoc {
  const doc = createDoc({ imageId: 'img_1', imageWidth: 100, imageHeight: 80 })
  return { ...doc, domain: 'example.com', text: null, thumbnail: null, ...overrides }
}

/** Noon of the target day: the test must not depend on the hour it runs at. */
function noonAgo(days: number): number {
  const date = new Date()
  date.setDate(date.getDate() - days)
  date.setHours(12, 0, 0, 0)
  return date.getTime()
}

function renderLibrary() {
  return render(
    <AppProvider>
      <Library />
    </AppProvider>,
  )
}

/** Title and tag editing lives in the list view, not the grid. */
async function switchToList() {
  await userEvent.click(screen.getByRole('button', { name: 'List' }))
}

describe('Library', () => {
  it('shows an empty state until something is captured', async () => {
    renderLibrary()

    await waitFor(() => {
      expect(screen.getByText('The library is empty')).toBeDefined()
    })
  })

  it('narrows the shots down as the query is typed', async () => {
    await putDoc(storedDoc({ id: 'doc_a', title: 'Dashboard', domain: 'github.com' }))
    await putDoc(storedDoc({ id: 'doc_b', title: 'Invoice', domain: 'stripe.com' }))

    renderLibrary()
    await waitFor(() => {
      expect(screen.getByTitle('Dashboard')).toBeDefined()
    })

    await userEvent.type(screen.getByLabelText('Search by domain or text'), 'stripe')

    await waitFor(() => {
      expect(screen.queryByTitle('Dashboard')).toBeNull()
    })
    expect(screen.getByTitle('Invoice')).toBeDefined()
  })

  it('keeps only the domains that are ticked', async () => {
    await putDoc(storedDoc({ id: 'doc_a', title: 'Dashboard', domain: 'github.com' }))
    await putDoc(storedDoc({ id: 'doc_b', title: 'Invoice', domain: 'stripe.com' }))

    renderLibrary()
    await waitFor(() => {
      expect(screen.getByTitle('Dashboard')).toBeDefined()
    })

    await userEvent.click(screen.getByLabelText('stripe.com'))

    await waitFor(() => {
      expect(screen.queryByTitle('Dashboard')).toBeNull()
    })
    expect(screen.getByTitle('Invoice')).toBeDefined()

    // The second domain adds to the first instead of replacing it: checkboxes are OR.
    await userEvent.click(screen.getByLabelText('github.com'))
    await waitFor(() => {
      expect(screen.getByTitle('Dashboard')).toBeDefined()
    })
  })

  it('keeps the shelf of annotated shots to the ones with layers', async () => {
    const drawn = storedDoc({ id: 'doc_a', title: 'Dashboard' })
    await putDoc({ ...drawn, layers: [createLayer('shape', { rect: { x: 0, y: 0, w: 5, h: 5 } })] })
    await putDoc(storedDoc({ id: 'doc_b', title: 'Invoice' }))

    renderLibrary()
    await waitFor(() => {
      expect(screen.getByTitle('Invoice')).toBeDefined()
    })

    await userEvent.click(screen.getByRole('button', { name: /With annotations/ }))

    await waitFor(() => {
      expect(screen.queryByTitle('Invoice')).toBeNull()
    })
    expect(screen.getByTitle('Dashboard')).toBeDefined()
  })

  it('says nothing about video until there is video to show', async () => {
    await putDoc(storedDoc({ id: 'doc_a', title: 'Dashboard' }))

    renderLibrary()
    await waitFor(() => {
      expect(screen.getByTitle('Dashboard')).toBeDefined()
    })

    expect(screen.getByRole<HTMLButtonElement>('button', { name: /Video and GIF/ }).disabled).toBe(
      true,
    )
  })

  it('breaks the feed into days', async () => {
    await putDoc(storedDoc({ id: 'doc_a', title: 'Dashboard', updatedAt: noonAgo(0) }))
    await putDoc(storedDoc({ id: 'doc_b', title: 'Invoice', updatedAt: noonAgo(1) }))

    renderLibrary()
    await waitFor(() => {
      expect(screen.getByTitle('Dashboard')).toBeDefined()
    })

    // "Today" also exists as a shelf on the left, so headings are looked up inside the feed.
    const feed = within(screen.getByRole('main'))
    expect(feed.getByText('Today')).toBeDefined()
    expect(feed.getByText('Yesterday')).toBeDefined()
  })

  it('offers the bulk actions once a shot is ticked', async () => {
    await putDoc(storedDoc({ id: 'doc_a', title: 'Dashboard' }))

    renderLibrary()
    await waitFor(() => {
      expect(screen.getByTitle('Dashboard')).toBeDefined()
    })
    expect(screen.queryByText('Selected: 1')).toBeNull()

    await userEvent.click(screen.getByLabelText('Pick the shot: Dashboard'))
    expect(screen.getByText('Selected: 1')).toBeDefined()

    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(confirm).toHaveBeenCalled()

    await waitFor(async () => {
      expect(await getDoc('doc_a')).toBeUndefined()
    })
  })

  it('filters by the tag of the shot it was clicked on', async () => {
    await putDoc(storedDoc({ id: 'doc_a', title: 'Dashboard', tags: ['bug'] }))
    await putDoc(storedDoc({ id: 'doc_b', title: 'Invoice', tags: [] }))

    renderLibrary()
    await waitFor(() => {
      expect(screen.getByTitle('Dashboard')).toBeDefined()
    })
    await switchToList()

    // The tag on the row and its sidebar checkbox are two different click targets.
    await userEvent.click(screen.getAllByText('bug')[0]!)

    await waitFor(() => {
      expect(screen.queryByDisplayValue('Invoice')).toBeNull()
    })
  })

  it('adds a tag to the document under the row', async () => {
    await putDoc(storedDoc({ id: 'doc_a', title: 'Dashboard' }))

    renderLibrary()
    await waitFor(() => {
      expect(screen.getByTitle('Dashboard')).toBeDefined()
    })
    await switchToList()

    await userEvent.click(screen.getByTitle('Add a tag'))
    await userEvent.type(screen.getByLabelText('Add a tag'), 'Bug{Enter}')

    await waitFor(async () => {
      expect((await getDoc('doc_a'))?.tags).toEqual(['bug'])
    })
  })

  it('keeps a rename that the tab was closed on', async () => {
    await putDoc(storedDoc({ id: 'doc_a', title: 'Untitled' }))

    const { unmount } = renderLibrary()
    await waitFor(() => {
      expect(screen.getByTitle('Untitled')).toBeDefined()
    })
    await switchToList()

    await userEvent.clear(screen.getByDisplayValue('Untitled'))
    await userEvent.type(screen.getByRole('textbox', { name: 'Shot title' }), 'Release notes')
    unmount()

    await waitFor(async () => {
      expect((await getDoc('doc_a'))?.title).toBe('Release notes')
    })
  })

  it('asks before deleting and removes the shot once confirmed', async () => {
    await putDoc(storedDoc({ id: 'doc_a', title: 'Dashboard' }))

    renderLibrary()
    await waitFor(() => {
      expect(screen.getByTitle('Dashboard')).toBeDefined()
    })
    await switchToList()

    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await userEvent.click(screen.getByTitle('Delete'))
    expect(confirm).toHaveBeenCalled()
    expect(screen.getByDisplayValue('Dashboard')).toBeDefined()

    confirm.mockReturnValue(true)
    await userEvent.click(screen.getByTitle('Delete'))

    await waitFor(async () => {
      expect(await getDoc('doc_a')).toBeUndefined()
    })
  })
})
