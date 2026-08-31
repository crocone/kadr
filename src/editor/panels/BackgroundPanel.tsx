import { useRef, useState } from 'react'

import {
  GRADIENT_PRESETS,
  gradientFromPreset,
  SOLID_PRESETS,
  switchBackgroundKind,
  wallpaperFromPreset,
} from '@/core/doc/backgrounds'
import type { Background, Doc, WallpaperPattern } from '@/core/doc/types'
import { newImageId } from '@/core/doc/ids'
import { dominantColors, gradientFromColors, samplePixels } from '@/core/render/palette'
import { WALLPAPER_PATTERNS } from '@/core/render/wallpaper'
import { putImage } from '@/core/storage/db'
import { useT } from '@/core/ui/app-context'
import { Button } from '@/core/ui/components'
import { Chip, ColorInput, Segmented, Slider } from '@/core/ui/controls'

import type { DocumentController } from '../useDocument'

const KINDS = ['gradient', 'wallpaper', 'solid', 'image', 'transparent'] as const

/** Pattern previews are pure CSS — no need for a canvas just for twelve buttons. */
function patternPreview(pattern: WallpaperPattern, from: string, to: string): string {
  switch (pattern) {
    case 'dots':
      return `radial-gradient(${to} 22%, transparent 24%) 0 0 / 12px 12px, linear-gradient(135deg, ${from}, ${from})`
    case 'grid':
      return `linear-gradient(${to} 1px, transparent 1px) 0 0 / 10px 10px, linear-gradient(90deg, ${to} 1px, transparent 1px) 0 0 / 10px 10px, linear-gradient(135deg, ${from}, ${from})`
    case 'stripes':
      return `repeating-linear-gradient(45deg, ${to} 0 4px, ${from} 4px 12px)`
    case 'rings':
      return `repeating-radial-gradient(circle at 50% 50%, ${to} 0 1px, ${from} 1px 8px)`
    default:
      return `radial-gradient(circle at 20% 20%, ${from}, transparent 60%), radial-gradient(circle at 80% 70%, ${to}, transparent 60%), linear-gradient(135deg, ${from}, ${to})`
  }
}

