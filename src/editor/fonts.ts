/**
 * Fonts for text layers, grouped by category.
 *
 * These are system families for now, not bundled files. The reason is simple: bundled
 * fonts in an open repository must be OFL-licensed and listed in LICENSES.md alongside
 * their files, while system fonts require nothing and are always there.
 * An OFL font set will be added with its licenses as a separate step.
 */
export type FontOption = { label: string; value: string }
export type FontGroup = { category: string; fonts: FontOption[] }

const stack = (...families: string[]) => families.map((name) => `'${name}'`).join(', ')

export const FONT_FAMILIES: readonly FontGroup[] = [
  {
    category: 'Sans',
    fonts: [
      { label: 'System', value: `system-ui, ${stack('Segoe UI', 'Helvetica Neue')}, sans-serif` },
      { label: 'Inter', value: `${stack('Inter')}, system-ui, sans-serif` },
      { label: 'Arial', value: `${stack('Arial', 'Helvetica')}, sans-serif` },
      { label: 'Verdana', value: `${stack('Verdana', 'Geneva')}, sans-serif` },
      { label: 'Tahoma', value: `${stack('Tahoma')}, sans-serif` },
      { label: 'Trebuchet', value: `${stack('Trebuchet MS')}, sans-serif` },
    ],
  },
  {
    category: 'Serif',
    fonts: [
      { label: 'Georgia', value: `${stack('Georgia')}, serif` },
      { label: 'Times', value: `${stack('Times New Roman', 'Times')}, serif` },
      { label: 'Palatino', value: `${stack('Palatino Linotype', 'Palatino')}, serif` },
    ],
  },
  {
    category: 'Mono',
    fonts: [
      { label: 'Consolas', value: `${stack('Consolas', 'SF Mono')}, ui-monospace, monospace` },
      { label: 'Courier', value: `${stack('Courier New', 'Courier')}, monospace` },
      { label: 'Menlo', value: `${stack('Menlo', 'DejaVu Sans Mono')}, monospace` },
    ],
  },
  {
    category: 'Display',
    fonts: [
      { label: 'Impact', value: `${stack('Impact', 'Haettenschweiler')}, sans-serif` },
      { label: 'Comic', value: `${stack('Comic Sans MS')}, cursive` },
    ],
  },
]

export const ALL_FONTS: readonly FontOption[] = FONT_FAMILIES.flatMap((group) => group.fonts)

/** Search by name: the set is small, but searching beats scrolling. */
export function searchFonts(query: string): FontOption[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return [...ALL_FONTS]
  return ALL_FONTS.filter((font) => font.label.toLowerCase().includes(needle))
}
