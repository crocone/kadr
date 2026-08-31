/**
 * Progress is shown on the action-icon badge, not as an in-page overlay: any overlay
 * would have to be hidden before every frame and would flicker every half-second.
 */
const ACCENT = '#4f46e5'
const DANGER = '#dc2626'
const DONE = '#16a34a'

export function showProgress(done: number, total: number): void {
  const percent = total > 0 ? Math.round((done / total) * 100) : 0
  void chrome.action.setBadgeBackgroundColor({ color: ACCENT })
  void chrome.action.setBadgeText({ text: `${percent}%` })
}

export function showBusy(label: string): void {
  void chrome.action.setBadgeBackgroundColor({ color: ACCENT })
  void chrome.action.setBadgeText({ text: label })
}

export function showError(title: string): void {
  void chrome.action.setBadgeBackgroundColor({ color: DANGER })
  void chrome.action.setBadgeText({ text: '!' })
  void chrome.action.setTitle({ title })
}

/**
 * Copy and download do not open the editor, so without a mark on the icon there is no
 * telling whether anything happened at all. The check mark clears itself.
 */
export function showDone(title: string, ms = 2500): void {
  void chrome.action.setBadgeBackgroundColor({ color: DONE })
  void chrome.action.setBadgeText({ text: '✓' })
  void chrome.action.setTitle({ title })
  setTimeout(clearBadge, ms)
}

export function clearBadge(): void {
  void chrome.action.setBadgeText({ text: '' })
  void chrome.action.setTitle({ title: '' })
}
