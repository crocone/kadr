/**
 * Where a captured frame goes besides the editor.
 *
 * Download uses a data URL, not a blob URL: an MV3 service worker has no
 * `URL.createObjectURL`, so there is nowhere to get a blob URL from (PLAN.md §8).
 * Clipboard copies are written by the overlay — see `content/overlay/area.ts`.
 */
import { dataUrlOf } from '@/core/bytes'

export async function downloadBlob(blob: Blob, filename: string): Promise<void> {
  await chrome.downloads.download({ url: await dataUrlOf(blob), filename, saveAs: false })
}
