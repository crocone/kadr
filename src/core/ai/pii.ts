/**
 * Detects private data in text — no network, no key, no model.
 *
 * Regexes catch what has a strict shape: email, phone, card, IBAN, EU VAT id,
 * SNILS, SSN, JWT, API keys, long hex identifiers, and IPs.
 *
 * Shape is necessary but not sufficient. Where a number has a checksum or
 * forbidden ranges, they are verified: card via Luhn, IBAN via mod-97, SSN via
 * never-issued ranges — otherwise the rule matches any order number of the right
 * length. Names and addresses are deliberately excluded: they have no shape,
 * regexing them false-positives on every other word, and a wrongly blurred piece
 * of UI is worse than an unblurred surname. Anything shapeless is left to the
 * human, who places the blur by hand in the editor.
 *
 * OCR is its own problem: letters landing mid-number instead of digits break any
 * regex, so they are fixed up before matching (`normalizeDigitRuns`).
 *
 * This module deals only in text and offsets within it. Turning matches into
 * blur layers is for whoever knows where the text sat on the image.
 */
export type PiiKind =
  'email' | 'phone' | 'card' | 'iban' | 'jwt' | 'apiKey' | 'ip' | 'snils' | 'ssn' | 'vat'

/**
 * Letters OCR regularly emits instead of digits.
 *
 * In a screen font, 0/O, 1/l, 5/S differ by a couple of pixels, so a phone comes
 * out of OCR as `+7961I8719O5`. To a regex that is no longer a phone — and the
 * redaction honestly finds nothing, even though the number is visible on the frame.
 */
const CONFUSED: Record<string, string> = {
  O: '0',
  o: '0',
  D: '0',
  I: '1',
  l: '1',
  '|': '1',
  S: '5',
  s: '5',
  B: '8',
  Z: '2',
  z: '2',
}

/** Digit share above which a token counts as a number, not a word. */
const DIGIT_SHARE = 0.6

const isDigit = (char: string | undefined): boolean =>
  char !== undefined && char >= '0' && char <= '9'

/**
 * Swaps look-alike letters for digits — only where the letter sits between digits.
 *
 * The fix is one-to-one per character: string length never changes, so match
 * offsets point exactly where they would in the original text, and the redaction
 * lands on the right words.
 *
 * Both conditions are required. Without the digit-share check "Sofia" would
 * become "5ofia" and "Illia" — "111ia". Without the digit-neighbor check IBANs
 * would break: `DE89370400440532013000` is over 90% digits, so the leading `D`
 * would turn into a zero and the account number would stop being one.
 */
export function normalizeDigitRuns(text: string): string {
  return text.replace(/\S+/g, (token) => {
    const digits = token.replace(/\D/g, '').length
    if (token.length < 5 || digits / token.length < DIGIT_SHARE) return token

    const chars = [...token]
    return chars
      .map((char, at) => {
        const swap = CONFUSED[char]
        if (!swap) return char
        return isDigit(chars[at - 1]) && isDigit(chars[at + 1]) ? swap : char
      })
      .join('')
  })
}

export type PiiMatch = {
  kind: PiiKind
  text: string
  /** Offsets in the original string, used to locate the word in OCR results. */
  start: number
  end: number
}

type Rule = { kind: PiiKind; pattern: RegExp; check?: (value: string) => boolean }

/**
 * Card numbers are verified with the Luhn checksum, not just shape: without it
 * any long order number becomes a match.
 */
export function luhnValid(digits: string): boolean {
  const clean = digits.replace(/\D/g, '')
  if (clean.length < 13 || clean.length > 19) return false

  let sum = 0
  let double = false

  for (let index = clean.length - 1; index >= 0; index -= 1) {
    let digit = Number(clean[index])
    if (double) {
      digit *= 2
      if (digit > 9) digit -= 9
    }
    sum += digit
    double = !double
  }

  return sum % 10 === 0
}

/**
 * IBAN checksum per ISO 13616: first four chars move to the end, letters become
 * numbers (A = 10 … Z = 35), and the mod-97 remainder must be 1.
 *
 * Without it the rule would match any "two letters, two digits, whatever" string
 * — half the SKUs and order codes seen in UIs.
 */
export function ibanValid(value: string): boolean {
  const clean = value.replace(/\s/g, '').toUpperCase()
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(clean)) return false

  const shifted = clean.slice(4) + clean.slice(0, 4)
  let remainder = 0

  // Remainder is computed piecewise: a 34-digit number does not fit in a JS number.
  for (const char of shifted) {
    const digits = char >= 'A' ? String(char.charCodeAt(0) - 55) : char
    for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97
  }

  return remainder === 1
}

