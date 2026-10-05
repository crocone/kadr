import { Button } from './components'

/**
 * Zoom bar over a canvas: mouse wheel for zooming, buttons for exact values.
 *
 * Shared by the screenshot editor and the clip editor — the same control over the same
 * problem, which is that neither a long page nor a 4K recording fits a panel at its own
 * size, and both need a way back to 100% to check a detail.
 */
export function ZoomBar({
  zoom,
  labels,
  onZoomIn,
  onZoomOut,
  onFit,
  onActualSize,
}: {
  zoom: number
  labels: { zoomIn: string; zoomOut: string; fit: string; actual: string }
  onZoomIn: () => void
  onZoomOut: () => void
  onFit: () => void
  onActualSize: () => void
}) {
  return (
    <div className="absolute bottom-4 left-4 flex items-center gap-1 rounded-panel border border-border bg-raised p-1 shadow-panel">
      <Button size="sm" variant="ghost" aria-label={labels.zoomOut} onClick={onZoomOut}>
        −
      </Button>
      <span className="w-16 text-center font-mono text-xs tabular-nums">
        {Math.round(zoom * 100)}%
      </span>
      <Button size="sm" variant="ghost" aria-label={labels.zoomIn} onClick={onZoomIn}>
        +
      </Button>
      <span className="mx-1 h-5 w-px bg-border" />
      <Button size="sm" variant="ghost" onClick={onFit}>
        {labels.fit}
      </Button>
      <Button size="sm" variant="ghost" onClick={onActualSize}>
        {labels.actual}
      </Button>
    </div>
  )
}
