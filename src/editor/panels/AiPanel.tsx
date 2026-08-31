import { useEffect, useState } from 'react'

import {
  displayName,
  isRunnable,
  newPrompt,
  PROMPT_EXAMPLES,
  readPrompts,
  remove,
  upsert,
  type UserPrompt,
  writePrompts,
} from '@/core/ai/prompts'
import { addLayer, createLayer } from '@/core/doc/layers'
import type { TextLayer } from '@/core/doc/types'
import { useT } from '@/core/ui/app-context'
import { cn } from '@/core/ui/cn'
import { Button } from '@/core/ui/components'
import { IconClose } from '@/core/ui/icons'

import type { AiController } from '../useAi'
import type { DocumentController } from '../useDocument'

/**
 * User-defined prompts, runnable against the current frame.
 *
 * No built-in prompts here by design: with their own API key users write their own,
 * and ours ship server-side with premium. The examples shown for an
 * empty list are templates, not features — clearly drafts, editable before running.
 */
export function AiPanel({
  controller,
  ai,
  enabled,
  onAddedImage,
}: {
  controller: DocumentController
  ai: AiController
  /** AI disabled in settings: the panel explains that instead of pretending to work. */
  enabled: boolean
  /** Where a model-produced image goes — storage and layer creation are the editor's job. */
  onAddedImage: (blob: Blob) => Promise<void>
}) {
  const t = useT()
  const [prompts, setPrompts] = useState<UserPrompt[]>([])
  const [editing, setEditing] = useState<UserPrompt | null>(null)

  useEffect(() => {
    void readPrompts().then(setPrompts)
  }, [])

  const save = (prompt: UserPrompt) => {
    const next = upsert(prompts, prompt)
    setPrompts(next)
    setEditing(null)
    void writePrompts(next)
  }

  const drop = (id: string) => {
    const next = remove(prompts, id)
    setPrompts(next)
    void writePrompts(next)
  }

  if (!enabled) {
    return <p className="text-[11px] leading-relaxed text-text-muted">{t('editor.ai.off')}</p>
  }

  if (editing) {
    return <PromptForm prompt={editing} onSave={save} onCancel={() => setEditing(null)} />
  }

  return (
    <>
      <ul className="flex flex-col gap-1">
        {prompts.map((prompt) => (
          <li key={prompt.id} className="flex items-center gap-1">
            <button
              type="button"
              disabled={ai.status === 'working' || !isRunnable(prompt)}
              onClick={() => {
                void ai.run(prompt.text, prompt.output)
              }}
              className="min-w-0 flex-1 truncate rounded-md border border-border bg-surface-muted px-2 py-1.5 text-left text-[12px] transition-colors hover:border-border-strong disabled:opacity-60"
            >
              {displayName(prompt)}
            </button>
            <button
              type="button"
              title={t('editor.ai.edit')}
              onClick={() => {
                setEditing(prompt)
              }}
              className="rounded p-1 text-[11px] text-text-muted hover:text-text"
            >
              ✎
            </button>
            <button
              type="button"
              title={t('editor.ai.delete')}
              onClick={() => {
                drop(prompt.id)
              }}
              className="rounded p-1 text-text-muted hover:text-text"
            >
              <IconClose size={12} />
            </button>
          </li>
        ))}
      </ul>

      {prompts.length === 0 ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-[11px] text-text-muted">{t('editor.ai.empty')}</p>
          {PROMPT_EXAMPLES.map((example) => (
            <button
              key={example.name}
              type="button"
              onClick={() => {
                setEditing(newPrompt(example))
              }}
              className="rounded-md border border-dashed border-border px-2 py-1.5 text-left text-[12px] text-text-muted transition-colors hover:border-border-strong hover:text-text"
            >
              {example.name}
            </button>
          ))}
        </div>
      ) : null}

      <Button
        size="sm"
        onClick={() => {
          setEditing(newPrompt())
        }}
      >
        {t('editor.ai.add')}
      </Button>

      <ImageEdit ai={ai} onAdded={onAddedImage} />

      <AiAnswer controller={controller} ai={ai} />
    </>
  )
}

/**
 * Edit the frame with a text prompt.
 *
 * The result lands as a separate layer on top of the original, not in place of it:
 * models make mistakes, and being able to compare and revert is worth one extra
 * layer.
 */
