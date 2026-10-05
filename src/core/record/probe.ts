/**
 * Asking a recorded file what it actually is.
 *
 * MediaRecorder writes a WebM with no duration in its header — it cannot know the
 * length while it is still recording, and it never goes back to patch the file. Chrome
 * therefore reports `Infinity` until something forces it to scan for the last cluster.
 * Seeking far past the end is that something: the browser walks to the real end and
 * fires `durationchange` with the truth.
 *
 * The wall clock is not a substitute. It counts the seconds between start and stop,
 * which includes the ones the encoder dropped when the machine was busy — and a
 * timeline built on a duration a few hundred milliseconds off puts every zoom slightly
 * in the wrong place, worse the further in you go.
 *
 * Needs a DOM: it runs in the offscreen document and in the clip editor, never in the
 * service worker.
 */

/** A seek target no recording will ever reach; it makes Chrome resolve the real end. */
const FAR_FUTURE = 1e7

export type VideoInfo = {
  /** Milliseconds. */
  duration: number
  width: number
  height: number
}

function waitFor(video: HTMLVideoElement, event: string, timeout = 8000): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => {
      clearTimeout(timer)
      video.removeEventListener(event, done)
      video.removeEventListener('error', failed)
      resolve()
    }
    const failed = () => {
      clearTimeout(timer)
      video.removeEventListener(event, done)
      video.removeEventListener('error', failed)
      reject(new Error(`video ${event} failed`))
    }
    const timer = setTimeout(failed, timeout)
    video.addEventListener(event, done, { once: true })
    video.addEventListener('error', failed, { once: true })
  })
}

/**
 * Loads the file just far enough to read its numbers. The element is muted and never
 * attached to the document: this is measurement, not playback.
 */
export async function loadVideo(
  file: Blob,
): Promise<{ video: HTMLVideoElement; release: () => void }> {
  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.muted = true
  video.preload = 'auto'
  video.src = url

  try {
    await waitFor(video, 'loadedmetadata')
  } catch (error) {
    URL.revokeObjectURL(url)
    throw error
  }

  return {
    video,
    release: () => {
      video.src = ''
      URL.revokeObjectURL(url)
    },
  }
}

export async function resolveDuration(video: HTMLVideoElement): Promise<number> {
  if (Number.isFinite(video.duration) && video.duration > 0) return video.duration * 1000

  const settled = waitFor(video, 'durationchange').catch(() => undefined)
  video.currentTime = FAR_FUTURE
  await settled
  // Back to the start, or the poster grab below would seek from the far end.
  video.currentTime = 0

  return Number.isFinite(video.duration) ? video.duration * 1000 : 0
}

/** Frame at a given moment, as a data URL. `null` when the frame cannot be read. */
export async function frameAt(
  video: HTMLVideoElement,
  atMs: number,
  maxWidth = 480,
): Promise<string | null> {
  try {
    const seeked = waitFor(video, 'seeked', 4000)
    video.currentTime = Math.max(0, atMs / 1000)
    await seeked

    const scale = Math.min(1, maxWidth / (video.videoWidth || maxWidth))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale))

    const context = canvas.getContext('2d')
    if (!context) return null
    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/webp', 0.75)
  } catch {
    return null
  }
}

/**
 * Everything the clip record needs about the file, plus a poster.
 *
 * The poster is taken a fraction of a second in, not at zero: the first frame of a tab
 * capture is regularly the page mid-paint, and a library full of white rectangles is
 * a library nobody scans.
 */
export async function probeVideo(file: Blob): Promise<VideoInfo & { poster: string | null }> {
  const { video, release } = await loadVideo(file)
  try {
    const duration = await resolveDuration(video)
    const poster = await frameAt(video, Math.min(300, duration / 2))
    return { duration, width: video.videoWidth, height: video.videoHeight, poster }
  } finally {
    release()
  }
}
