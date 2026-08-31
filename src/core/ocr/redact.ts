/**
 * From recognized text to redaction layers.
 *
 * Matches arrive as character offsets, words as image-pixel rectangles, and the blur
 * layer lives in document coordinates. All the conversion happens here as a pure
 * function: it can't be tested against real recognition, and a bug on this path only
 * shows up in the exported file.
 */
import { findPii, type PiiKind, type PiiMatch } from '@/core/ai/pii'
import type { PiiKind as DocPiiKind, Rect } from '@/core/doc/types'

import { boxesForRange, joinWords, mergeByLines, toDocumentRect, type Word } from './words'

export type Finding = {
  kind: PiiKind
  text: string
  /** Rectangles in document coordinates, one per line of the match. */
  rects: Rect[]
}

/** Small margin around a word: OCR boxes hug the glyphs tightly. */
export const PADDING = 2

function padded(rect: Rect, padding: number): Rect {
  return {
    x: rect.x - padding,
    y: rect.y - padding,
    w: rect.w + padding * 2,
    h: rect.h + padding * 2,
  }
}

/**
 * Findings with rectangles resolved.
 *
 * A finding with no rectangles is dropped: it matched in the joined text but maps to
 * no word — there is nothing to redact, and an empty layer in the list would look
 * broken.
 */
export function findingsFrom(
  words: readonly Word[],
  image: { w: number; h: number },
  frame: Rect,
  padding = PADDING,
): Finding[] {
  const joined = joinWords(words)
  const findings: Finding[] = []

  for (const match of findPii(joined.text)) {
    const rects = mergeByLines(boxesForRange(joined, match.start, match.end))
      .map((box) => toDocumentRect(box, image, frame))
      .map((rect) => padded(rect, padding))

    if (rects.length > 0) findings.push({ kind: match.kind, text: match.text, rects })
  }

  return findings
}

/**
 * Maps detector kinds onto the document's kinds.
 *
 * The scales differ on purpose: the detector distinguishes JWT from API key, while
 * the document only cares what a patch hides when the user reads the findings list.
 * The mapping is explicit because a silent cast would eventually turn an IBAN into
 * "other".
 */
export function docPiiKind(kind: PiiKind): DocPiiKind {
  switch (kind) {
    case 'email':
    case 'phone':
    case 'card':
      return kind
    // Bank account details, same as a card: the document has no separate kind for them.
    case 'iban':
      return 'card'
    case 'jwt':
    case 'apiKey':
      return 'token'
    case 'snils':
    case 'ssn':
    case 'vat':
    case 'ip':
      return 'other'
  }
}

/** All patch rectangles; used to tell whether there is anything to redact. */
export function rectsOf(findings: readonly Finding[]): Rect[] {
  return findings.flatMap((finding) => finding.rects)
}

export type { PiiMatch }
