import { useEffect, useMemo, useRef, useState } from 'react'

import type { DocId } from '@/core/doc/types'
import { sendMessage } from '@/core/messaging'
import { saveBlob } from '@/core/render/export'
import { buildFilename } from '@/core/render/filename'
import type { StoredDoc } from '@/core/storage/db'
import {
  collectDomains,
  collectTags,
  dayOffset,
  groupByDay,
  removeDoc,
  renameDoc,
  searchDocs,
  searchLibrary,
  type Shelf,
  shelfCounts,
  shelfQuery,
  setDocTags,
} from '@/core/storage/library'
import { readSettings } from '@/core/storage/settings'
import { renderDocBlob } from '@/guide/render'
import { useApp } from '@/core/ui/app-context'
import { targetOf, useReshoot } from '@/core/ui/useReshoot'
import { cn } from '@/core/ui/cn'
import { Button } from '@/core/ui/components'
import { IconGrid, IconLibrary, IconList, IconSearch, IconSettings } from '@/core/ui/icons'

import { SelectionBar } from './SelectionBar'
import { ShotCard } from './ShotCard'
import { ShotRow } from './ShotRow'
import { Sidebar } from './Sidebar'

const RENAME_DEBOUNCE_MS = 500

type View = 'grid' | 'list'

/**
 * Shot library: search by domain, date, tags, and OCR text (PLAN.md §6).
 *
 * All documents are loaded once and filtered in memory: search must respond to every
 * keystroke, and a trip to IndexedDB per letter cannot deliver that.
 *
 * The feed is grouped by capture day. People look for shots from memory — "it was
 * yesterday" — and a day heading answers that faster than a date on every card.
 */
