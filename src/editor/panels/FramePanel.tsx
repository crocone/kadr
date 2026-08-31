import { frameRect } from '@/core/doc/canvas-presets'
import { applyCrop } from '@/core/doc/capture-ops'
import { shadowFromPreset } from '@/core/doc/defaults'
import type { Doc, Shadow, ShadowPreset } from '@/core/doc/types'
import { contentBounds, sampleImage, worthTrimming } from '@/core/render/trim'
import { useT } from '@/core/ui/app-context'
import { Button } from '@/core/ui/components'
import { ColorInput, Segmented, Slider } from '@/core/ui/controls'

import type { DocumentController } from '../useDocument'

const SHADOW_PRESETS: readonly ShadowPreset[] = ['none', 'soft', 'hard', 'float', 'neon']

/** Padding and radius both alter the canvas, so they go through one helper. */
function withCanvas(doc: Doc, patch: Partial<Doc['canvas']>): Doc {
  return { ...doc, canvas: { ...doc.canvas, ...patch } }
}

function withCapture(doc: Doc, patch: Partial<Doc['capture']>): Doc {
  return { ...doc, capture: { ...doc.capture, ...patch } }
}

export function FramePanel({
  controller,
  section,
  onCrop,
  frame,
}: {
  controller: DocumentController
  /** The panel is split in two: frame and shadow live in separate right-column groups. */
  section: 'frame' | 'shadow'
  onCrop: () => void
  /** Loaded capture frame — its pixels drive the empty-margin trim. */
  frame: HTMLImageElement | null
}) {
  const t = useT()
  const { doc, edit, commit } = controller
  const { canvas, capture } = doc

  /**
   * Trim solid-colour margins. Bounds arrive as fractions of the frame while
   * `applyCrop` expects a rect in document coordinates — the conversion happens
   * here so the model never deals with fractions.
   */
  const trimMargins = () => {
    if (!frame) return

    const sample = sampleImage(frame)
    const bounds = sample ? contentBounds(sample) : null
    if (!bounds || !worthTrimming(bounds)) return

    commit((current) => {
      const rect = frameRect(current)
      const region = {
        x: rect.x + bounds.x * rect.w,
        y: rect.y + bounds.y * rect.h,
        w: bounds.w * rect.w,
        h: bounds.h * rect.h,
      }

      return applyCrop(current, region, {
        w: frame.naturalWidth,
        h: frame.naturalHeight,
      })
    })
  }

  /**
   * Padding grows the canvas outward while the frame keeps its size — otherwise
   * increasing padding would eat into the picture.
   */
  const setPadding = (padding: number, live: boolean) => {
    const recipe = (current: Doc): Doc => {
      const delta = padding - current.canvas.padding
      return withCanvas(current, {
        padding,
        w: current.canvas.w + delta * 2,
        h: current.canvas.h + delta * 2,
        preset: 'custom',
      })
    }
    if (live) edit(recipe)
    else commit(recipe)
  }

  const setShadow = (patch: Partial<Shadow>, live: boolean) => {
    const recipe = (current: Doc): Doc =>
      withCanvas(current, { shadow: { ...current.canvas.shadow, ...patch } })
    if (live) edit(recipe)
    else commit(recipe)
  }

  if (section === 'frame') {
    return (
      <>
        <Slider
          label={t('editor.frame.padding')}
          value={canvas.padding}
          min={0}
          max={320}
          unit=" px"
          onInput={(padding) => {
            setPadding(padding, true)
          }}
          onCommit={() => {
            commit()
          }}
        />
        <Slider
          label={t('editor.frame.radius')}
          value={canvas.radius}
          min={0}
          max={64}
          unit=" px"
          onInput={(radius) => {
            edit((current) => withCanvas(current, { radius }))
          }}
          onCommit={() => {
            commit()
          }}
        />
        <Slider
          label={t('editor.frame.scale')}
          value={capture.scale}
          min={0.2}
          max={2}
          step={0.01}
          format={(value) => `${Math.round(value * 100)}%`}
          onInput={(scale) => {
            edit((current) => withCapture(current, { scale }))
          }}
          onCommit={() => {
            commit()
          }}
        />
        <Slider
          label={t('editor.frame.rotation')}
          value={capture.rotation}
          min={-45}
          max={45}
          step={0.5}
          unit="°"
          onInput={(rotation) => {
            edit((current) => withCapture(current, { rotation }))
          }}
          onCommit={() => {
            commit()
          }}
        />
        <Button size="sm" onClick={onCrop}>
          {t('editor.capture.cropImage')}
        </Button>
        <Button size="sm" variant="secondary" disabled={!frame} onClick={trimMargins}>
          {t('editor.capture.trim')}
        </Button>
      </>
    )
  }

  return (
    <>
      <Segmented
        value={canvas.shadow.preset}
        onChange={(preset) => {
          commit((current) => withCanvas(current, { shadow: shadowFromPreset(preset) }))
        }}
        options={SHADOW_PRESETS.map((preset) => ({
          value: preset,
          label: t(`editor.shadow.${preset}`),
        }))}
      />
      <Slider
        label={t('editor.shadow.offsetX')}
        value={canvas.shadow.offsetX}
        min={-80}
        max={80}
        unit=" px"
        onInput={(offsetX) => {
          setShadow({ offsetX }, true)
        }}
        onCommit={() => {
          commit()
        }}
      />
      <Slider
        label={t('editor.shadow.offsetY')}
        value={canvas.shadow.offsetY}
        min={-80}
        max={120}
        unit=" px"
        onInput={(offsetY) => {
          setShadow({ offsetY }, true)
        }}
        onCommit={() => {
          commit()
        }}
      />
      <Slider
        label={t('editor.shadow.blur')}
        value={canvas.shadow.blur}
        min={0}
        max={160}
        unit=" px"
        onInput={(blur) => {
          setShadow({ blur }, true)
        }}
        onCommit={() => {
          commit()
        }}
      />
      <Slider
        label={t('editor.shadow.opacity')}
        value={canvas.shadow.opacity}
        min={0}
        max={1}
        step={0.01}
        format={(value) => `${Math.round(value * 100)}%`}
        onInput={(opacity) => {
          setShadow({ opacity }, true)
        }}
        onCommit={() => {
          commit()
        }}
      />
      <ColorInput
        screenLabel={t('editor.color.screen')}
        label={t('editor.shadow.colour')}
        value={canvas.shadow.color}
        onChange={(color) => {
          setShadow({ color }, true)
        }}
        onCommit={() => {
          commit()
        }}
      />
    </>
  )
}
