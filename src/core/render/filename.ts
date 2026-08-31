/**
 * Meaningful filename instead of `screenshot(3).png`.
 * The template is configured in options; fields are domain, page title and date.
 */
export type FilenameFields = {
  domain: string
  title: string
  date: Date
}

export const FILENAME_MAX_LENGTH = 120

/**
 * Name for a capture without page metadata: no domain or title, only date and time.
 * The user's template won't do here: it almost always starts with `{domain}`, and the
 * whole point of the toggle is that the page address doesn't leave with the file.
 */
export const ANONYMOUS_TEMPLATE = 'kadr-{date}-{time}'

/** Latin letters and digits stay, Cyrillic is transliterated, the rest collapses to a hyphen. */
const TRANSLIT: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'h',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'sch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .split('')
    .map((char) => TRANSLIT[char] ?? char)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function isoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function isoTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

/**
 * Substitutes template fields. Empty fields leave no holes like `--2026-08-30`:
 * separators are collapsed after substitution.
 */
export function buildFilename(template: string, fields: FilenameFields, extension: string): string {
  const values: Record<string, string> = {
    domain: slugify(fields.domain),
    title: slugify(fields.title),
    date: isoDate(fields.date),
    time: isoTime(fields.date),
  }

  const body = template
    .replace(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match)
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')

  const safe = (body || 'kadr').slice(0, FILENAME_MAX_LENGTH)
  return `${safe}.${extension}`
}
