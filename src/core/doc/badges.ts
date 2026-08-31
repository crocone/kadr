/**
 * Numbered badge labels.
 *
 * The number isn't stored in the label: it's derived from badge order in the
 * document, so inserting a step in the middle renumbers the rest by itself.
 * This module only turns a number into a label of the chosen style.
 */
import type { BadgeStyle } from './types'

const ROMAN: readonly [number, string][] = [
  [1000, 'M'],
  [900, 'CM'],
  [500, 'D'],
  [400, 'CD'],
  [100, 'C'],
  [90, 'XC'],
  [50, 'L'],
  [40, 'XL'],
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
]

/**
 * Roman numerals. Zero and negatives simply don't exist in roman notation —
 * they return an empty string, not an invented sign.
 */
export function roman(value: number): string {
  let left = Math.floor(value)
  if (left < 1) return ''

  let out = ''
  for (const [weight, letters] of ROMAN) {
    while (left >= weight) {
      out += letters
      left -= weight
    }
  }

  return out
}

/** What the badge shows. A bullet needs no number: it's a dot, not an order. */
export function badgeLabel(number: number, style: BadgeStyle): string {
  switch (style) {
    case 'roman':
      return roman(number)
    case 'bullet':
      return '•'
    default:
      return String(number)
  }
}
