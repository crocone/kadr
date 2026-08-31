/**
 * OCR language picker.
 *
 * The list grew long, so it's a dropdown rather than a row of chips: sixteen buttons
 * in a row is a wall, not a choice. Language names are translated by the browser —
 * no per-locale dictionary of language names here.
 *
 * A separate checkbox adds English on top: in a Russian UI half the labels are Latin,
 * from "Email" to button names, and they read poorly without the second dictionary.
 */
import {
  joinLanguage,
  languageLabel,
  type OcrLanguage as Language,
  OCR_LANGUAGES,
  splitLanguage,
} from '@/core/ocr/engine'
import { useApp } from '@/core/ui/app-context'

export function OcrLanguagePicker({
  value,
  onChange,
}: {
  value: Language
  onChange: (value: Language) => void
}) {
  const { t, locale } = useApp()
  const { code, withEnglish } = splitLanguage(value)

  const options = OCR_LANGUAGES.map((option) => ({
    value: option,
    label: languageLabel(option, locale),
  })).sort((a, b) => a.label.localeCompare(b.label, locale))

  return (
    <span className="flex items-center gap-2">
      <select
        value={code}
        aria-label={t('editor.privacy.lang')}
        onChange={(event) => {
          onChange(joinLanguage(event.target.value as typeof code, withEnglish))
        }}
        className="h-7 rounded-md border border-border bg-surface-muted px-1.5 text-[11px] text-text"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      {code === 'eng' ? null : (
        <label className="flex items-center gap-1 text-[11px] text-text-muted">
          <input
            type="checkbox"
            checked={withEnglish}
            onChange={(event) => {
              onChange(joinLanguage(code, event.target.checked))
            }}
          />
          {t('editor.privacy.lang.plusEnglish')}
        </label>
      )}
    </span>
  )
}