function ImageEdit({ ai, onAdded }: { ai: AiController; onAdded: (blob: Blob) => Promise<void> }) {
  const t = useT()
  const [prompt, setPrompt] = useState('')

  return (
    <div className="flex flex-col gap-1.5 border-t border-border pt-2">
      <span className="text-[11px] text-text-muted">{t('editor.ai.edit.title')}</span>
      <textarea
        value={prompt}
        rows={2}
        placeholder={t('editor.ai.edit.hint')}
        onChange={(event) => {
          setPrompt(event.target.value)
        }}
        className="resize-y rounded-md border border-border bg-surface-muted px-2 py-1.5 text-[12px] leading-relaxed text-text"
      />
      <Button
        size="sm"
        disabled={ai.status === 'working' || prompt.trim() === ''}
        onClick={() => {
          void ai.edit(prompt).then(async (blob) => {
            if (blob) await onAdded(blob)
          })
        }}
      >
        {t('editor.ai.edit.run')}
      </Button>
      {/* The image layer uses the standard object bar (move/delete as usual),
          so there are no dedicated accept/cancel buttons. */}
      <p className="text-[10px] leading-relaxed text-text-muted">{t('editor.ai.edit.note')}</p>
    </div>
  )
}

/** Model answer: drop onto the canvas as text, copy, or dismiss. */
function AiAnswer({ controller, ai }: { controller: DocumentController; ai: AiController }) {
  const t = useT()

  if (ai.status === 'working') {
    return <p className="text-[11px] text-text-muted">{t('editor.ai.working')}</p>
  }

  if (ai.error) {
    // Show the provider's message next to the parsed cause: a bare error code isn't
    // actionable, and the provider text usually says what actually went wrong.
    const detail = ai.error.message === ai.error.code ? '' : ai.error.message

    return (
      <div className="flex flex-col gap-1 rounded-md bg-danger/10 px-2 py-1.5">
        <p className="text-[11px] text-danger">{t(`editor.ai.error.${ai.error.code}` as never)}</p>
        {detail ? (
          <p className="max-h-24 overflow-y-auto font-mono text-[10px] leading-relaxed break-all text-danger/80">
            {detail}
          </p>
        ) : null}
      </div>
    )
  }

  if (ai.status !== 'done' || ai.answer === '') return null

  return (
    <div className="flex flex-col gap-1.5 border-t border-border pt-2">
      <p className="max-h-40 overflow-y-auto text-[11.5px] leading-relaxed whitespace-pre-wrap text-text-soft">
        {ai.answer}
      </p>
      {ai.cached ? <p className="text-[10px] text-text-muted">{t('editor.ai.fromCache')}</p> : null}

      <span className="flex flex-wrap gap-1.5">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            controller.commit((current) => {
              const layer = createLayer('text', {
                at: { x: current.canvas.padding, y: current.canvas.padding },
              }) as TextLayer

              return addLayer(current, { ...layer, text: ai.answer, fontSize: 24 })
            })
          }}
        >
          {t('editor.ai.asText')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            void navigator.clipboard.writeText(ai.answer)
          }}
        >
          {t('editor.ai.copy')}
        </Button>
        <Button size="sm" variant="ghost" onClick={ai.clear}>
          {t('editor.ai.dismiss')}
        </Button>
      </span>
    </div>
  )
}

function PromptForm({
  prompt,
  onSave,
  onCancel,
}: {
  prompt: UserPrompt
  onSave: (prompt: UserPrompt) => void
  onCancel: () => void
}) {
  const t = useT()
  const [draft, setDraft] = useState(prompt)

  return (
    <div className="flex flex-col gap-2">
      <input
        value={draft.name}
        placeholder={t('editor.ai.name')}
        onChange={(event) => {
          setDraft({ ...draft, name: event.target.value })
        }}
        className="h-7 rounded-md border border-border bg-surface-muted px-2 text-[12px] text-text"
      />
      <textarea
        value={draft.text}
        rows={5}
        placeholder={t('editor.ai.text')}
        onChange={(event) => {
          setDraft({ ...draft, text: event.target.value })
        }}
        className="resize-y rounded-md border border-border bg-surface-muted px-2 py-1.5 text-[12px] leading-relaxed text-text"
      />

      <span className="flex items-center gap-1">
        {(['text', 'json'] as const).map((output) => (
          <button
            key={output}
            type="button"
            onClick={() => {
              setDraft({ ...draft, output })
            }}
            className={cn(
              'h-7 rounded-md border px-2 text-[11px] transition-colors',
              draft.output === output
                ? 'border-accent bg-accent/15 text-text'
                : 'border-border text-text-muted hover:border-border-strong',
            )}
          >
            {t(`editor.ai.output.${output}`)}
          </button>
        ))}
      </span>

      <span className="flex gap-1.5">
        <Button
          size="sm"
          disabled={!isRunnable(draft)}
          onClick={() => {
            onSave(draft)
          }}
        >
          {t('common.save')}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
      </span>
    </div>
  )
}
