/**
 * Guide step caption (PLAN.md §6.5).
 *
 * Built from two halves: the element's name and what it is. The name comes from the
 * same places a screen reader looks — `aria-label`, `title`, `alt`, visible text,
 * `placeholder`: an accessible name someone wrote is the best caption there is. The
 * element kind (button, link, field, checkbox) turns "Save" into "Click 'Save'".
 *
 * Templates live in the ru/en i18n dictionaries, not as strings here: captions are
 * human-readable text and must be translated with everything else.
 *
 * The module is pure: step in, string out. No DOM — the element kind was determined
 * at recording time, while it was still under the cursor.
 */
import { type Locale, type MessageKey, translate } from '@/core/i18n'

import type { ScribeStep } from './timeline'

/**
 * Element kind in guide terms, not markup terms. A `div` with `role="button"` is a
 * button; an `a` without href driven by script is also a button — the user sees and
 * presses a button.
 */
export type ElementKind =
  'button' | 'link' | 'field' | 'checkbox' | 'radio' | 'select' | 'tab' | 'menuitem' | 'other'

const ROLE_KINDS: Record<string, ElementKind> = {
  button: 'button',
  link: 'link',
  checkbox: 'checkbox',
  radio: 'radio',
  switch: 'checkbox',
  tab: 'tab',
  menuitem: 'menuitem',
  menuitemcheckbox: 'menuitem',
  menuitemradio: 'menuitem',
  textbox: 'field',
  searchbox: 'field',
  combobox: 'select',
  listbox: 'select',
  option: 'other',
}

const TAG_KINDS: Record<string, ElementKind> = {
  button: 'button',
  a: 'link',
  select: 'select',
  textarea: 'field',
  summary: 'button',
  label: 'other',
}

/**
 * Element kind from tag, role, and type. Role beats tag: it exists precisely to say
 * what the element really is, and in div-based design systems it's the only truthful
 * source.
 */
export function elementKindOf(input: {
  tag: string
  role?: string | null
  type?: string | null
  href?: boolean
}): ElementKind {
  const role = input.role?.toLowerCase()
  if (role && role in ROLE_KINDS) return ROLE_KINDS[role]!

  const tag = input.tag.toLowerCase()
  if (tag === 'input') {
    const type = (input.type ?? 'text').toLowerCase()
    if (type === 'checkbox') return 'checkbox'
    if (type === 'radio') return 'radio'
    if (type === 'button' || type === 'submit' || type === 'reset' || type === 'image') {
      return 'button'
    }
    return 'field'
  }
  // A link without an href is a button pretending to be a link: "follow the link"
  // makes no sense when there's nowhere to go.
  if (tag === 'a') return input.href ? 'link' : 'button'

  return TAG_KINDS[tag] ?? 'other'
}

/** Guillemets make the label read as part of the sentence, not a chunk of code. */
function quote(label: string): string {
  return `«${label}»`
}

const NAMED: Record<ElementKind, MessageKey> = {
  button: 'scribe.caption.click.button',
  link: 'scribe.caption.click.link',
  field: 'scribe.caption.click.field',
  checkbox: 'scribe.caption.click.checkbox',
  radio: 'scribe.caption.click.radio',
  select: 'scribe.caption.click.select',
  tab: 'scribe.caption.click.tab',
  menuitem: 'scribe.caption.click.menuitem',
  other: 'scribe.caption.click.other',
}

const UNNAMED: Record<ElementKind, MessageKey> = {
  button: 'scribe.caption.blind.button',
  link: 'scribe.caption.blind.link',
  field: 'scribe.caption.blind.field',
  checkbox: 'scribe.caption.blind.checkbox',
  radio: 'scribe.caption.blind.radio',
  select: 'scribe.caption.blind.select',
  tab: 'scribe.caption.blind.tab',
  menuitem: 'scribe.caption.blind.menuitem',
  other: 'scribe.caption.blind.other',
}

/** Long labels get truncated: a guide needs a line, not a product-card paragraph. */
const MAX_LABEL = 60

function labelOf(step: ScribeStep): string {
  const raw = step.element?.fingerprint.label ?? ''
  const flat = raw.replace(/\s+/g, ' ').trim()
  return flat.length > MAX_LABEL ? `${flat.slice(0, MAX_LABEL - 1)}…` : flat
}

export function captionOf(step: ScribeStep, locale: Locale): string {
  const label = labelOf(step)
  const kind = step.target ?? 'other'
  const say = (key: MessageKey, params?: Record<string, string | number>) =>
    translate(locale, key, params)

  if (step.kind === 'navigate') {
    return say('scribe.caption.navigate', { title: step.title || step.url })
  }
  if (step.kind === 'key') {
    return say('scribe.caption.key', { key: label || 'Enter' })
  }
  if (step.kind === 'submit') return say('scribe.caption.submit')

  if (step.kind === 'input') {
    // We don't know what was typed and don't want to: field values are never stored.
    // The guide says "fill in"; what to fill in is the reader's business.
    return label
      ? say('scribe.caption.input', { label: quote(label) })
      : say('scribe.caption.blind.input')
  }

  return label ? say(NAMED[kind], { label: quote(label) }) : say(UNNAMED[kind])
}

/**
 * Captions for untouched steps only. Hand-edited ones stay as they are: rebuilding
 * the guide must not erase what someone already rewrote.
 */
export function withCaptions(steps: readonly ScribeStep[], locale: Locale): ScribeStep[] {
  return steps.map((step) =>
    step.captionEdited ? step : { ...step, caption: captionOf(step, locale) },
  )
}
