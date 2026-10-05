/**
 * The clip editor page.
 *
 * A screen recording needs a different room from a screenshot: what is edited is time,
 * not pixels, and the controls that matter are a timeline and a transport. So this is
 * its own page rather than a mode of the screenshot editor — but the decoration it
 * offers is the screenshot editor's, drawn by the same code, so the two produce
 * matching output.
 */
import { useCallback, useEffect, useState } from 'react'

import { outputDuration, toSource } from '@/core/record/edit'
import { formatDuration, formatSize } from '@/core/record/format'
import { deleteClipFile } from '@/core/record/opfs'
import type { Waveform } from '@/core/record/sound'
import type { Rect } from '@/core/doc/types'
import type { ClipDecoration, ClipEdit } from '@/core/record/types'
import { deleteClip, deleteImage } from '@/core/storage/db'
import { useT } from '@/core/ui/app-context'
import { Button } from '@/core/ui/components'
import { IconPause, IconPlay, IconRedo, IconTrash, IconUndo } from '@/core/ui/icons'

import { Controls } from './Controls'
import { CropOverlay } from './CropOverlay'
import { type ClipFormat, exportClip } from './export'
import { Player } from './Player'
import { loadWaveform } from './sound'
import { Timeline } from './Timeline'
import { clampZoom, ZOOM_STEP } from '@/core/render/view'
import { ZoomBar } from '@/core/ui/ZoomBar'

import { useBackdrop } from './useBackdrop'
import { clipIdFromUrl, useClip } from './useClip'

const FORMATS: readonly ClipFormat[] = ['webm', 'mp4', 'gif']

