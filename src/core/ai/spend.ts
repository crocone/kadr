/**
 * Spend counter.
 *
 * The extension does not know prices — each provider has its own and they change
 * — so it counts tokens and requests, not money. Lying with an exact sum is worse
 * than honest numbers that show where it all goes (PLAN.md §7).
 */
import type { AiUsage } from './types'

const STORAGE_KEY = 'aiSpend'

export type Spend = {
  requests: number
  input: number
  output: number
  /** When counting started; a reset begins a new period. */
  since: number
}

export function emptySpend(now = Date.now()): Spend {
  return { requests: 0, input: 0, output: 0, since: now }
}

export function addUsage(spend: Spend, usage: AiUsage): Spend {
  return {
    ...spend,
    requests: spend.requests + 1,
    input: spend.input + usage.input,
    output: spend.output + usage.output,
  }
}

export async function readSpend(): Promise<Spend> {
  const stored = await chrome.storage.local.get(STORAGE_KEY)
  return (stored[STORAGE_KEY] as Spend | undefined) ?? emptySpend()
}

export async function recordSpend(usage: AiUsage): Promise<Spend> {
  const next = addUsage(await readSpend(), usage)
  await chrome.storage.local.set({ [STORAGE_KEY]: next })

  return next
}

export async function resetSpend(now = Date.now()): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: emptySpend(now) })
}
