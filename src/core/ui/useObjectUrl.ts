import { useEffect, useMemo } from 'react'

/**
 * Object URL for a blob from IndexedDB. The URL lives exactly as long as the
 * component is shown: without revoking, the blob stays in tab memory until the tab
 * closes — and the library has hundreds of thumbnails.
 */
export function useObjectUrl(blob: Blob | null | undefined): string | null {
  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob])

  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url)
    }
  }, [url])

  return url
}
