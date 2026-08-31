import { useState } from 'react'

import { arrangeableItems } from '@/core/doc/arrange'
import type { Doc } from '@/core/doc/types'
import type { Settings } from '@/core/storage/settings'
import { type AppContextValue, useT } from '@/core/ui/app-context'
import { isNeutral } from '@/core/render/filters'
import { PanelGroup } from '@/core/ui/controls'

import type { DocumentController } from '../useDocument'
import type { ExportController } from '../useExport'
import { BackgroundPanel } from './BackgroundPanel'
import { FiltersPanel } from './FiltersPanel'
import { FramePanel } from './FramePanel'
import type { AiController } from '../useAi'
import type { OcrController } from '../useOcr'
import type { TrackerController } from '../useTracker'
import { AiPanel } from './AiPanel'
import { PrivacyPanel } from './PrivacyPanel'
import { FramesPanel } from './FramesPanel'
import { MockupPanel } from './MockupPanel'
import { LayersPanel } from './LayersPanel'
import { SelectedObject } from './SelectedObject'
import { SizePanel } from './SizePanel'
import { StylePanel } from './StylePanel'
import { TrackerPanel } from './TrackerPanel'

type GroupId =
  | 'layers'
  | 'style'
  | 'background'
  | 'frame'
  | 'mockup'
  | 'frames'
  | 'ai'
  | 'privacy'
  | 'tracker'
  | 'filters'
  | 'shadow'
  | 'size'

/**
 * Right panel: collapsible groups with a one-line summary when collapsed.
 *
 * The most-used groups (layers, frame) are open by default. The rest show their
 * state as a summary line and expand on click — otherwise the panel becomes an
 * endless column of sliders.
 */
