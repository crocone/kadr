// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'

const recognized = vi.fn((_image: unknown) => ({ data: { text: '', blocks: [] } }))

const setParameters = vi.fn()

vi.mock('tesseract.js', () => ({
  createWorker: vi.fn(() => ({ recognize: recognized, setParameters, terminate: vi.fn() })),
  PSM: { SPARSE_TEXT: '11' },
}))

const {
  defaultLanguage,
  joinLanguage,
  languageLabel,
  OCR_LANGUAGES,
  recognize,
  releaseOcr,
  splitLanguage,
} = await import('./engine')

afterEach(async () => {
  await releaseOcr()
  recognized.mockClear()
  setParameters.mockClear()
  vi.restoreAllMocks()
})

/** jsdom can't draw, so the canvas is stubbed: what reaches the engine is what matters. */
function stubCanvas(blob: Blob) {
  const canvas = document.createElement('canvas')
  canvas.getContext = (() => ({ drawImage: vi.fn() })) as unknown as typeof canvas.getContext
  canvas.toBlob = (callback: BlobCallback) => {
    callback(blob)
  }

  const real = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) =>
    tag === 'canvas' ? canvas : real(tag),
  )
  return canvas
}

describe('recognize', () => {
  // A UI screenshot is not a document page: labels are scattered across panels, and
  // printed-page parsing drops half of such text for not belonging to any paragraph.
  it('reads the shot as scattered interface text, not as a page of a document', async () => {
    await recognize(new Blob(['x']), 'eng')
    expect(setParameters).toHaveBeenCalledWith({ tessedit_pageseg_mode: '11' })
  })

  it('hands a blob straight to the engine', async () => {
    const blob = new Blob(['x'], { type: 'image/png' })
    await recognize(blob, 'eng')

    expect(recognized.mock.calls[0]?.[0]).toBe(blob)
  })

  // Given an <img>, tesseract fetches image.src instead of reading pixels. Our images
  // are shown via object URLs revoked right after decoding: the element holds the
  // raster but the URL is dead. Passing such an element means "Failed to fetch" and a
  // silently empty redaction — which is what happened.
  it('never hands over an <img>, whose object URL is long revoked', async () => {
    const blob = new Blob(['png'], { type: 'image/png' })
    stubCanvas(blob)

    const image = new window.Image()
    image.src = 'blob:chrome-extension://kadr/dead-link'

    await recognize(image, 'eng')

    const passed = recognized.mock.calls[0]?.[0]
    expect(passed).toBeInstanceOf(Blob)
    expect(passed).not.toBe(image)
  })
})

describe('языки', () => {
  it('offers the popular ones, not just two', () => {
    expect(OCR_LANGUAGES.length).toBeGreaterThan(10)
    for (const code of ['rus', 'eng', 'deu', 'fra', 'spa', 'chi_sim', 'jpn']) {
      expect(OCR_LANGUAGES).toContain(code)
    }
  })

  it('names a language in the language of the interface, without a dictionary of its own', () => {
    expect(languageLabel('deu', 'ru').toLowerCase()).toContain('нем')
    expect(languageLabel('deu', 'en').toLowerCase()).toContain('german')
  })

  it('splits and rejoins the pair the engine is given', () => {
    expect(splitLanguage('rus+eng')).toEqual({ code: 'rus', withEnglish: true })
    expect(splitLanguage('deu')).toEqual({ code: 'deu', withEnglish: false })
    expect(joinLanguage('deu', true)).toBe('deu+eng')
    // English plus English is just English.
    expect(joinLanguage('eng', true)).toBe('eng')
  })

  it('starts from the language the interface speaks', () => {
    expect(defaultLanguage('ru')).toBe('rus+eng')
    expect(defaultLanguage('en')).toBe('eng')
  })
})