/** Countries whose VAT ids start with a country code — that prefix is what the rule keys on. */
const VAT_COUNTRIES =
  'AT|BE|BG|CY|CZ|DE|DK|EE|EL|ES|FI|FR|HR|HU|IE|IT|LT|LU|LV|MT|NL|PL|PT|RO|SE|SI|SK'

/**
 * US Social Security number. Never-issued ranges are rejected: otherwise any
 * hyphenated number triple matches — dates, phone extensions, version numbers.
 */
export function ssnValid(value: string): boolean {
  const [area, group, serial] = value.split(/[- ]/)
  if (!area || !group || !serial) return false

  const first = Number(area)
  if (first === 0 || first === 666 || first >= 900) return false
  return Number(group) !== 0 && Number(serial) !== 0
}

/**
 * Order matters: matches never overlap and the first rule claims the span, so
 * long unambiguous shapes come before short vague ones.
 */
const RULES: readonly Rule[] = [
  { kind: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  {
    kind: 'apiKey',
    pattern: /\b(?:sk|pk|rk|api|key|ghp|gho|xox[bp])[-_][A-Za-z0-9_-]{16,}\b/gi,
  },
  {
    kind: 'email',
    // Spaces around the @ are an OCR artifact: absent on the frame, but constant
    // in OCR text because fonts leave a visible gap around `@`.
    pattern: /\b[A-Za-z0-9._%+-]+ ?@ ?[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  },
  {
    kind: 'snils',
    // Strict shape, no false positives: 123-456-789 01.
    pattern: /\b\d{3}[- ]\d{3}[- ]\d{3}[- ]\d{2}\b/g,
  },
  {
    kind: 'ssn',
    // US. Strict shape, but the extra check is mandatory: see `ssnValid`.
    pattern: /\b\d{3}[- ]\d{2}[- ]\d{4}\b/g,
    check: ssnValid,
  },
  {
    kind: 'iban',
    // IBANs are almost always printed in groups of four: DE89 3704 0044 0532 0130 00.
    // The earlier pattern required a solid run and missed such numbers entirely.
    pattern: /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){11,30}\b/g,
    check: ibanValid,
  },
  {
    kind: 'vat',
    // EU VAT id: country code plus a tail. The tail must be mostly digits —
    // otherwise the first ALL-CAPS word like DEPARTMENTS matches.
    pattern: new RegExp(`\\b(?:${VAT_COUNTRIES})[A-Z0-9]{8,12}\\b`, 'g'),
    check: (value) => value.replace(/\D/g, '').length >= 6,
  },
  {
    kind: 'card',
    pattern: /\b(?:\d[ -]?){13,19}\b/g,
    check: luhnValid,
  },
  {
    kind: 'phone',
    // Grouping varies by habit: 912 345-67-89 and 415 555 2671 are the same
    // thing. So the shape is loose and the digit count filters the rest.
    pattern: /(?:\+\d{1,3}[\s-]?)?(?:\(\d{2,5}\)[\s-]?)?\d{2,4}(?:[\s-]?\d{2,4}){1,4}/g,
    check: (value) => {
      const digits = value.replace(/\D/g, '').length
      // Upper bound from E.164: anything longer is an order number, not a phone.
      return digits >= 10 && digits <= 15
    },
  },
  {
    kind: 'ip',
    pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    check: (value) => value.split('.').every((part) => Number(part) <= 255),
  },
  {
    kind: 'apiKey',
    // A long hex string is a session id, hash, or token. No real word of that
    // length uses only a–f.
    pattern: /\b[0-9a-f]{32,}\b/gi,
  },
]

function overlaps(match: PiiMatch, found: readonly PiiMatch[]): boolean {
  return found.some((other) => match.start < other.end && other.start < match.end)
}

/** All matches in a string, in position order, non-overlapping. */
export function findPii(text: string): PiiMatch[] {
  const found: PiiMatch[] = []
  // Search the digit-normalized text but return slices of the original: same
  // length, so offsets line up exactly.
  const probe = normalizeDigitRuns(text)

  for (const rule of RULES) {
    // A /g regex keeps position between calls: fresh instance per pass.
    const pattern = new RegExp(rule.pattern.source, rule.pattern.flags)

    for (const match of probe.matchAll(pattern)) {
      const value = match[0]
      const start = match.index
      if (rule.check && !rule.check(value)) continue

      const candidate = {
        kind: rule.kind,
        text: text.slice(start, start + value.length),
        start,
        end: start + value.length,
      }
      if (!overlaps(candidate, found)) found.push(candidate)
    }
  }

  return found.sort((a, b) => a.start - b.start)
}

export function hasPii(text: string): boolean {
  return findPii(text).length > 0
}
