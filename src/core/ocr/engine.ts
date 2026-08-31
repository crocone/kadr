/**
 * In-browser text recognition.
 *
 * The engine and wasm ship in the bundle — no way around it, MV3 forbids executing
 * remotely loaded code. Language data is downloaded on first use: `eng` plus `rus`
 * weigh nearly 25 MB, a bad deal to bundle for users who never open OCR (PLAN.md §7).
 *
 * The frame itself never leaves the browser: recognition happens here, and the only
 * network request is for the language data.
 */
import { createWorker, PSM, type Worker } from 'tesseract.js'

import { CORE_FILE, WORKER_FILE } from './runtime'
import type { Word } from './words'

/**
 * Recognition languages.
 *
 * The list is free: language data is fetched on demand and never bundled, so an extra
 * language here is a line of code, not megabytes. These cover most UI languages; the
 * codes are Tesseract's three-letter ones.
 */
export const OCR_LANGUAGES = [
  'rus',
  'eng',
  'ukr',
  'deu',
  'fra',
  'spa',
  'ita',
  'por',
  'nld',
  'pol',
  'ces',
  'tur',
  'ara',
  'chi_sim',
  'jpn',
  'kor',
] as const

export type OcrLanguageCode = (typeof OCR_LANGUAGES)[number]

/**
 * What goes to the engine: one language, or that language plus English.
 *
 * The pair matters more than it seems: a Russian UI is half Latin labels, from
 * `Email` to button captions. Arbitrary combinations are not offered — each extra
 * dictionary costs ~10 MB and a noticeably slower pass.
 */
export type OcrLanguage = OcrLanguageCode | `${OcrLanguageCode}+eng`

/**
 * Tesseract speaks ISO 639-2, `Intl.DisplayNames` speaks BCP 47; this table only
 * converts between them — the browser supplies and localizes the actual names.
 */
const DISPLAY_TAGS: Record<OcrLanguageCode, string> = {
  rus: 'ru',
  eng: 'en',
  ukr: 'uk',
  deu: 'de',
  fra: 'fr',
  spa: 'es',
  ita: 'it',
  por: 'pt',
  nld: 'nl',
  pol: 'pl',
  ces: 'cs',
  tur: 'tr',
  ara: 'ar',
  chi_sim: 'zh-Hans',
  jpn: 'ja',
  kor: 'ko',
}

/** Language name in the UI language, without hand-written labels per locale. */
export function languageLabel(code: OcrLanguageCode, locale: string): string {
  try {
    const names = new Intl.DisplayNames([locale], { type: 'language' })
    const label = names.of(DISPLAY_TAGS[code])
    if (label && label !== DISPLAY_TAGS[code]) return label
  } catch {
    // Old browser without DisplayNames: the raw code is worse than a name, but readable.
  }
  return DISPLAY_TAGS[code]
}

export function splitLanguage(value: OcrLanguage): { code: OcrLanguageCode; withEnglish: boolean } {
  const [code] = value.split('+') as [OcrLanguageCode]
  return { code, withEnglish: value.endsWith('+eng') }
}

export function joinLanguage(code: OcrLanguageCode, withEnglish: boolean): OcrLanguage {
  return withEnglish && code !== 'eng' ? `${code}+eng` : code
}

/** Default: the UI language, with English added. */
export function defaultLanguage(locale: string): OcrLanguage {
  const code = OCR_LANGUAGES.find((option) => DISPLAY_TAGS[option] === locale) ?? 'eng'
  return joinLanguage(code, true)
}

/**
 * Where language data is downloaded from. Same as tesseract.js's own default, named
 * explicitly so the extension's only network request isn't hidden in a library's
 * defaults.
 */
export const LANG_PATH = 'https://tessdata.projectnaptha.com/4.0.0'

export type OcrResult = { text: string; words: Word[] }

export type Progress = (stage: string, ratio: number) => void

/**
 * The worker survives between runs: creating one means loading wasm and language
 * data, seconds on first use. It is only recreated on a language change.
 */