export function ClipEditor() {
  const t = useT()
  const [id] = useState(clipIdFromUrl)
  const { clip, file, url, loaded, missing, update, patch, commit, undo, redo, canUndo, canRedo } =
    useClip(id)
  const backdrop = useBackdrop(clip?.decoration.background ?? { kind: 'transparent' })

  const [playing, setPlaying] = useState(false)
  const [outputTime, setOutputTime] = useState(0)
  const [seekTo, setSeekTo] = useState<{ at: number } | null>(null)
  const [busy, setBusy] = useState<{ format: ClipFormat; done: number; total: number } | null>(null)
  const [waveform, setWaveform] = useState<Waveform | null>(null)

  /**
   * The sound is read once the file is in hand. It runs for a few seconds on a long
   * take, so the lane opens flat and fills in; nothing else waits for it.
   */
  const hasAudio = clip?.audio === true
  const duration = clip?.duration ?? 0
  useEffect(() => {
    if (!file || !hasAudio || duration <= 0) return
    const abort = new AbortController()
    void loadWaveform(file, duration, abort.signal)
      .then((peaks) => {
        if (!abort.signal.aborted) setWaveform(peaks)
      })
      .catch((error: unknown) => {
        console.warn('[kadr] clip: the sound could not be read for the lane', error)
      })
    return () => {
      abort.abort()
    }
  }, [file, hasAudio, duration])
  /** The rectangle being dragged, in frame fractions. `null` — not cropping right now. */
  const [cropping, setCropping] = useState<Rect | null>(null)
  /** Display scale; `null` means "fit the panel", which is where every clip starts. */
  const [zoom, setZoom] = useState<number | null>(null)
  const [shownZoom, setShownZoom] = useState(1)

  const onTime = useCallback((at: number) => {
    setOutputTime(at)
  }, [])

  const onEnded = useCallback(() => {
    setPlaying(false)
  }, [])

  /**
   * Space toggles playback and Ctrl+Z steps back, as in every player and every editor
   * anyone has used. Neither fires while a control has focus: a space there belongs to
   * the control, and so does an undo inside a text field.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target
      const inControl =
        target instanceof HTMLElement && target.closest('input, button, select, textarea')

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
        return
      }

      if (event.code !== 'Space' || inControl) return
      event.preventDefault()
      setPlaying((was) => !was)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [undo, redo])

  if (!loaded) {
    return <p className="p-8 text-sm text-text-muted">{t('common.loading')}</p>
  }

  if (!clip || missing || !url || !file) {
    return (
      <div className="p-8">
        <p className="text-sm text-text-soft">{t('clip.missing')}</p>
      </div>
    )
  }

  const seek = (at: number) => {
    setOutputTime(at)
    setSeekTo({ at })
  }

  const runExport = (format: ClipFormat) => {
    setBusy({ format, done: 0, total: 1 })
    setPlaying(false)

    void exportClip(format, clip, file, backdrop, (done, total) => {
      setBusy({ format, done, total })
    })
      .catch((error: unknown) => {
        console.error('[kadr] clip export failed', error)
      })
      .finally(() => {
        setBusy(null)
      })
  }

  /**
   * Deleting a clip is three deletes in two storages with no transaction across them,
   * so the order matters: the record goes last, because a record pointing at a file
   * that is already gone is a broken card, while a file nothing points at is only
   * wasted space that the library sweeps up later.
   */
  const remove = () => {
    void (async () => {
      await deleteClipFile(clip.file)
      if (clip.poster) await deleteImage(clip.poster)
      await deleteClip(clip.id)
      window.close()
    })()
  }

  const total = outputDuration(clip.edit)

  /**
   * While the crop rectangle is being dragged the player shows the untouched frame with
   * the camera off: a crop chosen against a moving, already-cropped picture would land
   * somewhere different every time.
   */
  const shown =
    cropping === null ? clip : { ...clip, edit: { ...clip.edit, crop: null, zooms: [] } }

  return (
    <div className="flex h-screen flex-col bg-surface text-text">
      <header className="flex items-center gap-3 border-b border-border px-4 py-2.5">
        <input
          value={clip.title}
          onChange={(event) => {
            patch({ title: event.target.value })
          }}
          // A typed title is one undo step, closed when the field is left rather than
          // per keystroke.
          onBlur={commit}
          className="min-w-0 flex-1 rounded-control bg-transparent px-1.5 py-1 text-sm font-medium outline-none focus:bg-surface-muted"
        />
        <span className="font-mono text-[11px] text-text-muted tabular-nums">
          {clip.width}×{clip.height} · {formatSize(clip.size)} · {t(`clip.source.${clip.source}`)}
        </span>

        <span className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            disabled={!canUndo}
            onClick={undo}
            title={t('editor.undo')}
          >
            <IconUndo size={14} />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!canRedo}
            onClick={redo}
            title={t('editor.redo')}
          >
            <IconRedo size={14} />
          </Button>
        </span>

        {FORMATS.map((format) => (
          <Button
            key={format}
            variant={format === 'mp4' ? 'primary' : 'secondary'}
            size="sm"
            disabled={busy !== null}
            title={t(`clip.export.${format}.hint`)}
            onClick={() => {
              runExport(format)
            }}
          >
            {format.toUpperCase()}
          </Button>
        ))}

        <Button variant="danger" size="sm" onClick={remove} title={t('clip.delete')}>
          <IconTrash size={14} />
        </Button>
      </header>

      {busy ? (
        <p className="border-b border-border bg-surface-muted px-4 py-1.5 text-[11px] text-text-soft">
          {t('clip.export.running', {
            format: busy.format.toUpperCase(),
            percent: Math.round((busy.done / Math.max(1, busy.total)) * 100),
          })}
        </p>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col gap-3 p-4">
          <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-xl bg-surface-muted p-3">
            <Player
              clip={shown}
              url={url}
              playing={playing && cropping === null}
              seekTo={seekTo}
              backdrop={backdrop}
              zoom={zoom}
              onZoom={setShownZoom}
              onZoomStep={(factor) => {
                setZoom((current) => clampZoom((current ?? shownZoom) * factor))
              }}
              onTime={onTime}
              onEnded={onEnded}
            >
              {cropping ? (
                <CropOverlay
                  crop={cropping}
                  onChange={setCropping}
                  onApply={() => {
                    // A rectangle that covers all but a sliver is not a crop, it is a
                    // rounding error — storing it would shave a few pixels off the frame
                    // and change its aspect for no reason anyone asked for.
                    const whole =
                      cropping.w > 0.99 &&
                      cropping.h > 0.99 &&
                      cropping.x < 0.01 &&
                      cropping.y < 0.01
                    update({ ...clip.edit, crop: whole ? null : cropping })
                    commit()
                    setCropping(null)
                  }}
                  onCancel={() => {
                    setCropping(null)
                  }}
                />
              ) : null}
            </Player>

            <ZoomBar
              zoom={shownZoom}
              labels={{
                zoomIn: t('editor.zoom.in'),
                zoomOut: t('editor.zoom.out'),
                fit: t('editor.zoom.fit'),
                actual: t('editor.zoom.actual'),
              }}
              onZoomIn={() => {
                setZoom(clampZoom(shownZoom * ZOOM_STEP))
              }}
              onZoomOut={() => {
                setZoom(clampZoom(shownZoom / ZOOM_STEP))
              }}
              onFit={() => {
                setZoom(null)
              }}
              onActualSize={() => {
                setZoom(1)
              }}
            />
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label={t(playing ? 'clip.pause' : 'clip.play')}
              onClick={() => {
                setPlaying((was) => !was)
              }}
              className="grid h-9 w-9 place-items-center rounded-full bg-accent text-accent-fg transition-opacity hover:opacity-90"
            >
              {playing ? <IconPause size={16} /> : <IconPlay size={16} />}
            </button>
            <span className="font-mono text-xs text-text-soft tabular-nums">
              {formatDuration(outputTime)} / {formatDuration(total)}
            </span>
          </div>

          <Timeline
            clip={clip}
            waveform={waveform}
            outputTime={outputTime}
            onSeek={seek}
            onEdit={update}
            onCommit={commit}
          />
        </div>

        <Controls
          clip={clip}
          playhead={toSource(clip.edit, outputTime)}
          cropping={cropping !== null}
          onCrop={(next) => {
            setCropping(next)
          }}
          onEdit={(edit: ClipEdit) => {
            update(edit)
          }}
          onDecoration={(decoration: ClipDecoration) => {
            patch({ decoration })
          }}
          onCommit={commit}
        />
      </div>
    </div>
  )
}
