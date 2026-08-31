import { useT } from '@/core/ui/app-context'
import { Button } from '@/core/ui/components'

/**
 * Bottom selection bar. Appears with the first checked shot and disappears with the
 * last: an empty strip with three disabled buttons would waste space promising nothing.
 */
export function SelectionBar({
  count,
  downloading,
  error,
  onOpen,
  onDownload,
  onDelete,
}: {
  count: number
  downloading: boolean
  error: boolean
  onOpen: () => void
  onDownload: () => void
  onDelete: () => void
}) {
  const t = useT()

  return (
    <div className="flex shrink-0 items-center gap-2 border-t border-border bg-surface px-5 py-3">
      <span className="text-[13px] text-text-soft">{t('library.selected', { n: count })}</span>
      {error ? (
        <span role="alert" className="text-[12px] text-danger">
          {t('library.download.failed')}
        </span>
      ) : null}

      <span className="flex-1" />

      <Button onClick={onOpen}>{t('library.open')}</Button>
      <Button disabled={downloading} onClick={onDownload}>
        {downloading ? t('library.downloading') : t('library.download')}
      </Button>
      <Button variant="danger" onClick={onDelete}>
        {t('library.delete')}
      </Button>
    </div>
  )
}
