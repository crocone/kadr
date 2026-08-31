import { useEffect, useState } from 'react'

import { migrateDoc } from '@/core/doc/create'
import { getDoc, type StoredDoc } from '@/core/storage/db'
import { useT } from '@/core/ui/app-context'

import { Workspace } from './Workspace'

/** The document arrives from the background script via IndexedDB: `?doc=<id>` in the tab URL. */
function docIdFromLocation(): string | null {
  return new URLSearchParams(window.location.search).get('doc')
}

export function Editor() {
  const t = useT()
  const [docId] = useState(docIdFromLocation)
  const [doc, setDoc] = useState<StoredDoc | null>(null)
  const [loading, setLoading] = useState(() => docId !== null)

  useEffect(() => {
    if (!docId) return
    let cancelled = false

    void getDoc(docId).then((found) => {
      if (cancelled) return
      setDoc(found ? { ...found, ...migrateDoc(found) } : null)
      setLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [docId])

  if (loading) {
    return <p className="p-6 text-sm text-text-muted">{t('common.loading')}</p>
  }

  if (!doc) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-1 text-center">
        <p className="text-sm font-medium">{t('editor.empty')}</p>
        <p className="max-w-xs text-xs text-text-muted">{t('editor.empty.hint')}</p>
      </div>
    )
  }

  return <Workspace stored={doc} />
}
