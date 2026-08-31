import { StrictMode } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'

import { AppProvider } from './AppProvider'

/** Single mount point for popup, editor, and options. */
export function mount(node: ReactNode, rootId = 'root'): void {
  const container = document.getElementById(rootId)
  if (!container) throw new Error(`Mount point #${rootId} not found`)
  createRoot(container).render(
    <StrictMode>
      <AppProvider>{node}</AppProvider>
    </StrictMode>,
  )
}
