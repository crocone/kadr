/**
 * Where the video bytes live.
 *
 * Not IndexedDB: a ten-minute recording is a few hundred megabytes, and IndexedDB
 * would hold it as a single blob that has to be read whole to seek one frame. OPFS
 * gives a real file, and a real file gives `URL.createObjectURL` and a `<video>` that
 * seeks like any other.
 *
 * During recording the chunks are written as separate numbered files, each closed the
 * moment it lands. That is the difference between "the tab crashed and the recording is
 * gone" and "the tab crashed and the recording is a few seconds short": a
 * `FileSystemWritableFileStream` held open for ten minutes commits nothing until
 * `close()`, so a crash takes everything with it. Numbered parts survive.
 *
 * When recording ends the parts are merged into one file and deleted. If they are still
 * there on the next start, the previous session died — the parts are all there is, and
 * merging them is the recovery.
 */
import type { ClipId } from './types'

const ROOT = 'clips'
const PARTS_SUFFIX = '.parts'

async function root(): Promise<FileSystemDirectoryHandle> {
  const opfs = await navigator.storage.getDirectory()
  return await opfs.getDirectoryHandle(ROOT, { create: true })
}

function partsName(id: ClipId): string {
  return `${id}${PARTS_SUFFIX}`
}

/** Chunk files sort as text, so the number is padded — part 10 must not precede part 2. */
function partName(index: number): string {
  return `${String(index).padStart(6, '0')}.part`
}

export type ChunkWriter = {
  write: (chunk: Blob) => Promise<void>
  /** Bytes written so far: the size limit is checked against this, not against an estimate. */
  bytes: () => number
}

/**
 * Opens the parts directory for a new recording. Anything already there under this id
 * is removed first: an id is generated per recording, so leftovers can only be debris
 * from a crash whose recording was already recovered or discarded.
 */
export async function openChunks(id: ClipId): Promise<ChunkWriter> {
  const dir = await root()
  await dir.removeEntry(partsName(id), { recursive: true }).catch(() => undefined)
  const parts = await dir.getDirectoryHandle(partsName(id), { create: true })

  let index = 0
  let bytes = 0
  // Writes are serialized: MediaRecorder can deliver the next chunk while the previous
  // one is still being written, and two concurrent writes would race on the counter.
  let queue: Promise<void> = Promise.resolve()

  return {
    write: (chunk) => {
      const turn = queue.then(async () => {
        const file = await parts.getFileHandle(partName(index), { create: true })
        const stream = await file.createWritable()
        await stream.write(chunk)
        await stream.close()
        index += 1
        bytes += chunk.size
      })
      queue = turn.catch(() => undefined)
      return turn
    },
    bytes: () => bytes,
  }
}

/**
 * Glues the parts into one file and removes them.
 *
 * Concatenation is all a WebM needs: MediaRecorder cuts its stream at points where the
 * pieces join back into a valid file — that is what `timeslice` is for.
 */
export async function mergeChunks(
  id: ClipId,
  extension = 'webm',
): Promise<{
  file: string
  size: number
}> {
  const dir = await root()
  const parts = await dir.getDirectoryHandle(partsName(id))

  const names: string[] = []
  for await (const name of parts.keys()) names.push(name)
  names.sort()

  const target = `${id}.${extension}`
  const handle = await dir.getFileHandle(target, { create: true })
  const stream = await handle.createWritable()

  let size = 0
  for (const name of names) {
    const file = await (await parts.getFileHandle(name)).getFile()
    // The blob goes to the stream, not through JavaScript: the browser copies it
    // disk to disk, and a 300 MB recording never sits in a variable.
    await stream.write(file)
    size += file.size
  }
  await stream.close()

  await dir.removeEntry(partsName(id), { recursive: true }).catch(() => undefined)
  return { file: target, size }
}

/** The recorded file itself. `null` when it is gone — storage cleared, profile moved. */
export async function clipFile(name: string): Promise<File | null> {
  try {
    return await (await (await root()).getFileHandle(name)).getFile()
  } catch {
    return null
  }
}

export async function deleteClipFile(name: string): Promise<void> {
  await (await root()).removeEntry(name).catch(() => undefined)
}

export async function deleteChunks(id: ClipId): Promise<void> {
  await (await root()).removeEntry(partsName(id), { recursive: true }).catch(() => undefined)
}

/**
 * Recordings whose parts were never merged — every one of them is a session that died
 * mid-recording. The background offers them back on the next start.
 */
export async function unmergedRecordings(): Promise<ClipId[]> {
  const found: ClipId[] = []
  for await (const [name, handle] of (await root()).entries()) {
    if (handle.kind === 'directory' && name.endsWith(PARTS_SUFFIX)) {
      found.push(name.slice(0, -PARTS_SUFFIX.length))
    }
  }
  return found
}

/** Every merged file on disk. Used to find bytes no clip record points at any more. */
export async function listClipFiles(): Promise<string[]> {
  const found: string[] = []
  for await (const [name, handle] of (await root()).entries()) {
    if (handle.kind === 'file') found.push(name)
  }
  return found
}

/**
 * Files nothing refers to. A clip record deleted while its file stayed behind is not a
 * hypothetical: the record lives in IndexedDB and the bytes in OPFS, and there is no
 * transaction spanning both.
 */
export async function orphanFiles(known: readonly string[]): Promise<string[]> {
  const owned = new Set(known)
  return (await listClipFiles()).filter((name) => !owned.has(name))
}

/**
 * How much room is left, in bytes. `unlimitedStorage` is in the manifest, so the quota
 * is generous — but not infinite, and a recording that dies at minute nine because the
 * disk filled up should have been refused at minute one.
 */
export async function storageHeadroom(): Promise<number> {
  const { quota = 0, usage = 0 } = await navigator.storage.estimate()
  return Math.max(0, quota - usage)
}