export function SidePanel({
  controller,
  exporter,
  selected,
  onSelect,
  showSafeZones,
  onShowSafeZones,
  onSizeChanged,
  onCrop,
  onReplaceImage,
  onAddImage,
  onArranged,
  ai,
  aiEnabled,
  ocr,
  tracker,
  settings,
  onAddedImage,
  frame,
}: {
  controller: DocumentController
  exporter: ExportController
  selected: string | null
  onSelect: (id: string | null) => void
  showSafeZones: boolean
  onShowSafeZones: (show: boolean) => void
  onSizeChanged: () => void
  onCrop: () => void
  onReplaceImage: () => void
  /** Add another frame to the document, as an image from a file. */
  onAddImage: () => void
  /** Arranging changes the canvas size, so the view is recomputed. */
  onArranged: () => void
  ai: AiController
  /** AI enabled in settings; otherwise the panel only explains where to turn it on. */
  aiEnabled: boolean
  /** Local private-data detection: needs no network or API key. */
  ocr: OcrController
  /** Sends the shot to an issue tracker: tokens and URLs live in settings. */
  tracker: TrackerController
  settings: Settings
  /** Model-produced image: stored and turned into a layer. */
  onAddedImage: (blob: Blob) => Promise<void>
  frame: HTMLImageElement | null
}) {
  const t = useT()
  const { doc } = controller
  const [open, setOpen] = useState<Record<GroupId, boolean>>({
    layers: true,
    style: false,
    background: false,
    frame: true,
    mockup: false,
    frames: false,
    ai: false,
    privacy: false,
    tracker: false,
    filters: false,
    shadow: false,
    size: false,
  })

  const toggle = (id: GroupId) => {
    setOpen((current) => ({ ...current, [id]: !current[id] }))
  }

  return (
    <aside className="flex w-[300px] shrink-0 flex-col overflow-y-auto border-l border-border bg-surface">
      <SelectedObject controller={controller} selected={selected} onSelect={onSelect} />

      <PanelGroup
        title={t('editor.layers')}
        summary={String(doc.layers.length + 1)}
        open={open.layers}
        onToggle={() => {
          toggle('layers')
        }}
      >
        <LayersPanel
          controller={controller}
          selected={selected}
          onSelect={onSelect}
          onReplaceImage={onReplaceImage}
        />
      </PanelGroup>

      <PanelGroup
        title={t('editor.style')}
        summary=""
        open={open.style}
        onToggle={() => {
          toggle('style')
        }}
      >
        <StylePanel controller={controller} onApplied={onSizeChanged} />
      </PanelGroup>

      <PanelGroup
        title={t('editor.background')}
        summary={backgroundSummary(doc, t)}
        open={open.background}
        onToggle={() => {
          toggle('background')
        }}
      >
        <BackgroundPanel controller={controller} frame={frame} />
      </PanelGroup>

      <PanelGroup
        title={t('editor.frame')}
        summary={`${doc.canvas.padding} px · ${doc.canvas.radius} px`}
        open={open.frame}
        onToggle={() => {
          toggle('frame')
        }}
      >
        <FramePanel controller={controller} section="frame" onCrop={onCrop} frame={frame} />
      </PanelGroup>

      <PanelGroup
        title={t('editor.frames')}
        summary={framesSummary(doc, t)}
        open={open.frames}
        onToggle={() => {
          toggle('frames')
        }}
      >
        <FramesPanel controller={controller} onAddImage={onAddImage} onArranged={onArranged} />
      </PanelGroup>

      <PanelGroup
        title={t('editor.mockup')}
        summary={mockupSummary(doc, t)}
        open={open.mockup}
        onToggle={() => {
          toggle('mockup')
        }}
      >
        <MockupPanel controller={controller} selected={selected} onFitted={onSizeChanged} />
      </PanelGroup>

      <PanelGroup
        title={t('editor.ai')}
        summary={aiEnabled ? '' : t('editor.ai.off')}
        open={open.ai}
        onToggle={() => {
          toggle('ai')
        }}
      >
        <AiPanel controller={controller} ai={ai} enabled={aiEnabled} onAddedImage={onAddedImage} />
      </PanelGroup>

      <PanelGroup
        title={t('editor.privacy')}
        summary={ocr.findings.length > 0 ? String(ocr.findings.length) : ''}
        open={open.privacy}
        onToggle={() => {
          toggle('privacy')
        }}
      >
        <PrivacyPanel ocr={ocr} ready={frame !== null} />
      </PanelGroup>

      <PanelGroup
        title={t('tracker.title')}
        summary=""
        open={open.tracker}
        onToggle={() => {
          toggle('tracker')
        }}
      >
        <TrackerPanel tracker={tracker} settings={settings} defaultTitle={doc.title} />
      </PanelGroup>

      <PanelGroup
        title={t('editor.filters')}
        summary={filtersSummary(doc, t)}
        open={open.filters}
        onToggle={() => {
          toggle('filters')
        }}
      >
        <FiltersPanel controller={controller} />
      </PanelGroup>

      <PanelGroup
        title={t('editor.shadow')}
        summary={`${t(`editor.shadow.${doc.canvas.shadow.preset}`)} · ${doc.canvas.shadow.blur} px`}
        open={open.shadow}
        onToggle={() => {
          toggle('shadow')
        }}
      >
        <FramePanel controller={controller} section="shadow" onCrop={onCrop} frame={frame} />
      </PanelGroup>

      <PanelGroup
        title={t('editor.size')}
        summary={`${doc.canvas.w} × ${doc.canvas.h} · ${exporter.format.toUpperCase()}`}
        open={open.size}
        onToggle={() => {
          toggle('size')
        }}
      >
        <SizePanel
          controller={controller}
          showSafeZones={showSafeZones}
          onShowSafeZones={onShowSafeZones}
          onSizeChanged={onSizeChanged}
        />
      </PanelGroup>
    </aside>
  )
}

function filtersSummary(doc: Doc, t: (key: never) => string): string {
  const { brightness, contrast, saturation, hue } = doc.capture.filters
  if (isNeutral(doc.capture.filters)) return t('editor.filters.none' as never)
  return [brightness, contrast, saturation, hue]
    .map((value) => (value > 0 ? `+${value}` : String(value)))
    .join(' ')
}

function backgroundSummary(doc: Doc, t: (key: never) => string): string {
  const kind = doc.canvas.background.kind
  const key = `editor.background.${kind}` as never
  return t(key)
}

/** Group summary: what dresses the frame — a device, a browser frame, or nothing. */
function mockupSummary(doc: Doc, t: (key: never) => string): string {
  const { mockup, frame } = doc.canvas
  if (mockup !== 'none') return t(`editor.device.${mockup}` as never)

  return t(`editor.browser.${frame.style}` as never)
}

/** How many frames the document holds: arranging makes sense from two up. */
function framesSummary(doc: Doc, t: AppContextValue['t']): string {
  return t('editor.frames.count', { n: arrangeableItems(doc).length })
}
