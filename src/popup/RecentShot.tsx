import { sendMessage } from '@/core/messaging'
import type { StoredDoc } from '@/core/storage/db'
import { useObjectUrl } from '@/core/ui/useObjectUrl'

/** The thumbnail is a blob in IndexedDB: the object URL lives only while the popup is open. */
export function RecentShot({ doc }: { doc: StoredDoc }) {
  const thumbnailUrl = useObjectUrl(doc.thumbnail)

  return (
    <li>
      <button
        type="button"
        onClick={() => {
          void sendMessage('editor:open', { docId: doc.id })
        }}
        className="flex w-full items-center gap-2.5 rounded-lg border border-transparent p-1 text-left transition-colors hover:border-border hover:bg-surface-muted"
      >
        <span className="h-9 w-14 shrink-0 overflow-hidden rounded-md border border-border bg-surface-muted">
          {thumbnailUrl ? (
            <img src={thumbnailUrl} alt="" className="h-full w-full object-cover" />
          ) : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-medium">{doc.title}</span>
          <span className="block truncate font-mono text-[10px] text-text-muted">{doc.domain}</span>
        </span>
      </button>
    </li>
  )
}
