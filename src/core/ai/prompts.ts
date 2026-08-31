/**
 * Library of user-authored prompts.
 *
 * On their own key the user writes requests themselves: name, text, output kind.
 * Ready-made prompts are part of premium and live on the server, not in the
 * open-source extension code.
 *
 * Prompts live in `chrome.storage.local`: they are a setting, not a document,
 * and have no reason to travel to Google's cloud via sync.
 */
import { newId } from '@/core/doc/ids'

import type { OutputKind } from './types'

const STORAGE_KEY = 'aiPrompts'

export type UserPrompt = {
  id: string
  name: string
  text: string
  output: OutputKind
  updatedAt: number
}

/** Hint for the empty list: shows what a prompt looks like, not a pretend catalog. */
export const PROMPT_EXAMPLES: readonly { name: string; text: string; output: OutputKind }[] = [
  {
    name: 'Alt-текст',
    text: 'Опиши этот скриншот одним предложением для alt-атрибута. Только описание, без вступления.',
    output: 'text',
  },
  {
    name: 'Текст с картинки',
    text: 'Извлеки весь текст со скриншота в markdown, сохраняя структуру списков и таблиц.',
    output: 'text',
  },
  {
    name: 'Заголовок тикета',
    text: 'Сформулируй по скриншоту короткий заголовок баг-репорта. Ответь только заголовком.',
    output: 'text',
  },
]

export function newPrompt(seed: Partial<UserPrompt> = {}, now = Date.now()): UserPrompt {
  return {
    id: newId('prompt'),
    name: '',
    text: '',
    output: 'text',
    updatedAt: now,
    ...seed,
  }
}

/**
 * Whether the prompt can be run. Empty text has nowhere to go; a missing name is
 * not an input error — a display name is derived automatically.
 */
export function isRunnable(prompt: UserPrompt): boolean {
  return prompt.text.trim() !== ''
}

/** List name: first line of the text when no explicit name was given. */
export function displayName(prompt: UserPrompt): string {
  const own = prompt.name.trim()
  if (own !== '') return own

  const line = prompt.text.trim().split('\n')[0] ?? ''
  return line.length > 40 ? `${line.slice(0, 40)}…` : line
}

export async function readPrompts(): Promise<UserPrompt[]> {
  const stored = await chrome.storage.local.get(STORAGE_KEY)
  return (stored[STORAGE_KEY] as UserPrompt[] | undefined) ?? []
}

export async function writePrompts(prompts: readonly UserPrompt[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: prompts })
}

/** Save: replaces by id, otherwise appends. */
export function upsert(
  prompts: readonly UserPrompt[],
  prompt: UserPrompt,
  now = Date.now(),
): UserPrompt[] {
  const updated = { ...prompt, updatedAt: now }
  const known = prompts.some((item) => item.id === prompt.id)

  return known
    ? prompts.map((item) => (item.id === prompt.id ? updated : item))
    : [...prompts, updated]
}

export function remove(prompts: readonly UserPrompt[], id: string): UserPrompt[] {
  return prompts.filter((prompt) => prompt.id !== id)
}