let current: { worker: Worker; language: OcrLanguage } | null = null

async function workerFor(language: OcrLanguage, onProgress?: Progress): Promise<Worker> {
  if (current?.language === language) return current.worker

  await current?.worker.terminate()
  current = null

  const worker = await createWorker(language, 1, {
    // Extension-local paths. The core is named as a file, not a directory: given a
    // directory tesseract would feature-detect and pick a variant itself — possibly
    // one that isn't in the package. The choice is made once, in runtime.ts.
    workerPath: chrome.runtime.getURL(WORKER_FILE),
    corePath: chrome.runtime.getURL(CORE_FILE),
    langPath: LANG_PATH,
    // Without this tesseract wraps the worker in a blob URL, which the extension's
    // CSP refuses to execute — the reason importScripts used to fail.
    workerBlobURL: false,
    // Language data is cached by the browser: the second run of a language is offline.
    cacheMethod: 'write',
    // Add the key only when there is a listener: exactOptionalPropertyTypes forbids
    // passing logger: undefined.
    ...(onProgress
      ? {
          logger: (message: { status: string; progress: number }) => {
            onProgress(message.status, message.progress)
          },
        }
      : {}),
  })

  /**
   * A UI screenshot is not a document page.
   *
   * By default tesseract parses the image like a printed page: columns, paragraphs,
   * reading order. An app screenshot has none of that — panel labels, table cells,
   * button captions scattered across the frame. Page-style parsing simply drops half
   * of such text for not belonging to any paragraph — hence emails the redaction
   * "didn't notice". `SPARSE_TEXT` means "find text anywhere, order irrelevant":
   * exactly right for UIs.
   */
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT })

  current = { worker, language }
  return worker
}

/**
 * The engine gets a Blob, never an `<img>` element.
 *
 * Given an `<img>`, tesseract reads `image.src` and fetches it instead of reading
 * pixels. Our images live in IndexedDB, are shown via `URL.createObjectURL`, and the
 * URL is revoked right after decoding (a live object URL pins the memory). That is
 * fine for drawing but fatal for `fetch`: it dies with "Failed to fetch" on the dead
 * URL, and redaction silently stopped finding anything.
 *
 * So input is normalized here, once for everyone: elements are redrawn onto a canvas
 * and passed as a blob the engine reads directly.
 */
async function asBlob(image: Blob | HTMLImageElement | HTMLCanvasElement): Promise<Blob> {
  if (image instanceof Blob) return image

  const width = image instanceof HTMLCanvasElement ? image.width : image.naturalWidth
  const height = image instanceof HTMLCanvasElement ? image.height : image.naturalHeight

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const context = canvas.getContext('2d')
  if (!context) throw new Error('2d context unavailable')
  context.drawImage(image, 0, 0)

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('the canvas produced no blob'))
    }, 'image/png')
  })
}

/** Words with coordinates in pixels of the given image. */
export async function recognize(
  image: Blob | HTMLImageElement | HTMLCanvasElement,
  language: OcrLanguage,
  onProgress?: Progress,
): Promise<OcrResult> {
  const source = await asBlob(image)
  const worker = await workerFor(language, onProgress)
  const { data } = await worker.recognize(source, {}, { blocks: true })

  const words: Word[] = []
  for (const block of data.blocks ?? []) {
    for (const paragraph of block.paragraphs) {
      for (const line of paragraph.lines) {
        for (const word of line.words) {
          words.push({
            text: word.text,
            box: {
              x: word.bbox.x0,
              y: word.bbox.y0,
              w: word.bbox.x1 - word.bbox.x0,
              h: word.bbox.y1 - word.bbox.y0,
            },
          })
        }
      }
    }
  }

  return { text: data.text, words }
}

/** Frees the wasm and language data: no reason to keep them in memory after use. */
export async function releaseOcr(): Promise<void> {
  await current?.worker.terminate()
  current = null
}
