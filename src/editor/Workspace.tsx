import type Konva from 'konva'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { withControlPoint } from '@/core/doc/arrows'
import { frameRect } from '@/core/doc/canvas-presets'
import {
  applyCrop,
  CAPTURE_ID,
  captureFromTransform,
  clearCaptureImage,
  defaultCropRegion,
  hasCaptureImage,
  fitCaptureToCanvas,
  moveCapture,
  resetCrop,
  setCaptureImage,
} from '@/core/doc/capture-ops'
import { newImageId } from '@/core/doc/ids'
import {
  addLayer,
  createLayer,
  duplicateLayer,
  findLayer,
  layerBounds,
  // The local moveLayer moves a layer across the canvas; this one moves it in the stack.
  moveLayer as restackLayer,
  removeLayer,
  resizeLayer,
  shiftLayerBy,
  updateLayer,
} from '@/core/doc/layers'
import { computeSnap, type Guide } from '@/core/doc/snapping'
import type { ImageLayer, LayerId, Rect } from '@/core/doc/types'
import { putImage, type StoredDoc } from '@/core/storage/db'
import { useApp } from '@/core/ui/app-context'

import { type Command, CommandPalette } from './CommandPalette'
import { type Command as HotkeyCommand, hotkeyFor } from './hotkeys'
import { CaptureActions } from './panels/CaptureActions'
import { ObjectBar } from './panels/ObjectBar'
import { ToolOptions } from './panels/ToolOptions'
import { SidePanel } from './panels/SidePanel'
import { ToolRail } from './panels/ToolRail'
import { TopBar } from './panels/TopBar'
import type { TransformBox } from './layers/SelectionFrame'
import { Stage } from './Stage'
import { useAi } from './useAi'
import { useOcr } from './useOcr'
import { useDocument } from './useDocument'
import { useStoredImage } from './useStoredImage'
import { useExport } from './useExport'
import { useTracker } from './useTracker'
import { TOOLS } from './tools'
import { useTool } from './useTool'

