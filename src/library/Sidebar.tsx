import type { MessageKey } from '@/core/i18n'
import {
  type Facet,
  isShelfReady,
  type Shelf,
  SHELVES,
  type ShelfCounts,
} from '@/core/storage/library'
import { useT } from '@/core/ui/app-context'
import { cn } from '@/core/ui/cn'
import { Button } from '@/core/ui/components'

/**
 * Sidebar: "what kind of shot" first, "where it came from" second.
 *
 * Shelves on top ask about the shot itself; domains and tags below ask about the
 * source. The order is not cosmetic: narrowing to today's shots is wanted more often
 * than narrowing to one site, and the more-used control goes higher.
 */
export function Sidebar({
  shelf,
  counts,
  onShelf,
  domains,
  pickedDomains,
  onDomains,
  tags,
  pickedTags,
  onTags,
  reshoot,
}: {
  shelf: Shelf
  counts: ShelfCounts
  onShelf: (shelf: Shelf) => void
  domains: Facet[]
  pickedDomains: readonly string[]
  onDomains: (domains: string[]) => void
  tags: Facet[]
  pickedTags: readonly string[]
  onTags: (tags: string[]) => void
  /** "Reshoot everything on this domain" button; present only when exactly one domain is picked. */
  reshoot: { label: string; running: boolean; onRun: () => void } | null
}) {
  const t = useT()

  return (
    <aside className="flex w-[240px] shrink-0 flex-col gap-5 overflow-y-auto border-r border-border p-4">
      <ul className="flex flex-col gap-0.5">
        {SHELVES.map((value) => {
          const ready = isShelfReady(value)
          return (
            <li key={value}>
              <button
                type="button"
                disabled={!ready}
                aria-current={shelf === value}
                title={ready ? undefined : t('popup.record.soon')}
                onClick={() => {
                  onShelf(value)
                }}
                className={cn(
                  'flex w-full items-center gap-2 rounded-control px-3 py-2 text-[13px] transition-colors',
                  'disabled:cursor-not-allowed disabled:opacity-40',
                  shelf === value
                    ? 'bg-surface-muted font-medium text-text'
                    : 'text-text-soft enabled:hover:bg-surface-muted enabled:hover:text-text',
                )}
              >
                <span className="truncate">{t(`library.shelf.${value}` as MessageKey)}</span>
                <span className="ml-auto font-mono text-[11px] text-text-muted tabular-nums">
                  {counts[value]}
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      {domains.length > 1 ? (
        <FacetChecks
          title={t('library.domains')}
          facets={domains}
          picked={pickedDomains}
          onPick={onDomains}
        />
      ) : null}

      {tags.length > 0 ? (
        <FacetChecks title={t('library.tags')} facets={tags} picked={pickedTags} onPick={onTags} />
      ) : null}

      {reshoot ? (
        <Button size="sm" disabled={reshoot.running} onClick={reshoot.onRun}>
          {reshoot.label}
        </Button>
      ) : null}
    </aside>
  )
}

/**
 * Checkbox list. Within a list the logic is OR: checking habr.com and figma.com shows
 * shots from both sites, not an impossible intersection.
 */
function FacetChecks({
  title,
  facets,
  picked,
  onPick,
}: {
  title: string
  facets: Facet[]
  picked: readonly string[]
  onPick: (values: string[]) => void
}) {
  return (
    <section className="flex flex-col gap-1.5 border-t border-border pt-4">
      <h2 className="px-3 font-mono text-[10px] tracking-[0.1em] text-text-muted uppercase">
        {title}
      </h2>
      {facets.map((facet) => (
        <label
          key={facet.value}
          className="flex cursor-pointer items-center gap-2.5 rounded-control px-3 py-1.5 text-[13px] text-text-soft transition-colors hover:bg-surface-muted hover:text-text"
        >
          <input
            type="checkbox"
            checked={picked.includes(facet.value)}
            onChange={(event) => {
              onPick(
                event.target.checked
                  ? [...picked, facet.value]
                  : picked.filter((value) => value !== facet.value),
              )
            }}
            className="h-[15px] w-[15px] accent-accent"
          />
          <span className="truncate">{facet.value}</span>
        </label>
      ))}
    </section>
  )
}
