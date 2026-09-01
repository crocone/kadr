import { useRef } from 'react'

import { fitCaptureToCanvas } from '@/core/doc/capture-ops'
import { captureDecoration, TILT_LIMIT } from '@/core/doc/frames'
import { findLayer, updateLayer } from '@/core/doc/layers'
import type { BrowserFrameStyle, Decoration, DeviceMockup, Doc, ImageLayer } from '@/core/doc/types'
import { useT } from '@/core/ui/app-context'
import { newImageId } from '@/core/doc/ids'
import { putImage } from '@/core/storage/db'
import { Button } from '@/core/ui/components'
import { Chip, NumberField, Segmented, Slider } from '@/core/ui/controls'

import type { DocumentController } from '../useDocument'

const FRAMES: readonly BrowserFrameStyle[] = ['none', 'macos', 'windows11']

/** Screen-zone fields, as percentages of the mockup image. */
const ZONE_FIELDS = [
  { key: 'x' as const, label: 'editor.mockup.zoneX' as const },
  { key: 'y' as const, label: 'editor.mockup.zoneY' as const },
  { key: 'w' as const, label: 'editor.mockup.zoneW' as const },
  { key: 'h' as const, label: 'editor.mockup.zoneH' as const },
]

const DEVICE_LIST: readonly DeviceMockup[] = [
  'none',
  'iphone-16-pro',
  'pixel-9-pro',
  'ipad-pro-m4',
  'macbook-pro',
  'custom',
]

/**
 * Custom mockup image, stored alongside captures — no need for a separate store,
 * and it survives restarts together with the document.
 *
 * Kept outside the component: calling Date.now() inside would be a render-time
 * impurity, even when invoked from a handler.
 */
async function storeMockup(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const imageId = newImageId()

  await putImage({
    id: imageId,
    blob: file,
    width: bitmap.width,
    height: bitmap.height,
    dpr: 1,
    createdAt: Date.now(),
    source: null,
  })
  bitmap.close()

  return imageId
}

/** The selected layer, when it is an image layer. */
function selectedImage(doc: Doc, selected: string | null): ImageLayer | null {
  const layer = selected ? findLayer(doc, selected) : undefined
  return layer?.kind === 'image' ? layer : null
}

/** Initial zone for a custom mockup — users adjust it to their image anyway. */
const DEFAULT_ZONE = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }

/**
 * Browser frame, device body, and tilt.
 *
 * A device body and a browser chrome compete for the same space around the frame,
 * so picking one clears the other: showing both toggles enabled would be dishonest
 * when only one gets drawn.
 *
 * After changing decoration the capture is refitted: chrome and device body take up
 * space, and without a refit the frame would overflow the canvas.
 */