/** Workspace of an open document. Separate from Editor so hooks are never conditional. */
export function Workspace({ stored }: { stored: StoredDoc }) {
  const { t, settings } = useApp()
  const controller = useDocument(stored)
  const { doc, commit, edit, undo, redo, canUndo, canRedo } = controller

  const stageRef = useRef<Konva.Stage | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  /** What to do with the picked file: replace the capture or add it as an image layer. */
  const fileMode = useRef<'replace' | 'add'>('replace')
  const [showSafeZones, setShowSafeZones] = useState(true)
  /** Selected layer, or the capture itself — it is a canvas object just like annotations. */
  const [selected, setSelected] = useState<string | null>(null)
  /** Snap guides for the current gesture; they live only while dragging. */
  const [guides, setGuides] = useState<Guide[]>([])

  // Canvas size changes re-fit the view: otherwise after picking a format the user
  // still looks at the old region and cannot see the result.
  const [fitToken, setFitToken] = useState(0)
  const requestFit = () => {
    setFitToken((current) => current + 1)
  }

  const frame = useStoredImage(doc.capture.imageId)
  const mockupImage = useStoredImage(doc.canvas.customMockup?.imageId ?? null)
  const background = useStoredImage(
    doc.canvas.background.kind === 'image' ? doc.canvas.background.imageId : null,
  )

  /** Dragging reports a delta: each layer kind has its own geometry. */
  const moveLayer = useCallback(
    (id: LayerId, delta: { x: number; y: number }) => {
      setGuides([])
      commit((current) => {
        const layer = findLayer(current, id)
        if (!layer) return current
        return updateLayer(current, id, shiftLayerBy(layer, delta))
      })
    },
    [commit],
  )

  const imageSize = useMemo(
    () => (frame ? { w: frame.naturalWidth, h: frame.naturalHeight } : null),
    [frame],
  )

  const shiftCapture = useCallback(
    (delta: { x: number; y: number }) => {
      setGuides([])
      commit((current) => moveCapture(current, delta))
    },
    [commit],
  )

  /** Transform gesture: for the capture it changes scale and offset, for a layer its rect. */
  const transform = useCallback(
    (id: string, box: TransformBox) => {
      commit((current) => {
        if (id === CAPTURE_ID) return captureFromTransform(current, box)

        const layer = findLayer(current, id)
        return layer ? updateLayer(current, id, resizeLayer(layer, box)) : current
      })
    },
    [commit],
  )

  /** Text layer being typed; while set, an input overlays the scene. */
  const [editing, setEditing] = useState<LayerId | null>(null)

  const tools = useTool(controller, (layer) => {
    setSelected(layer.id)
    // A fresh label opens for typing right away: otherwise the word "Text" is left on canvas.
    if (layer.kind === 'text') setEditing(layer.id)
  })

  const editingLayer = editing ? findLayer(doc, editing) : undefined
  const editingText = editingLayer?.kind === 'text' ? editingLayer : null

  /** End of typing: an empty label is useless — the layer goes away with its text. */
  const finishEditing = (text: string) => {
    const id = editing
    setEditing(null)
    if (!id) return

    commit((current) =>
      text.trim() === '' ? removeLayer(current, id) : updateLayer(current, id, { text }),
    )
  }
  const exporter = useExport(doc, stageRef)
  const ai = useAi(doc, stageRef)
  const ocr = useOcr(doc, frame, controller)

  // Settings live outside the document: AppProvider holds them and updates by subscription,
  // so AI enabled in another tab arrives here without a reload.
  const tracker = useTracker(doc, stageRef)
  const selectedLayer = selected && selected !== CAPTURE_ID ? findLayer(doc, selected) : undefined

  /**
   * Crop region. While set, crop mode is on: the region can be moved and resized,
   * but is applied via a separate button — cropping is irreversible for later edits,
   * so it should not happen as a side effect of releasing the mouse.
   */
  const [cropRect, setCropRect] = useState<Rect | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)

  /**
   * Snapping while dragging. The threshold is in screen pixels, converted to document
   * units by the current zoom: otherwise nothing would snap when zoomed out, and when
   * zoomed in objects would stick from half a screen away.
   */
  const dragSnap = useCallback(
    (id: string, delta: { x: number; y: number }) => {
      // The capture is a canvas object too, but lives outside layers: frameRect gives its bounds.
      const layer = id === CAPTURE_ID ? null : findLayer(doc, id)
      const bounds = id === CAPTURE_ID ? frameRect(doc) : layer ? layerBounds(layer) : null
      if (!bounds) return delta

      const zoom = stageRef.current?.scaleX() ?? 1
      const threshold = SNAP_SCREEN_PX / Math.max(0.01, zoom)

      const moving = { ...bounds, x: bounds.x + delta.x, y: bounds.y + delta.y }
      const others = doc.layers
        .filter((other) => other.id !== id)
        .map(layerBounds)
        .filter((rect): rect is Rect => rect !== null)

      const snap = computeSnap(moving, [CANVAS_RECT(doc), ...others], threshold)
      setGuides(snap.guides)
      return { x: delta.x + snap.dx, y: delta.y + snap.dy }
    },
    [doc],
  )

  /**
   * Bend an arrow with its handle. While the handle is dragged we use `edit`, so the
   * whole curve is one undo step instead of a trail of intermediate positions.
   */
  const bendArrow = (id: string, control: { x: number; y: number }, done: boolean) => {
    const apply = (current: typeof doc) => {
      const layer = findLayer(current, id)
      if (layer?.kind !== 'arrow') return current
      return updateLayer(current, id, { points: withControlPoint(layer, control) })
    }

    if (done) commit(apply)
    else edit(apply)
  }

  const startCrop = () => {
    setCropRect(defaultCropRegion(doc))
    setSelected(CAPTURE_ID)
  }

  /** Stores the file and returns its id with dimensions. */
  const storeImage = async (file: File) => {
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
    const size = { width: bitmap.width, height: bitmap.height }
    bitmap.close()

    return { imageId, ...size }
  }

  const loadImage = async (file: File) => {
    const image = await storeImage(file)
    commit((current) => setCaptureImage(current, image))
  }

  /** Second and later images become layers, scaled down and centered rather than stacked full-size. */
  const addImage = async (file: File) => {
    const image = await storeImage(file)

    commit((current) => {
      const room = Math.min(current.canvas.w, current.canvas.h) * 0.6
      const scale = Math.min(1, room / Math.max(image.width, image.height))
      const w = image.width * scale
      const h = image.height * scale

      const layer = createLayer('image', {
        rect: { x: (current.canvas.w - w) / 2, y: (current.canvas.h - h) / 2, w, h },
      }) as ImageLayer

      return addLayer(current, {
        ...layer,
        imageId: image.imageId,
        name: file.name === '' ? layer.name : file.name,
      })
    })
  }

  /**
   * Where an incoming image goes: it opens an empty document, and is added as a layer
   * to a non-empty one. The capture can be replaced from the layers panel — silently
   * overwriting the user's work just because they dropped a file would be rude.
   */
  const receiveImage = (file: File) => {
    if (hasCaptureImage(doc)) void addImage(file)
    else void loadImage(file)
  }

  /**
   * Image from the clipboard. The extension must work without page capture too:
   * copy anything, paste, edit (PLAN.md §4).
   */
  const pasteImage = async () => {
    if (!navigator.clipboard.read) return

    for (const item of await navigator.clipboard.read()) {
      const type = item.types.find((name) => name.startsWith('image/'))
      if (!type) continue

      const blob = await item.getType(type)
      receiveImage(new File([blob], 'clipboard', { type }))
      return
    }
  }

  const applyCropNow = () => {
    if (cropRect && imageSize) commit((current) => applyCrop(current, cropRect, imageSize))
    setCropRect(null)
  }

  /** Keyboard and palette invoke the same commands — no reason for them to diverge. */
  const runCommand = (command: HotkeyCommand) => {
    switch (command) {
      case 'palette':
        setPaletteOpen(true)
        return
      case 'undo':
        undo()
        return
      case 'redo':
        redo()
        return
      case 'copy':
        void exporter.copy()
        return
      case 'save':
        void exporter.save()
        return
      case 'paste':
        void pasteImage()
        return
      case 'duplicate':
        if (selected && selected !== CAPTURE_ID) {
          commit((current) => duplicateLayer(current, selected).doc)
        }
        return

      case 'raise':
      case 'lower':
        if (selected && selected !== CAPTURE_ID) {
          commit((current) => restackLayer(current, selected, command === 'raise' ? 'up' : 'down'))
        }
    }
  }

  /** Palette commands reuse what the buttons do instead of duplicating the logic. */
  const commands: Command[] = [
    ...TOOLS.map((spec) => ({
      id: `tool:${spec.tool}`,
      group: t('editor.palette.tools'),
      title: t(`editor.tool.${spec.tool}`),
      hint: spec.key.toUpperCase(),
      run: () => {
        if (spec.tool === 'crop') startCrop()
        else tools.setTool(spec.tool)
      },
    })),
    {
      id: 'doc:undo',
      group: t('editor.palette.document'),
      title: t('editor.undo'),
      hint: 'Ctrl+Z',
      run: () => {
        runCommand('undo')
      },
    },
    {
      id: 'doc:redo',
      group: t('editor.palette.document'),
      title: t('editor.redo'),
      hint: 'Ctrl+Y',
      run: () => {
        runCommand('redo')
      },
    },
    {
      id: 'doc:raise',
      group: t('editor.palette.document'),
      title: t('editor.layers.raise'),
      hint: 'Ctrl+]',
      run: () => {
        runCommand('raise')
      },
    },
    {
      id: 'doc:lower',
      group: t('editor.palette.document'),
      title: t('editor.layers.lower'),
      hint: 'Ctrl+[',
      run: () => {
        runCommand('lower')
      },
    },
    {
      id: 'doc:copy',
      group: t('editor.palette.document'),
      title: t('editor.export.copy'),
      hint: 'Ctrl+C',
      run: () => {
        runCommand('copy')
      },
    },
    {
      id: 'doc:save',
      group: t('editor.palette.document'),
      title: t('editor.export.save'),
      run: () => {
        runCommand('save')
      },
    },
    {
      id: 'doc:original',
      group: t('editor.palette.document'),
      title: t('editor.export.original'),
      run: exporter.saveOriginal,
    },
    {
      id: 'view:fit',
      group: t('editor.palette.view'),
      title: t('editor.capture.fit'),
      run: () => {
        commit(fitCaptureToCanvas)
      },
    },
    {
      id: 'view:safe',
      group: t('editor.palette.view'),
      title: t('editor.size.safeZones'),
      run: () => {
        setShowSafeZones((current) => !current)
      },
    },
    {
      id: 'doc:replace',
      group: t('editor.palette.document'),
      title: t('editor.capture.replace'),
      run: () => {
        fileMode.current = 'replace'
        fileRef.current?.click()
      },
    },
  ]

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const hotkey = hotkeyFor(event, {
        inField: target !== null && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName),
        cropping: cropRect !== null,
        hasSelection: selected !== null,
      })
      if (!hotkey) return

      event.preventDefault()

      switch (hotkey.kind) {
        case 'command':
          runCommand(hotkey.command)
          return

        case 'tool':
          if (hotkey.tool === 'crop') startCrop()
          else {
            setCropRect(null)
            tools.setTool(hotkey.tool)
          }
          return

        case 'nudge':
          if (selected === CAPTURE_ID) shiftCapture(hotkey.delta)
          else if (selected) moveLayer(selected, hotkey.delta)
          return

        case 'applyCrop':
          applyCropNow()
          return

        case 'delete':
          if (selected === CAPTURE_ID) commit(clearCaptureImage)
          else if (selected) commit((current) => removeLayer(current, selected))
          setSelected(null)
          return

        case 'escape':
          setCropRect(null)
          setSelected(null)
          tools.setTool('select')
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  })

  return (
    <div
      className="flex h-dvh flex-col"
      // A file dropped on the editor opens as an image — no page capture required
      // (PLAN.md §4). Without preventDefault the browser would just open the image.
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) event.preventDefault()
      }}
      onDrop={(event) => {
        const file = event.dataTransfer.files[0]
        if (!file?.type.startsWith('image/')) return
        event.preventDefault()
        receiveImage(file)
      }}
    >
      {paletteOpen ? (
        <CommandPalette
          commands={commands}
          onClose={() => {
            setPaletteOpen(false)
          }}
        />
      ) : null}

      <TopBar
        doc={doc}
        frameSize={frame ? { width: frame.naturalWidth, height: frame.naturalHeight } : null}
        canUndo={canUndo}
        canRedo={canRedo}
        copied={exporter.status === 'copied'}
        exporter={exporter}
        onUndo={undo}
        onRedo={redo}
        onCopy={exporter.copy}
      />

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          // The layers-panel button replaces the capture; the "add image" button adds one.
          if (file) void (fileMode.current === 'replace' ? loadImage(file) : addImage(file))
          event.target.value = ''
        }}
      />

      <div className="flex min-h-0 flex-1">
        <ToolRail
          tool={cropRect ? 'crop' : tools.tool}
          onPick={(tool) => {
            // Crop is a mode, not a gesture: it starts immediately, no drag needed.
            if (tool === 'crop') startCrop()
            else {
              setCropRect(null)
              tools.setTool(tool)
            }
          }}
        />

        <main className="work-surface relative min-w-0 flex-1 overflow-hidden">
          <Stage
            doc={doc}
            frame={frame}
            background={background}
            mockupImage={mockupImage}
            showSafeZones={showSafeZones}
            stageRef={stageRef}
            fitToken={fitToken}
            tools={tools}
            selected={selected}
            onSelect={setSelected}
            onMoveLayer={moveLayer}
            onMoveCapture={shiftCapture}
            onTransform={transform}
            cropRect={cropRect}
            onCropRect={setCropRect}
            editing={editingText}
            onEditLayer={(id) => {
              const layer = findLayer(doc, id)
              if (layer?.kind === 'text') setEditing(id)
            }}
            onEditDone={finishEditing}
            onArrowControl={bendArrow}
            domain={stored.domain}
            onDragSnap={dragSnap}
            guides={guides}
          />
          {cropRect || selected === CAPTURE_ID ? (
            <CaptureActions
              controller={controller}
              cropping={cropRect !== null}
              canReset={doc.capture.crop !== null}
              onCrop={startCrop}
              onApply={applyCropNow}
              onCancel={() => {
                setCropRect(null)
              }}
              onFit={() => {
                commit(fitCaptureToCanvas)
              }}
              onReset={() => {
                if (imageSize) commit((current) => resetCrop(current, imageSize))
              }}
            />
          ) : null}
          {selectedLayer || tools.tool === 'eraser' ? (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-3">
              {/* Tool options win over the object bar: the tool is what is active right now. */}
              {tools.tool === 'eraser' ? (
                <ToolOptions tools={tools} />
              ) : selectedLayer ? (
                <ObjectBar controller={controller} layer={selectedLayer} />
              ) : null}
            </div>
          ) : null}
        </main>

        <SidePanel
          controller={controller}
          exporter={exporter}
          selected={selected}
          onSelect={setSelected}
          showSafeZones={showSafeZones}
          onShowSafeZones={setShowSafeZones}
          onSizeChanged={requestFit}
          onCrop={startCrop}
          onReplaceImage={() => {
            fileMode.current = 'replace'
            fileRef.current?.click()
          }}
          onAddImage={() => {
            fileMode.current = 'add'
            fileRef.current?.click()
          }}
          onArranged={requestFit}
          ai={ai}
          aiEnabled={settings.aiEnabled}
          tracker={tracker}
          settings={settings}
          ocr={ocr}
          onAddedImage={(blob) => addImage(new File([blob], 'ai.png', { type: 'image/png' }))}
          frame={frame}
        />
      </div>
    </div>
  )
}

/** Snap threshold in screen pixels — same as guides in design tools. */
const SNAP_SCREEN_PX = 6

/** The canvas as a snap target: edges and center. */
const CANVAS_RECT = (doc: { canvas: { w: number; h: number } }): Rect => ({
  x: 0,
  y: 0,
  w: doc.canvas.w,
  h: doc.canvas.h,
})
