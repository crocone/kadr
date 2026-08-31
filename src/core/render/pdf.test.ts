import { describe, expect, it } from 'vitest'

import { buildPdf, PAGE_SIZES, pageForImage, paginate, type PdfImage } from './pdf'

const A4 = PAGE_SIZES.a4

async function textOf(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  return Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')
}

function fakeJpeg(size = 16): PdfImage {
  return { jpeg: new Uint8Array(size).fill(0xff), width: 100, height: 140 }
}

describe('paginate', () => {
  it('fits a short image on a single page', () => {
    expect(paginate(1000, 500, A4)).toEqual([{ y: 0, height: 500 }])
  })

  it('splits a long page into sheets and leaves the remainder on the last', () => {
    const slices = paginate(1000, 5000, A4)

    expect(slices.length).toBeGreaterThan(1)
    expect(slices[0]?.y).toBe(0)
    expect(slices.at(-1)!.y + slices.at(-1)!.height).toBe(5000)
  })

  it('leaves no gap and no overlap between sheets', () => {
    const slices = paginate(1280, 9000, A4)

    for (let i = 1; i < slices.length; i++) {
      expect(slices[i]!.y).toBe(slices[i - 1]!.y + slices[i - 1]!.height)
    }
  })

  it('makes taller sheets for a narrower image, since it is scaled up to the page', () => {
    const narrow = paginate(500, 10_000, A4)[0]!.height
    const wide = paginate(2000, 10_000, A4)[0]!.height

    expect(wide).toBeGreaterThan(narrow)
  })

  it('has nothing to paginate for an empty image', () => {
    expect(paginate(0, 0, A4)).toEqual([])
  })
})

describe('buildPdf', () => {
  it('writes a header and a trailer', async () => {
    const text = await textOf(buildPdf([fakeJpeg()], A4))

    expect(text.startsWith('%PDF-1.4')).toBe(true)
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true)
  })

  it('declares as many pages as it was given', async () => {
    const text = await textOf(buildPdf([fakeJpeg(), fakeJpeg(), fakeJpeg()], A4))

    expect(text).toContain('/Count 3')
    expect(text.match(/\/Type \/Page[^s]/g)).toHaveLength(3)
  })

  it('embeds the jpeg untouched, as DCTDecode', async () => {
    const text = await textOf(buildPdf([fakeJpeg(32)], A4))

    expect(text).toContain('/Filter /DCTDecode')
    expect(text).toContain('/Length 32')
  })

  it('points every xref entry at the real byte offset of its object', async () => {
    const text = await textOf(buildPdf([fakeJpeg(), fakeJpeg()], A4))

    const xrefStart = Number(/startxref\n(\d+)/.exec(text)?.[1])
    expect(text.slice(xrefStart, xrefStart + 4)).toBe('xref')

    const entries = [...text.matchAll(/^(\d{10}) 00000 n $/gm)].map((match) => Number(match[1]))
    expect(entries).toHaveLength(2 + 2 * 3)
    for (const [index, offset] of entries.entries()) {
      expect(text.slice(offset)).toMatch(new RegExp(`^${index + 1} 0 obj`))
    }
  })

  it('sizes the media box to the requested page format', async () => {
    const text = await textOf(buildPdf([fakeJpeg()], PAGE_SIZES.letter))
    expect(text).toContain('/MediaBox [0 0 612.00 792.00]')
  })
})

describe('pageForImage', () => {
  it('turns the sheet sideways for a screenshot, which is wider than it is tall', () => {
    expect(pageForImage({ width: 5376, height: 2994 }, PAGE_SIZES.a4)).toEqual({
      w: PAGE_SIZES.a4.h,
      h: PAGE_SIZES.a4.w,
    })
  })

  it('leaves a tall shot on a portrait sheet', () => {
    expect(pageForImage({ width: 800, height: 2000 }, PAGE_SIZES.a4)).toEqual(PAGE_SIZES.a4)
  })
})

describe('pageForImage', () => {
  it('turns the sheet sideways for a screenshot, which is wider than it is tall', () => {
    expect(pageForImage({ width: 5376, height: 2994 }, PAGE_SIZES.a4)).toEqual({
      w: PAGE_SIZES.a4.h,
      h: PAGE_SIZES.a4.w,
    })
  })

  it('leaves a tall shot on a portrait sheet', () => {
    expect(pageForImage({ width: 800, height: 2000 }, PAGE_SIZES.a4)).toEqual(PAGE_SIZES.a4)
  })
})