export function Library() {
  const { t, locale } = useApp()
  const [docs, setDocs] = useState<StoredDoc[]>([])
  const [loaded, setLoaded] = useState(false)
  const [text, setText] = useState('')
  const [shelf, setShelf] = useState<Shelf>('all')
  const [domains, setDomains] = useState<string[]>([])
  const [tags, setTags] = useState<string[]>([])
  const [view, setView] = useState<View>('grid')
  const [selected, setSelected] = useState<ReadonlySet<DocId>>(new Set())

  // Reference point for "today" and "yesterday". Taken once: recomputing it on every
  // render would churn the whole feed for no reason.
  const [now] = useState(() => Date.now())

  /** Pending renames: per-document timer plus the last typed title. */
  const renames = useRef(new Map<string, { timer: ReturnType<typeof setTimeout>; title: string }>())

  useEffect(() => {
    void searchLibrary().then((found) => {
      setDocs(found)
      setLoaded(true)
    })
  }, [])

  useEffect(() => {
    const pending = renames.current
    // The tab gets closed right after an edit more often than you'd think, so a
    // pending title is flushed to the DB instead of being dropped with its timer.
    return () => {
      for (const [id, { timer, title }] of pending) {
        clearTimeout(timer)
        void renameDoc(id, title)
      }
      pending.clear()
    }
  }, [])

  const dateFormat = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }),
    [locale],
  )
  const timeFormat = useMemo(
    () => new Intl.DateTimeFormat(locale, { timeStyle: 'short' }),
    [locale],
  )
  const dayFormat = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: 'long' }), [locale])

  const domainFacets = useMemo(() => collectDomains(docs), [docs])
  const tagFacets = useMemo(() => collectTags(docs), [docs])
  const counts = useMemo(() => shelfCounts(docs, now), [docs, now])

  const found = useMemo(
    () => searchDocs(docs, { text, domains, tags, ...shelfQuery(shelf, now) }),
    [docs, text, domains, tags, shelf, now],
  )
  const groups = useMemo(() => groupByDay(found), [found])

  // Selection only counts while the shot is visible: a deleted or filtered-out one
  // must not silently ride along into a download.
  const picked = useMemo(() => found.filter((doc) => selected.has(doc.id)), [found, selected])

  const select = (id: DocId, on: boolean) => {
    setSelected((current) => {
      const next = new Set(current)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const reshoot = useReshoot()
  /** What is being reshot right now: cards in the batch disable their button, others don't. */
  const [pending, setPending] = useState<Set<string>>(new Set())

  /**
   * Reshooting changes frames in the DB while the list lives in page memory: without a
   * reload the thumbnails would stay stale and the button would look like a no-op.
   */
  const runReshoot = async (targets: ReturnType<typeof targetOf>[]) => {
    const real = targets.filter((target) => target !== null)
    if (real.length === 0) return

    setPending(new Set(real.map((target) => target.docId)))
    try {
      await reshoot.run(real)
      setDocs(await searchLibrary())
    } finally {
      setPending(new Set())
    }
  }

  /**
   * "Reshoot everything on this domain" sits next to the domain checkboxes: the batch
   * is exactly what the user just filtered, one permission and one window for all of
   * it. Requires exactly one domain — two sites would need two permissions.
   */
  const domainTargets = useMemo(
    () => (domains.length === 1 ? found.map(targetOf).filter((target) => target !== null) : []),
    [domains, found],
  )

  const patch = (id: string, change: (doc: StoredDoc) => StoredDoc) => {
    setDocs((current) => current.map((doc) => (doc.id === id ? change(doc) : doc)))
  }

  /** The edit shows immediately but hits the DB debounced: titles are typed letter by letter. */
  const rename = (id: string, title: string) => {
    patch(id, (doc) => ({ ...doc, title }))
    clearTimeout(renames.current.get(id)?.timer)
    renames.current.set(id, {
      title,
      timer: setTimeout(() => {
        renames.current.delete(id)
        void renameDoc(id, title)
      }, RENAME_DEBOUNCE_MS),
    })
  }

  const retag = (id: string, next: string[]) => {
    patch(id, (doc) => ({ ...doc, tags: next }))
    void setDocTags(id, next)
  }

  const forget = (ids: readonly DocId[]) => {
    setDocs((current) => current.filter((doc) => !ids.includes(doc.id)))
    setSelected(new Set())
    void (async () => {
      for (const id of ids) await removeDoc(id)
    })()
  }

  const drop = (doc: StoredDoc) => {
    if (!window.confirm(t('library.delete.confirm', { title: doc.title }))) return
    forget([doc.id])
  }

  const dropSelected = () => {
    const first = picked[0]
    if (!first) return

    const question =
      picked.length === 1
        ? t('library.delete.confirm', { title: first.title })
        : t('library.delete.confirmMany', { n: picked.length })
    if (!window.confirm(question)) return

    forget(picked.map((doc) => doc.id))
  }

  const openSelected = () => {
    for (const doc of picked) void sendMessage('editor:open', { docId: doc.id })
  }

  const [downloading, setDownloading] = useState(false)
  const [downloadFailed, setDownloadFailed] = useState(false)

  /**
   * The batch downloads one file at a time: `chrome.downloads` takes one URL per call,
   * and rendering ten documents at once would keep ten canvases in memory.
   */
  const downloadSelected = () => {
    setDownloading(true)
    setDownloadFailed(false)

    void (async () => {
      const settings = await readSettings()
      let failed = false

      for (const doc of picked) {
        try {
          // Renders the same scene as the editor: the file gets the styled, annotated
          // frame, not the raw capture from the DB.
          const blob = await renderDocBlob(doc, 1)
          await saveBlob(
            blob,
            buildFilename(
              settings.filenameTemplate,
              { domain: doc.domain, title: doc.title, date: new Date(doc.updatedAt) },
              'png',
            ),
          )
        } catch (error) {
          console.error('[kadr] the shot could not be saved', error)
          failed = true
        }
      }

      setDownloadFailed(failed)
      setDownloading(false)
    })()
  }

  const dayLabel = (day: number): string => {
    const offset = dayOffset(day, now)
    if (offset === 0) return t('library.day.today')
    if (offset === 1) return t('library.day.yesterday')
    return dayFormat.format(day)
  }

  const nothingAtAll = loaded && docs.length === 0

  return (
    <div className="flex h-screen flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-3.5">
        <span className="grid h-[26px] w-[26px] place-items-center rounded-md bg-accent text-accent-fg">
          <IconLibrary size={15} />
        </span>
        <h1 className="text-base font-semibold">{t('library.title')}</h1>
        <span className="font-mono text-[11px] tracking-[0.08em] text-text-muted uppercase">
          {t('library.count', { n: found.length })}
        </span>

        <label className="relative ml-auto w-80">
          <span className="sr-only">{t('library.search')}</span>
          <span className="absolute top-1/2 left-2.5 -translate-y-1/2 text-text-muted">
            <IconSearch size={14} />
          </span>
          <input
            autoFocus
            type="search"
            value={text}
            placeholder={t('library.search')}
            onChange={(event) => {
              setText(event.target.value)
            }}
            className={cn(
              'h-9 w-full rounded-control border border-border bg-surface pr-2.5 pl-8 text-[13px]',
              'hover:border-border-strong focus:border-border-strong focus:outline-none',
            )}
          />
        </label>

        <span className="flex items-center gap-1 rounded-control bg-surface-muted p-0.5">
          <ViewButton
            active={view === 'grid'}
            label={t('library.view.grid')}
            onClick={() => {
              setView('grid')
            }}
          >
            <IconGrid size={15} />
          </ViewButton>
          <ViewButton
            active={view === 'list'}
            label={t('library.view.list')}
            onClick={() => {
              setView('list')
            }}
          >
            <IconList size={15} />
          </ViewButton>
        </span>

        <button
          type="button"
          title={t('popup.openOptions')}
          aria-label={t('popup.openOptions')}
          onClick={() => {
            void chrome.runtime.openOptionsPage()
          }}
          className="grid h-9 w-9 place-items-center rounded-control border border-border text-text-muted hover:border-border-strong hover:text-text"
        >
          <IconSettings size={15} />
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        <Sidebar
          shelf={shelf}
          counts={counts}
          onShelf={setShelf}
          domains={domainFacets}
          pickedDomains={domains}
          onDomains={setDomains}
          tags={tagFacets}
          pickedTags={tags}
          onTags={setTags}
          reshoot={
            domainTargets.length > 0
              ? {
                  label: reshoot.running
                    ? t('reshoot.running')
                    : t('reshoot.domain', { domain: domains[0] ?? '' }),
                  running: reshoot.running,
                  onRun: () => {
                    void runReshoot(domainTargets)
                  },
                }
              : null
          }
        />

        <main className="flex-1 overflow-y-auto p-5">
          {reshoot.error ? <p className="mb-3 text-xs text-danger">{t(reshoot.error)}</p> : null}

          {found.length === 0 && loaded ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
              <p className="text-sm text-text-soft">
                {nothingAtAll ? t('library.empty') : t('library.nothingFound')}
              </p>
              <p className="text-xs text-text-muted">
                {nothingAtAll ? t('library.empty.hint') : t('library.nothingFound.hint')}
              </p>
              {nothingAtAll ? (
                <Button
                  className="mt-2"
                  onClick={() => {
                    void sendMessage('editor:open', {})
                  }}
                >
                  {t('popup.openEditor')}
                </Button>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              {groups.map((group) => (
                <section key={group.day} className="flex flex-col gap-3">
                  <h2 className="font-mono text-[10px] tracking-[0.1em] text-text-muted uppercase">
                    {dayLabel(group.day)}
                  </h2>

                  {view === 'grid' ? (
                    <ul className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
                      {group.docs.map((doc) => (
                        <ShotCard
                          key={doc.id}
                          doc={doc}
                          timeFormat={timeFormat}
                          selected={selected.has(doc.id)}
                          onSelect={(on) => {
                            select(doc.id, on)
                          }}
                          onOpen={() => {
                            void sendMessage('editor:open', { docId: doc.id })
                          }}
                        />
                      ))}
                    </ul>
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {group.docs.map((doc) => (
                        <ShotRow
                          key={doc.id}
                          doc={doc}
                          dateFormat={dateFormat}
                          selected={selected.has(doc.id)}
                          onSelect={(on) => {
                            select(doc.id, on)
                          }}
                          onOpen={() => {
                            void sendMessage('editor:open', { docId: doc.id })
                          }}
                          onRename={(title) => {
                            rename(doc.id, title)
                          }}
                          onTags={(next) => {
                            retag(doc.id, next)
                          }}
                          onPickTag={(picked) => {
                            setTags((current) =>
                              current.includes(picked)
                                ? current.filter((tag) => tag !== picked)
                                : [...current, picked],
                            )
                          }}
                          onDelete={() => {
                            drop(doc)
                          }}
                          onReshoot={
                            targetOf(doc)
                              ? () => {
                                  void runReshoot([targetOf(doc)])
                                }
                              : null
                          }
                          reshooting={pending.has(doc.id)}
                        />
                      ))}
                    </ul>
                  )}
                </section>
              ))}
            </div>
          )}
        </main>
      </div>

      {picked.length > 0 ? (
        <SelectionBar
          count={picked.length}
          downloading={downloading}
          error={downloadFailed}
          onOpen={openSelected}
          onDownload={downloadSelected}
          onDelete={dropSelected}
        />
      ) : null}
    </div>
  )
}

function ViewButton({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'grid h-8 w-8 place-items-center rounded-md transition-colors',
        active ? 'bg-raised text-text shadow-sm' : 'text-text-muted hover:text-text',
      )}
    >
      {children}
    </button>
  )
}