export function MockupPanel({
  controller,
  selected,
  onFitted,
}: {
  controller: DocumentController
  /**
   * Current selection. The frame is applied to the selected capture: a responsive
   * series has three, and "whichever comes first" is not the expected answer.
   */
  selected: string | null
  /** Refitting changes the scene view — it should return to the computed one. */
  onFitted: () => void
}) {
  const t = useT()
  const fileRef = useRef<HTMLInputElement>(null)
  const { doc, edit, commit } = controller

  const target = selectedImage(doc, selected)
  // A layer without its own decoration inherits the capture's: a series should look
  // like a series, not a set of mismatched frames.
  const current: Decoration = target?.decoration ?? captureDecoration(doc)
  const { frame, mockup } = current

  /** Patch decoration: the capture keeps it on the canvas, an image layer on itself. */
  const patchDecoration = (patch: Partial<Decoration>, live = false) => {
    const recipe = (doc: Doc): Doc => {
      if (target) {
        return updateLayer(doc, target.id, {
          decoration: { ...(target.decoration ?? captureDecoration(doc)), ...patch },
        })
      }
      return { ...doc, canvas: { ...doc.canvas, ...patch } }
    }

    if (live) edit(recipe)
    else commit(recipe)
  }

  /**
   * Changing the capture's decoration requires a refit — chrome and device body take
   * up space. An image layer leaves the canvas alone: it stays where it was placed.
   */
  const apply = (patch: Partial<Decoration>) => {
    if (target) {
      patchDecoration(patch)
      return
    }

    commit((doc) => fitCaptureToCanvas({ ...doc, canvas: { ...doc.canvas, ...patch } }))
    onFitted()
  }

  const setFrame = (patch: Partial<Doc['canvas']['frame']>, live = false) => {
    patchDecoration({ frame: { ...frame, ...patch } }, live)
  }

  const loadMockup = async (file: File) => {
    const imageId = await storeMockup(file)

    apply({
      mockup: 'custom',
      customMockup: { imageId, screen: current.customMockup?.screen ?? DEFAULT_ZONE },
    })
  }

  const setZone = (key: keyof typeof DEFAULT_ZONE, value: number) => {
    const custom = current.customMockup
    if (!custom) return

    patchDecoration(
      { customMockup: { ...custom, screen: { ...custom.screen, [key]: value } } },
      true,
    )
  }

  const setTilt = (patch: Partial<Doc['capture']['tilt']>, live: boolean) => {
    const recipe = (current: Doc): Doc => ({
      ...current,
      capture: { ...current.capture, tilt: { ...current.capture.tilt, ...patch } },
    })
    if (live) edit(recipe)
    else commit(recipe)
  }

  return (
    <>
      <Segmented
        value={frame.style}
        onChange={(style) => {
          apply({
            frame: { ...frame, style },
            ...(style === 'none' ? {} : { mockup: 'none' as const }),
          })
        }}
        options={FRAMES.map((style) => ({ value: style, label: t(`editor.browser.${style}`) }))}
      />

      {frame.style !== 'none' && mockup === 'none' ? (
        <>
          <Segmented
            value={frame.theme}
            onChange={(theme) => {
              setFrame({ theme })
            }}
            options={[
              { value: 'light' as const, label: t('editor.browser.light') },
              { value: 'dark' as const, label: t('editor.browser.dark') },
            ]}
          />

          <label className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-text-muted">{t('editor.browser.url')}</span>
            <input
              type="text"
              value={frame.url}
              spellCheck={false}
              placeholder={t('editor.browser.urlHint')}
              onChange={(event) => {
                setFrame({ url: event.target.value }, true)
              }}
              onBlur={() => {
                commit()
              }}
              className="h-7 w-[150px] rounded-md border border-border bg-surface-muted px-1.5 text-[11px] text-text"
            />
          </label>

          <label className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-text-muted">{t('editor.browser.showUrl')}</span>
            <input
              type="checkbox"
              checked={frame.showUrl}
              onChange={(event) => {
                setFrame({ showUrl: event.target.checked })
              }}
              className="h-4 w-4 accent-accent"
            />
          </label>
        </>
      ) : null}

      {mockup === 'custom' ? (
        <>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void loadMockup(file)
              event.target.value = ''
            }}
          />
          <Button
            size="sm"
            onClick={() => {
              fileRef.current?.click()
            }}
          >
            {t(current.customMockup ? 'editor.mockup.replace' : 'editor.mockup.load')}
          </Button>

          {current.customMockup ? (
            <>
              <p className="text-[11px] text-text-muted">{t('editor.mockup.zoneHint')}</p>
              {ZONE_FIELDS.map(({ key, label }) => (
                <NumberField
                  key={key}
                  label={t(label)}
                  value={Math.round(current.customMockup!.screen[key] * 100)}
                  min={0}
                  max={100}
                  onChange={(value) => {
                    setZone(key, value / 100)
                  }}
                  onCommit={() => {
                    commit()
                  }}
                />
              ))}
            </>
          ) : null}
        </>
      ) : null}

      <div className="flex flex-wrap gap-1.5">
        {DEVICE_LIST.map((device) => (
          <Chip
            key={device}
            active={mockup === device}
            onClick={() => {
              apply({
                mockup: device,
                ...(device === 'none' ? {} : { frame: { ...frame, style: 'none' as const } }),
              })
            }}
          >
            {t(`editor.device.${device}`)}
          </Chip>
        ))}
      </div>

      {mockup !== 'none' && mockup !== 'custom' ? (
        // The frame theme doubles as the body finish: pale metal or black.
        <Segmented
          value={frame.theme}
          onChange={(theme) => {
            setFrame({ theme })
          }}
          options={[
            { value: 'light' as const, label: t('editor.device.silver') },
            { value: 'dark' as const, label: t('editor.device.black') },
          ]}
        />
      ) : null}

      {target ? <p className="text-[11px] text-text-muted">{t('editor.mockup.forLayer')}</p> : null}

      <Slider
        label={t('editor.frame.tiltX')}
        value={doc.capture.tilt.x}
        min={-TILT_LIMIT}
        max={TILT_LIMIT}
        step={0.5}
        unit="°"
        onInput={(x) => {
          setTilt({ x }, true)
        }}
        onCommit={() => {
          commit()
        }}
      />
      <Slider
        label={t('editor.frame.tiltY')}
        value={doc.capture.tilt.y}
        min={-TILT_LIMIT}
        max={TILT_LIMIT}
        step={0.5}
        unit="°"
        onInput={(y) => {
          setTilt({ y }, true)
        }}
        onCommit={() => {
          commit()
        }}
      />
    </>
  )
}
