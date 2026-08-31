import type { ReactNode } from 'react'

import type { MessageKey } from '@/core/i18n'
import { sizeParts } from '@/core/render/estimate'
import { EXPORT_FORMATS } from '@/core/render/export'
import { isShareTargetReady, SHARE_TARGETS, type ShareTarget } from '@/core/share/targets'
import { useT } from '@/core/ui/app-context'
import { cn } from '@/core/ui/cn'
import { Button, Toggle } from '@/core/ui/components'
import { Segmented, Slider } from '@/core/ui/controls'
import { IconCopy } from '@/core/ui/icons'

import { DENSITIES, type ExportController } from '../useExport'

/**
 * Export panel: what file comes out, how heavy it is, and where it goes.
 *
 * The header answers the one question people open this for — the file's dimensions
 * and weight. The weight is approximate: the exact size is only known after a
 * render, and re-rendering in the background on every toggle isn't affordable.
 *
 * Density is a segmented control, not a slider: people deliberately pick ×1/×2/×3,
 * while a 0.25-step slider also offered choices like 1.75.
 */
export function ExportPanel({ controller }: { controller: ExportController }) {
  const t = useT()
  const { format, quality, density, maxDensity, output, status, stripMeta, sharedLink } = controller
  const lossy = format === 'jpeg' || format === 'webp' || format === 'pdf'
  const working = status === 'working'
  const size = sizeParts(output.bytes)

  return (
    <div className="flex w-[320px] flex-col">
      <header className="flex flex-col gap-0.5 border-b border-border px-4 py-3.5">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{t('editor.export')}</h2>
        <p className="font-mono text-[11px] text-text-muted tabular-nums">
          {output.width} × {output.height} · ≈ {size.value}&nbsp;
          {t(`units.${size.unit}` as MessageKey)}
        </p>
      </header>

      <div className="flex flex-col gap-3.5 border-b border-border px-4 py-3.5">
        <Row label={t('editor.export.format')}>
          <Segmented
            size="lg"
            tone="accent"
            label={t('editor.export.format')}
            value={format}
            onChange={controller.setFormat}
            options={EXPORT_FORMATS.map((value) => ({ value, label: value.toUpperCase() }))}
          />
        </Row>

        {lossy ? (
          <Slider
            label={t('editor.export.quality')}
            value={quality}
            min={0.4}
            max={1}
            step={0.01}
            format={(value) => `${Math.round(value * 100)}%`}
            onInput={controller.setQuality}
            onCommit={() => undefined}
          />
        ) : null}

        {format === 'pdf' ? (
          <p className="text-[10px] leading-relaxed text-text-muted">
            {t('editor.export.pdfNote')}
          </p>
        ) : null}

        <Row label={t('editor.export.density')}>
          <Segmented
            size="lg"
            label={t('editor.export.density')}
            value={String(density)}
            onChange={(value) => {
              controller.setDensity(Number(value) as (typeof DENSITIES)[number])
            }}
            options={DENSITIES.map((value) => ({
              value: String(value),
              label: `×${value}`,
              // Densities beyond what Chrome's canvas can handle stay visible but
              // disabled: silently delivering ×1 instead of ×3 is worse than showing the limit.
              disabled: value > maxDensity,
              title: value > maxDensity ? t('editor.export.density.limit') : `×${value}`,
            }))}
          />
        </Row>

        <Toggle
          checked={stripMeta}
          onChange={controller.setStripMeta}
          label={t('editor.export.stripMeta')}
        />
        {stripMeta ? (
          <p className="text-[10px] leading-relaxed text-text-muted">
            {t('editor.export.stripMeta.hint')}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2 border-b border-border px-4 py-3.5">
        <span className="text-[11px] text-text-muted">{t('editor.export.send')}</span>
        <div className="grid grid-cols-2 gap-2">
          {SHARE_TARGETS.map((target) => (
            <TargetTile
              key={target}
              target={target}
              checked={controller.targets.includes(target)}
              onToggle={() => {
                controller.toggleTarget(target)
              }}
            />
          ))}
        </div>
        <p className="text-[10px] leading-relaxed text-text-muted">
          {t('editor.export.target.link.hint')}
        </p>
      </div>

      <div className="flex flex-col gap-2 px-4 py-3.5">
        <div className="flex gap-2">
          <Button
            variant="primary"
            className="h-10 flex-1 text-[13px]"
            disabled={working}
            onClick={controller.save}
          >
            {working ? t('editor.export.working') : t('editor.export.save')}
          </Button>
          <Button
            className="h-10 w-10 shrink-0 px-0"
            disabled={working}
            title={t('editor.export.copy')}
            aria-label={t('editor.export.copy')}
            onClick={controller.copy}
          >
            <IconCopy size={16} />
          </Button>
        </div>

        <Button size="sm" variant="ghost" onClick={controller.saveOriginal}>
          {t('editor.export.original')}
        </Button>

        {status === 'copied' ? (
          <p className="text-[11px] text-success">{t('editor.export.copied')}</p>
        ) : null}
        {sharedLink ? (
          <p className="text-[11px] text-success">{t('editor.export.linked')}</p>
        ) : null}
        {status === 'failed' || status === 'too-big' ? (
          <p role="alert" className="text-[11px] text-danger">
            {t(status === 'too-big' ? 'editor.export.tooBig' : 'editor.export.failed')}
          </p>
        ) : null}
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] text-text-muted">{label}</span>
      {children}
    </div>
  )
}

/**
 * One share target. Unavailable ones are shown but disabled: the layout has four,
 * and hiding three until tokens are configured would reshuffle the grid every time.
 */
function TargetTile({
  target,
  checked,
  onToggle,
}: {
  target: ShareTarget
  checked: boolean
  onToggle: () => void
}) {
  const t = useT()
  const ready = isShareTargetReady(target)

  return (
    <label
      title={ready ? undefined : t('editor.export.target.soon')}
      className={cn(
        'flex items-center gap-2.5 rounded-control border px-3 py-2.5 text-[12.5px] transition-colors',
        ready
          ? 'cursor-pointer border-border text-text-soft hover:border-border-strong hover:text-text'
          : 'cursor-not-allowed border-border text-text-muted opacity-45',
        checked && 'border-accent text-text',
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={!ready}
        onChange={onToggle}
        className="h-4 w-4 accent-accent disabled:cursor-not-allowed"
      />
      {t(`editor.export.target.${target}` as MessageKey)}
    </label>
  )
}