export function BackgroundPanel({
  controller,
  frame,
}: {
  controller: DocumentController
  /** Loaded capture frame — used to pick a matching background. */
  frame: HTMLImageElement | null
}) {
  const t = useT()
  const { doc, edit, commit } = controller
  const background = doc.canvas.background
  const fileRef = useRef<HTMLInputElement>(null)

  // Settings of previously used background kinds, so switching back loses nothing.
  const [remembered, setRemembered] = useState<Partial<Record<Background['kind'], Background>>>({})

  const setBackground = (next: Background, live = false) => {
    const recipe = (current: Doc): Doc => ({
      ...current,
      canvas: { ...current.canvas, background: next },
    })
    if (live) edit(recipe)
    else commit(recipe)
  }

  const changeKind = (kind: Background['kind']) => {
    setRemembered((current) => ({ ...current, [background.kind]: background }))
    if (kind === 'image') {
      fileRef.current?.click()
      return
    }
    setBackground(switchBackgroundKind(background, kind, remembered))
  }

  const pickFromFrame = () => {
    if (!frame) return
    const pixels = samplePixels(frame)
    const gradient = pixels ? gradientFromColors(dominantColors(pixels)) : null
    if (gradient) setBackground(gradient)
  }

  const uploadImage = async (file: File) => {
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
    setBackground({ kind: 'image', imageId, fit: 'cover' })
  }

  return (
    <div className="flex flex-col gap-2.5">
      {/* Five background kinds don't fit on one line — lay them out as a grid. */}
      <div className="grid grid-cols-3 gap-1">
        {KINDS.map((kind) => (
          <Chip
            key={kind}
            active={background.kind === kind}
            onClick={() => {
              changeKind(kind)
            }}
          >
            {t(`editor.background.${kind}`)}
          </Chip>
        ))}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void uploadImage(file)
          event.target.value = ''
        }}
      />

      {background.kind === 'gradient' ? (
        <>
          <div className="grid grid-cols-6 gap-1.5">
            {GRADIENT_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                title={preset.id}
                onClick={() => {
                  setBackground(gradientFromPreset(preset, background.angle))
                }}
                style={{
                  backgroundImage: `linear-gradient(135deg, ${preset.from}, ${preset.to})`,
                }}
                className="aspect-square rounded-md border border-border transition-transform hover:scale-105"
              />
            ))}
          </div>
          <ColorInput
            screenLabel={t('editor.color.screen')}
            label={t('editor.background.from')}
            value={background.from}
            onChange={(from) => {
              setBackground({ ...background, from }, true)
            }}
            onCommit={() => {
              commit()
            }}
          />
          <ColorInput
            screenLabel={t('editor.color.screen')}
            label={t('editor.background.to')}
            value={background.to}
            onChange={(to) => {
              setBackground({ ...background, to }, true)
            }}
            onCommit={() => {
              commit()
            }}
          />
          <Slider
            label={t('editor.background.angle')}
            value={background.angle}
            min={0}
            max={360}
            unit="°"
            onInput={(angle) => {
              setBackground({ ...background, angle }, true)
            }}
            onCommit={() => {
              commit()
            }}
          />
        </>
      ) : null}

      {background.kind === 'wallpaper' ? (
        <>
          <Segmented
            value={background.pattern}
            onChange={(pattern) => {
              setBackground({ ...background, pattern })
            }}
            options={WALLPAPER_PATTERNS.map((pattern) => ({
              value: pattern,
              label: t(`editor.background.pattern.${pattern}`),
            }))}
          />
          <div className="grid grid-cols-6 gap-1.5">
            {GRADIENT_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                title={preset.id}
                onClick={() => {
                  setBackground(wallpaperFromPreset(background.pattern, preset, background.angle))
                }}
                style={{ background: patternPreview(background.pattern, preset.from, preset.to) }}
                className="aspect-square rounded-md border border-border transition-transform hover:scale-105"
              />
            ))}
          </div>
          <ColorInput
            screenLabel={t('editor.color.screen')}
            label={t('editor.background.from')}
            value={background.from}
            onChange={(from) => {
              setBackground({ ...background, from }, true)
            }}
            onCommit={() => {
              commit()
            }}
          />
          <ColorInput
            screenLabel={t('editor.color.screen')}
            label={t('editor.background.to')}
            value={background.to}
            onChange={(to) => {
              setBackground({ ...background, to }, true)
            }}
            onCommit={() => {
              commit()
            }}
          />
          <Slider
            label={t('editor.background.angle')}
            value={background.angle}
            min={0}
            max={360}
            unit="°"
            onInput={(angle) => {
              setBackground({ ...background, angle }, true)
            }}
            onCommit={() => {
              commit()
            }}
          />
        </>
      ) : null}

      {background.kind === 'solid' ? (
        <>
          <div className="grid grid-cols-6 gap-1.5">
            {SOLID_PRESETS.map((color) => (
              <button
                key={color}
                type="button"
                title={color}
                onClick={() => {
                  setBackground({ kind: 'solid', color })
                }}
                style={{ backgroundColor: color }}
                className="aspect-square rounded-md border border-border transition-transform hover:scale-105"
              />
            ))}
          </div>
          <ColorInput
            screenLabel={t('editor.color.screen')}
            label={t('editor.background.colour')}
            value={background.color}
            onChange={(color) => {
              setBackground({ kind: 'solid', color }, true)
            }}
            onCommit={() => {
              commit()
            }}
          />
        </>
      ) : null}

      {background.kind === 'image' ? (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => {
              fileRef.current?.click()
            }}
          >
            {t('editor.background.replace')}
          </Button>
          <Segmented
            value={background.fit}
            onChange={(fit) => {
              setBackground({ ...background, fit })
            }}
            options={[
              { value: 'cover', label: t('editor.background.cover') },
              { value: 'contain', label: t('editor.background.contain') },
              { value: 'tile', label: t('editor.background.tile') },
            ]}
          />
        </div>
      ) : null}

      <Button
        size="sm"
        variant="secondary"
        disabled={!frame}
        onClick={pickFromFrame}
        title={t('editor.background.fromFrame.hint')}
      >
        {t('editor.background.fromFrame')}
      </Button>
    </div>
  )
}
