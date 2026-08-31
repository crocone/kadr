/**
 * Offscreen document: clipboard, video recording and heavy rendering outside the
 * service worker. The MV3 worker suspends and would cut a recording short, so
 * MediaRecorder can only live here (PLAN.md §5).
 *
 * Phase 0: the document exists and answers ping — to be filled in during phases 2 and 7.
 */
import { registerMessageHandlers } from '@/core/messaging'

registerMessageHandlers({
  ping: () => ({ ok: true, from: 'offscreen' }),
})
