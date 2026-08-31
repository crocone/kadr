/**
 * Minimal PDF writer: pages with one image each.
 *
 * Hand-written rather than a library, for the same reason video will go through
 * WebCodecs instead of ffmpeg.wasm (PLAN.md §5): only one object type is needed —
 * JPEG via DCTDecode, embedded byte-for-byte without re-encoding. A couple hundred
 * lines versus a megabyte of dependency.
 *
 * A long capture is cut into pages, not emitted as one huge image (PLAN.md §3).
 */
export type PageSize = { w: number; h: number }

/** Sizes in typographic points: 1 pt = 1/72 inch. */
export const PAGE_SIZES = {
  a4: { w: 595.28, h: 841.89 },
  letter: { w: 612, h: 792 },
} as const satisfies Record<string, PageSize>

export type PageFormat = keyof typeof PAGE_SIZES

/** The same page turned sideways. */
export function landscape(page: PageSize): PageSize {
  return { w: page.h, h: page.w }
}

/**
 * Page orientation for the image: portrait for tall, landscape for wide.
 *
 * A screen capture is almost always wider than tall, and on portrait A4 it fills the
 * top third, leaving two thirds blank on every page. A ten-step guide used to become
 * ten nearly empty pages.
 */
export function pageForImage(image: { width: number; height: number }, page: PageSize): PageSize {
  return image.width > image.height ? landscape(page) : page
}

export type Slice = { y: number; height: number }

/**
 * Layout of the frame across pages. The image is fitted to the page width, so one
 * page's height in frame pixels is constant; the last page is shorter.
 */
export function paginate(imageWidth: number, imageHeight: number, page: PageSize): Slice[] {
  if (imageWidth <= 0 || imageHeight <= 0) return []

  const scale = page.w / imageWidth
  const sliceHeight = Math.max(1, Math.floor(page.h / scale))

  const slices: Slice[] = []
  for (let y = 0; y < imageHeight; y += sliceHeight) {
    slices.push({ y, height: Math.min(sliceHeight, imageHeight - y) })
  }
  return slices
}

export type PdfImage = {
  /** Ready JPEG bytes. Embedded as-is: DCTDecode reads it without re-encoding. */
  jpeg: Uint8Array
  width: number
  height: number
}

const encoder = new TextEncoder()

function latin1(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff
  return bytes
}

/**
 * How the image sits on the page. A long capture is cut into page-width slices pinned
 * to the top — otherwise a white strip would appear at each seam. A standalone frame
 * that doesn't fill the page is centred, so the page looks like a page rather than
 * cropped at the top.
 */
export type PageAlign = 'top' | 'middle'

/**
 * Assembles the PDF. Object offsets are computed from the actual chunk lengths so the
 * xref table adds up: any mistake here makes the whole file unreadable.
 */
export function buildPdf(images: PdfImage[], page: PageSize, align: PageAlign = 'top'): Blob {
  const chunks: Uint8Array[] = []
  const offsets: number[] = []
  let length = 0

  const push = (data: Uint8Array | string) => {
    const bytes = typeof data === 'string' ? latin1(data) : data
    chunks.push(bytes)
    length += bytes.length
  }

  /** Objects are numbered from one; offsets[i] is the offset of object i + 1. */
  const startObject = (index: number) => {
    offsets[index - 1] = length
    push(`${index} 0 obj\n`)
  }

  const pageCount = Math.max(1, images.length)
  // 1 — catalog, 2 — page tree, then three objects per page.
  const pageObjectId = (i: number) => 3 + i * 3
  const contentObjectId = (i: number) => 4 + i * 3
  const imageObjectId = (i: number) => 5 + i * 3

  push('%PDF-1.4\n')
  // Comment with high bytes: a hint to readers that the file is binary.
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]))

  startObject(1)
  push('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')

  startObject(2)
  const kids = images.map((_, i) => `${pageObjectId(i)} 0 R`).join(' ')
  push(`<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>\nendobj\n`)

  images.forEach((image, i) => {
    // Fit to page width, or to height when it wouldn't fit vertically: a standalone
    // frame would otherwise simply be cropped.
    const scale = Math.min(page.w / image.width, page.h / image.height)
    const drawWidth = image.width * scale
    const drawHeight = image.height * scale
    const left = (page.w - drawWidth) / 2
    const bottom = align === 'middle' ? (page.h - drawHeight) / 2 : page.h - drawHeight
    const content = `q\n${drawWidth.toFixed(2)} 0 0 ${drawHeight.toFixed(2)} ${left.toFixed(
      2,
    )} ${bottom.toFixed(2)} cm\n/Im0 Do\nQ\n`

    startObject(pageObjectId(i))
    push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.w.toFixed(2)} ${page.h.toFixed(2)}] ` +
        `/Resources << /XObject << /Im0 ${imageObjectId(i)} 0 R >> >> ` +
        `/Contents ${contentObjectId(i)} 0 R >>\nendobj\n`,
    )

    startObject(contentObjectId(i))
    push(`<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`)

    startObject(imageObjectId(i))
    push(
      `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode ` +
        `/Length ${image.jpeg.length} >>\nstream\n`,
    )
    push(image.jpeg)
    push('\nendstream\nendobj\n')
  })

  const xrefOffset = length
  const objectCount = offsets.length + 1
  push(`xref\n0 ${objectCount}\n`)
  push('0000000000 65535 f \n')
  for (const offset of offsets) push(`${String(offset).padStart(10, '0')} 00000 n \n`)
  push(`trailer\n<< /Size ${objectCount} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`)

  return new Blob(chunks as BlobPart[], { type: 'application/pdf' })
}

export function encodeUtf8(text: string): Uint8Array {
  return encoder.encode(text)
}
