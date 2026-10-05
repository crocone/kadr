/**
 * The clip editor's right panel.
 *
 * Two kinds of control live here and they are deliberately kept apart. The top half
 * changes the clip — speed, pauses, camera — and every one of those is an offer with a
 * number attached: "cut 4 pauses, 12 s shorter", "zoom on 7 clicks". A button that
 * silently rewrites a recording is a button people stop trusting after the first
 * surprise, so each says what it will do before it does it.
 *
 * The bottom half is decoration, and it reuses the screenshot editor's vocabulary
 * exactly: the same gradients, the same shadow presets, the same padding slider. A clip
 * and a screenshot from the same tool should look like they came from the same tool.
 */
import { DEFAULT_GRADIENT_ANGLE, GRADIENT_PRESETS, SOLID_PRESETS } from '@/core/doc/backgrounds'
import { shadowFromPreset } from '@/core/doc/defaults'
import { newImageId } from '@/core/doc'
import type { Background, BrowserFrameStyle, ShadowPreset } from '@/core/doc/types'
import { putImage } from '@/core/storage/db'
import { keptDuration, MAX_SPEED, MIN_SPEED, normalizeSpans } from '@/core/record/edit'
import { formatDuration } from '@/core/record/format'
import { findPauses, pauseSavings } from '@/core/record/pauses'
import { addSilence, setMuted } from '@/core/record/sound'
import type { Rect } from '@/core/doc/types'
import type { Clip, ClipDecoration, ClipEdit } from '@/core/record/types'
import { autoZooms, DEFAULT_ZOOM_OPTIONS } from '@/core/record/zoom'
import { useT } from '@/core/ui/app-context'
import { cn } from '@/core/ui/cn'
import { Button, Toggle } from '@/core/ui/components'
import { ColorInput, PanelSection, Segmented, Slider } from '@/core/ui/controls'

const SPEEDS = [0.5, 1, 1.5, 2] as const
/** Length of a silence placed by button rather than by drag. */
const DEFAULT_SILENCE_MS = 2000
const FRAMES: readonly BrowserFrameStyle[] = ['none', 'macos', 'windows11']
const SHADOWS: readonly ShadowPreset[] = ['none', 'soft', 'hard', 'float']
const FITS: readonly ('cover' | 'contain' | 'tile')[] = ['cover', 'contain', 'tile']

/**
 * Whether a swatch is the one in force. Without this the row of colours gives no sign of
 * what is selected — you can see twelve options and not which of them you are looking at
 * on the canvas.
 */
function isPicked(background: Background, swatch: Background): boolean {
  if (background.kind !== swatch.kind) return false
  if (background.kind === 'solid' && swatch.kind === 'solid') {
    return background.color.toLowerCase() === swatch.color.toLowerCase()
  }
  if (background.kind === 'gradient' && swatch.kind === 'gradient') {
    return (
      background.from.toLowerCase() === swatch.from.toLowerCase() &&
      background.to.toLowerCase() === swatch.to.toLowerCase()
    )
  }
  return background.kind === 'transparent'
}

/** Ring on the chosen swatch; the rest keep a plain border. */
function swatchClass(picked: boolean): string {
  return cn(
    'h-6 w-6 rounded-md border transition-shadow',
    picked ? 'border-accent ring-2 ring-accent ring-offset-1 ring-offset-surface' : 'border-border',
  )
}

