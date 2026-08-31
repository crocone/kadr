import type { Doc } from '@/core/doc/types'
import { isNeutral, NEUTRAL } from '@/core/render/filters'
import { useT } from '@/core/ui/app-context'
import { Button } from '@/core/ui/components'
import { Slider } from '@/core/ui/controls'

import type { DocumentController } from '../useDocument'

/** Capture filters. Zero means "as shot", hence the symmetric ranges. */
export function FiltersPanel({ controller }: { controller: DocumentController }) {
  const t = useT()
  const { doc, edit, commit } = controller
  const filters = doc.capture.filters

  const set = (patch: Partial<Doc['capture']['filters']>, live: boolean) => {
    const recipe = (current: Doc): Doc => ({
      ...current,
      capture: { ...current.capture, filters: { ...current.capture.filters, ...patch } },
    })
    if (live) edit(recipe)
    else commit(recipe)
  }

  const done = () => {
    commit()
  }

  return (
    <div className="flex flex-col gap-2.5">
      <Slider
        label={t('editor.filters.brightness')}
        value={filters.brightness}
        min={-100}
        max={100}
        onInput={(brightness) => {
          set({ brightness }, true)
        }}
        onCommit={done}
      />
      <Slider
        label={t('editor.filters.contrast')}
        value={filters.contrast}
        min={-100}
        max={100}
        onInput={(contrast) => {
          set({ contrast }, true)
        }}
        onCommit={done}
      />
      <Slider
        label={t('editor.filters.saturation')}
        value={filters.saturation}
        min={-100}
        max={100}
        onInput={(saturation) => {
          set({ saturation }, true)
        }}
        onCommit={done}
      />
      <Slider
        label={t('editor.filters.hue')}
        value={filters.hue}
        min={-180}
        max={180}
        unit="°"
        onInput={(hue) => {
          set({ hue }, true)
        }}
        onCommit={done}
      />

      <Button
        size="sm"
        variant="ghost"
        disabled={isNeutral(filters)}
        onClick={() => {
          set(NEUTRAL, false)
        }}
      >
        {t('editor.filters.reset')}
      </Button>
    </div>
  )
}
