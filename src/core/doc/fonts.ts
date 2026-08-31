/**
 * Fonts for text layers.
 *
 * System fonts only — each described as a stack with fallbacks for all three
 * platforms. No network involved: the extension loads nothing external
 * (PLAN.md §9), and Google Fonts weights would drag in both requests and
 * licences.
 *
 * Categories and search come from checklist §2: with this many fonts, choosing
 * would otherwise mean scrolling a long list.
 */
export type FontCategory = 'sans' | 'serif' | 'mono' | 'display' | 'hand'

export type FontFace = {
  id: string
  label: string
  /** Ready-to-use `font-family` string. */
  stack: string
  category: FontCategory
}

export const FONT_CATEGORIES: readonly FontCategory[] = ['sans', 'serif', 'mono', 'display', 'hand']

export const FONTS: readonly FontFace[] = [
  { id: 'system', label: 'System', stack: 'system-ui, sans-serif', category: 'sans' },
  { id: 'inter', label: 'Inter', stack: 'Inter, system-ui, sans-serif', category: 'sans' },
  {
    id: 'helvetica',
    label: 'Helvetica',
    stack: 'Helvetica Neue, Helvetica, Arial, sans-serif',
    category: 'sans',
  },
  { id: 'arial', label: 'Arial', stack: 'Arial, Helvetica, sans-serif', category: 'sans' },
  { id: 'segoe', label: 'Segoe UI', stack: 'Segoe UI, system-ui, sans-serif', category: 'sans' },
  { id: 'roboto', label: 'Roboto', stack: 'Roboto, system-ui, sans-serif', category: 'sans' },
  { id: 'verdana', label: 'Verdana', stack: 'Verdana, Geneva, sans-serif', category: 'sans' },
  { id: 'tahoma', label: 'Tahoma', stack: 'Tahoma, Verdana, sans-serif', category: 'sans' },

  { id: 'georgia', label: 'Georgia', stack: 'Georgia, Times New Roman, serif', category: 'serif' },
  {
    id: 'times',
    label: 'Times New Roman',
    stack: 'Times New Roman, Times, serif',
    category: 'serif',
  },
  { id: 'cambria', label: 'Cambria', stack: 'Cambria, Georgia, serif', category: 'serif' },
  {
    id: 'palatino',
    label: 'Palatino',
    stack: 'Palatino Linotype, Palatino, serif',
    category: 'serif',
  },

  {
    id: 'mono',
    label: 'System Mono',
    stack: 'ui-monospace, SFMono-Regular, monospace',
    category: 'mono',
  },
  {
    id: 'jetbrains',
    label: 'JetBrains Mono',
    stack: 'JetBrains Mono, ui-monospace, monospace',
    category: 'mono',
  },
  { id: 'consolas', label: 'Consolas', stack: 'Consolas, Menlo, monospace', category: 'mono' },
  {
    id: 'courier',
    label: 'Courier New',
    stack: 'Courier New, Courier, monospace',
    category: 'mono',
  },

  {
    id: 'impact',
    label: 'Impact',
    stack: 'Impact, Haettenschweiler, sans-serif',
    category: 'display',
  },
  {
    id: 'trebuchet',
    label: 'Trebuchet MS',
    stack: 'Trebuchet MS, Tahoma, sans-serif',
    category: 'display',
  },
  {
    id: 'franklin',
    label: 'Franklin Gothic',
    stack: 'Franklin Gothic Medium, Arial Narrow, sans-serif',
    category: 'display',
  },

  {
    id: 'comic',
    label: 'Comic Sans MS',
    stack: 'Comic Sans MS, Comic Sans, cursive',
    category: 'hand',
  },
  {
    id: 'segoe-script',
    label: 'Segoe Script',
    stack: 'Segoe Script, Bradley Hand, cursive',
    category: 'hand',
  },
  {
    id: 'brush',
    label: 'Brush Script',
    stack: 'Brush Script MT, Segoe Script, cursive',
    category: 'hand',
  },
]

export const DEFAULT_FONT: FontFace = FONTS[1]!

/** Lookup by stack: a layer stores the stack, not the id. */
export function fontByStack(stack: string): FontFace | undefined {
  return FONTS.find((font) => font.stack === stack)
}

/**
 * Search by name. Category `null` means "all": there's no separate "all" entry —
 * a cleared selection plays that role.
 */
export function searchFonts(query: string, category: FontCategory | null = null): FontFace[] {
  const needle = query.trim().toLowerCase()

  return FONTS.filter((font) => {
    if (category && font.category !== category) return false
    if (!needle) return true
    return font.label.toLowerCase().includes(needle)
  })
}