export function Controls({
  clip,
  playhead,
  cropping,
  onCrop,
  onEdit,
  onDecoration,
  onCommit,
}: {
  clip: Clip
  /** Source time under the playhead: "zoom here" needs a moment to attach to. */
  playhead: number
  cropping: boolean
  /** Opens the crop rectangle over the player, or closes it with `null`. */
  onCrop: (crop: Rect | null) => void
  onEdit: (edit: ClipEdit) => void
  onDecoration: (decoration: ClipDecoration) => void
  /** Closes the gesture: dragging a slider is one undo step, not one per pixel. */
  onCommit: () => void
}) {
  const t = useT()
  const { edit, decoration } = clip

  /**
   * A button press is a finished action, so it closes its own undo step. Sliders do not
   * go through here: they close on release, which is what makes a whole drag one step
   * instead of one per pixel.
   */
  const apply = (next: ClipEdit) => {
    onEdit(next)
    onCommit()
  }

  const applyDecoration = (next: ClipDecoration) => {
    onDecoration(next)
    onCommit()
  }

  const pauses = findPauses(clip.events, edit)
  const savings = pauseSavings(pauses)
  const hasClicks = clip.events.some((event) => event.kind === 'click')

  /**
   * A hand-placed zoom, centred wherever the camera is already looking. Without a click
   * to aim at there is nothing better to guess — and the user is about to drag it
   * anyway.
   */
  const addZoom = () => {
    const hold = {
      start: playhead,
      end: Math.min(edit.trim.end, playhead + DEFAULT_ZOOM_OPTIONS.hold),
    }
    apply({
      ...edit,
      zooms: [
        ...edit.zooms,
        {
          id: `zoom_manual_${Math.round(playhead)}`,
          hold,
          rampIn: DEFAULT_ZOOM_OPTIONS.rampIn,
          rampOut: DEFAULT_ZOOM_OPTIONS.rampOut,
          at: { x: 0.5, y: 0.5 },
          scale: 1.6,
          auto: false,
        },
      ],
    })
  }

  /**
   * An uploaded background is a stored image like any other: the bytes go into the image
   * store and the decoration keeps its id. That way it survives a reload, gets cleaned up
   * with the clip, and is the same thing the screenshot editor puts behind a shot.
   */
  const pickBackdrop = async (file: File) => {
    const bitmap = await createImageBitmap(file).catch(() => null)
    const imageId = newImageId()

    await putImage({
      id: imageId,
      blob: file,
      width: bitmap?.width ?? 0,
      height: bitmap?.height ?? 0,
      dpr: 1,
      createdAt: Date.now(),
      source: null,
    })
    bitmap?.close()

    applyDecoration({ ...decoration, background: { kind: 'image', imageId, fit: 'cover' } })
  }

  return (
    <aside className="flex w-[280px] shrink-0 flex-col gap-5 overflow-y-auto border-l border-border p-4">
      <PanelSection title={t('clip.speed')}>
        <Segmented
          label={t('clip.speed')}
          options={SPEEDS.map((speed) => ({ value: String(speed), label: `${speed}x` }))}
          value={String(edit.speed)}
          onChange={(value) => {
            apply({ ...edit, speed: Math.min(MAX_SPEED, Math.max(MIN_SPEED, Number(value))) })
          }}
        />
        <p className="text-[11px] text-text-muted">
          {t('clip.length', {
            time: formatDuration(keptDuration(edit) / edit.speed),
          })}
        </p>
      </PanelSection>

      <PanelSection title={t('clip.pauses')}>
        {pauses.length > 0 ? (
          <Button
            onClick={() => {
              apply({ ...edit, cuts: normalizeSpans([...edit.cuts, ...pauses], edit.trim) })
            }}
          >
            {t('clip.pauses.cut', { n: pauses.length, time: formatDuration(savings) })}
          </Button>
        ) : (
          <p className="text-[11px] text-text-muted">{t('clip.pauses.none')}</p>
        )}
        {edit.cuts.length > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              apply({ ...edit, cuts: [] })
            }}
          >
            {t('clip.cuts.clear', { n: edit.cuts.length })}
          </Button>
        ) : null}
      </PanelSection>

      <PanelSection title={t('clip.sound')}>
        {clip.audio ? (
          <>
            <Toggle
              label={t('clip.sound.keep')}
              checked={!edit.sound.muted}
              onChange={(keep) => {
                apply(setMuted(edit, !keep))
              }}
            />
            {!edit.sound.muted ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    // Two seconds from the playhead, or up to the end of the sound —
                    // a starting point to drag into shape, like a hand-placed zoom.
                    apply(
                      addSilence(edit, {
                        start: playhead,
                        end: Math.min(edit.sound.trim.end, playhead + DEFAULT_SILENCE_MS),
                      }),
                    )
                  }}
                >
                  {t('clip.silence.here')}
                </Button>
                {edit.sound.silences.length > 0 ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      apply({ ...edit, sound: { ...edit.sound, silences: [] } })
                    }}
                  >
                    {t('clip.silences.clear', { n: edit.sound.silences.length })}
                  </Button>
                ) : null}
              </div>
            ) : null}
            <p className="text-[11px] text-text-muted">{t('clip.sound.hint')}</p>
          </>
        ) : (
          <p className="text-[11px] text-text-muted">{t('clip.sound.none')}</p>
        )}
      </PanelSection>

      <PanelSection title={t('clip.camera')}>
        {hasClicks ? (
          <Button
            onClick={() => {
              // Hand-placed zooms survive a rebuild: the machine gets the clicks, the
              // person keeps whatever they decided themselves.
              const manual = edit.zooms.filter((zoom) => !zoom.auto)
              apply({ ...edit, zooms: [...manual, ...autoZooms(clip.events, edit)] })
            }}
          >
            {t('clip.zoom.auto')}
          </Button>
        ) : (
          <p className="text-[11px] text-text-muted">{t('clip.zoom.noClicks')}</p>
        )}
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={addZoom}>
            {t('clip.zoom.add')}
          </Button>
          {edit.zooms.length > 0 ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                apply({ ...edit, zooms: [] })
              }}
            >
              {t('clip.zoom.clear')}
            </Button>
          ) : null}
        </div>
      </PanelSection>

      <PanelSection title={t('clip.clicks.title')}>
        <Toggle
          label={t('clip.clicks')}
          checked={edit.clicks.show}
          onChange={(show) => {
            apply({ ...edit, clicks: { ...edit.clicks, show } })
          }}
        />
        {edit.clicks.show ? (
          <>
            <ColorInput
              label={t('clip.clicks.color')}
              value={edit.clicks.color}
              onChange={(color) => {
                apply({ ...edit, clicks: { ...edit.clicks, color } })
              }}
              onCommit={onCommit}
            />
            <Slider
              label={t('clip.clicks.size')}
              value={Math.round(edit.clicks.size * 1000)}
              min={20}
              max={160}
              onInput={(value) => {
                onEdit({ ...edit, clicks: { ...edit.clicks, size: value / 1000 } })
              }}
              onCommit={onCommit}
              format={(value) => `${Math.round((value / 60) * 10) / 10}x`}
            />
          </>
        ) : null}
        {clip.events.length === 0 ? (
          <p className="text-[11px] text-text-muted">{t('clip.noTimeline')}</p>
        ) : null}
      </PanelSection>

      <PanelSection title={t('clip.crop')}>
        <Button
          disabled={cropping}
          onClick={() => {
            // Reopening starts from the crop already in force, not from the whole
            // frame: adjusting a crop is far more common than replacing it.
            onCrop(edit.crop ?? { x: 0.1, y: 0.1, w: 0.8, h: 0.8 })
          }}
        >
          {t('clip.crop.start')}
        </Button>
        {edit.crop ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              onCrop(null)
              apply({ ...edit, crop: null })
            }}
          >
            {t('clip.crop.reset')}
          </Button>
        ) : null}
      </PanelSection>

      <PanelSection title={t('clip.frame')}>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            title={t('clip.background.none')}
            onClick={() => {
              applyDecoration({ ...decoration, background: { kind: 'transparent' } })
            }}
            className={cn(
              swatchClass(isPicked(decoration.background, { kind: 'transparent' })),
              'bg-surface-muted',
            )}
          />
          {SOLID_PRESETS.slice(0, 6).map((color) => (
            <button
              key={color}
              type="button"
              onClick={() => {
                applyDecoration({ ...decoration, background: { kind: 'solid', color } })
              }}
              style={{ background: color }}
              className={swatchClass(isPicked(decoration.background, { kind: 'solid', color }))}
            />
          ))}
          {GRADIENT_PRESETS.slice(0, 6).map((preset) => {
            const background = {
              kind: 'gradient' as const,
              from: preset.from,
              to: preset.to,
              angle: DEFAULT_GRADIENT_ANGLE,
            }
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => {
                  applyDecoration({ ...decoration, background })
                }}
                style={{ background: `linear-gradient(135deg, ${preset.from}, ${preset.to})` }}
                className={swatchClass(isPicked(decoration.background, background))}
              />
            )
          })}
        </div>

        {/*
          A colour of one's own. The presets cover the common cases; a brand colour is
          never among them, and matching one by eye out of twelve squares is not a thing
          anybody manages.
        */}
        <ColorInput
          label={t('clip.background.custom')}
          screenLabel={t('editor.color.screen')}
          value={decoration.background.kind === 'solid' ? decoration.background.color : '#0f172a'}
          onChange={(color) => {
            applyDecoration({ ...decoration, background: { kind: 'solid', color } })
          }}
          onCommit={onCommit}
        />

        <label className="flex cursor-pointer items-center justify-between gap-2 text-[11px] text-text-muted">
          <span>{t('clip.background.image')}</span>
          <input
            type="file"
            accept="image/*"
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) void pickBackdrop(file)
            }}
            className="w-[128px] text-[10px] file:mr-2 file:rounded-md file:border file:border-border file:bg-surface-muted file:px-2 file:py-1 file:text-[10px] file:text-text-soft"
          />
        </label>

        {decoration.background.kind === 'image' ? (
          <Segmented
            label={t('clip.background.fit')}
            options={FITS.map((fit) => ({ value: fit, label: t(`clip.background.fit.${fit}`) }))}
            value={decoration.background.fit}
            onChange={(fit) => {
              if (decoration.background.kind !== 'image') return
              applyDecoration({ ...decoration, background: { ...decoration.background, fit } })
            }}
          />
        ) : null}

        <Segmented
          label={t('editor.mockup')}
          options={FRAMES.map((style) => ({ value: style, label: t(`editor.browser.${style}`) }))}
          value={decoration.frame.style}
          onChange={(style) => {
            applyDecoration({ ...decoration, frame: { ...decoration.frame, style } })
          }}
        />
        {decoration.frame.style !== 'none' ? (
          <Segmented
            label={t('editor.mockup')}
            options={(['light', 'dark'] as const).map((theme) => ({
              value: theme,
              label: t(`editor.browser.${theme}`),
            }))}
            value={decoration.frame.theme}
            onChange={(theme) => {
              applyDecoration({ ...decoration, frame: { ...decoration.frame, theme } })
            }}
          />
        ) : null}

        <Slider
          label={t('clip.padding')}
          value={decoration.padding}
          min={0}
          max={160}
          unit="px"
          onInput={(padding) => {
            onDecoration({ ...decoration, padding })
          }}
          onCommit={onCommit}
        />
        <Slider
          label={t('clip.radius')}
          value={decoration.radius}
          min={0}
          max={48}
          unit="px"
          onInput={(radius) => {
            onDecoration({ ...decoration, radius })
          }}
          onCommit={onCommit}
        />
        <Segmented
          label={t('clip.shadow')}
          options={SHADOWS.map((preset) => ({
            value: preset,
            label: t(`editor.shadow.${preset}`),
          }))}
          value={decoration.shadow.preset}
          onChange={(preset) => {
            applyDecoration({ ...decoration, shadow: shadowFromPreset(preset) })
          }}
        />
      </PanelSection>
    </aside>
  )
}
