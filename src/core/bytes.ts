/**
 * Blob to base64. Shared by the background (data URLs for downloads), trackers
 * (GitHub only accepts files this way), and the AI layer — hence a standalone module.
 *
 * `String.fromCharCode(...bytes)` on a megabyte frame blows the stack (each byte
 * becomes an argument), so we convert in 32 KB chunks. `FileReader` is no option:
 * it does not exist in a service worker.
 */
const CHUNK = 0x8000

export async function base64Of(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK))
  }
  return btoa(binary)
}

export async function dataUrlOf(blob: Blob): Promise<string> {
  return `data:${blob.type || 'image/png'};base64,${await base64Of(blob)}`
}
